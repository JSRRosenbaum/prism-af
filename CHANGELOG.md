# Changelog

## 0.1.0 — 2026-10-21

- Extract the native advisory completion gate into a standalone OMP package with an explicit release allowlist.
- Preserve fresh tool-disabled recaps, separate human-control/work-state judgments, bounded one-review chains, cancellation, pending-input checks, duplicate suppression, and branch-aware request recovery.
- Select the exact native typesafe backend through OMP's `modelRoles.judge`; disable judge fallback candidates without adding a provider transport.
- Remove bundled operator policy, system-prompt injection, machine identities, and unrelated integrations.
- Identify packaged verdicts with plugin/version metadata; distinguish continuation requests from observed native resumption.
- Target OMP 18.12.5 internal judge APIs; ship under MIT.
- Qualify the packaged entrypoint with four isolated native scenarios and 71 behavioral regressions.
