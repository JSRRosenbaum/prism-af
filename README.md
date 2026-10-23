# prism-af

Advisory completion judgment for OMP. An ordinary extension factory registers the native `session_stop` hook; it does not add a queue, scheduler, provider transport, or Telegram integration.

## Compatibility

Targets **OMP 18.12.5** only. Other versions are unverified. The manifest pins host peer versions; optional peers are supplied by the running compiled OMP host, not installed as a second runtime. Bun is needed for development tests, not an additional plugin service.

This plugin depends on **internal OMP APIs**: `settings` from `@oh-my-pi/pi-coding-agent`, and `resolveJudge` / `journalJudgmentUsage` from `@oh-my-pi/pi-coding-agent/judgment`. `lib/omp-judgment-host.ts` also uses OMP's native `NativeJudge` client and catalog cost calculation so completion calls can use an explicit HTTP deadline rather than the role chain's fixed ten-second attempt. Model selection still comes from the configured judge role; credentials and headers still come from OMP's registry, usage is journaled, and there is no substitute model or custom HTTP transport. An incompatible upgrade causes explicit abstention, not a replacement verdict. The UI uses OMP's native TUI render API.

## Install

```sh
omp plugin install github:JSRRosenbaum/prism-af#main
```

For local development:

```sh
git clone https://github.com/JSRRosenbaum/prism-af.git
omp plugin install ./prism-af
```

Local directory installation is a symlink, not a release snapshot. The `omp.extensions` manifest loads `extensions/prism-af.ts`; do not also pass that entrypoint with `-e` or retain another completion-gate registration. The development install tracks `main`; the historical `v0.1.0` tag predates the rename.

Start a fresh OMP process after installation, or use an independently controlled orderly exact-session resume supported by your host. Neither package discovery, `/reload`, nor `ctx.reload()` proves changed extension code is active. Do not terminate a host from its own active turn or simulate supported activation with terminal keystrokes. Preserve the existing native journal when resuming.

When migrating from a loose `jev-completion-gate.ts`, disable only that legacy module in the new process's config overlay, leaving unrelated global registrations untouched:

```yaml
disabledExtensions:
  - extension-module:jev-completion-gate
```

The package entrypoint has the distinct module ID `extension-module:prism-af`, so the legacy disable does not suppress the package. Merge any already-disabled modules into the overlay rather than replacing them. Do not install globally alongside an undisabled legacy gate: that would give future sessions two registrations. Session-specific installation/launch must be isolated from unrelated sessions.

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

Human control answers “did the human tell us to stop this turn?”, not “does the next step need permission?”. The detailed card therefore lists only the five work outcomes, not a redundant Human stop radio option. A human stop shows its separate control score and explicitly marks work classification as not evaluated. `blocked` remains an external dependency/resource wait; `approval_required` remains a genuinely new human decision/permission requirement. Neither is a duplicate of the stop/proceed qualifier, and neither grants authority.

**Requested continuation is not observed resumption.** OMP owns native scheduling and its continuation cap (eight automatic resumptions in the targeted host). A ninth ending may still be judged without another scheduled turn. Verify a native continuation entry and subsequent actual assistant/tool events before claiming resumption.

### Bounds and failure

| Evidence | Accepted bound |
| --- | --- |
| Current human request | 8,000 characters; rejected intact if oversized |
| Terminal answer | 24,000 characters; rejected intact if oversized |
| Recent text context | 4,000 characters, at most two messages per role |
| Fresh recap | 1–1,200 characters; no truncation or substitute |
| Recap deadline | 15 seconds |
| Two classifier calls combined | 28 seconds, additionally bounded by the whole gate |
| Entire gate | 29 seconds, below OMP 18.12.5's fixed 30-second extension-handler cap |

Recent context prioritizes complete human constraints, then tool observations, then assistant claims. Oversized context items are omitted whole with omitted-character metadata. Backend failure never fabricates a decision or silently falls back. A sufficiently long original human request can intentionally prevent judgment; compaction does not relax the bound.

Evidence-validation failures are recorded as stage `evidence`, before recap or classifier calls. Oversized request/answer diagnostics name the actual character count and the accepted limit; rejection still preserves the complete evidence without requesting continuation.

Character budgets are not token guarantees; token, queue and compute limits belong to the configured backend. A longer server budget does not extend OMP's fixed 30-second stop-hook cap. This plugin requests a 28-second native HTTP attempt and retains its 29-second whole-hook cancellation; a sufficiently large/queued request may still abstain. Other OMP native-judge consumers keep their host-default timeout. The plugin does not patch global timeouts, bypass handler budgets, truncate evidence, or restart foreground sessions.

These character limits bound the classifier evidence, **not the recap's input**. The recap asks OMP's native ephemeral-turn API to supply session context; this plugin sets no recap input-token budget. The 1,200-character recap bound applies to the returned text. `tools: false` does not mean empty conversation history. A recap-stage context-window error belongs to that main-model side request, before Decider classification; increasing the Decider context limit cannot repair it.

Failure cards name the stage and cause, such as **Recap context exceeded**, **Recap timed out**, or **Judge unavailable**. Context failures include the configured model window and native session-token estimate when available, explicitly separate from the rejected side request. The audit leaves `exactRequestTokens` and `exactOverflowTokens` null because these are not measured by the session estimate; the original provider diagnostic remains available. No model window, output budget, compaction setting, timeout, retry, or continuation policy is changed by diagnostics.

## Observe activation

Default audit: `~/.omp/agent/logs/jev-completion-gate.jsonl`. Override with `JEV_COMPLETION_GATE_AUDIT_LOG`. No telemetry is sent by the plugin itself; native judge calls use the selected provider and OMP usage ledger.

### Card visibility

Cards are **full and visible by default** in the native terminal UI. Change presentation during a session:

| Command | Live presentation |
| --- | --- |
| `/prism-af full` | Recap and detailed decision cards (default). |
| `/prism-af collapse [--save]` | Result and selected probability share a full-width ruled live header. Stops occupy that single line with no recap; other results retain a muted recap preview of at most two lines and a bottom rule. Continuation uses the theme accent (cyan/blue), stops use muted gray, reviews/waits use amber, and failures use red. After retirement, only the selected result label remains, with no probability or routing suffix. `--save` also persists this as the startup default. |
| `/prism-af hidden` | No cards; judging, auditing, and continuation behavior remain enabled. Deduplicated failure warnings remain visible. |

Changing modes immediately redisplays the latest idle result without another judgment. Pending or unavailable verdicts never invent a percentage. Live compact headers reflow to the current terminal width and use the theme's native line glyph on both sides of the result. Stops omit the recap only in collapse mode; full mode and model continuation context retain it. Other live recap previews end in an ellipsis when they exceed two lines; only the visible preview is shortened.

On failure, the live collapsed body shows the failure diagnostic instead of a missing or stale recap. It keeps the same two-line preview budget and restores more detail when widened; full mode retains the full diagnostic. Failure details are not replaced with “Recap unavailable.”

Before the next submitted input or native continuation, the editor widget is cleared. Every visible settled card retires above the next prompt/reply as a notice with a short left-hand rule and no right-hand rule, bottom rule, fixed-width padding, or prewrapped text. Collapsed retirement shows only one selected result label, such as `─── Complete`, `─── Stopped`, or `─── Approval required`: no probability, route, recap, explanation, or metadata. Complete/Stopped are muted gray, Actionable uses the theme accent (cyan/blue), and Blocked/Approval required/Evidence unclear are amber. Failures retain only their short stage/cause result, such as `─── Recap context exceeded` or `─── Judge unavailable`, in red; cancelled/superseded checks show their corresponding neutral result rather than an old selected state. Full-mode retired notices retain the result, route, and available selected probability, but omit recap, failure-detail paragraphs, model metadata, and decision-detail blocks. Live-card content, model continuation context, and judge policy are unchanged.

Hidden cards and interrupted pending judgments leave no notice. Visibility commands affect only the current idle card, not retired notices, and a late judgment cannot restore an old card under a new prompt. Retirement uses UI notices, not persisted conversation messages or additional model context; structured/native clients may present them as transient toasts rather than ANSI scrollback. Previously emitted fixed-width snapshots cannot be converted retroactively.

`/prism-af` (alias `/completion-cards`) changes presentation for the current registration and immediately redisplays the latest available result without another judgment. `--save` atomically persists the selected mode as `visibility` in `~/.omp/agent/extensions/completion-judge.json` (or `$PI_CODING_AGENT_DIR/extensions/completion-judge.json`; override the path with `JEV_COMPLETION_GATE_CONFIG`). Unrelated JSON keys are preserved. At startup, a recognized `JEV_COMPLETION_GATE_VISIBILITY=full`, `collapse`, or `hidden` value takes precedence over the file; unset or empty values use the file, then default to `full`. An unrecognized nonempty environment value selects `full`. A settings read error warns and uses full cards; a save error reports failure without disabling judgment. The old `JEV_COMPLETION_GATE_VERBOSE` switch is no longer read. No-UI sessions have no card surface.

The package/repository rename to `prism-af` does not rename the existing settings file, `JEV_COMPLETION_GATE_*` environment variables, or audit-log path; saved preferences and integrations remain unchanged. Replace the old package installation rather than loading both identities.

Every admitted execution or evidence-review continuation carries a **separate continuation request**, after the compact recap and JSON verdict/control/route evidence. Execution requests explicitly ask for the next authorized action—not another final answer, acknowledgment, or status update. Review requests explicitly ask for one permitted read-only check, not another description of the proposed check. Recap and verdict remain fallible evidence, not authority; a mistaken judgment must not manufacture work or override a human stop. Hidden/collapsed cards do not suppress either part of this model context.

The recap prompt asks for **Delivered / Remaining / Next** in fewer than 80 words. Remaining work is evaluated against the requested outcome, not just the latest finished substep. An optional enhancement or unrequested activation does not become an unfinished assignment after a sufficient informational answer; genuine established interests remain distinct from completed assignments.

A `complete` verdict is accepted only at **≥ 90% confidence** (`COMPLETE_CONFIDENCE` in `lib/jev-completion-contract.ts`). Below that bar the chain gets one evidence review (`routeReason: complete-uncertain`) instead of parking, because a bare-majority completion usually meant remaining verification had not run. Conversely, an ambiguous human-control read — a bare acknowledgement such as "ok, thanks" — cannot veto a confident completion; that reading previously produced a redundant review turn after a finished answer.

On OMP 18.12.5, an isolated synthetic-provider run captured the actual second native OpenAI model request with the continuation recap, JSON verdict, human-control result, and route/effect while cards were hidden. The fixture returned a synthetic response; this qualifies context delivery mechanics, not model accuracy or activation in the user's running session. A separate fresh native UI smoke verified full/collapse/hidden toggling and that `collapse --save` is restored after restart; its verdict was explicitly synthetic.

An isolated OMP 18.12.6 CLI run captured the revised recap prompt and the actual resumed model requests for both execution and review with cards hidden. Synthetic main/recap/judge outputs drove a real native `continue → write → stop` and `review → read → uncertain` sequence. This verifies prompt delivery and routing mechanics, not that a real model will stop repeating summaries or that wG has loaded the revision.

Compact rendering was exercised in isolated fresh OMP 18.12.6 ANSI terminals with synthetic stop/continue/review examples: a one-line ruled stop with no recap, ruled result/probability headers above continuation/review previews, resize from 120 to 60 columns with two-line ellipsis, and the unchanged detailed full-mode stop recap/verdict. Boundary tests cover widths 1–321, Unicode/ASCII/Nerd symbols, wide text, and reversible preview truncation on resize. This does not activate changed renderer code in an existing process.

Single-label collapsed retirement and muted completed results were verified in another isolated OMP 18.12.6 CLI run with synthetic native judgment, blocked network access, retirement before automatic continuation and new human input, and 120→60→160-column resize. Full-mode retired probabilities and hidden-mode suppression were also verified; this does not activate a resident extension handler.

An already-running legacy gate does not gain these controls from a source edit or `/reload`. Changed extension code must be loaded through a fresh process or the orderly exact-session resume procedure above; do not claim activation until a fresh audit record confirms it for that session. Updating the user's saved default does not activate a currently running session.

Audit records include plugin/version, contract/prompt/policy versions, session/turn identity, input hashes/lengths, decision, stage, and requested effect. Successful evidence text is not logged. Error reasons may contain provider diagnostic details: treat audit files as private. New audit directories/files request `0700`/`0600`; existing permissions are not tightened. Audit I/O is best-effort and never changes delivery behavior: absence is not proof of successful activation or a verdict.

While a recap is pending, a read-only `before_provider_request` observer records `recapRequests` metadata only for payloads containing that exact recap prompt: timestamp, payload model, serialized JSON bytes, input/message-item count, tool-definition count, explicit output cap when present, and whether a previous response is referenced. It records no prompt text, images, credentials, or response IDs, returns no payload replacement, and never adds telemetry to classifier evidence. A context-failure record may additionally contain `decision.context` with the configured window and session-token estimate.

Payload bytes/items are **not token counts or an overage calculation**. This is the payload observed at that hook, not a guarantee about later hooks, provider-side cached history, transport encoding, or effective context limits. No observed payload field means no matching hook snapshot was captured, not proof that no request happened. Auditing remains best-effort; this observer does not retry requests or change their context.

To prove activation, observe a **fresh record for the exact native session**, `plugin: "prism-af"`, and the installed version. If effect is `continue` or `review`, separately correlate native `session-stop-continuation` history and a subsequent real turn/tool result. A synthetic provider run qualifies mechanics only, not live activation or classifier accuracy.

## Development and release

```sh
bun install --frozen-lockfile
bun test
npm pack --ignore-scripts --dry-run
```

The release allowlist contains ten files: the entrypoint, five library modules, package manifest, README, changelog, and MIT license. Source tests are in GitHub but excluded from the installed package. No installation lifecycle scripts run. Do not add private sessions, receipts, audit logs, credentials, or local policy to the repository.

Derived from a maintained native completion-gate implementation: decision contract v2, prompt v9, continuation policy v18, recap v2. The portable classifier remains `2026-10-21-portable-v1`; recap is `2026-10-22-portable-v2` and continuation policy is `2026-10-22-portable-v3`, adding explicit action/review requests without changing routing. The decision contract remains `2026-10-20-v2`. Implementation and extraction were AI-assisted; finite mechanics tests do not establish broad semantic accuracy.

### Release qualification

On OMP 18.12.5, the initial release passed 71 behavioral tests, including cancellation, pending-input races, duplicate delivery, branch changes, clear boundaries, and backend rejection. Fresh isolated HOME installations of the packed manifest entrypoint exercised native `continue → write → stop`, human-stop non-effects, one `review → read → uncertain` chain, and failed-backend abstention. Main/recap/classifier replies in those scenarios were synthetic; package discovery, native judgment transport, actual tools, and continuation scheduling were real. These are finite mechanics qualifications, not a semantic accuracy claim.

## License

MIT. See [LICENSE](LICENSE).
