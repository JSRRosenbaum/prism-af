// Judges settled answers through OMP's cancellable stop hook; never grants authority or dispatches a second queue.
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionStopEvent } from "@oh-my-pi/pi-coding-agent";
import { appendAudit, createJudge, describeJudgeFailure, fingerprint, textFromContent } from "../lib/jev-judge.ts";
import { createCompletionView, formatRetiredCompletionView, type CompletionView } from "../lib/jev-completion-view.ts";
import { loadCompletionVisibility, saveCompletionVisibility } from "../lib/jev-completion-settings.ts";
import {
	COMPLETION_CONTRACT_VERSION, COMPLETION_INSTRUCTIONS, HUMAN_CONTROL_QUESTION, WORK_CRITERIA,
	isHumanControl, isWorkState, routeCompletionDecision, type CompletionDecision,
} from "../lib/jev-completion-contract.ts";

const MAX_TERMINAL_ANSWER_CHARS = 24_000;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_RECAP_CHARS = 1_200;
const CLASSIFIER_PROMPT_VERSION = "2026-10-21-portable-v1";
const CONTINUATION_POLICY_VERSION = "2026-10-22-portable-v3";
const RECAP_PROMPT_VERSION = "2026-10-22-portable-v2";
const RECAP_PROMPT = [
	"Write a decision recap for the continuation judge from the current conversation, in fewer than 80 words. Use three brief labels: Delivered; Remaining; Next.",
	"Delivered: what is actually delivered and verified. Remaining: the original requested outcome or established live commitment/interest that is still unmet, or explicitly none.",
	"Next: one concrete reachable action within existing permission that advances that remaining outcome, or explicitly none. Name the action, not a promise to continue or another status report.",
	"Evaluate completion against the human's requested outcome, not just the latest substep. Recovery, installation, verification, and activation are distinct; do not mark a requested working outcome complete after only retrieval.",
	"Conversely, do not turn an optional enhancement, unrequested implementation, or later activation into unfinished assigned work after a sufficient informational answer. Keep genuine established interests distinct from the completed assignment.",
	"If no step is reachable, name the observed external dependency or genuinely new approval needed and the condition that would unblock it. A restriction on a later action does not block an earlier permitted step.",
	"Use only responsibilities and permissions established in the current conversation. Do not invent an exploration remit, busywork, or permission from a previous summary. Human stops and redirects override earlier requests. Describe missing or conflicting evidence honestly.",
	"Return only the brief operational recap, not an answer to the user, instructions to the judge, or tool calls.",
].join(" ");
const auditLogPath =
	process.env.JEV_COMPLETION_GATE_AUDIT_LOG ||
	join(homedir(), ".omp", "agent", "logs", "jev-completion-gate.jsonl");

interface ContextItem {
	role: "user" | "assistant" | "toolResult";
	toolName?: string;
	isError?: boolean;
	text?: string;
	omittedChars?: number;
}

interface CompletionInput {
	userRequest: string;
	terminalAnswer: string;
	recentContext: ContextItem[];
	decisionRecap?: { text: string; model: string };
}

interface RecapRequestTelemetry {
	at: string;
	model?: string;
	payloadBytes: number;
	inputItems?: number;
	toolDefinitions?: number;
	maxOutputTokens?: number;
	previousResponseReferenced: boolean;
}

function classifierInput(event: SessionStopEvent): CompletionInput {
	let userIndex = -1;
	for (let index = event.messages.length - 1; index >= 0; index--) {
		const message = event.messages[index];
		if (message.role === "user" && message.attribution !== "agent") {
			userIndex = index;
			break;
		}
	}
	const recentContext: ContextItem[] = [];
	const counts = { user: 0, assistant: 0, toolResult: 0 };
	for (let index = event.messages.length - 1; index >= 0; index--) {
		const message = event.messages[index];
		if (index === userIndex || message === event.last_assistant_message) continue;
		if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") continue;
		if (message.role === "user" && message.attribution === "agent") continue;
		if (counts[message.role] >= 2) continue;
		const text = textFromContent(message.content).trim();
		if (!text) continue;
		counts[message.role]++;
		recentContext.push({
			role: message.role,
			...(message.role === "toolResult" ? { toolName: message.toolName, isError: message.isError } : {}),
			text,
		});
		if (counts.user === 2 && counts.assistant === 2 && counts.toolResult === 2) break;
	}
	// Prefer complete human constraints, then observations, then assistant commentary.
	// Whole omitted messages are marked; excerpts must not hide a trailing constraint or failure.
	let remaining = MAX_CONTEXT_CHARS;
	for (const role of ["user", "toolResult", "assistant"] as const) {
		for (const item of recentContext) {
			if (item.role !== role) continue;
			if (item.text!.length <= remaining) remaining -= item.text!.length;
			else {
				item.omittedChars = item.text!.length;
				delete item.text;
			}
		}
	}
	return {
		recentContext: recentContext.reverse(),
		userRequest: textFromContent(event.messages[userIndex]?.content).trim(),
		terminalAnswer: textFromContent(event.last_assistant_message?.content).trim(),
	};
}

function recordDecision(event: SessionStopEvent, input: CompletionInput, decision: unknown, effect: string, stage: "evidence" | "recap" | "judge", routeReason?: string, recapRequests?: RecapRequestTelemetry[]): void {
	appendAudit(auditLogPath, {
		version: 5,
		plugin: "prism-af",
		pluginVersion: "0.1.0",
		decisionContractVersion: COMPLETION_CONTRACT_VERSION,
		promptVersion: CLASSIFIER_PROMPT_VERSION,
		continuationPolicyVersion: CONTINUATION_POLICY_VERSION,
		at: new Date().toISOString(),
		sessionId: event.session_id,
		turnId: event.turn_id,
		input: {
			...(input.decisionRecap ? {
				decisionRecap: {
					promptVersion: RECAP_PROMPT_VERSION,
					sha256: fingerprint(input.decisionRecap.text),
					length: input.decisionRecap.text.length,
					model: input.decisionRecap.model,
				},
			} : {}),
			userRequest: { sha256: fingerprint(input.userRequest), length: input.userRequest.length },
			terminalAnswer: { sha256: fingerprint(input.terminalAnswer), length: input.terminalAnswer.length },
			recentContext: {
				sha256: fingerprint(JSON.stringify(input.recentContext)),
				length: input.recentContext.reduce((length, item) => length + (item.text?.length ?? 0), 0),
				entries: input.recentContext.length,
				omitted: input.recentContext.filter(item => item.omittedChars !== undefined).length,
			},
		},
		...(recapRequests?.length ? { recapRequests } : {}),
		decision,
		stage,
		effect,
		...(routeReason ? { routeReason } : {}),
	});
}

async function recapCompletion(ctx: ExtensionContext, signal: AbortSignal) {
	if (!ctx.runEphemeralTurn) throw new Error("OMP cannot generate a decision recap; no completion verdict was requested");
	const { replyText } = await ctx.runEphemeralTurn({
		promptText: RECAP_PROMPT,
		tools: false,
		minimizeEffort: true,
		dedupeReply: false,
		signal,
	});
	signal.throwIfAborted();
	const text = replyText.trim();
	if (!text || text.length > MAX_RECAP_CHARS) {
		throw new Error("Decision recap must contain 1..1200 characters; no recap was truncated or substituted");
	}
	return { text, model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown" };
}

async function classifyCompletion(input: CompletionInput, ctx: ExtensionContext, signal: AbortSignal): Promise<CompletionDecision & { status: "classified" }> {
	const judge = createJudge(ctx, "completion-gate", 28_000);
	const controlResult = await judge.judge({
		state: { userRequest: input.userRequest },
		questions: { humanControl: HUMAN_CONTROL_QUESTION },
	}, { signal });
	signal.throwIfAborted();
	if (ctx.hasPendingMessages()) throw new Error("Human-control classification superseded by pending input");
	const controlAnswer = controlResult.answers.humanControl;
	if (!isHumanControl(controlAnswer?.choice)) throw new Error("Local judge returned no valid human-control decision");
	const humanControl = {
		choice: controlAnswer.choice, confidence: controlAnswer.confidence, probabilities: controlAnswer.probabilities,
	};
	const controlProbability = humanControl.probabilities?.[humanControl.choice];
	if (!Number.isFinite(controlProbability) || controlProbability! < 0 || controlProbability! > 1) {
		throw new Error("Local judge returned an invalid human-control probability");
	}
	if (humanControl.choice === "stop") return {
		status: "classified",
		choice: "stopped", confidence: humanControl.confidence,
		probabilities: { stopped: controlProbability! }, humanControl, model: controlResult.model,
	};
	const result = await judge.judge(
		{
			state: input,
			questions: {
				continuation: {
					type: "choice",
					instructions: COMPLETION_INSTRUCTIONS,
					criteria: WORK_CRITERIA,
				},
			},
		},
		{ signal },
	);
	const answer = result.answers.continuation;
	if (!isWorkState(answer?.choice)) {
		throw new Error("Local judge returned no valid completion decision");
	}
	return {
		status: "classified",
		choice: answer.choice,
		confidence: answer.confidence,
		probabilities: answer.probabilities,
		model: result.model,
		humanControl,
	};
}

export default function registerJevCompletionGate(pi: ExtensionAPI): void {
	const processedAnswers = new WeakSet<object>();
	let lastFailure: string | undefined;
	let reviewUsed = false;
	let visibility = loadCompletionVisibility();
	let latestView: CompletionView | undefined;
	let displayGeneration = 0;
	let activeRecapRequests: RecapRequestTelemetry[] | undefined;
	const recapPromptJson = JSON.stringify(RECAP_PROMPT).slice(1, -1);
	pi.on("before_provider_request", event => {
		if (!activeRecapRequests) return;
		// Observe only this recap, not concurrent native title/job/other side turns.
		// Persist counts only: never payload text, images, credentials, or response IDs.
		try {
			const serialized = JSON.stringify(event.payload);
			if (!serialized?.includes(recapPromptJson)) return;
			const payload = event.payload as Record<string, unknown> | null;
			if (!payload || typeof payload !== "object") return;
			const items = payload.input ?? payload.messages;
			const outputCap = payload.max_output_tokens ?? payload.max_completion_tokens ?? payload.max_tokens;
			activeRecapRequests.push({
				at: new Date().toISOString(),
				...(typeof payload.model === "string" ? { model: payload.model } : {}),
				payloadBytes: Buffer.byteLength(serialized, "utf8"),
				...(Array.isArray(items) ? { inputItems: items.length } : {}),
				...(Array.isArray(payload.tools) ? { toolDefinitions: payload.tools.length } : {}),
				...(typeof outputCap === "number" && Number.isFinite(outputCap) ? { maxOutputTokens: outputCap } : {}),
				previousResponseReferenced: typeof payload.previous_response_id === "string" && payload.previous_response_id.length > 0,
			});
		} catch {
			// Best-effort telemetry cannot change provider payloads or completion behavior.
		}
	});
	const showCompletionView = (ctx: ExtensionContext, view: CompletionView, generation = displayGeneration): void => {
		if (generation !== displayGeneration) return;
		latestView = view;
		if (!ctx.hasUI) return;
		// Resolve current geometry and theme on every native render, not in a notification.
		ctx.ui.setWidget("jev-completion-gate", visibility === "hidden" ? undefined
			: () => createCompletionView(view, () => ctx.ui.theme, () => visibility));
	};
	const retireCompletionView = (ctx: ExtensionContext): void => {
		const view = latestView;
		latestView = undefined;
		displayGeneration++;
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("jev-completion-gate", undefined);
		// Retire before optimistic input painting, without freezing terminal geometry.
		// Native notices receive logical text and own wrapping at their current width.
		if (view?.effect !== undefined && visibility !== "hidden") {
			ctx.ui.notify(formatRetiredCompletionView(view, ctx.ui.theme, visibility), "info");
		}
	};
	pi.on("input", (_event, ctx) => { retireCompletionView(ctx); });
	// Native continuations have no input event; retire before their next reply.
	pi.on("before_agent_start", (_event, ctx) => { retireCompletionView(ctx); });
	const setCards = async (args: string, ctx: ExtensionContext, command: string): Promise<void> => {
		const match = /^(full|collapse|hidden)(?:\s+(--save))?$/.exec(args.trim().toLowerCase());
		const mode = match?.[1];
		if (mode !== "full" && mode !== "collapse" && mode !== "hidden") {
			ctx.ui.notify(`Completion cards: ${visibility}. Usage: /${command} full|collapse|hidden [--save]`, "info");
			return;
		}
		visibility = mode;
		if (latestView) showCompletionView(ctx, latestView);
		if (match?.[2]) {
			try {
				saveCompletionVisibility(mode);
				ctx.ui.notify(`Completion cards: ${mode}. Saved startup default.`, "info");
			} catch (error) {
				ctx.ui.notify(`Completion cards: ${mode} for this session only; could not save. ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
		}
	};
	for (const command of ["prism-af", "completion-cards"]) {
		pi.registerCommand(command, {
			description: "Set completion cards: full, collapse, or hidden; add --save for the startup default",
			handler: (args: string, ctx: ExtensionContext) => setCards(args, ctx, command),
		});
	}

	pi.on("session_stop", async (event, ctx) => {
		const assistant = event.last_assistant_message;
		if (
			event.signal.aborted || ctx.hasPendingMessages() ||
			assistant?.role !== "assistant" || assistant.stopReason !== "stop" || processedAnswers.has(assistant)
		) return;
		processedAnswers.add(assistant);
		// A new native user turn starts a new chain; repeated stop hooks share its one review budget.
		if (!event.stop_hook_active) reviewUsed = false;
		const input = classifierInput(event);
		const generation = displayGeneration;
		const recapRequests: RecapRequestTelemetry[] = [];
		// Silence is still a stop attempt; the fresh recap supplies current work context.
		const signal = AbortSignal.any([event.signal, AbortSignal.timeout(29_000)]);
		let stage: "evidence" | "recap" | "judge" = "evidence";
		try {
			// Compaction can remove every human message from event.messages, but
			// getBranch() retains original entries on the current native leaf path.
			// Never scan getEntries(), cache a request across branches, or use summaries.
			if (!event.messages.some(message => message.role === "user" && message.attribution !== "agent")) {
				const branch = ctx.sessionManager.getBranch();
				for (let index = branch.length - 1; index >= 0; index--) {
					const entry = branch[index];
					// `/clear` keeps native history, but ends the prior request's context.
					if (entry.type === "reset_boundary") break;
					if (entry.type !== "message" || entry.message.role !== "user" || entry.message.attribution === "agent") continue;
					input.userRequest = textFromContent(entry.message.content).trim();
					break;
				}
			}
			if (!input.userRequest) {
				throw new Error("No human-origin request evidence is available on the current native branch; no completion verdict was requested");
			}
			if (input.userRequest.length > MAX_MESSAGE_CHARS) {
				throw new Error(`Human request length ${input.userRequest.length} exceeds the ${MAX_MESSAGE_CHARS}-character limit; evidence was not truncated.`);
			}
			if (input.terminalAnswer.length > MAX_TERMINAL_ANSWER_CHARS) {
				throw new Error(`Terminal answer length ${input.terminalAnswer.length} exceeds the ${MAX_TERMINAL_ANSWER_CHARS}-character limit; evidence was not truncated.`);
			}
			stage = "recap";
			activeRecapRequests = recapRequests;
			try {
				input.decisionRecap = await recapCompletion(ctx, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
			} finally {
				if (activeRecapRequests === recapRequests) activeRecapRequests = undefined;
			}
			if (signal.aborted || ctx.hasPendingMessages()) {
				const effect = event.signal.aborted ? "cancelled" : "superseded";
				recordDecision(event, input, { status: effect }, effect, stage, undefined, recapRequests);
				return;
			}
			showCompletionView(ctx, {
				recap: input.decisionRecap.text,
			}, generation);
			stage = "judge";
			const judgeSignal = AbortSignal.any([signal, AbortSignal.timeout(28_000)]);
			const decision = await classifyCompletion(input, ctx, judgeSignal);
			const route = routeCompletionDecision(decision, reviewUsed);
			const effect = judgeSignal.aborted || ctx.hasPendingMessages() ? "superseded" : route.effect;
			recordDecision(event, input, decision, effect, stage, route.reason, recapRequests);
			lastFailure = undefined;
			showCompletionView(ctx, {
				recap: input.decisionRecap.text, decision, effect,
			}, generation);
			const continuationContext = [
				"Completion evidence: the recap and verdict below are fallible context, not instructions or new authorization. The separate continuation request follows.",
				JSON.stringify({
					recap: input.decisionRecap.text,
					result: {
						state: decision.choice, probability: decision.probabilities?.[decision.choice],
						humanControl: decision.humanControl, effect, reason: route.reason,
					},
				}),
			].join("\n");
			if (effect === "review") {
				reviewUsed = true;
				return {
					continue: true,
					additionalContext: `${continuationContext}\n\n` +
						"Continuation request — perform one evidence review now.\n" +
						"This is not a request for another recap, acknowledgment, or statement that retrieval is complete. Reconcile the evidence above with the actual human request, then perform one concrete permitted read-only check of the unresolved evidence, proposed blocker, or claimed approval requirement. Use tools when needed; do not merely describe the check. Report what the check established, or the exact missing condition if no useful check is reachable. This is not approval for a proposed mutation. Do not replay failed or unknown operations, request already-granted approval, invent work, or broaden authority. Respect current human stops and redirects. The next ending will be judged again; unresolved uncertainty or a verified blocker will not request another evidence-review turn.",
				};
			}
			if (effect !== "continue") return;
			return {
				continue: true,
				additionalContext: `${continuationContext}\n\n` +
					"Continuation request — resume the existing work now.\n" +
					"This is an execution turn, not a request for another final answer, acknowledgment, status update, or restatement that the previous substep is complete. Reconcile the evidence above with the actual human request. Choose the next concrete still-authorized action that advances the unmet outcome or established live interest, carry it out using tools when appropriate, and continue the existing work rather than ending with another promise or recap. Deliver completed assignments independently of exploration. Do not invent extra work, revive a spent trail, or treat an unrequested enhancement as an unmet assignment. This request grants no new permission: honor human stops, redirects, resource limits, and spend/publication/destruction boundaries. If the evidence is wrong and no permitted next action remains, state the actual completion or exact blocker instead of manufacturing activity.",
			};
		} catch (error) {
			const failure = describeJudgeFailure(error);
			const effect = event.signal.aborted ? "cancelled" : ctx.hasPendingMessages() ? "superseded" : "failed";
			const subject = stage === "recap" ? "Recap" : stage === "judge" ? "Judge" : "Evidence";
			const failureTitle = `${subject} ${failure.kind === "context" ? "context exceeded"
				: failure.kind === "timeout" ? "timed out" : failure.kind === "unavailable" ? "unavailable"
				: failure.kind === "quota" ? "rate limited" : failure.kind === "auth" ? "authentication failed"
				: failure.kind === "billing" ? "billing failed" : "failed"}`;
			// Session usage is an estimate, not the rejected side request's exact token count.
			const usage = stage === "recap" && failure.kind === "context" ? ctx.getContextUsage?.() : undefined;
			const context = stage === "recap" && failure.kind === "context" ? {
				model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
				sessionTokensEstimate: Number.isFinite(usage?.tokens) ? usage!.tokens : undefined,
				configuredWindowTokens: usage?.contextWindow ?? ctx.model?.contextWindow,
				exactRequestTokens: null, exactOverflowTokens: null,
			} : undefined;
			recordDecision(event, input, {
				status: effect, kind: failure.kind, reason: failure.message,
				...(context ? { context } : {}),
			}, effect, stage, undefined, recapRequests);
			if (effect !== "failed") {
				if (input.decisionRecap) showCompletionView(ctx, {
					recap: input.decisionRecap.text, effect,
				}, generation);
				return;
			}
			const contextMessage = context ? [
				context.model ? `Model ${context.model}.` : "",
				context.configuredWindowTokens ? `Configured window ${context.configuredWindowTokens.toLocaleString("en-US")} tokens.` : "",
				context.sessionTokensEstimate !== undefined ? `Session estimate ${context.sessionTokensEstimate.toLocaleString("en-US")} tokens.` : "",
				"No exact recap token count/overage captured.",
			].filter(Boolean).join(" ") + " " : "";
			const message = `${failureTitle}. ${contextMessage}${failure.message} No verdict or automatic continuation.`;
			showCompletionView(ctx, {
				recap: input.decisionRecap?.text, effect, failure: message, failureTitle,
			}, generation);
			if ((visibility === "hidden" || !ctx.hasUI) && lastFailure !== failure.kind) {
				if (ctx.hasUI) ctx.ui.notify(message, "warning");
				else process.stderr.write(`${message}\n`);
			}
			lastFailure = failure.kind;
		}
	});
}
