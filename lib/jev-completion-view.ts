import type { Component } from "@oh-my-pi/pi-tui";
import { renderOutputBlock } from "@oh-my-pi/pi-tui/render";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@oh-my-pi/pi-tui/utils";
import type { Theme, ThemeColor } from "@oh-my-pi/pi-tui/theme";
import { COMPLETION_STATES, type CompletionDecision } from "./jev-completion-contract.ts";

const choices = Object.entries(COMPLETION_STATES).map(([key, state]) => ({ key, ...state }));
const workChoices = choices.filter(choice => choice.key !== "stopped");
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

export type CompletionVisibility = "full" | "collapse" | "hidden";

export interface CompletionView {
	recap?: string;
	decision?: CompletionDecision;
	effect?: string;
	failure?: string;
}

/** UI-only presentation. Selection is the model's choice, never the gate's effect. */
export function renderCompletionView(view: CompletionView, theme: Theme, width: number, visibility: CompletionVisibility = "full"): string {
	if (visibility === "hidden" || width < 1) return "";
	const { decision, effect, failure } = view;
	const selected = choices.find(choice => choice.key === decision?.choice);
	const pending = effect === undefined;
	const admitted = effect === "continue";
	const color: ThemeColor = pending ? "accent" : admitted ? "success" : effect === "stop" ? "error" : "warning";
	if (visibility === "collapse") {
		const probability = selected && decision?.probabilities?.[selected.key];
		const score = typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1
			? ` · ${(probability * 100).toFixed(1)}%` : "";
		const result = pending ? "Judging..." : effect === "continue" ? "continuation requested" : effect;
		const label = pending ? result! : effect === "stop"
			? `${selected?.label ?? "No verdict"}${score}`
			: `${selected?.label ?? "No verdict"} · ${result}${score}`;
		const title = truncateToWidth(label, width >= 5 ? width - 4 : width);
		const horizontal = theme.symbol("tree.horizontal");
		const ruleWidth = Math.max(0, width - visibleWidth(title) - 2);
		const leftWidth = Math.floor(ruleWidth / 2);
		const titleLine = theme.bold(theme.fg(color, title));
		const header = width < 5 ? titleLine
			: theme.fg(color, `${horizontal.repeat(leftWidth)} `) + titleLine
				+ theme.fg(color, ` ${horizontal.repeat(ruleWidth - leftWidth)}`);
		if (effect === "stop") return header;
		const recap = wrapTextWithAnsi(view.recap?.replace(/\s+/g, " ").trim() || "Recap unavailable.", width);
		const preview = recap.slice(0, 2).map(line => truncateToWidth(line, width));
		if (recap.length > 2) preview[1] = `${truncateToWidth(recap[1]!, width - 1, "")}…`;
		return [
			header,
			...preview.map(line => theme.fg("muted", line)),
			theme.fg(color, horizontal.repeat(width)),
		].join("\n");
	}
	const outcome = failure ?? (pending ? "Judging..." : effect === "stop"
		? decision?.choice === "stopped" ? "Human stop respected; no continuation requested." : "Work complete; no continuation requested."
		: outcomes[effect] ?? "No continuation requested.");
	const rows = decision?.choice === "stopped"
		? [theme.fg("muted", "Work state not evaluated: human stop.")]
		: workChoices.map(choice => {
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
export function createCompletionView(view: CompletionView, getTheme: () => Theme, visibility: CompletionVisibility | (() => CompletionVisibility) = "full"): Component {
	return {
		render: width => {
			const rendered = renderCompletionView(view, getTheme(), width, typeof visibility === "function" ? visibility() : visibility);
			return rendered ? rendered.split("\n") : [];
		},
		invalidate() {},
	};
}
