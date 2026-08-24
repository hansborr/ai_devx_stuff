# 126. All 32 hook bindings hand-author derived command strings, and 29 also hand-author standard matcher syntax, without canonical-projection enforcement

Status: Landed on fix/cq-126
Theme: hook-wiring provenance enforcement · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`harness.controls.json` wires 18 AI hook controls into 32 per-harness bindings.
All 32 hand-author a **command** string determined by the harness and the hook
body's basename. Thirty bindings also carry a matcher: 29 use standard
harness/tool-surface adapter syntax, one is the policy-owned lifecycle matcher,
and the two Stop-family bindings are matcher-less. All 32
command strings follow exactly one of two templates — the Claude
`$CLAUDE_PROJECT_DIR` form or the codex/copilot toplevel-quoted form — with zero
exceptions, and the edit-hook matcher triple (`Edit|Write` / `apply_patch` /
`create|edit`) repeats verbatim across seven controls.

The generation side already treats these strings as derived: `hook-shims.ts`
parses the authored commands back into shim paths with two grammar regexes, and
`check-wiring.sh` mirrors the same two grammars in shell. So the repo authors a
string in the manifest, then re-derives its meaning in code. The generator
already rejects commands outside the two recognized grammars or the selected
harness's shim directory, but it does not assert the exact canonical projection
from body basename or validate canonical matcher syntax. Nor does it tell a
contributor which parts of a binding are policy they may choose (event, order,
timeout, statusMessage, notes) versus adapter syntax that must follow the
template. Since the shim-generation
work landed, the manifest genuinely is the single wiring authority with a drift
check, so nothing actively misleads; the surviving cost is that every new hook
means hand-copying template boilerplate into up to three bindings, and the
manifest — the marquee copyable artifact of a public harness-engineering
reference — carries ~32 near-identical records where the genuinely divergent
data (aggregator asymmetries, timeouts, deliberate-omission notes) is buried in
boilerplate.

The same validate-mode seam also has a narrower fail-open edge: `hookWiring` is
the only manifest facet whose consumer silently discards unknown fields both on
the top-level facet and inside each harness command. Across the 18 live wired
controls, a misspelled or obsolete field can therefore survive whole-manifest
validation and disappear from the resolved model instead of producing the
focused registration diagnostic that the other facets provide.

## Evidence

All counts below re-derived from the tree at the pin by parsing
`harness.controls.json` and enumerating `hookWiring` facets.

- `harness.controls.json:1395-1428` — the `check/harness-hook-wiring-generator`
  control registers hook wiring as a generated surface: outputs
  `.claude/settings.json`, `.claude/hooks/`, `.codex/hooks.json`,
  `.codex/hooks/`, `.copilot/hooks/`, `.github/hooks/copilot.json`
  (`:1420-1427`), checked by `checkScript: "harness:wiring:check"` (`:1428`).
- The manifest has 24 `kind: "hook"` controls; 18 carry a `hookWiring` facet
  (the other 6 are git hooks with no harness bindings). The facets span
  `harness.controls.json:2226` (first, `hook/ai-no-direct-db`) through `:2719`
  (last, `hook/ai-subagent-stop-reminder`).
- 18 wired controls expand to 32 bindings: 14 claude, 9 codex, 9 copilot.
  7 controls are wired in all three harnesses — `hook/ai-protected-files`
  (PreToolUse) plus 6 PostToolUse edit hooks (`ai-prisma-generate`,
  `ai-doc-length`, `ai-backlog-note-lint`, `ai-tidy-edited-file`,
  `ai-lint-coverage-check`, `ai-ratchet-regression-check`).
- Matcher histogram across the 32 bindings: 7 `Edit|Write` / 7 `apply_patch` /
  7 `create|edit` / 6 `Bash` / 2 `bash|powershell` / 1 `startup|resume|compact`
  (the claude-only `hook/ai-session-state` lifecycle hook) / 2 matcher-less
  (`hook/ai-stop-reminder` Stop, `hook/ai-subagent-stop-reminder` SubagentStop).
  Every matcher is a pure function of (harness, tool surface) except the
  lifecycle and matcher-less cases.
- All 32 command strings match exactly one of two templates: 14 claude commands
  of the form `bash $CLAUDE_PROJECT_DIR/.claude/hooks/<name>` and 18
  codex/copilot commands of the form
  `bash "$(git rev-parse --show-toplevel)/.<codex|copilot>/hooks/<name>"`.
  Zero nonconforming commands.
- `scripts/harness/hook-shims.ts:37-38` — `CLAUDE_PROJECT_DIR_COMMAND` and
  `TOPLEVEL_COMMAND`, the two regexes that parse authored commands back into
  shim paths (`:69`), resolved against `HOOK_SHIM_DIRS` (`:17`). The code
  re-derives what the manifest hand-authors.
- `scripts/ai-hooks/check-wiring.sh:160-164` — the same two command grammars
  mirrored a second time, in shell.
- `scripts/harness/hook-wiring-schema.ts:223-231` — `assertMatcherPolicy`
  validates only matcher *presence* per event; `:241-253` accepts `matcher` and
  `command` as arbitrary strings. No content validation exists.
- `scripts/harness/harness-manifest-schema.ts:30-43` — the whole-manifest
  parser deliberately treats facet interiors as loose carriers and leaves deep
  validation to the consumer, making `hook-wiring-schema.ts` the enforcement
  point for unsupported `hookWiring` fields.
- `scripts/harness/generated-surfaces.ts:29-56`,
  `scripts/harness/skill-inventory-schema.ts:44-52`, and
  `scripts/harness/verify-step-schema.ts:186-203` — the other three live facet
  validators reject unknown keys through strict objects or explicit allowed-key
  checks.
- `scripts/harness/hook-wiring-schema.ts:233-256` and `:332-370` — harness
  commands and the top-level `hookWiring` object read only recognized fields
  into new result objects without comparing the input keys to an allowed
  inventory. Measured at the pin, exactly **18** controls carry `hookWiring`
  (`jq '[.controls[] | select(has("hookWiring"))] | length'
  harness.controls.json`).
- Genuine per-binding divergence that must stay expressible:
  `harness.controls.json:2236-2239` — `hook/ai-no-direct-db` notes recording
  that codex/copilot deliberately route the same policy through their Bash
  aggregators; all 9 codex bindings carry a `statusMessage` (e.g. `:2259`,
  `:2402`); `:2730-2734` — `hook/ai-subagent-stop-reminder` notes explaining
  why codex and copilot wiring is omitted.
- `scripts/harness/hook-wiring-schema.ts:100-122` — `HARNESS_SUPPORTED_EVENTS`
  and `HOOK_OUTPUT_SUPPORT`, existing fail-closed `as const satisfies`
  capability tables the projection tables below should sit beside.
- `scripts/harness/hook-shims.ts:139` — the existing `porting-knob:` comment
  convention.

## Proposed direction

Assert-canonical **validate mode** — enforce that the authored strings match the
canonical projection, rather than deleting them or generating them. Hook
identity stays where it already lives: the `hookWiring` facet on each control in
`harness.controls.json`. No separate provider-neutral registry.

1. **Add an optional neutral `surface: "bash" | "edit"` field** to the
   `hookWiring` facet, declared on the eligible non-aggregator bash/edit
   controls (11 by enumeration at the pin: the 7 three-harness edit-surface
   controls plus the 4 claude-only Bash hooks `ai-no-direct-db`,
   `ai-git-commit-quiet`, `ai-bun-run-quiet`, `ai-failure-guidance` — the last
   is a PostToolUseFailure hook, so if the tripwire is scoped to
   PreToolUse/PostToolUse it still accepts an explicit `surface` declaration
   here).
2. **Add two projection tables** in `scripts/harness/hook-wiring-schema.ts`,
   colocated with `HARNESS_SUPPORTED_EVENTS` / `HOOK_OUTPUT_SUPPORT`
   (`:100-122`) and using the same fail-closed `as const satisfies` idiom:
   - `CANONICAL_MATCHER[(harness, surface)]`: claude bash→`Bash`, claude
     edit→`Edit|Write`, codex edit→`apply_patch`, copilot
     bash→`bash|powershell`, copilot edit→`create|edit`. (Codex `Bash`
     matchers occur only on the excluded aggregators, so the table needs no
     codex-bash row.)
   - `canonicalCommand(harness, bodyBasename)`: claude →
     `bash $CLAUDE_PROJECT_DIR/.claude/hooks/<name>`; codex/copilot → the
     toplevel-quoted form into `HOOK_SHIM_DIRS[harness]`.
3. **Validate on declaration.** When `surface` is declared, schema validation
   asserts the authored matcher and command byte-equal the canonical
   projection, with error messages that print the expected string — the
   validator is the self-teaching provenance oracle.
4. **Add the opt-out tripwire:** error/warn when a non-aggregator
   PreToolUse/PostToolUse control whose matcher matches a known canonical value
   omits `surface`, forcing either a declaration or an explanatory note.
5. **Grafted refinements:**
   - The lifecycle matcher `startup|resume|compact` on `hook/ai-session-state`
     is *policy* (which session sources fire), not adapter syntax — it stays
     authored and out of the tables. Frame the change explicitly, in the facet
     schema comment, as stage 1 of a possible later emit-canonical derivation,
     so flipping assert→emit is a mechanical follow-up on already-tested
     tables.
   - Mark the projection tables with the repo's existing `porting-knob:`
     comment convention (precedent `hook-shims.ts:139`).
   - State the provenance rule in three existing teaching surfaces: the facet
     schema JSDoc/error messages, the generated harness-controls doc
     (`docs/generated/harness-controls.md`, rendered via
     `scripts/harness/hook-wiring-doc.ts` and regenerated with
     `bun run docs:harness-controls`), and a comment atop the manifest's
     hookWiring section. Rule text: **manifest = policy authority** (event,
     order, body, timeout, statusMessage, outputs, notes); **projection tables
     in hook-wiring-schema.ts = adapter-syntax authority** (manifest
     matcher/command strings are canonical-checked copies, like committed
     generated output); **.claude/.codex/.copilot/.github hook files =
     generated, never authoritative**.
6. **Reject unknown fields at the existing consumer boundary.** Add explicit
   allowed-key inventories for the top-level `hookWiring` object and for every
   harness command object, with focused diagnostics and tests. The top-level
   inventory includes this leaf's new optional `surface` field alongside the
   existing policy fields; command inventories cover only the currently
   resolved command fields. Keep this in `hook-wiring-schema.ts` rather than
   tightening the whole-manifest carrier or sharing validators across facets.

Explicitly untouched: `generate-hook-wiring.ts`, the `hook-shims.ts`
command-parse regexes, `check-wiring.sh`, all generated hook files, and all
generatedSurface trigger/fixture registrations — generated bytes are identical
by construction (`bun run harness:wiring:check` must stay green throughout).
Estimated churn: ~50-70 lines in `hook-wiring-schema.ts`, ~10 manifest lines,
schema unit tests (no `hook-wiring-schema.test.ts` exists yet; the sibling
suites `generate-hook-wiring.test.ts` / `hook-shims.test.ts` are the pattern),
and one doc regen.

Full derivation — dropping the authored strings, deleting the backward-parse
regexes, a `shimName` aggregator override, materialized-binding doc rendering —
is recorded as an **optional deferred follow-up**, to be decided later with the
tables in hand. It is not scheduled in this pack.

## Scope / caveats

Binding rulings from the panel that shaped this leaf:

- **Do not introduce a separate provider-neutral hook registry or identity
  layer.** Identity and policy stay in the existing `hookWiring` facet,
  extended only with the optional `surface` field. (A new registry would
  recreate the provenance ambiguity this leaf removes.)
- **Do not delete or generator-derive the manifest's matcher/command strings in
  this pack.** Validate mode only; emit-mode derivation is the explicitly
  optional later follow-up.
- **Exact-key rejection is part of that validate mode.** It changes only
  consumer acceptance and focused schema tests: do not use it to edit the
  wiring generator, shims, generated hook files, or generatedSurface
  registrations, and include the optional `surface` field in the top-level
  allowed-key inventory.
- **Do not touch** `generate-hook-wiring.ts`, the `hook-shims.ts` regexes,
  `scripts/ai-hooks/check-wiring.sh`, any generated hook file, or any
  generatedSurface trigger/fixture registration. The change is confined to
  `hook-wiring-schema.ts`, the `hookWiring` facets, tests, and doc regen.
- **Do not neutralize the aggregators or claude-only hooks.**
  `hook/ai-codex-pre-tool-use` / `hook/ai-codex-post-tool-use` /
  `hook/ai-copilot-pre-tool-use` / `hook/ai-copilot-post-tool-use` and the
  claude-only lifecycle/policy hooks are documented architectural asymmetries,
  not repetition: they omit `surface` and record their asymmetry in `notes`.
  The step-4 tripwire covers the omission case.
- **Do not project timeouts, codex `statusMessage`, or the lifecycle matcher**
  through the tables — they are per-harness policy and stay authored.
- **Sizing:** triage carried this at M for a needs-split generator/migration
  change; the panel's final ruling is that the validate-mode reshape lands as a
  **single leaf at effective size S** (severity medium confirmed), touching one
  code file plus ~10 manifest lines. The S estimate holds only because
  generated bytes are untouched by construction; if implementation finds
  itself editing the generator or shims, stop — that is the deferred follow-up,
  not this leaf.
- **Prior pack:** the landed shim-generation plan
  (`docs/agent_notes/backlog/arch-plans-2026-07/03-harness-hook-shim-generation.md`,
  merged `3e9b28df`) already owns generation of the `.claude`/`.codex`/`.copilot`
  shims and is a recorded do-not-reopen (CQ25-122); this leaf's novelty is
  provenance *enforcement*, not generation. CQ25-129 (won't-do: rewriting
  `generate-hook-wiring.ts`'s JSON scanner onto `jsonc-parser`) reinforces
  leaving the generator alone. The 2026-07-25 pack explicitly placed
  `harness.controls.json` internals out of its scope
  (`code-quality-2026-07-25/AUDIT-SUMMARY.md:123`), so no prior ruling covers
  within-manifest binding factoring.
- **Same-file siblings:** [125-manifest-copies-verify-slot-programs-across.md](./125-manifest-copies-verify-slot-programs-across.md)
  (gate slot programs) and [116-generated-surface-dependencies-manually.md](./116-generated-surface-dependencies-manually.md)
  (generated-surface dependency facets) edit other sections of
  `harness.controls.json`, and [114-harness-controls-represented-competing.md](./114-harness-controls-represented-competing.md)
  touches the manifest's TypeScript contract. No ordering dependency, but do
  not work them concurrently with this leaf in `harness.controls.json` or
  `scripts/harness/`.
