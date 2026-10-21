import { afterEach, expect, test } from "bun:test";
import { createJudge, loadJudgeInternals, resetJudgeInternals } from "../lib/jev-judge.ts";

afterEach(resetJudgeInternals);

const request = { state: { userRequest: "Finish the authorized fix." }, questions: { continuation: {} } };

async function backend(role: unknown, model = { provider: "native", id: "judge", api: "typesafe" }) {
  let resolutions = 0;
  let calls = 0;
  await loadJudgeInternals(async () => ({
    settings: {
      getModelRole: () => role,
      overlay: () => ({}),
    },
    journalJudgmentUsage: () => undefined,
    resolveJudge: () => {
      resolutions++;
      return {
        primaryModel: () => model,
        judge: async () => { calls++; return { model: "judge", answers: { continuation: { choice: "complete" } } }; },
      };
    },
  }));
  return {
    judge: createJudge({ modelRegistry: {}, model: { provider: "chat", id: "not-a-judge" } }, "completion-gate"),
    calls: () => calls, resolutions: () => resolutions,
  };
}

for (const role of [undefined, "", "judge", { provider: "native", id: "judge" }]) {
  test(`non-explicit judge role ${JSON.stringify(role)} abstains before backend resolution`, async () => {
    const fixture = await backend(role);
    await expect(fixture.judge.judge(request)).rejects.toThrow("explicit provider/model");
    expect(fixture.resolutions()).toBe(0);
    expect(fixture.calls()).toBe(0);
  });
}

for (const model of [
  { provider: "other", id: "judge", api: "typesafe" },
  { provider: "native", id: "other", api: "typesafe" },
  { provider: "native", id: "judge", api: "openai-completions" },
]) {
  test(`a resolved backend outside the configured native judge contract is never invoked: ${JSON.stringify(model)}`, async () => {
    const fixture = await backend("native/judge", model);
    await expect(fixture.judge.judge(request)).rejects.toThrow("no fallback was attempted");
    expect(fixture.calls()).toBe(0);
  });
}

