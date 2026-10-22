# Changelog

## Unreleased

- Rename the package, GitHub repository, extension module, and new audit-record plugin identity to `prism-completion`. Preserve saved settings, environment variables, audit-log location, judge policy, and presentation behavior; the development install now targets `main` rather than the pre-rename release tag.
- Verify renamed manifest loading and `plugin: "prism-completion"` audit identity in isolated OMP 18.12.6 full/collapse/hidden CLI runs with synthetic native judgment and blocked network access; all 98 regression tests pass.
- Simplify retired collapsed cards to one selected result label without probability, route, recap, explanations, or metadata. Preserve the short left-hand rule and full-mode retired probabilities; judge policy and model context are unchanged.
- Use muted gray for Complete/Stopped, the theme accent (cyan/blue) for Actionable/continuation, amber for review/blocker/approval results, and red for judge failures. Retired collapsed failures/cancellation/supersession show their own result rather than an old selection.
- Verify single-label retirement, gray Complete, unchanged full/hidden behavior, prompt ordering, and 120→60→160-column resize in an isolated OMP 18.12.6 terminal with synthetic native judgment and blocked network access; resident-session activation still requires a fresh process.
- Retire every visible live card as a result-only notice with a short left-hand rule ending at the result, no right/bottom rule, and no frozen terminal padding. Omit recap, failure-detail, model, and decision-detail blocks after retirement in both full and collapsed modes. Prompt ordering, model context, and OMP core are unchanged.
- Verify retirement before native continuation and new input in full/collapse/hidden modes at 120→60→160 columns using the installed OMP 18.12.6 CLI, synthetic native judgment responses, and network isolation; retain PTY replay images. This is not live-session activation or a real-model judgment claim.
- Show the actual failure diagnostic in collapsed cards instead of “Recap unavailable” or a stale recap, preserving the compact two-line preview and resize reflow.
- Distinguish evidence-validation failures from recap failures in audit records; report the request/answer character count and limit without changing evidence bounds, truncating inputs, retrying, or requesting continuation.
- Show full recap and decision cards by default in the native terminal UI.
- Add `full`, `collapse`, and `hidden` presentation modes; `/completion-cards` changes the latest display without rejudging, and `--save` persists a startup default.
- In collapse mode, place the outcome/routing/probability inside a full-width native-theme live header rule. Stop results occupy one line with no recap or bottom rule; other results keep a muted recap preview capped at two lines and a bottom rule. Resize reflow, full-mode layout, and model context are unchanged.
- Retire the editor-bound card before the next input or native continuation, preserving visible settled cards as terminal scrollback notices instead of leaving the previous verdict below a new prompt. Hidden/pending cards leave no snapshot; late judgments cannot restore a retired card.
- Verify full/collapse/hidden prompt ordering in fresh isolated OMP 18.12.6 ANSI terminals with synthetic recap/judge results; this is not live-session activation or structured-client transcript persistence.
- Verify the shorter collapsed stop/continuation/review layouts and 120→60-column resize in a fresh isolated OMP 18.12.6 ANSI terminal with synthetic verdicts; full-mode stop details remain available.
- Read startup visibility from `JEV_COMPLETION_GATE_VISIBILITY` before `completion-judge.json` under `PI_CODING_AGENT_DIR` (path override: `JEV_COMPLETION_GATE_CONFIG`); settings errors fall back to full presentation without disabling judgment.
- Provide model continuations compact recap, JSON verdict, human-control result, and route/effect as advisory context independently of UI visibility; no permission or routing policy changes.
- Separate continuation requests from advisory recap/verdict evidence: execution asks for an authorized next action instead of another final/status recap; review asks for one actual permitted read-only check. No routing or authorization changes.
- Shape recaps as Delivered / Remaining / Next, distinguishing a completed substep from the requested outcome and unrequested enhancements from unfinished assignments. Record recap revision `2026-10-22-portable-v2` and continuation policy `2026-10-22-portable-v3` in audit metadata.
- Capture revised recap and execution/review prompts in actual resumed OMP 18.12.6 model requests with cards hidden; synthetic outputs drove real native write/read tools. This is delivery-mechanics evidence, not a real-model loop-resolution or live-activation claim.
- Qualify command toggles and saved-collapse restart in an isolated fresh OMP 18.12.5 terminal using synthetic judgment and real native widgets; this does not prove activation in an existing session.
- Capture the actual second native OpenAI model request in an isolated OMP 18.12.5 run, confirming advisory recap/verdict/control/route context delivery with cards hidden; classifier/provider output was synthetic and this is not live-session activation.
- Remove the redundant Human stop work-state row; retain human control separately and preserve external-blocker versus new-permission routing.
- Accept complete human requests up to 8,000 characters and terminal answers up to 24,000 characters; retain explicit rejection rather than truncation.
- Use OMP's native typesafe client with registry credentials/headers and usage journaling to permit 28-second classifier attempts, bounded by a 29-second gate beneath the host's 30-second handler cap.
- Qualify two overlapping real local judgments of 5,371 input tokens each through an isolated native terminal, with synthetic recap/ending evidence; this is not activation of an already-running foreground gate or a semantic accuracy claim.

## 0.1.0 — 2026-10-21

- Extract the native advisory completion gate into a standalone OMP package with an explicit release allowlist.
- Preserve fresh tool-disabled recaps, separate human-control/work-state judgments, bounded one-review chains, cancellation, pending-input checks, duplicate suppression, and branch-aware request recovery.
- Select the exact native typesafe backend through OMP's `modelRoles.judge`; disable judge fallback candidates without adding a provider transport.
- Remove bundled operator policy, system-prompt injection, machine identities, and unrelated integrations.
- Identify packaged verdicts with plugin/version metadata; distinguish continuation requests from observed native resumption.
- Target OMP 18.12.5 internal judge APIs; ship under MIT.
- Qualify the packaged entrypoint with four isolated native scenarios and 71 behavioral regressions.
