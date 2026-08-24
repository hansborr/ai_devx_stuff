# 115. Gate parity checks pin wiring by fingerprinting shell and YAML source text instead of sharing the data that creates the wiring

Status: Landed on fix/cq-115
Theme: contracts over source fingerprints · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Three `harness:check` parity checks answer the question "is the gate wired the
way the manifest says?" by reading the gate's *source text* — literal shell
fragments, whitespace-normalized regexes, `indexOf` source-order positions, a
hand-rolled line-oriented YAML reading, and a reimplementation of a hook's
`grep -qE` pattern — instead of comparing against the structured data the
wiring is (or could be) generated from. The consequence cuts both ways: a
harmless refactor of `.husky/pre-commit`, `.github/workflows/ci.yml`, or
`.husky/pre-push` (reordering an assignment, reflowing a line, renaming a
local) can fail a check whose invariant still holds, while extending a gate
means teaching another private parser to recognize new text. One of the three
(the pre-push scope pin) is honest about this — it documents its brittleness
and fails with paste-ready replacement text — so its cost is loud friction
rather than silent wrongness; the other two just quietly tax every edit to the
files they fingerprint.

This matters more here than it would in a private repo: the repo is a public
harness-engineering reference, and fingerprint-based parity checking is
exactly the pattern an adopter would copy. The repo's own established
convention — generated `.generated.sh` fragments sourced by hooks, registered
as `generatedSurface` facets with a standard freshness gate — already solves
two of the three cases with *less* code, and the third case is a deliberate
tamper tripwire that should be shrunk and labeled as such, not replaced.

One data-shaped seam remains inside the registration-preflight slice: the
verify-step producer and its in-process freshness checker separately map the
same four output paths to the same four renderers, while preflight maintains a
third four-path list. That preflight proves only that each declared path is in
the manifest and that the checker source mentions the corresponding constant;
it does not prove the refresh path actually writes every advertised output.

## Evidence

All three checks run under `bun run harness:check`
(`scripts/harness-check.ts:124-136` feeds hook/engine/collector source into
the preflight check; `:143-145` runs the pre-push pin; `:159-163` runs CI
parity).

Registration preflight (`scripts/harness/registration-preflight-wiring.ts`, 192 lines):

- `scripts/harness/registration-preflight-wiring.ts:46-64` — slices the
  `musi_precommit_snapshot_fast_mode` function body out of `.husky/pre-commit`
  by `indexOf` on `"musi_precommit_snapshot_fast_mode() {\n"` and `"\n}\n"`,
  then requires nine literal fragments (`snapshotFragments`) to appear inside
  the slice.
- `scripts/harness/registration-preflight-wiring.ts:77-96` — collapses the
  hook source with `replace(/\s+/gu, " ")` and matches multi-clause regexes
  that embed the timeout default as literal text
  (`MUSI_PRECOMMIT_REGISTRATION_TIMEOUT:-45`, mirroring
  `.husky/pre-commit:303`) and the exact `timeout --foreground …` command
  line.
- `scripts/harness/registration-preflight-wiring.ts:107-125` — `checkHookWiring`
  takes `indexOf` positions of five source tokens and asserts they appear in
  ascending source order; `:130-137` repeats the same position-ordering
  technique against `scripts/lib/verify-engine.sh`.
- `scripts/harness/registration-preflight-wiring.ts:22-30` and `:161-175` —
  `REQUIRED_REGISTRATION_FRAGMENTS` duplicates the verify-steps generator's
  output paths as a local const, then `checkFragmentCoverage` verifies
  coverage by counting substring occurrences (`>= 2`, import-plus-use) of each
  constant name in the raw source of
  `scripts/harness/registration-generated-checks.ts`.

CI gate parity (`scripts/harness/harness-gate-parity.ts`):

- `scripts/harness/harness-gate-parity.ts:117-145` —
  `findMarkedStepInvocation` and `extractCiGateBindings` parse
  `.github/workflows/ci.yml` by splitting on `"\n"` and running per-line
  regexes for `# harness-ci-gate:`, `- name:`/`- uses:`, and `run:` — a
  private, comment-anchored YAML interpretation that breaks on any
  formatting the regexes did not anticipate.
- Measured at the pin: `ciGateControlIds` in `harness.controls.json` has
  exactly one entry (`verify-wrapper/verify`), and `ci.yml` has exactly one
  `# harness-ci-gate:` marker (`.github/workflows/ci.yml:75`, binding the
  `bun run verify` step at `:81`). The 65-line parser exists to check one
  comment against one step.

Pre-push scope pin (`scripts/harness/pre-push-scope-pin.ts`, 113 lines, plus an 87-line test):

- `scripts/harness/pre-push-scope-pin.ts:21-22` — `TRIGGER_ANCHOR` and
  `ALTERNATION_PATTERN` reproduce, in TypeScript, the shape of the hook's
  `grep -qE` trigger at `.husky/pre-push:267`
  (`(^|/)(sensor-near-duplicates\.baseline|drift-ai\.config)\.json$|\.(ts|tsx|js|jsx|mjs|cjs)$`),
  and `:26-34` carries its own ERE metacharacter escape/unescape helpers to
  round-trip extensions through that pattern.
- `scripts/harness/pre-push-scope-pin.ts:88-100` — reads
  `drift-ai.config.json` through a private lenient JSON reader rather than
  `loadDriftAiConfig`, accepted as a trade-off to keep the fixture import
  closure small (`:82-87`).
- Mitigant, by design: the file header (`:1-8`) states the coupling problem it
  papers over ("the two were previously coupled by a comment only"), and its
  failure messages carry paste-ready fix text — the exact replacement
  alternation (`:74-79`) or a pointer to update the pin itself (`:36-42`). The
  brittleness is documented, loud, and self-repairing; it is still a parser
  maintained by hand to chase a string the repo could generate.

The repo already has the machinery the first two checks reimplement by hand:

- `.husky/pre-commit:254-257` and `:433` already source generated fragments
  (`scripts/harness/generated-surface-freshness.generated.sh`,
  `scripts/verify/steps.generated.sh`) — the sourced-fragment pattern for
  husky hooks exists.
- `scripts/harness/generate-hook-timeout-constants.ts` generates
  `scripts/ai-hooks/hook-timeouts.generated.sh`, sourced by
  `scripts/ai-hooks/bun-run-quiet.sh:47` and
  `scripts/ai-hooks/git-commit-quiet.sh:38` — the data-to-data constant
  fragment pattern exists.
- The `check/verify-steps-generator` control in `harness.controls.json`
  declares a `generatedSurface` facet with `triggerPaths`/`outputPaths` whose
  freshness the standard gate already enforces — the registration pattern for
  new generated surfaces exists.
- `scripts/harness/generate-verify-steps.ts:402-433` — the refresh entry point
  independently registers the four output-path/renderer pairs; the final three
  calls each reload the generated-surface model.
- `scripts/harness/registration-generated-checks.ts:95-131` — the in-process
  freshness checker enumerates the same four output-path/renderer pairs again.
- `scripts/harness/registration-preflight-wiring.ts:161-175` — preflight joins
  its local four-path list to manifest `outputPaths` and counts constant-name
  occurrences in checker source. It never compares a producer-owned
  path/renderer descriptor with the manifest record, so declared checker
  coverage can pass without proving the refresh entry point writes every
  output.

## Proposed direction

Three independent parts with different verbs — generate, restructure, shrink —
not one blanket generation effort. Part 1 lands first (cheapest, least
controversial); parts 2 and 3 are independent of each other; part 3's doc
change describes the end state of all three.

1. **Pre-push scope pin: generate the trigger, delete the checker.** Generate
   the ENTIRE near-duplicates trigger ERE — the filename alternation
   (`sensor-near-duplicates\.baseline|drift-ai\.config)\.json` half as well as
   the `buildSourceExtensions` extension half (`scripts/drift-ai/scope.ts:62`
   plus `drift-ai.config.json` `additionalSourceExtensions`) — into a
   `.generated.sh` fragment sourced by `.husky/pre-push`, replacing the
   hardcoded pattern at `.husky/pre-push:267`. Generating only the extension
   set would leave half the pattern hand-written and the seam alive. Register
   the generator as a `generatedSurface` facet in `harness.controls.json`
   (model: the `check/verify-steps-generator` facet; regen with
   `bun run verify:steps` after editing the manifest) so the standard
   freshness gate subsumes the parity check. `.husky/pre-push` fails closed
   with a regeneration instruction if the fragment is missing, mirroring its
   existing stale-baseline failure at `.husky/pre-push:313-322`. Declare
   `drift-ai.config.json` as a generator input in
   `eslint-config/config-surface-manifest.json` (it is not declared there
   today; regen with `bun run harness:config-surfaces`). Then delete
   `scripts/harness/pre-push-scope-pin.ts`, its test, and its invocation at
   `scripts/harness-check.ts:143-145` outright — net-negative LOC.
2. **CI gate parity: contract as data, real parser, no generation.** Do NOT
   generate `ci.yml`, a marker-bounded region in it, or a composite action.
   Instead move the binding out of the `# harness-ci-gate:` comment into
   step-level structured data — e.g. `env: HARNESS_CI_GATE:
   verify-wrapper/verify` on the step at `.github/workflows/ci.yml:76-81` —
   and parse the workflow with a real YAML parser (`Bun.YAML`, available on
   the repo's Bun ≥ 1.3). Keep the extraction thin so unit tests cover only
   the pure comparison of parsed step objects ({env key, `run`} pairs) against
   `ciGateControlIds` + manifest invocations. Retire
   `findMarkedStepInvocation` and `extractCiGateBindings`
   (`harness-gate-parity.ts:117-145`). Record in the check's header that
   whole-file or composite-action generation is revisited only if
   `ciGateControlIds` grows to roughly 3+ entries; today it has one.
3. **Registration preflight: shrink and label, no generation.** Single-source
   only the data-shaped parts:
   - the timeout default: emit it as a generated constant fragment the hook
     sources (the `hook-timeouts.generated.sh` data-to-data pattern), so
     `registration-preflight-wiring.ts:77-96` compares data to data instead of
     regex-matching a literal `:-45` in normalized shell;
   - replace `REQUIRED_REGISTRATION_FRAGMENTS` (`:22-30`) and the duplicated
     producer/checker mappings with one generator-owned typed descriptor for
     the four output path-to-renderer projections. Both the refresh entry point
     and in-process freshness checker consume it, loading the typed manifest
     and generated-surface model once per operation rather than once per
     projection;
   - keep the `check/verify-steps-generator` facet's `outputPaths` as the
     registration authority. Replace fragment coverage (`:161-175`) with an
     exact descriptor-path-to-manifest-path parity assertion, so neither an
     advertised output with no writer nor an undeclared generated output can
     pass preflight.

   Deliberately KEEP the behavioral ordering fingerprints — the snapshot
   function slice (`:46-64`), the unstaged-to-gate `indexOf` ordering
   (`:107-125`), and admission-before-marker-before-bridge (`:130-137`) —
   but narrow multi-line formatting-sensitive fragments to
   function-name/assignment anchors so reflow-only edits stop tripping them.
   Reframe the file with a header naming it a **source-fingerprint tamper
   tripwire**: it reads real hook source precisely so the edit that unwires
   the hook cannot regenerate its own alibi — a generated or hook-self-described
   contract would let the same commit that removes the admission call also
   update the contract that vouches for it.
4. **Docs.** Alongside part 3, add a short decision-rule section to the
   relevant harness doc: *generate what is data; fingerprint only
   behavioral/tamper invariants, and label them* — and record the intentional
   residual fingerprint in the preflight check as the worked example.

## Scope / caveats

- **Binding ruling (CI parity):** do not generate `ci.yml`, a marker-bounded
  region in it, or a composite-action fragment while `ciGateControlIds` has
  fewer than ~3 entries; the fix is contract-as-data (step-level env key) plus
  a real YAML parser, nothing more.
- **Binding ruling (preflight):** do not replace the behavioral ordering
  fingerprints (snapshot function, unstaged-to-gate ordering,
  admission-before-marker-before-bridge) with generated or hook-self-described
  contracts, and do not generate `.husky/pre-commit` internals. Shrink
  fingerprints to anchors, label the file a deliberate tamper tripwire, and
  record the residual in the harness docs.
  - **Met differently (landed):** the timeout default landed as the shared
    hand-written `MUSI_GATE_PRECOMMIT_REGISTRATION_TIMEOUT_DEFAULT` constant in
    `scripts/lib/verify-state-paths.sh` — the repo's canonical home for gate
    timing budgets, documented in `docs/guides/verify-gate-lifecycle.md` — not
    as the generated fragment the direction's part 3 asks for, because a
    generator for one integer is more machinery than the rule it records; the
    bullet's stated purpose still holds, since the preflight now anchors on the
    constant's name instead of a literal `:-45` and the number lives once.
- **Binding ruling (verify-step projections):** manifest `outputPaths` remain
  the registration authority; the typed descriptor must agree exactly rather
  than replace them. Preserve the standalone `bun run verify:steps:check`
  command and the current granular malformed-manifest diagnostics while
  consolidating generation and in-process comparison.
- **Binding ruling (shape):** this is three independently landable pieces —
  pre-push trigger generation (S/M), CI contract-as-data (S/M), preflight
  shrink-and-label plus decision-rule docs (M) — with the pre-push piece
  first. Do not attempt it as one sweep.
- **Binding ruling (pre-push generation):** the generated fragment must carry
  the entire ERE including the baseline/config filename alternation; pre-push
  must fail closed when the fragment is missing; `drift-ai.config.json` must
  be declared as a generator input in the config-surface manifest.
  - **Met differently (landed):** the config-surface manifest cannot hold a
    JSON file — `eslint-config/config-surfaces.js:45` restricts `language` to
    `js|mjs|ts` — and
    [109-musi-repository-policy-embedded-throughout.md](./109-musi-repository-policy-embedded-throughout.md)
    (§ "Scope / caveats") independently rules that `drift-ai.config.json` must
    *not* be registered there. The ruling's function — a config edit arms the
    generator's freshness gate and reaches the fixture tree — is instead met by
    the `check/pre-push-scope-trigger-generator` facet's `triggerPaths` plus
    its `fixtureExtras` residue, both validated by `harness:check`.
- **Prior pack (CQ25-130, do-not-reopen):** the `.husky/pre-commit` dispatcher
  split (2026-07-25 leaf 32 steps 4-5) stays refused; see
  `docs/agent_notes/backlog/code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md`
  § "Operational risk: the commit gate", which names this very
  fingerprint-matching a hazard ("a re-plumbing job the leaf does not budget
  for") — that section corroborates this leaf rather than covering it, and
  nothing here reopens the split. A full data-driven pre-commit engine (the
  only way to *generate* the ordering invariants part 3 keeps) is adjacent to
  exactly what that ruling refused; hence shrink-and-label.
- **Prior pack (CQ25-142, recorded decision):** never wire a new check into
  pre-commit registration admission (`.husky/pre-commit:341-344`, 5s budget);
  every check this leaf adds or restructures runs under full `harness:check`
  only.
- The pre-push pin's loud, paste-ready failure mode is part of why this is
  medium severity, not high: today's cost is refactor friction, not silent
  drift. Part 1 removes the friction *and* the parser; it does not fix a
  correctness bug.
- Out of scope: any change to what the checks enforce (ordering invariants,
  timeout semantics, CI gate membership), the pre-push scan logic itself, and
  `loadDriftAiConfig`'s import-closure trade-off (the generator in part 1 may
  simply reuse `buildSourceExtensions` at generation time, where closure size
  does not matter).
- Coordination, not ordering: parts 1 and 3 add/derive from `generatedSurface`
  facets in `harness.controls.json`, which
  [114-harness-controls-represented-competing.md](./114-harness-controls-represented-competing.md)
  and
  [116-generated-surface-dependencies-manually.md](./116-generated-surface-dependencies-manually.md)
  also restructure. No dependency edge, but avoid editing the manifest's facet
  surfaces concurrently with those leaves.
- After touching the manifest, hooks, or generated fragments, `bun run
  harness:check` is the closing verification; `bun run harness:hook-timeouts`
  is the regen command for the timeout-constant fragment pattern part 3
  extends.
