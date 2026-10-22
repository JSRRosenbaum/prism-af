# Changelog

## Unreleased

- Show full recap and decision cards by default in the native terminal UI.
- Add `full`, `collapse`, and `hidden` presentation modes; `/completion-cards` changes the latest display without rejudging, and `--save` persists a startup default.
- Render collapsed verdicts as compact notices with full-width native-theme rules above and below, a red/amber/green outcome/routing/probability header, and a muted recap preview capped at two lines. Reflow on resize and ellipsize only the visible preview; model context is unchanged.
- Retire the editor-bound card before the next input or native continuation, preserving visible settled cards as terminal scrollback notices instead of leaving the previous verdict below a new prompt. Hidden/pending cards leave no snapshot; late judgments cannot restore a retired card.
- Verify full/collapse/hidden prompt ordering in fresh isolated OMP 18.12.6 ANSI terminals with synthetic recap/judge results; this is not live-session activation or structured-client transcript persistence.
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
