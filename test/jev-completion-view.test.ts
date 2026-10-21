import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { loadThemeSync } from "@oh-my-pi/pi-tui/theme/loader";
import { visibleWidth } from "@oh-my-pi/pi-tui/utils";
import { createCompletionView, renderCompletionView } from "../lib/jev-completion-view.ts";
import { COMPLETION_STATES, type CompletionState } from "../lib/jev-completion-contract.ts";

const theme = loadThemeSync("dark", { mode: "truecolor", symbolPresetOverride: "unicode" });

for (const choice of Object.keys(COMPLETION_STATES) as CompletionState[]) {
	const { label, color } = COMPLETION_STATES[choice];
	test(`${choice} selects exactly one of six options with its semantic color`, () => {
		const probabilities: Record<string, number> = choice === "stopped" ? { stopped: 0.91 } : Object.fromEntries(
			Object.keys(COMPLETION_STATES).filter(state => state !== "stopped").map((state, index) => [state, (index + 1) / 15]),
		);
		const humanControl = choice === "stopped"
			? { choice: "stop" as const, probabilities: { stop: 0.91, proceed: 0.08, uncertain: 0.01 } }
			: { choice: "proceed" as const, probabilities: { stop: 0.02, proceed: 0.93, uncertain: 0.05 } };
		const rendered = renderCompletionView({ recap: "Inspection complete.", decision: { choice, probabilities, humanControl }, effect: "stop" }, theme, 100);
		const plain = stripVTControlCharacters(rendered);
		expect(plain.match(/SELECTED/g)).toHaveLength(1);
		const score = (probabilities[choice]! * 100).toFixed(1);
		expect(rendered).toContain(theme.fg(color, `${theme.symbol("radio.selected")} ${label}  ${score}%  SELECTED`));
		for (const [state, option] of Object.entries(COMPLETION_STATES)) {
			if (probabilities[state] !== undefined) {
				expect(plain).toContain(`${option.label}  ${(probabilities[state]! * 100).toFixed(1)}%`);
			} else {
				expect(plain).toContain(option.label);
				expect(plain).not.toMatch(new RegExp(`${option.label}  \\d`));
			}
		}
	});
}

test("a plurality actionable choice stays selected when continuation is withheld", () => {
	const rendered = renderCompletionView({
		recap: "A next step remains.", effect: "low-probability",
		decision: { choice: "actionable", probabilities: { actionable: 0.41, complete: 0.35, insufficient_evidence: 0.24 } },
	}, theme, 120);
	const plain = stripVTControlCharacters(rendered);
	expect(plain).toContain("Actionable  41.0%  SELECTED");
	expect(plain).not.toContain("Continuation requested;");
	expect(rendered).toContain(theme.fg("warning", "Result"));
});

test("pending and failed judgments never fabricate a selected option or probability", () => {
	for (const view of [{ recap: "Ready to judge." }, { effect: "failed", failure: "Provider unavailable; no verdict." }]) {
		const plain = stripVTControlCharacters(renderCompletionView(view, theme, 100));
		expect(plain).not.toContain("SELECTED");
		expect(plain).not.toContain("%");
	}
});

test("native frames fit narrow terminals with wide text and ASCII or Nerd Font markers", () => {
	for (const preset of ["unicode", "ascii", "nerd"] as const) {
		const selectedTheme = loadThemeSync("dark", { symbolPresetOverride: preset });
		for (const width of [1, 4, 20, 40, 80, 140]) {
			const rendered = renderCompletionView({
				recap: "Verify 日本語 and long_unbroken_identifiers_without_losing_the_frame.",
				decision: { choice: "complete", model: "synthetic-native/finite" }, effect: "stop",
			}, selectedTheme, width);
			for (const row of rendered.split("\n")) expect(visibleWidth(row)).toBeLessThanOrEqual(width);
		}
	}
});

test("the same component reflows its recap and preserves both frames after narrowing and widening", () => {
	const view = createCompletionView({
		recap: "The fix is implemented. Next, verify the actual terminal across widths before declaring completion. 日本語.",
		decision: {
			choice: "actionable", probabilities: { actionable: 0.8, complete: 0.1, insufficient_evidence: 0.1 },
			humanControl: { choice: "proceed", probabilities: { proceed: 0.97, stop: 0.02, uncertain: 0.01 } },
		},
		effect: "continue",
	}, () => theme);
	for (const width of [321, 110, 70, 321]) {
		const rows = view.render(width).map(stripVTControlCharacters);
		expect(rows.filter(row => row.startsWith("╭"))).toHaveLength(2);
		expect(rows.filter(row => row.startsWith("╰"))).toHaveLength(2);
		for (const row of rows) {
			expect(visibleWidth(row)).toBe(width);
			expect(row).toMatch(/^(?:╭.*╮|╰.*╯|├.*┤|│.*│)$/u);
		}
		const text = rows.join("\n");
		expect(text).toContain("Actionable  80.0%  SELECTED");
	}
});

test("an existing card follows theme and symbol changes without another judgment", () => {
	let current = loadThemeSync("dark", { mode: "truecolor", symbolPresetOverride: "unicode" });
	const view = createCompletionView({ decision: { choice: "stopped" }, effect: "stop" }, () => current);
	expect(view.render(80).join("\n")).toContain(current.fg("error", `${current.symbol("radio.selected")} Human stop  SELECTED`));
	current = loadThemeSync("light", { mode: "truecolor", symbolPresetOverride: "ascii" });
	view.invalidate();
	const rendered = view.render(80).join("\n");
	expect(rendered).toContain(current.fg("error", `${current.symbol("radio.selected")} Human stop  SELECTED`));
	expect(stripVTControlCharacters(rendered)).not.toContain("◉");
});

test("evidence review is distinct from ordinary continuation and preserves the judged state", () => {
	for (const choice of ["actionable", "insufficient_evidence", "blocked", "approval_required"] as const) {
		const decision = {
			choice, probabilities: { [choice]: 0.8 },
			humanControl: { choice: "proceed" as const, probabilities: { proceed: 0.95, stop: 0.04, uncertain: 0.01 } },
		};
		const review = renderCompletionView({ decision, effect: "review" }, theme, 140);
		const continuation = renderCompletionView({ decision, effect: "continue" }, theme, 140);
		const plain = stripVTControlCharacters(review);
		expect(plain).toContain(`${COMPLETION_STATES[choice].label}  80.0%  SELECTED`);
		expect(plain.match(/SELECTED/g)).toHaveLength(1);
		expect(review).toContain(theme.fg("warning", "Result"));
		expect(continuation).toContain(theme.fg("success", "Result"));
		expect(plain).not.toBe(stripVTControlCharacters(continuation));
	}
});

test("completed and human stops remain different selected states with terminal results", () => {
	for (const choice of ["complete", "stopped"] as const) {
		const rendered = renderCompletionView({ decision: { choice }, effect: "stop" }, theme, 120);
		expect(stripVTControlCharacters(rendered)).toContain(`${COMPLETION_STATES[choice].label}  SELECTED`);
		expect(rendered).toContain(theme.fg("error", "Result"));
	}
});

test("blocked, approval, uncertainty, low probability and failure remain amber, not completed", () => {
	for (const [choice, effect] of [
		["blocked", "blocked"],
		["approval_required", "approval-required"],
		["insufficient_evidence", "uncertain"],
		["actionable", "low-probability"],
		["actionable", "failed"],
	] as const) {
		const rendered = renderCompletionView({ decision: { choice }, effect }, theme, 120);
		expect(rendered).toContain(theme.fg("warning", "Result"));
		expect(stripVTControlCharacters(rendered)).toContain(`${COMPLETION_STATES[choice].label}  SELECTED`);
		expect(stripVTControlCharacters(rendered)).not.toContain("Complete  SELECTED");
	}
});

test("human-control scores remain separate from the five-state work distribution", () => {
	const plain = stripVTControlCharacters(renderCompletionView({
		decision: {
			choice: "actionable",
			probabilities: { actionable: 0.62, complete: 0.2, blocked: 0.08, approval_required: 0.06, insufficient_evidence: 0.04 },
			humanControl: { choice: "proceed", probabilities: { proceed: 0.91, stop: 0.07, uncertain: 0.02 } },
		},
		effect: "continue",
	}, theme, 140));
	expect(plain).toContain("Human control (separate): proceed  91.0%");
	expect(plain).toContain("Actionable  62.0%  SELECTED");
	expect(plain).not.toContain("Human stop  7.0%");
	expect(plain.match(/SELECTED/g)).toHaveLength(1);
});

test("a human stop shows its actual control score without inventing a work distribution", () => {
	const plain = stripVTControlCharacters(renderCompletionView({
		decision: {
			choice: "stopped", probabilities: { stopped: 0.86 },
			humanControl: { choice: "stop", probabilities: { stop: 0.86, proceed: 0.1, uncertain: 0.04 } },
		},
		effect: "stop",
	}, theme, 140));
	expect(plain).toContain("Human control (separate): stop  86.0%");
	expect(plain).toContain("Human stop  86.0%  SELECTED");
	expect(plain.match(/%/g)).toHaveLength(2);
});

test("human-control uncertainty does not replace the selected work state or invent a score", () => {
	const plain = stripVTControlCharacters(renderCompletionView({
		decision: {
			choice: "insufficient_evidence", probabilities: { insufficient_evidence: 0.73 },
			humanControl: { choice: "uncertain" },
		},
		effect: "review",
	}, theme, 140));
	expect(plain).toContain("Human control (separate): uncertain");
	expect(plain).toContain("Evidence unclear  73.0%  SELECTED");
	expect(plain.match(/%/g)).toHaveLength(1);
});
