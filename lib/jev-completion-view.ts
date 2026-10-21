import type { Component } from "@oh-my-pi/pi-tui";
import { renderOutputBlock } from "@oh-my-pi/pi-tui/render";
import type { Theme, ThemeColor } from "@oh-my-pi/pi-tui/theme";
import { COMPLETION_STATES, type CompletionDecision } from "./jev-completion-contract.ts";

const choices = Object.entries(COMPLETION_STATES).map(([key, state]) => ({ key, ...state }));
const outcomes: Record<string, string> = {
	continue: "Continuation requested; native limits still apply.",
	review: "One advisory read-only evidence review requested: verify unclear evidence or blocker/approval claims; no new authority. Native limits still apply.",
	blocked: "Blocked by an external condition; no continuation requested.",
	"approval-required": "Human decision required; no approval granted or continuation requested.",
	uncertain: "Evidence remains unclear after review; no continuation requested.",
	"low-probability": "Continuation withheld: a valid selected-state probability greater than 50% is required; this is not completion.",
	failed: "Judgment failed; no continuation requested.",
	superseded: "Judgment superseded; no continuation requested.",
	cancelled: "Judgment cancelled; no continuation requested.",
};

export interface CompletionView {
	recap?: string;
	decision?: CompletionDecision;
	effect?: string;
	failure?: string;
}

/** UI-only presentation. Selection is the model's choice, never the gate's effect. */
export function renderCompletionView(view: CompletionView, theme: Theme, width: number): string {
	const { decision, effect, failure } = view;
	const selected = choices.find(choice => choice.key === decision?.choice);
	const pending = effect === undefined;
	const admitted = effect === "continue";
	const color: ThemeColor = pending ? "accent" : admitted ? "success" : effect === "stop" ? "error" : "warning";
	const outcome = failure ?? (pending ? "Judging..." : effect === "stop"
		? decision?.choice === "stopped" ? "Human stop respected; no continuation requested." : "Work complete; no continuation requested."
		: outcomes[effect] ?? "No continuation requested.");
	const rows = choices.map(choice => {
		const active = selected === choice;
		const probability = decision?.probabilities?.[choice.key];
		const score = Number.isFinite(probability) && probability! >= 0 && probability! <= 1
			? `  ${(probability! * 100).toFixed(1)}%` : "";
		const label = `${theme.symbol(active ? "radio.selected" : "radio.unselected")} ${choice.label}${score}${active ? "  SELECTED" : ""}`;
		return active ? theme.bg("selectedBg", theme.bold(theme.fg(choice.color, label))) : theme.fg("muted", label);
	});
	const control = decision?.humanControl;
	const controlProbability = control?.probabilities?.[control.choice];
	const controlScore = Number.isFinite(controlProbability) && controlProbability! >= 0 && controlProbability! <= 1
		? `  ${(controlProbability! * 100).toFixed(1)}%` : "";
	const controlLines = control
		? [theme.fg("muted", `Human control (separate): ${control.choice}${controlScore}`)] : [];
	const recap = renderOutputBlock({
		header: theme.bold(theme.fg("accent", "Completion recap")), width, applyBg: false,
		sections: [{ lines: [theme.fg("text", view.recap?.replace(/\s+/g, " ") ?? "Recap unavailable.")] }],
	}, theme);
	const judge = renderOutputBlock({
		header: theme.bold(theme.fg(color, "Completion judge")),
		headerMeta: decision?.model ? theme.fg("muted", decision.model) : undefined,
		width, applyBg: false, borderColor: color,
		sections: [
			{ lines: [...controlLines, theme.fg("text", "Completion state (read-only)"), ...rows] },
			{ label: theme.fg(color, "Result"), lines: [theme.fg(color, outcome)] },
		],
	}, theme);
	return [...recap, ...judge].join("\n");
}

/** Resolve current geometry and theme on every native render, including theme swaps. */
export function createCompletionView(view: CompletionView, getTheme: () => Theme): Component {
	return {
		render: width => renderCompletionView(view, getTheme(), width).split("\n"),
		invalidate() {},
	};
}
