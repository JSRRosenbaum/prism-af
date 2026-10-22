// Static imports of OMP internals, loaded lazily by jev-judge.ts. OMP's extension loader maps `@oh-my-pi/*`
// only for static imports, so this module is the one place those internal paths appear.
export { settings } from "@oh-my-pi/pi-coding-agent";
export { journalJudgmentUsage, resolveJudge } from "@oh-my-pi/pi-coding-agent/judgment";

import { NativeJudge, tokenUsage, type Model, type JudgmentRequest, type Usage } from "@oh-my-pi/pi-ai";
import { calculateCost } from "@oh-my-pi/pi-catalog/models";

interface NativeRegistry {
	getApiKey(model: Model, sessionId: string | undefined, options: { signal?: AbortSignal }): Promise<unknown>;
	resolver(model: Model, sessionId?: string): ConstructorParameters<typeof NativeJudge>[0]["apiKey"];
	resolveModelHeaders(model: Model, signal?: AbortSignal): Promise<Record<string, string> | undefined>;
}

/** OMP 18.12.5's role chain fixes native HTTP attempts at 10s; use its native client with an explicit budget. */
export async function judgeWithTimeout(input: {
	model: Model; registry: NativeRegistry; sessionId?: string; purpose: string;
	request: JudgmentRequest; signal?: AbortSignal; timeoutMs: number;
	onUsage?: (event: unknown) => void;
}) {
	const { model, registry, sessionId, request, signal, timeoutMs, purpose, onUsage } = input;
	if (!await registry.getApiKey(model, sessionId, { signal })) throw new Error("Configured judge credentials unavailable; no fallback attempted");
	const client = new NativeJudge({
		api: "typesafe", provider: model.provider, model: model.requestModelId ?? model.id,
		baseUrl: model.baseUrl, apiKey: registry.resolver(model, sessionId),
		headers: await registry.resolveModelHeaders(model, signal), timeoutMs,
		supportsImages: false,
	});
	let usage: Usage = tokenUsage(0, 0);
	let stopReason = "error";
	let errorMessage: string | undefined;
	try {
		const result = await client.judge(request, { signal, onPartialUsage: partial => { usage = partial; } });
		usage = result.usage;
		stopReason = "stop";
		return result;
	} catch (error) {
		stopReason = signal?.aborted || (error instanceof Error && /Abort|Timeout/.test(error.name)) ? "aborted" : "error";
		errorMessage = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		if (usage.cost.total === 0) calculateCost(model, usage);
		onUsage?.({ purpose, role: "typesafe", api: model.api, provider: model.provider,
			model: model.id, usage, stopReason, ...(errorMessage ? { errorMessage } : {}) });
	}
}
