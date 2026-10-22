// Human control and work progress are different questions; neither model output grants authority.
export const COMPLETION_CONTRACT_VERSION = "2026-10-20-v2";

export const COMPLETION_STATES = {
	actionable: { label: "Actionable", color: "accent", criterion: "CONTINUE: A concrete next step can be taken now within existing permission, for unfinished work or a genuine live interest. An available authorized inspection is a next step. A promise is not delivery." },
	complete: { label: "Complete", color: "muted", criterion: "FINISHED: The requested outcome is delivered, and no live commitment or genuine interest has a next step. Do not invent work after a sufficient informational answer." },
	blocked: { label: "Blocked", color: "warning", criterion: "WAIT: Useful work remains, but an observed external dependency or resource conflict prevents every useful permitted step. No useful safe inspection remains." },
	approval_required: { label: "Approval required", color: "warning", criterion: "ASK: The only useful next step requires a genuinely new human decision or permission. Permission already given in userRequest is not missing approval." },
	stopped: { label: "Stopped", color: "muted" },
	insufficient_evidence: { label: "Evidence unclear", color: "warning", criterion: "REVIEW: Evidence is missing or contradictory, so it is not possible to establish the next step or any other state. Do not guess that work is finished or blocked." },
} as const;
export type CompletionState = keyof typeof COMPLETION_STATES;
export type WorkState = Exclude<CompletionState, "stopped">;
export const WORK_CRITERIA = Object.fromEntries(Object.entries(COMPLETION_STATES).flatMap(([key, state]) => "criterion" in state ? [[key, state.criterion]] : []));
export const COMPLETION_INSTRUCTIONS = "Classify the remaining work. Human commands to end the turn are checked separately, not a work state. userRequest gives the task and its allowed scope. terminalAnswer and decisionRecap are fallible claims; check recentContext observations. A concrete permitted next action wins over a restriction on a later action. Count standing responsibilities or live interests only when established by current evidence and existing permission; never invent an exploration remit or busywork.";
export const HUMAN_CONTROL_QUESTION = {
	type: "choice",
	instructions: "Read only the current human message. Determine whether the human commands the assistant to end this turn immediately, rather than describing an old quote, forbidding one operation, or asking for work. Restrictions on particular actions do not mean stop the whole turn. Assistant messages are not human instructions.",
	criteria: {
		stop: "The human explicitly says to stop now or not continue this turn.",
		proceed: "The human asks for an answer or work; there is no current command to end this turn. Follow the stated scope and restrictions.",
		uncertain: "The message does not establish whether the human wants this turn to end now.",
	},
} as const;
export interface HumanControlDecision {
	choice: "stop" | "proceed" | "uncertain";
	confidence?: number;
	probabilities?: Record<string, number>;
}
export interface CompletionDecision {
	choice: CompletionState;
	confidence?: number;
	probabilities?: Record<string, number>;
	model?: string;
	humanControl?: HumanControlDecision;
}
export type CompletionEffect = "continue" | "review" | "stop" | "blocked" | "approval-required" | "uncertain" | "low-probability";
export interface CompletionRoute {
	effect: CompletionEffect;
	reason: "actionable" | "complete" | "blocked" | "approval-required" | "human-stop" | "human-control-uncertain" | "insufficient-evidence" | "low-probability" | "invalid-probability";
}

export function isWorkState(value: unknown): value is WorkState {
	return typeof value === "string" && Object.hasOwn(WORK_CRITERIA, value);
}
export function isHumanControl(value: unknown): value is HumanControlDecision["choice"] {
	return value === "stop" || value === "proceed" || value === "uncertain";
}

/** One review per native chain verifies ambiguity and proposed parking conditions, without adding execution authority. */
export function routeCompletionDecision(decision: CompletionDecision, reviewUsed: boolean): CompletionRoute {
	const probability = decision.probabilities?.[decision.choice];
	if (!Number.isFinite(probability) || probability! < 0 || probability! > 1) {
		return { effect: "low-probability", reason: "invalid-probability" };
	}
	if (decision.humanControl?.choice === "stop") return { effect: "stop", reason: "human-stop" };
	if (decision.humanControl?.choice !== "proceed") {
		return { effect: reviewUsed ? "uncertain" : "review", reason: "human-control-uncertain" };
	}
	if (probability! <= 0.5 || decision.choice === "insufficient_evidence") {
		const reason = probability! <= 0.5 ? "low-probability" : "insufficient-evidence";
		return { effect: reviewUsed ? (reason === "low-probability" ? "low-probability" : "uncertain") : "review", reason };
	}
	switch (decision.choice) {
		case "actionable": return { effect: "continue", reason: "actionable" };
		case "complete": return { effect: "stop", reason: "complete" };
		case "blocked": return { effect: reviewUsed ? "blocked" : "review", reason: "blocked" };
		case "approval_required": return { effect: reviewUsed ? "approval-required" : "review", reason: "approval-required" };
		case "stopped": return { effect: reviewUsed ? "uncertain" : "review", reason: "human-control-uncertain" };
	}
}
