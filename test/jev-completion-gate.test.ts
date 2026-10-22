import type { Component } from "@oh-my-pi/pi-tui";
import type { Theme } from "@oh-my-pi/pi-tui/theme";
import { afterAll, afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { loadThemeSync } from "@oh-my-pi/pi-tui/theme/loader";
import { loadJudgeInternals, resetJudgeInternals } from "../lib/jev-judge.ts";

const directory = mkdtempSync(join(tmpdir(), "completion-gate-"));
const audit = join(directory, "decisions.jsonl");
const previousAudit = process.env.JEV_COMPLETION_GATE_AUDIT_LOG;
const previousVisibility = process.env.JEV_COMPLETION_GATE_VISIBILITY;
const previousConfig = process.env.JEV_COMPLETION_GATE_CONFIG;
const settingsPath = join(directory, "settings.json");
process.env.JEV_COMPLETION_GATE_CONFIG = settingsPath;
process.env.JEV_COMPLETION_GATE_AUDIT_LOG = audit;
delete process.env.JEV_COMPLETION_GATE_VISIBILITY;
// Exercise the normal startup default, without a visibility opt-in.
const { default: registerGate } = await import("../extensions/completion-judge.ts");
if (previousAudit === undefined) delete process.env.JEV_COMPLETION_GATE_AUDIT_LOG;
else process.env.JEV_COMPLETION_GATE_AUDIT_LOG = previousAudit;
afterEach(() => { resetJudgeInternals(); rmSync(settingsPath, { force: true }); });
afterAll(() => {
	rmSync(directory, { recursive: true, force: true });
	if (previousVisibility === undefined) delete process.env.JEV_COMPLETION_GATE_VISIBILITY;
	else process.env.JEV_COMPLETION_GATE_VISIBILITY = previousVisibility;
	if (previousConfig === undefined) delete process.env.JEV_COMPLETION_GATE_CONFIG;
	else process.env.JEV_COMPLETION_GATE_CONFIG = previousConfig;
});

function turn(request = "Implement the fix and verify it.", answer = "I will edit the failing handler next.") {
	const controller = new AbortController();
	const assistant = { role: "assistant", content: [{ type: "text", text: answer }], stopReason: "stop", timestamp: Date.now() };
	return {
		controller,
		event: {
			type: "session_stop", session_id: "completion-test", turn_id: 0, stop_hook_active: false,
			signal: controller.signal,
			messages: [{ role: "user", attribution: "user", content: [{ type: "text", text: request }] }, assistant],
			last_assistant_message: assistant,
		},
	};
}

interface RecapOptions {
	promptText: string;
	tools: false;
	minimizeEffort: true;
	dedupeReply: false;
	signal: AbortSignal;
}

interface JudgeInput {
	userRequest: string;
	terminalAnswer: string;
	recentContext: unknown[];
	decisionRecap?: { text: string; model: string };
}

type RecapProvider = (options: RecapOptions) => Promise<string>;
const defaultRecap = "The requested fix is still unfinished. The live next step is editing the failing handler, then verifying it.";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
}

async function fixture(
	classify: (input: JudgeInput) => Promise<unknown> = async () => ({ choice: "actionable", confidence: 0.1, probabilities: { actionable: 0.9, complete: 0.05, insufficient_evidence: 0.05 } }),
	model = "finite",
	options: {
		recap?: RecapProvider | null;
		model?: { provider: string; id: string } | null;
		branch?: () => unknown[];
		control?: (input: { userRequest: string }) => Promise<unknown>;
	} = {},
) {
	let calls = 0;
	let controlCalls = 0;
	let pending = false;
	const notices: string[] = [];
	const notifications: { text: string; level: string }[] = [];
	let widget: Component | undefined;
	const timeline: string[] = [];
	const inputs: JudgeInput[] = [];
	const recapRequests: RecapOptions[] = [];
	const handlers: Record<string, Function> = {};
	const commands: Record<string, { handler: Function }> = {};
	const synthetic = {
			primaryModel: () => ({ provider: "synthetic-native", id: model, api: "typesafe" }),
			judge: async (request: { state: JudgeInput; questions: Record<string, unknown> }) => {
				if (request.questions.humanControl) {
					controlCalls++;
					return { model, answers: { humanControl: options.control
						? await options.control(request.state)
						: { choice: "proceed", probabilities: { proceed: 0.9, stop: 0.05, uncertain: 0.05 } } } };
				}
				calls++;
				inputs.push(request.state);
				timeline.push("judge");
				return { model, answers: { continuation: await classify(request.state) } };
			},
	};
	await loadJudgeInternals(async () => ({
		settings: { getModelRole: () => "synthetic-native/finite", overlay: () => ({}) },
		journalJudgmentUsage: () => undefined,
		resolveJudge: () => synthetic,
		judgeWithTimeout: async ({ request }: { request: Parameters<typeof synthetic.judge>[0] }) => synthetic.judge(request),
	}));
	registerGate({
		on: (name: string, handler: Function) => { handlers[name] = handler; },
		registerCommand: (name: string, command: { handler: Function }) => { commands[name] = command; },
	} as never);
	const recap = options.recap === undefined ? async () => defaultRecap : options.recap;
	const context = {
		modelRegistry: {}, hasPendingMessages: () => pending, hasUI: true,
		sessionManager: {
			getBranch: () => options.branch?.() ?? [],
			getEntries: () => { throw new Error("All-branch evidence must never be read"); },
		},
		model: options.model === undefined ? { provider: "test-provider", id: "test-model" } : options.model ?? undefined,
		...(recap === null ? {} : {
			runEphemeralTurn: async (request: RecapOptions) => {
				recapRequests.push(request);
				timeline.push("recap");
				const replyText = await recap(request);
				return {
					replyText,
					assistantMessage: { role: "assistant", content: [{ type: "text", text: replyText }], stopReason: "stop" },
				};
			},
		}),
		ui: {
			theme: loadThemeSync("dark"),
			notify: (text: string, level: string) => {
				text = stripVTControlCharacters(text);
				notices.push(text);
				notifications.push({ text, level });
				timeline.push(text);
			},
			setWidget: (_key: string, factory: ((_tui: unknown, theme: Theme) => Component) | undefined) => {
				widget = factory?.({ terminal: { columns: 100 } }, context.ui.theme);
				const text = stripVTControlCharacters(widget?.render(100).join("\n") ?? "");
				notices.push(text);
				timeline.push(text);
			},
		},
	};
	return {
		settle: (event: unknown) => handlers.session_stop(event, context),
		setVisibility: (mode: string) => commands["completion-cards"]!.handler(mode, context),
		submit: async (text: string) => {
			await handlers.input?.({ type: "input", text, source: "interactive" }, context);
			timeline.push(`USER: ${text}`);
			await handlers.before_agent_start?.({ type: "before_agent_start" }, context);
			timeline.push("ASSISTANT: next reply");
		},
		widgetText: () => stripVTControlCharacters(widget?.render(100).join("\n") ?? ""),
		setPending: (value: boolean) => { pending = value; },
		calls: () => calls, notices, notifications, inputs, recapRequests, timeline,
		controlCalls: () => controlCalls,
		surfaceText: () => stripVTControlCharacters(widget?.render(100).join("\n") ?? notifications.map(notice => notice.text).join("\n")),
	};
}

function lastAudit() {
	return JSON.parse(readFileSync(audit, "utf8").trim().split("\n").at(-1)!);
}

test("duplicate delivery of a settled answer does not classify or resume it twice", async () => {
	const gate = await fixture();
	const { event } = turn();
	const result = await gate.settle(event);
	expect(result).toMatchObject({ continue: true });
	expect(lastAudit()).toMatchObject({ effect: "continue", decision: { model: "finite" } });
	expect(await gate.settle(event)).toBeUndefined();
	expect(gate.calls()).toBe(1);
	expect(gate.recapRequests).toHaveLength(1);
});
for (const visibility of ["full", "collapse", "hidden"] as const) {
	for (const state of ["actionable", "blocked", "insufficient_evidence"] as const) {
		test(`${visibility} cards deliver the current recap and ${state} result to the continuing model`, async () => {
			const recap = 'The handler is edited. Verify the "native import" next.\nDo not publish.';
			const gate = await fixture(async () => ({ choice: state, probabilities: { [state]: 0.9 } }),
				undefined, { recap: async () => recap });
			await gate.setVisibility(visibility);
			const result = await gate.settle(turn().event);
			expect(result.continue).toBe(true);
			const context = JSON.parse(result.additionalContext.split("\n")[1]);
			expect(context).toEqual({
				recap,
				result: {
					state, probability: 0.9,
					humanControl: { choice: "proceed", probabilities: { proceed: 0.9, stop: 0.05, uncertain: 0.05 } },
					effect: state === "actionable" ? "continue" : "review",
					reason: state === "insufficient_evidence" ? "insufficient-evidence" : state,
				},
			});
		});
	}
}


test("a silent settled ending can continue unfinished work after a fresh recap", async () => {
	const gate = await fixture();
	const { event } = turn("Finish the private correction; do not post routine worker updates.", "");
	expect(await gate.settle(event)).toMatchObject({ continue: true });
	expect(lastAudit()).toMatchObject({ effect: "continue", input: { terminalAnswer: { length: 0 } } });
	expect(await gate.settle(event)).toBeUndefined();
	expect(gate.calls()).toBe(1);
	expect(gate.recapRequests).toHaveLength(1);
});

test("a silent ending deferred for queued input is judged once after the queue clears and can stop", async () => {
	const gate = await fixture(async () => { throw new Error("Human stop must not classify work"); }, undefined, {
		control: async () => ({ choice: "stop", probabilities: { stop: 0.9 } }),
		recap: async () => "The user requested silence and stopping. All requested work is delivered; no live next step remains.",
	});
	const { event } = turn("Everything is complete. Stop without another update.", "");
	gate.setPending(true);
	expect(await gate.settle(event)).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(gate.recapRequests).toHaveLength(0);
	gate.setPending(false);
	expect(await gate.settle(event)).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(gate.controlCalls()).toBe(1);
	expect(lastAudit()).toMatchObject({ effect: "stop", input: { terminalAnswer: { length: 0 } } });
});

test("continued turns are rejudged until a later stop decision ends the chain", async () => {
	const choices = ["actionable", "actionable", "complete"];
	let nextChoice = 0;
	let nextRecap = 0;
	const recaps = [
		"The handler still needs editing.",
		"The edit is complete; verification is next.",
		"The fix and verification are complete; no committed next step remains.",
	];
	const gate = await fixture(async () => {
		const choice = choices[nextChoice++];
		return { choice, probabilities: { [choice]: 0.9 }, confidence: 0.1 };
	}, undefined, { recap: async () => recaps[nextRecap++]! });
	const first = turn();
	expect(await gate.settle(first.event)).toMatchObject({ continue: true });

	const second = turn("Implement the fix and verify it.", "The edit is complete; the real import verification is still pending.");
	second.event.stop_hook_active = true;
	second.event.turn_id = 1;
	expect(await gate.settle(second.event)).toMatchObject({ continue: true });
	expect(lastAudit()).toMatchObject({ turnId: 1, effect: "continue" });

	const third = turn("Implement the fix and verify it.", "The fix and real import verification are complete.");
	third.event.stop_hook_active = true;
	third.event.turn_id = 2;
	expect(await gate.settle(third.event)).toBeUndefined();
	expect(lastAudit()).toMatchObject({ turnId: 2, effect: "stop", decision: { choice: "complete" } });
	expect(gate.calls()).toBe(3);
	expect(gate.recapRequests).toHaveLength(3);
	expect(gate.inputs.map(input => input.decisionRecap?.text)).toEqual(recaps);
});

test("a fresh user turn with identical text is not suppressed by an earlier request fingerprint", async () => {
	const gate = await fixture();
	expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
	expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
});

test("invalid probabilities cannot request execution or review despite a high confidence field", async () => {
	for (const probability of [NaN, Infinity, undefined, -1, 1.01]) {
		resetJudgeInternals();
		const gate = await fixture(async () => ({ choice: "actionable", confidence: 1, probabilities: { actionable: probability } }));
		expect(await gate.settle(turn().event)).toBeUndefined();
		expect(lastAudit()).toMatchObject({ effect: "low-probability", routeReason: "invalid-probability" });
	}
});

test("strict-majority boundary separates evidence review from actionable continuation", async () => {
	for (const probability of [0, 0.49, 0.5, 0.5001, 1]) {
		resetJudgeInternals();
		const gate = await fixture(async () => ({ choice: "actionable", confidence: 1, probabilities: { actionable: probability } }));
		expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
		expect(lastAudit().effect).toBe(probability > 0.5 ? "continue" : "review");
		const next = turn();
		next.event.stop_hook_active = true;
		if (probability > 0.5) expect(await gate.settle(next.event)).toMatchObject({ continue: true });
		else expect(await gate.settle(next.event)).toBeUndefined();
		expect(lastAudit().effect).toBe(probability > 0.5 ? "continue" : "low-probability");
	}
});

test("unclear evidence gets one native review, not completion or an endless review chain", async () => {
	const gate = await fixture(async () => ({
		choice: "insufficient_evidence", probabilities: { insufficient_evidence: 0.8 },
	}));
	const first = turn("Inspect the unresolved condition.", "The current evidence is contradictory.");
	expect(await gate.settle(first.event)).toMatchObject({ continue: true });
	expect(lastAudit()).toMatchObject({ effect: "review", routeReason: "insufficient-evidence" });
	expect(await gate.settle(first.event)).toBeUndefined();

	const second = turn("Inspect the unresolved condition.", "The permitted inspection did not resolve the ambiguity.");
	second.event.stop_hook_active = true;
	second.event.turn_id = 1;
	expect(await gate.settle(second.event)).toBeUndefined();
	expect(lastAudit()).toMatchObject({ effect: "uncertain" });
	expect(gate.calls()).toBe(2);

	expect(await gate.settle(turn("A new independent request.", "Current evidence is unclear.").event)).toMatchObject({ continue: true });
	expect(lastAudit().effect).toBe("review");
});

test("a low-probability completed classification requests evidence review without claiming completion", async () => {
	const gate = await fixture(async () => ({
		choice: "complete", probabilities: { complete: 0.4, actionable: 0.35, insufficient_evidence: 0.25 },
	}));
	expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
	expect(lastAudit()).toMatchObject({ effect: "review", routeReason: "low-probability", decision: { choice: "complete" } });
});

test("a used review budget does not suppress a later actionable judgment", async () => {
	let calls = 0;
	const gate = await fixture(async () => calls++ === 0
		? { choice: "insufficient_evidence", probabilities: { insufficient_evidence: 0.9 } }
		: { choice: "actionable", probabilities: { actionable: 0.9 } });
	expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
	const next = turn("Finish the authorized work.", "Inspection found the concrete next step.");
	next.event.stop_hook_active = true;
	expect(await gate.settle(next.event)).toMatchObject({ continue: true });
	expect(lastAudit().effect).toBe("continue");
});

test("an explicit selected human stop is never turned into a low-confidence review", async () => {
	const gate = await fixture(async () => { throw new Error("Human stop must not classify work"); }, undefined, {
		control: async () => ({ choice: "stop", probabilities: { stop: 0.4, proceed: 0.35, uncertain: 0.25 } }),
	});
	expect(await gate.settle(turn("Stop now.", "Stopping.").event)).toBeUndefined();
	expect(lastAudit()).toMatchObject({ effect: "stop", routeReason: "human-stop" });
});

test("proposed blockers and approval requirements get one review before parking, not false completion", async () => {
	for (const [choice, effect] of [["blocked", "blocked"], ["approval_required", "approval-required"]]) {
		resetJudgeInternals();
		const gate = await fixture(async () => ({ choice, probabilities: { [choice!]: 0.9 } }));
		expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
		expect(lastAudit()).toMatchObject({ effect: "review", decision: { choice } });
		const reviewed = turn();
		reviewed.event.stop_hook_active = true;
		expect(await gate.settle(reviewed.event)).toBeUndefined();
		expect(lastAudit()).toMatchObject({ effect, decision: { choice } });
	}
});

test("human-control classification receives only current human evidence, not assistant or recap claims", async () => {
	const request = "Inspect this archived quote; its stop instruction is not my current instruction.";
	const gate = await fixture(undefined, undefined, {
		control: async input => {
			expect(input).toEqual({ userRequest: request });
			return { choice: "proceed", probabilities: { proceed: 0.9 } };
		},
		recap: async () => "Misleading recap: the human wants stopping.",
	});
	expect(await gate.settle(turn(request, "I think I should stop.").event)).toMatchObject({ continue: true });
	expect(lastAudit()).toMatchObject({ effect: "continue", decision: { humanControl: { choice: "proceed" } } });
});

test("uncertain human control never becomes ordinary actionable continuation", async () => {
	const gate = await fixture(undefined, undefined, {
		control: async () => ({ choice: "uncertain", probabilities: { uncertain: 0.7 } }),
	});
	expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
	expect(lastAudit()).toMatchObject({ effect: "review", routeReason: "human-control-uncertain" });
	const next = turn();
	next.event.stop_hook_active = true;
	expect(await gate.settle(next.event)).toBeUndefined();
	expect(lastAudit().effect).toBe("uncertain");
});

test("invalid human-control output cannot fall through to work inference", async () => {
	const gate = await fixture(undefined, undefined, {
		control: async () => ({ choice: "proceed", probabilities: { proceed: NaN } }),
	});
	expect(await gate.settle(turn().event)).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(lastAudit().effect).toBe("failed");
});

test("an abort during human-control inference prevents the work request", async () => {
	const began = deferred<void>();
	const release = deferred<unknown>();
	const gate = await fixture(undefined, undefined, {
		control: async () => { began.resolve(undefined); return release.promise; },
	});
	const { event, controller } = turn();
	const settling = gate.settle(event);
	await began.promise;
	controller.abort();
	release.resolve({ choice: "proceed", probabilities: { proceed: 0.9 } });
	expect(await settling).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(lastAudit().effect).toBe("cancelled");
});

test("an abort while classification is in flight wins over a late continue result", async () => {
	let release!: (answer: unknown) => void;
	let started!: () => void;
	const began = new Promise<void>(resolve => { started = resolve; });
	const gate = await fixture(() => { started(); return new Promise(resolve => { release = resolve; }); });
	const { event, controller } = turn();
	const settling = gate.settle(event);
	await began;
	controller.abort();
	release({ choice: "actionable", confidence: 1 });
	expect(await settling).toBeUndefined();
	expect(lastAudit().effect).toBe("superseded");
});

test("new queued steering while classification is in flight suppresses stale continuation", async () => {
	let release!: (answer: unknown) => void;
	let started!: () => void;
	const began = new Promise<void>(resolve => { started = resolve; });
	const gate = await fixture(() => { started(); return new Promise(resolve => { release = resolve; }); });
	const settling = gate.settle(turn().event);
	await began;
	gate.setPending(true);
	release({ choice: "actionable", confidence: 1 });
	expect(await settling).toBeUndefined();
	expect(lastAudit().effect).toBe("superseded");
});

test("unavailable or wrong-model judges cannot produce an approval or invoke fallback inference", async () => {
	const gate = await fixture(async () => ({ choice: "actionable", confidence: 1 }), "hosted-other-model");
	expect(await gate.settle(turn().event)).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(lastAudit()).toMatchObject({ effect: "failed", decision: { kind: "unavailable" } });
});

test("provider failure is audited as failure rather than a completion verdict", async () => {
	const gate = await fixture(async () => { throw new Error("local inference deadline"); });
	expect(await gate.settle(turn().event)).toBeUndefined();
	expect(lastAudit()).toMatchObject({ effect: "failed", decision: { status: "failed" } });
	expect(lastAudit().stage).toBe("judge");
});

test("repeated provider failures replace pending UI without inventing a selected verdict", async () => {
	const gate = await fixture(async () => { throw new Error("inference unavailable"); });
	for (let attempt = 0; attempt < 2; attempt++) {
		expect(await gate.settle(turn().event)).toBeUndefined();
		const surface = gate.surfaceText();
		expect(surface.replace(/[│\s]+/gu, " ")).toContain("inference unavailable");
		expect(surface).not.toContain("Judging...");
		expect(surface).not.toContain("SELECTED");
	}
});

test("oversized evidence is rejected intact rather than silently discarding the user's constraints", async () => {
	const gate = await fixture();
	expect(await gate.settle(turn("x".repeat(64 * 1024)).event)).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(lastAudit().input.userRequest.length).toBe(64 * 1024);
});

test("aborted answers and pending input do not start classification", async () => {
	const gate = await fixture();
	const { event } = turn();
	event.last_assistant_message.stopReason = "aborted";
	expect(await gate.settle(event)).toBeUndefined();
	gate.setPending(true);
	expect(await gate.settle(turn().event)).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(gate.recapRequests).toHaveLength(0);
});

test("classification and continuation wait for the tools-disabled recap, with recap UI before judge UI", async () => {
	const began = deferred<void>();
	const release = deferred<string>();
	const recap = "The fix is unfinished.\n\n  Next:\t edit the handler, then verify.";
	const gate = await fixture(undefined, undefined, {
		recap: async () => { began.resolve(undefined); return release.promise; },
	});
	const { event } = turn();
	event.messages.unshift({
		role: "assistant", content: [{ type: "text", text: "The previous inspection isolated the failing handler." }],
		stopReason: "stop", timestamp: Date.now(),
	});
	let settled = false;
	const settling = gate.settle(event).then((result: unknown) => { settled = true; return result; });
	await began.promise;
	expect(gate.calls()).toBe(0);
	expect(settled).toBe(false);
	expect(gate.notices).toHaveLength(0);
	expect(gate.recapRequests).toHaveLength(1);
	const request = gate.recapRequests[0]!;
	expect(request).toMatchObject({ tools: false, dedupeReply: false });
	expect(request.signal).toBeInstanceOf(AbortSignal);
	expect(request.signal.aborted).toBe(false);

	release.resolve(recap);
	expect(await settling).toMatchObject({ continue: true });
	expect(gate.calls()).toBe(1);
	expect(gate.inputs[0]).toMatchObject({
		userRequest: "Implement the fix and verify it.",
		terminalAnswer: "I will edit the failing handler next.",
		recentContext: [{ role: "assistant", text: "The previous inspection isolated the failing handler." }],
		decisionRecap: { text: recap, model: "test-provider/test-model" },
	});
	const recapIndex = gate.timeline.indexOf(gate.notices[0]!);
	const judgeIndex = gate.timeline.indexOf("judge");
	const verdictIndex = gate.timeline.indexOf(gate.notices[1]!);
	expect(recapIndex).toBeGreaterThanOrEqual(0);
	expect(judgeIndex).toBeGreaterThan(recapIndex);
	expect(verdictIndex).toBeGreaterThan(judgeIndex);
});

test("the completed UI replaces pending state while retaining the recap before the verdict", async () => {
	const gate = await fixture();
	await gate.settle(turn().event);
	const rendered = gate.surfaceText();
	expect(rendered).toContain("The requested fix is still unfinished.");
	expect(rendered).toMatch(/Actionable\s+90\.0%\s+SELECTED/);
	expect(rendered.indexOf("The requested fix")).toBeLessThan(rendered.indexOf("SELECTED"));
});

test("card modes change the latest verdict without rejudging or suppressing continuation", async () => {
	const gate = await fixture();
	await gate.setVisibility("hidden");
	expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
	expect(gate.surfaceText()).toBe("");
	expect(gate.calls()).toBe(1);
	await gate.setVisibility("collapse");
	await gate.setVisibility("full");
	expect(gate.surfaceText().replace(/[│\s]+/g, " ")).toContain(defaultRecap);
	expect(gate.surfaceText()).toMatch(/Actionable\s+90\.0%\s+SELECTED/);
	await gate.setVisibility("hidden");
	expect(gate.surfaceText()).toBe("");
	expect(gate.calls()).toBe(1);
	expect(gate.controlCalls()).toBe(1);
});

for (const mode of ["full", "collapse", "hidden"]) {
	test(`${mode} cards stay before the next human prompt, not below it`, async () => {
		const gate = await fixture(async () => ({ choice: "complete", probabilities: { complete: 0.9 } }));
		await gate.setVisibility(mode);
		await gate.settle(turn().event);
		await gate.submit("Now inspect the other handler.");
		expect(gate.widgetText()).toBe("");
		const archived = gate.notifications;
		if (mode === "hidden") {
			expect(archived).toEqual([]);
		} else {
			expect(archived).toHaveLength(1);
			const cardIndex = gate.timeline.indexOf(archived[0]!.text);
			expect(cardIndex).toBeLessThan(gate.timeline.indexOf("USER: Now inspect the other handler."));
		}
		await gate.setVisibility("full");
		expect(gate.widgetText()).toBe("");
		expect(gate.calls()).toBe(1);
	});
}

test("a verdict arriving after a new prompt cannot restore the old card", async () => {
	const began = deferred<void>();
	const release = deferred<unknown>();
	const gate = await fixture(async () => { began.resolve(undefined); return release.promise; });
	const settling = gate.settle(turn().event);
	await began.promise;
	await gate.submit("Stop that work; inspect this instead.");
	gate.setPending(true);
	release.resolve({ choice: "complete", probabilities: { complete: 0.95 } });
	expect(await settling).toBeUndefined();
	expect(gate.widgetText()).toBe("");
	expect(gate.notifications).toEqual([]);
});

test("hiding a pending card stays hidden when the judgment resolves", async () => {
	const began = deferred<void>();
	const release = deferred<unknown>();
	const gate = await fixture(async () => { began.resolve(undefined); return release.promise; });
	const settling = gate.settle(turn().event);
	await began.promise;
	await gate.setVisibility("hidden");
	release.resolve({ choice: "complete", probabilities: { complete: 0.95 } });
	expect(await settling).toBeUndefined();
	expect(gate.surfaceText()).toBe("");
	await gate.setVisibility("collapse");
	expect(gate.widgetText()).toContain("95.0%");
	expect(gate.widgetText()).not.toContain("Judging...");
	expect(gate.calls()).toBe(1);
});

test("saving collapsed mode applies to a fresh registration without another opt-in", async () => {
	const gate = await fixture();
	await gate.setVisibility("collapse --save");
	resetJudgeInternals();
	const resumed = await fixture();
	expect(await resumed.settle(turn().event)).toMatchObject({ continue: true });
	expect(gate.calls()).toBe(0);
});

for (const interruption of ["abort", "pending input"] as const) {
	test(`${interruption} during recap prevents classification, stale recap UI, and continuation`, async () => {
		const began = deferred<void>();
		const release = deferred<string>();
		const gate = await fixture(undefined, undefined, {
			recap: async () => { began.resolve(undefined); return release.promise; },
		});
		const { event, controller } = turn();
		const settling = gate.settle(event);
		await began.promise;
		if (interruption === "abort") {
			controller.abort();
			expect(gate.recapRequests[0]!.signal.aborted).toBe(true);
		} else {
			gate.setPending(true);
		}
		release.resolve("This late recap must never be shown or classified.");
		expect(await settling).toBeUndefined();
		expect(gate.calls()).toBe(0);
		expect(gate.inputs).toHaveLength(0);
		expect(gate.notices).toHaveLength(0);
		expect(lastAudit().stage).toBe("recap");
		if (interruption === "abort") expect(["cancelled", "superseded"]).toContain(lastAudit().effect);
		else expect(lastAudit().effect).toBe("superseded");
	});
}

const invalidRecaps: { name: string; recap: RecapProvider | null }[] = [
	{ name: "empty", recap: async () => "" },
	{ name: "whitespace-only", recap: async () => " \n\t " },
	{ name: "oversized", recap: async () => "x".repeat(1_201) },
	{ name: "failed", recap: async () => { throw new Error("side-turn generation failed"); } },
	{ name: "missing provider", recap: null },
];

for (const { name, recap } of invalidRecaps) {
	test(`${name} recap abstains without a raw-evidence classification fallback`, async () => {
		const gate = await fixture(undefined, undefined, { recap });
		expect(await gate.settle(turn().event)).toBeUndefined();
		expect(gate.calls()).toBe(0);
		expect(gate.inputs).toHaveLength(0);
		expect(gate.recapRequests).toHaveLength(recap === null ? 0 : 1);
		expect(lastAudit()).toMatchObject({ stage: "recap", effect: "failed", decision: { status: "failed" } });
	});
}

for (const length of [1, 1_200]) {
	test(`a ${length}-character recap is accepted at the inclusive bound`, async () => {
		const text = "x".repeat(length);
		const gate = await fixture(undefined, undefined, { recap: async () => text, model: null });
		expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
		expect(gate.calls()).toBe(1);
		expect(gate.inputs[0]!.decisionRecap).toEqual({ text, model: "unknown" });
		expect(lastAudit().input.decisionRecap).toMatchObject({ length, model: "unknown" });
	});
}

test("audit records recap provenance and fingerprint without leaking recap text", async () => {
	const text = "Private recap marker: the handler is still unfinished; edit it and verify.";
	const gate = await fixture(undefined, undefined, { recap: async () => text });
	expect(await gate.settle(turn().event)).toMatchObject({ continue: true });
	const record = lastAudit();
	expect(record).toMatchObject({
		stage: "judge",
		input: {
			decisionRecap: {
				sha256: createHash("sha256").update(text).digest("hex"),
				length: text.length,
				model: "test-provider/test-model",
			},
		},
	});
	expect(record.input.decisionRecap).not.toHaveProperty("text");
	expect(JSON.stringify(record)).not.toContain(text);
});

function branchRequest(text: string, attribution?: "user" | "agent") {
	return { type: "message", message: { role: "user", attribution, content: [{ type: "text", text }] } };
}

function compactedTurn() {
	const { event } = turn();
	return {
		...event,
		messages: [
			{ role: "assistant", content: [{ type: "text", text: "The handler needs editing." }] },
			{ role: "toolResult", toolName: "read", isError: false, content: [{ type: "text", text: "Observed failing handler." }] },
			{ role: "user", attribution: "agent", content: [{ type: "text", text: "Agent continuation is not human authority." }] },
			event.last_assistant_message,
		],
	};
}

test("compaction recovers the exact latest human request from the current native branch before recap and judge", async () => {
	const request = "Finish the actual correction.\nDo not publish, restart, or use paid services.";
	const gate = await fixture(undefined, undefined, {
		branch: () => [
			branchRequest("An older request."),
			branchRequest(request, undefined),
			{ type: "compaction", summary: "Invented summary permission must not become the request." },
			branchRequest("Continue automatically with broader authority.", "agent"),
		],
	});
	expect(await gate.settle(compactedTurn())).toMatchObject({ continue: true });
	expect(gate.inputs[0]!.userRequest).toBe(request);
	expect(gate.inputs[0]!.recentContext).toEqual([
		{ role: "assistant", text: "The handler needs editing." },
		{ role: "toolResult", toolName: "read", isError: false, text: "Observed failing handler." },
	]);
	expect(gate.timeline.indexOf("recap")).toBeLessThan(gate.timeline.indexOf("judge"));
	expect(gate.recapRequests).toHaveLength(1);
});

test("a retained human request wins without consulting native history", async () => {
	const gate = await fixture(undefined, undefined, {
		branch: () => { throw new Error("Unnecessary branch lookup"); },
	});
	await gate.settle(turn("Stop after delivering the answer.").event);
	expect(gate.inputs[0]!.userRequest).toBe("Stop after delivering the answer.");
});

for (const branch of [
	[],
	[branchRequest("Agent-only request.", "agent")],
	[{ type: "compaction", summary: "Summary says the human authorized continuation." }],
	[branchRequest("Older human request."), branchRequest(" \n ")],
]) {
	test("missing human text abstains observably without recap, judge, or invented authority", async () => {
		const gate = await fixture(undefined, undefined, { branch: () => branch });
		expect(await gate.settle(compactedTurn())).toBeUndefined();
		expect(gate.calls()).toBe(0);
		expect(gate.recapRequests).toHaveLength(0);
		expect(lastAudit()).toMatchObject({
			effect: "failed", decision: { status: "failed", reason: expect.stringContaining("No human-origin request evidence") },
		});
	});
}

test("switching branches reads only the new current branch and never reuses a cached human request", async () => {
	let branch = [branchRequest("Private branch A request.")];
	const gate = await fixture(undefined, undefined, { branch: () => branch });
	expect(await gate.settle(compactedTurn())).toMatchObject({ continue: true });
	branch = [branchRequest("Branch B: stop; do not resume branch A.")];
	await gate.settle(compactedTurn());
	expect(gate.inputs.map(input => input.userRequest)).toEqual([
		"Private branch A request.", "Branch B: stop; do not resume branch A.",
	]);
	branch = [];
	expect(await gate.settle(compactedTurn())).toBeUndefined();
	expect(gate.calls()).toBe(2);
	expect(gate.recapRequests).toHaveLength(2);
	expect(lastAudit().effect).toBe("failed");
});

test("oversized recovered human evidence is rejected intact before recap or judge", async () => {
	const gate = await fixture(undefined, undefined, { branch: () => [branchRequest("x".repeat(64 * 1024))] });
	expect(await gate.settle(compactedTurn())).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(gate.recapRequests).toHaveLength(0);
	expect(lastAudit()).toMatchObject({ effect: "failed", input: { userRequest: { length: 64 * 1024 } } });
});

test("native branch lookup failure is observable and cannot fall back to summaries or another branch", async () => {
	const gate = await fixture(undefined, undefined, {
		branch: () => { throw new Error("Native branch lookup unavailable"); },
	});
	expect(await gate.settle(compactedTurn())).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(gate.recapRequests).toHaveLength(0);
	expect(lastAudit()).toMatchObject({
		effect: "failed", decision: { reason: expect.stringContaining("Native branch lookup unavailable") },
	});
});

test("compacted turns preserve pending-input, cancellation, stop-reason, and duplicate guards before branch recovery", async () => {
	let lookups = 0;
	const gate = await fixture(undefined, undefined, {
		branch: () => { lookups++; return [branchRequest("Finish the authorized correction.")]; },
	});
	gate.setPending(true);
	expect(await gate.settle(compactedTurn())).toBeUndefined();
	gate.setPending(false);
	const aborted = compactedTurn();
	const controller = new AbortController();
	controller.abort();
	expect(await gate.settle({ ...aborted, signal: controller.signal })).toBeUndefined();
	const failed = compactedTurn();
	failed.last_assistant_message.stopReason = "error";
	expect(await gate.settle(failed)).toBeUndefined();
	expect(lookups).toBe(0);
	const event = compactedTurn();
	expect(await gate.settle(event)).toMatchObject({ continue: true });
	expect(await gate.settle(event)).toBeUndefined();
	expect(lookups).toBe(1);
	expect(gate.calls()).toBe(1);
	expect(gate.recapRequests).toHaveLength(1);
});

test("an empty retained human message cannot revive an older branch request", async () => {
	const gate = await fixture(undefined, undefined, {
		branch: () => { throw new Error("Older requests must not replace a retained human message"); },
	});
	expect(await gate.settle(turn(" \n ").event)).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(gate.recapRequests).toHaveLength(0);
	expect(lastAudit().decision.reason).toContain("No human-origin request evidence");
});

test("a durable clear boundary prevents recovering pre-clear human authority but permits a new post-clear request", async () => {
	const beforeClear = branchRequest("Old request: continue unfinished work.");
	const cleared = { type: "reset_boundary" };
	let branch: unknown[] = [
		beforeClear,
		cleared,
		{ type: "compaction", summary: "Old request summarized after clear is not new authority." },
		branchRequest("Agent continuation after clear.", "agent"),
	];
	const gate = await fixture(undefined, undefined, { branch: () => branch });
	expect(await gate.settle(compactedTurn())).toBeUndefined();
	expect(gate.calls()).toBe(0);
	expect(gate.recapRequests).toHaveLength(0);
	expect(lastAudit()).toMatchObject({ effect: "failed", decision: {
		reason: expect.stringContaining("No human-origin request evidence"),
	} });

	const request = "New post-clear request: inspect only; do not resume the old work.";
	branch = [beforeClear, cleared, branchRequest(request), { type: "compaction", summary: "New context compacted." }];
	expect(await gate.settle(compactedTurn())).toMatchObject({ continue: true });
	expect(gate.inputs[0]!.userRequest).toBe(request);
	expect(gate.calls()).toBe(1);
	expect(gate.recapRequests).toHaveLength(1);
});
