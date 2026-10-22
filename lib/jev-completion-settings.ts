import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CompletionVisibility } from "./jev-completion-view.ts";

function settingsPath(): string {
	return process.env.JEV_COMPLETION_GATE_CONFIG || join(
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".omp", "agent"),
		"extensions", "completion-judge.json",
	);
}

function readSettings(path: string): Record<string, unknown> {
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a settings object");
		return value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

export function loadCompletionVisibility(): CompletionVisibility {
	try {
		const value = process.env.JEV_COMPLETION_GATE_VISIBILITY?.trim().toLowerCase()
			|| readSettings(settingsPath()).visibility;
		return value === "collapse" || value === "hidden" ? value : "full";
	} catch (error) {
		process.stderr.write(`Completion card settings unavailable; using full cards. ${error instanceof Error ? error.message : String(error)}\n`);
		return "full";
	}
}

/** Persist presentation only; preserve unrelated settings and never partially replace the live JSON. */
export function saveCompletionVisibility(visibility: CompletionVisibility): string {
	const path = settingsPath();
	const value = { ...readSettings(path), visibility };
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
	return path;
}
