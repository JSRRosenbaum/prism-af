import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCompletionVisibility, saveCompletionVisibility } from "../lib/jev-completion-settings.ts";

const previousPath = process.env.JEV_COMPLETION_GATE_CONFIG;
const previousVisibility = process.env.JEV_COMPLETION_GATE_VISIBILITY;
const directory = mkdtempSync(join(tmpdir(), "completion-settings-"));
const path = join(directory, "settings.json");
afterEach(() => {
	if (previousPath === undefined) delete process.env.JEV_COMPLETION_GATE_CONFIG;
	else process.env.JEV_COMPLETION_GATE_CONFIG = previousPath;
	if (previousVisibility === undefined) delete process.env.JEV_COMPLETION_GATE_VISIBILITY;
	else process.env.JEV_COMPLETION_GATE_VISIBILITY = previousVisibility;
	rmSync(path, { force: true });
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function configure() {
	process.env.JEV_COMPLETION_GATE_CONFIG = path;
	delete process.env.JEV_COMPLETION_GATE_VISIBILITY;
}

test("saving a card preference preserves unrelated settings", () => {
	configure();
	writeFileSync(path, JSON.stringify({ visibility: "hidden", anotherSetting: { enabled: true } }));
	saveCompletionVisibility("collapse");
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ visibility: "collapse", anotherSetting: { enabled: true } });
	expect(loadCompletionVisibility()).toBe("collapse");
});

test("a malformed preference file cannot be overwritten by a save", () => {
	configure();
	const malformed = "{ not valid JSON";
	writeFileSync(path, malformed);
	expect(() => saveCompletionVisibility("hidden")).toThrow();
	expect(readFileSync(path, "utf8")).toBe(malformed);
});
