# 54. protected-files.sh is advisory-only even for files where an agent edit is near-certainly wrong; split the path list into advisory and deny tiers

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: hooks · Area: hooks-protected-files · Severity: med-high · Size: M · Confidence: high
Theme: protected-files-tiering · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
The protected-files PreToolUse hook treats every entry in its path table identically: a throttled `additionalContext` advisory, never a deny. That is right for "read the guide first" paths (routers, schemas, socket surface) but wrong for files where a direct agent edit is near-certainly a mistake or an integrity hole: hand-editing `lint-ratchet.baseline.json` silently moves the debt ratchet (see leaf 14 of this pack on baseline integrity); editing suppression registers widens the allowed-suppression surface; editing generated files (`docs/generated/*`, `scripts/verify/steps.generated.sh`) gets overwritten by the next regeneration or desyncs the freshness gate; hand-editing `bun.lock` or `.husky/_` breaks machinery. Worse, the advisory tier is throttled, so a repeat edit within the TTL gets *no* message at all. PreToolUse denies fire before the write and even hold under bypassed permissions, so a deny tier is the correct strength for this short list.

## Evidence
- `scripts/ai-hooks/protected-files.sh:146` — the only emission path is `ai_emit_additional_context "PreToolUse" "$combined"`; `ai_emit_deny` (available in `scripts/ai-hooks/common.sh:63-66`) is never used. Verified: no deny anywhere in the file.
- `scripts/ai-hooks/protected-files.sh:27-82` — the single flat advisory table. It already *labels* three entries "Tamper advisory": `*/lint-ratchet.baseline.json` (`:52-55`), `*/eslint.config.js` (`:56-59`), suppression registers `scripts/eslint-disable-register.sh|scripts/suppression-register.sh` (`:60-63`) — the hook knows these are tamper-shaped and still only whispers.
- `scripts/ai-hooks/protected-files.sh:100-111` — advisories are throttled (default TTL 1800s, max 10 detections), so repeat offenses within the window are silent.
- Wiring: `.claude/settings.json:113-121` — PreToolUse, matcher `Edit|Write`, so a deny would land *before* the file is written. Codex adapter: `.codex/hooks/protected-files.sh` on `apply_patch` (note `docs/agent_notes/harness-engineering-research/12-custom-hooks.md` records Codex PreToolUse as unreliable for structured patches — the deny tier is Claude-strength, Codex-best-effort).
- Deny-tier candidates verified to exist: `lint-ratchet.baseline.json` (repo root), `scripts/eslint-disable-register.sh`, `scripts/suppression-register.sh`, `docs/generated/{harness-controls.md,local-lint-rules.md}` (regenerate: `bun run docs:harness-controls` per `harness.controls.json:1` `$comment`), `scripts/verify/steps.generated.sh` (generated verify steps), `bun.lock`, `.husky/_`.
- Kill-switch house style to mirror: `.no-stop-*` markers (`scripts/ai-hooks/stop-policy.sh:7-14`), `.no-edit-lint` (`scripts/ai-hooks/ratchet-regression-check.sh:34`).

## Proposed direction
Split `ai_protected_file_advisory_entry` into two tiers:
- **Advisory tier (current behavior, throttled):** guides and caution paths — prisma schema, routers, socket, rules, e2e, shared schemas, `eslint.config.js`, `.husky/*` (hand-editing hooks is legitimate maintenance), concurrency boundaries.
- **Deny tier (`ai_emit_deny`, never throttled):** `lint-ratchet.baseline.json`, both suppression registers, `docs/generated/*`, `scripts/verify/steps.generated.sh`, `bun.lock`, `.husky/_/*`. Each deny message must carry repair text pointing at the right regeneration/maintenance command (`bun run docs:harness-controls`, `bun run lint:ratchet:check-baseline` after an *intentional* baseline move, `bun install` for the lockfile, and so on).
Escape hatch consistent with house style: a `.allow-protected-edits` marker file at repo root downgrades the deny tier to advisory (message should say which marker enabled it), so intentional maintenance — e.g. a genuine ratchet re-baseline — stays a one-touch override rather than a hook edit. Extend the hook's coverage in `scripts/ai-hooks/test.sh` with both tiers and the marker.

## Scope / caveats
Keep the deny list short and near-certain; anything debatable stays advisory (this is why `eslint.config.js` and `.husky/*` do not move tiers). The deny reason is the prompt the agent reads — make each one name the correct alternative action, not just "denied". Cross-ref leaf 14 of this pack for the lint-ratchet baseline integrity rationale; this leaf is the enforcement half. One commit; if the escape-hatch plumbing grows, split marker support into a first commit.
