# omp-completion-judge

Advisory completion judgment for OMP. An ordinary extension factory registers the native `session_stop` hook; it does not add a queue, scheduler, provider transport, or Telegram integration.

## Compatibility

Targets **OMP 18.12.5** only. Other versions are unverified. The manifest pins host peer versions; optional peers are supplied by the running compiled OMP host, not installed as a second runtime. Bun is needed for development tests, not an additional plugin service.

This plugin depends on **internal OMP APIs**: `settings` from `@oh-my-pi/pi-coding-agent`, and `resolveJudge` / `journalJudgmentUsage` from `@oh-my-pi/pi-coding-agent/judgment`. Those imports are isolated in `lib/omp-judgment-host.ts`. An incompatible upgrade causes explicit abstention, not a replacement verdict. The UI uses OMP's native TUI render API.

## Install

```sh
omp plugin install github:JSRRosenbaum/omp-completion-judge#v0.1.0
```

For local development:

```sh
git clone https://github.com/JSRRosenbaum/omp-completion-judge.git
omp plugin install ./omp-completion-judge
```

Local directory installation is a symlink, not a release snapshot. The `omp.extensions` manifest loads `extensions/completion-judge.ts`; do not also pass that entrypoint with `-e` or retain another completion-gate registration.

Start a fresh OMP process after installation, or use an independently controlled orderly exact-session resume supported by your host. Neither package discovery, `/reload-plugins`, nor `ctx.reload()` proves changed extension code is active. Do not terminate a host from its own active turn or simulate supported activation with terminal keystrokes. Preserve the existing native journal when resuming.

When migrating from a loose `jev-completion-gate.ts`, disable only that legacy module in the new process's config overlay, leaving unrelated global registrations untouched:

```yaml
disabledExtensions:
  - extension-module:jev-completion-gate
```

The package entrypoint has the distinct module ID `extension-module:completion-judge`, so the legacy disable does not suppress the package. Merge any already-disabled modules into the overlay rather than replacing them. Do not install globally alongside an undisabled legacy gate: that would give future sessions two registrations. Session-specific installation/launch must be isolated from unrelated sessions.

For a session-only launch without global installation, OMP 18.12.5 also resolves the package manifest through `--extension /absolute/path/to/package-directory`. Combine that with your existing `--resume` and local `--config` overlay after orderly exit. Do **not** substitute `--plugin-dir`: that flag injects Claude/Agent plugin roots and does not load this package's native extension module.

### Native judge configuration

Use OMP's existing `config.yml`, model registry, and credentials. Select the full, exact provider/model identity of an already configured **native `typesafe` API** judge:

```yaml
modelRoles:
  judge: your-provider/your-model
```

Replace that example with an actual registered model; the plugin ships no provider, endpoint, key, or machine-specific model default. Native `typesafe` judges are the deliberately narrow supported backend contract inherited from the extracted implementation. Prompted chat/local-inference judge substitutes and other judgment APIs are not qualified here.

The plugin requires `settings.getModelRole("judge")` to resolve to the exact selected provider/model. A session-local settings overlay replaces the judge fallback chain with `[]`; the session chat model is not supplied as a fallback. Missing configuration, wrong resolved identity/API, unavailable internals, and backend errors produce a warning and failed audit record, with **no verdict and no automatic continuation**. OMP still owns its native transport behavior, cancellation, credentials, and usage accounting.

### Local policy

There is no bundled persona, standing exploration authorization, or system-prompt injection. Keep operator-specific policy in your normal local OMP instructions/system prompt. The tool-disabled recap sees the current conversation and system prompt; it is fallible evidence, not a new permission source. The classifier counts standing responsibilities or interests only when established by current evidence and existing permission. Installing the plugin grants no authority.

## Decision contract

At an eligible settled assistant ending:

1. Generate a fresh native ephemeral recap with `tools: false`, without appending it to conversation history.
2. Classify **stop / proceed / uncertain** from only the current human-origin request. Compacted requests are recovered from the current native branch, never another branch or a summary; `/clear` boundaries end prior authority.
3. Separately classify **actionable / complete / blocked / approval_required / insufficient_evidence** from the request, bounded observations, terminal answer, and recap.
4. Request native continuation for actionable work only with a finite selected-state probability strictly greater than `0.5` and human-control `proceed`.
5. Permit at most one advisory evidence-review continuation per native chain for uncertain/low-probability evidence or proposed blockers/approval requirements. Unresolved uncertainty then abstains; verified blockers/approval requirements park. A fresh human turn resets the review budget; later supported actionable work is still eligible.

A selected human stop never requests review or continuation. Pending input, cancellation, error/aborted answers, and duplicate delivery suppress stale work. Review asks for permitted read-only evidence; it is not a sandbox or approval grant. No judge output is authoritative task acceptance or execution permission.

**Requested continuation is not observed resumption.** OMP owns native scheduling and its continuation cap (eight automatic resumptions in the targeted host). A ninth ending may still be judged without another scheduled turn. Verify a native continuation entry and subsequent actual assistant/tool events before claiming resumption.

### Bounds and failure

| Evidence | Accepted bound |
| --- | --- |
| Current human request | 2,000 characters; rejected intact if oversized |
| Terminal answer | 8,000 characters; rejected intact if oversized |
| Recent text context | 4,000 characters, at most two messages per role |
| Fresh recap | 1–1,200 characters; no truncation or substitute |
| Recap deadline | 15 seconds |
| Two classifier calls combined | 10 seconds |
| Entire gate | 25 seconds |

Recent context prioritizes complete human constraints, then tool observations, then assistant claims. Oversized context items are omitted whole with omitted-character metadata. Backend failure never fabricates a decision or silently falls back. A sufficiently long original human request can intentionally prevent judgment; compaction does not relax the bound.

## Observe activation

Default audit: `~/.omp/agent/logs/jev-completion-gate.jsonl`. Override with `JEV_COMPLETION_GATE_AUDIT_LOG`; enable the native two-card widget with `JEV_COMPLETION_GATE_VERBOSE=1` **before process startup**. No telemetry is sent by the plugin itself; native judge calls use the selected provider and OMP usage ledger.

Audit records include plugin/version, contract/prompt/policy versions, session/turn identity, input hashes/lengths, decision, stage, and requested effect. Successful evidence text is not logged. Error reasons may contain provider diagnostic details: treat audit files as private. New audit directories/files request `0700`/`0600`; existing permissions are not tightened. Audit I/O is best-effort and never changes delivery behavior: absence is not proof of successful activation or a verdict.

To prove activation, observe a **fresh record for the exact native session**, `plugin: "omp-completion-judge"`, and the installed version. If effect is `continue` or `review`, separately correlate native `session-stop-continuation` history and a subsequent real turn/tool result. A synthetic provider run qualifies mechanics only, not live activation or classifier accuracy.

## Development and release

```sh
bun install --frozen-lockfile
bun test
npm pack --ignore-scripts --dry-run
```

The release allowlist contains the entrypoint, four library modules, package manifest, README, changelog, and MIT license. Source tests are in GitHub but excluded from the installed package. No installation lifecycle scripts run. Do not add private sessions, receipts, audit logs, credentials, or local policy to the repository.

Derived from a maintained native completion-gate implementation: decision contract v2, prompt v9, continuation policy v18, recap v2. Portable prompt/recap/policy revisions are identified separately as `2026-10-21-portable-v1`; the decision contract remains `2026-10-20-v2`. Implementation and extraction were AI-assisted; finite mechanics tests do not establish broad semantic accuracy.

### Release qualification

On OMP 18.12.5, the initial release passed 71 behavioral tests, including cancellation, pending-input races, duplicate delivery, branch changes, clear boundaries, and backend rejection. Fresh isolated HOME installations of the packed manifest entrypoint exercised native `continue → write → stop`, human-stop non-effects, one `review → read → uncertain` chain, and failed-backend abstention. Main/recap/classifier replies in those scenarios were synthetic; package discovery, native judgment transport, actual tools, and continuation scheduling were real. These are finite mechanics qualifications, not a semantic accuracy claim.

## License

MIT. See [LICENSE](LICENSE).
