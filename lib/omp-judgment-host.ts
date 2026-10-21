// Static imports of OMP internals, loaded lazily by jev-judge.ts. OMP's extension loader maps `@oh-my-pi/*`
// only for static imports, so this module is the one place those internal paths appear.
export { settings } from "@oh-my-pi/pi-coding-agent";
export { journalJudgmentUsage, resolveJudge } from "@oh-my-pi/pi-coding-agent/judgment";
