// Completion judge adapter to OMP's native judge configuration and transport.
// The OMP judge chain lives behind internal package paths (`@oh-my-pi/pi-coding-agent/judgment`, `settings`),
// not the extension API. They are loaded lazily so a changed OMP internal fails loudly with one clear message
// instead of breaking extension load silently.
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(part => part?.type === "text" && typeof part.text === "string")
		.map(part => part.text)
		.join("\n");
}

export function normalizeForFingerprint(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

export function fingerprint(text: string): string {
	return createHash("sha256").update(normalizeForFingerprint(text)).digest("hex");
}

export function appendAudit(path: string, record: unknown): void {
	try {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
	} catch {
		// Auditing must not alter classification or delivery behavior.
	}
}

export class JudgeUnavailableError extends Error {
	override name = "JudgeUnavailableError";
}

/** Classify failures for an observable abstention; never retry or substitute a backend here. */
export type JudgeFailureKind = "billing" | "quota" | "auth" | "cooldown" | "unavailable" | "timeout" | "error";
export interface JudgeFailure {
	kind: JudgeFailureKind;
	expected: boolean;
	status?: number;
	message: string;
	link?: string;
}

const EXPECTED_FAILURES = new Set<JudgeFailureKind>(["billing", "quota", "auth", "cooldown", "unavailable"]);

export function describeJudgeFailure(error: unknown): JudgeFailure {
	const message = error instanceof Error ? error.message : String(error);
	const status = Number(/\((40[1-3]|429)\)|\bHTTP (40[1-3]|429)\b/.exec(message)?.slice(1).find(Boolean)) || undefined;
	const link = /https?:\/\/[^\s"'<>)]+/.exec(message)?.[0];
	let kind: JudgeFailureKind = "error";
	if (error instanceof JudgeUnavailableError) kind = "unavailable";
	else if (status === 402 || /billing_error|no available .*credits/i.test(message)) kind = "billing";
	else if (status === 429 || /rate.?limit|quota/i.test(message)) kind = "quota";
	else if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|invalid api key/i.test(message)) kind = "auth";
	else if (/rejected the account recently/i.test(message)) kind = "cooldown";
	else if ((error instanceof Error && error.name === "TimeoutError") || /timed? ?out|aborted/i.test(message)) kind = "timeout";
	return { kind, expected: EXPECTED_FAILURES.has(kind), ...(status ? { status } : {}), message, ...(link ? { link } : {}) };
}


interface JudgeRequest {
	state: unknown;
	questions: Record<string, unknown>;
}
interface JudgeAnswer {
	choice?: string;
	confidence?: number;
	probabilities?: Record<string, number>;
	noul?: number;
	score?: number;
}
interface JudgeResult {
	provider: string;
	model: string;
	answers: Record<string, JudgeAnswer>;
}
interface Judge {
	judge(request: JudgeRequest, options?: { signal?: AbortSignal }): Promise<JudgeResult>;
	primaryModel?(): { provider: string; id: string; api: string } | undefined;
}
interface JudgeInternals {
	settings: unknown;
	resolveJudge(deps: Record<string, unknown>): Judge;
	journalJudgmentUsage(manager: unknown): unknown;
	judgeWithTimeout?(input: Record<string, unknown>): Promise<JudgeResult>;
}
export interface JudgeContext {
	modelRegistry: unknown;
	model?: unknown;
	sessionManager?: Record<string, unknown>;
}

type Importer = () => Promise<Record<string, unknown>>;
const INTERNALS = "@oh-my-pi/pi-coding-agent (settings) and @oh-my-pi/pi-coding-agent/judgment (resolveJudge, journalJudgmentUsage)";

let internals: Promise<JudgeInternals> | undefined;

// OMP's loader maps `@oh-my-pi/*` only for static imports, so they live in omp-judgment-host.ts, loaded here lazily.
const hostImporter: Importer = () => import("./omp-judgment-host.ts");

/** Resolve the OMP judge internals once; rejects with a JudgeUnavailableError naming what moved. */
export function loadJudgeInternals(importer: Importer = hostImporter): Promise<JudgeInternals> {
	internals ??= (async () => {
		let host: Record<string, unknown>;
		try {
			host = await importer();
		} catch (error) {
			throw new JudgeUnavailableError(
				`Jev judge unavailable: cannot import OMP internals ${INTERNALS} (${error instanceof Error ? error.message : String(error)}). An OMP upgrade likely moved them; update lib/omp-judgment-host.ts.`,
			);
		}
		const missing = [
			typeof host.settings !== "object" || host.settings === null ? "settings" : "",
			typeof host.resolveJudge !== "function" ? "resolveJudge" : "",
			typeof host.journalJudgmentUsage !== "function" ? "journalJudgmentUsage" : "",
		].filter(Boolean);
		if (missing.length) {
			throw new JudgeUnavailableError(
				`Jev judge unavailable: OMP no longer provides ${missing.join(", ")}. An OMP upgrade likely changed them; update lib/omp-judgment-host.ts.`,
			);
		}
		return host as unknown as JudgeInternals;
	})();
	internals.catch(() => {});
	return internals;
}

/** Test seam: forget the cached internals. */
export function resetJudgeInternals(): void {
	internals = undefined;
}

function hasUsageLedger(manager: Record<string, unknown> | undefined): boolean {
	return (
		typeof manager?.appendModelUsage === "function" &&
		typeof manager.getSessionId === "function" &&
		typeof manager.getLeafId === "function"
	);
}

/** A judge bound to one session; the first call surfaces JudgeUnavailableError if OMP internals moved. */
export function createJudge(ctx: JudgeContext, purpose: string, timeoutMs?: number): Judge {
	return {
		async judge(request, options) {
			const omp = await loadJudgeInternals();
			const manager = ctx.sessionManager;
			const onUsage = hasUsageLedger(manager) ? omp.journalJudgmentUsage(manager) : undefined;
			const getSessionId = manager?.getSessionId as (() => string) | undefined;
			const hostSettings = omp.settings as {
				getModelRole?: (role: string) => unknown;
				overlay?: (values: Record<string, unknown>) => unknown;
			};
			const requiredModel = hostSettings.getModelRole?.("judge");
			if (typeof requiredModel !== "string" || !requiredModel.includes("/") || !requiredModel.trim()) {
				throw new JudgeUnavailableError("Configure an explicit provider/model in OMP modelRoles.judge; no fallback was attempted");
			}
			if (!hostSettings.overlay) throw new JudgeUnavailableError("OMP cannot isolate the completion judge's fallback chain");
			const settings = hostSettings.overlay({ "retry.fallbackChains": { judge: [] } });
			const judge = omp.resolveJudge({
				settings,
				registry: ctx.modelRegistry,
				sessionId: getSessionId?.call(manager),
				purpose,
				...(onUsage ? { onUsage } : {}),
			});
			const model = judge.primaryModel?.();
			if (!model || `${model.provider}/${model.id}` !== requiredModel || model.api !== "typesafe") {
				throw new JudgeUnavailableError(`Completion judge requires configured native typesafe model ${requiredModel}; no fallback was attempted`);
			}
			if (timeoutMs !== undefined) {
				if (!omp.judgeWithTimeout) throw new JudgeUnavailableError("OMP native timed-judge client unavailable");
				return omp.judgeWithTimeout({
					model, registry: ctx.modelRegistry, sessionId: getSessionId?.call(manager),
					purpose, request, signal: options?.signal, timeoutMs, onUsage,
				});
			}
			return judge.judge(request, options);
		},
	};
}

