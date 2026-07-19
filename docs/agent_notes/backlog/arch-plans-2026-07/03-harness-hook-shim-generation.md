# 03 — Harness Hook-Shim Generation: Emit Adapters, Don't Just Validate Them

Status: Done — landed 2026-07-19 (`3e9b28df`); cross-reviewed at intake
(both reviewers adopt-with-changes) and again at implementation
Date: 2026-07-19
Source: 2026-07-17 harness architecture review, run in the sibling
checkout. Re-verified 2026-07-19 against HEAD `7e4bd5df`: the
generated-surfaces inventory has landed (`b07b475a`), so shim
generation registers via the existing `generatedSurface` facet; the
".claude vs .codex doc-length.sh fallback" divergence is the
*documented intentional* per-adapter difference
(`scripts/ai-hooks/README.md` Shim Contract); the accidental drift is
intra-adapter and much broader than first thought — see Problem.
Priority: P3 · Size: M · Risk: medium

## Problem

`scripts/harness/generate-hook-wiring.ts` (334 L) already projects
`harness.controls.json` `hookWiring` entries into three settings files
(`.claude/settings.json` hooks key, `.codex/hooks.json`,
`.github/hooks/copilot.json`), but the 32 shims those configs invoke
(14 `.claude/hooks/`, 9 `.codex/hooks/`, 9 `.copilot/hooks/`, backed
by 16 distinct canonical bodies across 18 `hookWiring` controls) are
hand-copied per tool, and they have drifted from their own canonical
form far more than cosmetically few files: verified 2026-07-19, only
`backlog-note-lint.sh` exactly matches the documented canonical Claude
header — 10 of 14 `.claude` shims and 7 of 9 `.codex` shims omit the
"Thin adapter" comment the README documents, three files write it with
an em-dash where the README's canonical form uses a hyphen, and
`.copilot/hooks/backlog-note-lint.sh` is the sole wrap outlier among
the nine copilot shims. The first generation run is therefore a
one-time normalization diff touching roughly 20 of 32 shims —
behavior-neutral (comments and headers), reviewed once in its own
commit, but bigger than a handful of files.

All of this is cosmetic today because `scripts/ai-hooks/check-wiring.sh`
(275 L) asserts the load-bearing part after the fact: each shim
resolves exactly one canonical body matching the manifest's
`hookWiring.body`, configs map commands back to manifest controls, and
no orphan adapters exist. The shim-shape assertion functions and their
self-check fixtures (~120 L combined) only exist because the shims are
hand-written. The validator catches drift; a generator makes drift
impossible. House rule kept: single-source + generate + `--check`.

## Approach

Emit the shims from one template per adapter, alongside the three
configs the generator already writes. Everything a shim needs is
derivable from existing manifest fields — no new `hookWiring` fields:

1. **Shim path** — parsed from `harnesses.<h>.command` using
   check-wiring's two recognized command shapes; fail generation on
   unrecognized shapes.
2. **Body** — `hookWiring.body`.
3. **Template** — by adapter directory: Claude exec shim
   (`${CLAUDE_PROJECT_DIR:-/workspace}` fallback), Codex exec shim
   (`/workspace` fallback), Copilot dispatch shim (sources `common.sh`
   + `copilot-adapter.sh`, calls
   `ai_copilot_dispatch <mode> <surface> <body>`). Templates carry a
   generated-ownership comment naming the regenerate command.
4. **Copilot dispatch args** — derived, not authored: `surface` from
   the copilot matcher (`bash|powershell` → `bash`, `create|edit` →
   `edit`, anything else fails generation), `mode` from event +
   surface (`PreToolUse` → `pre`, `PostToolUse` → `post-edit` /
   `post-bash`). This reproduces all 9 current dispatch lines.
   **Known gap:** the schema permits copilot `Stop` and the config
   generator maps it to `agentStop`, but `ai_copilot_dispatch`
   (`scripts/ai-hooks/copilot-adapter.sh:142`) has no stop mode — shim
   generation fails closed on that combination with a recorded reason
   (or a Stop template is added deliberately; do not emit a shim that
   dispatches into a mode that doesn't exist).

**Filesystem safety is a design requirement, not a nicety.** Manifest
command/body values are validated today only as non-empty strings
(`hook-wiring-schema.ts:172,254`); once they become write targets the
generator must accept only the exact per-adapter command grammar,
reject path traversal, absolute paths, shell metacharacters, non-`.sh`
names, duplicate/colliding output paths, and bodies outside
`scripts/ai-hooks/<safe-name>.sh`. Write mode must **reconcile** the
three owned directories (report or prune unexpected `*.sh` files with
an exact actionable message — a removed manifest entry must not leave
an unrepairable orphan), and `--check` must byte-compare *and* assert
regular-file type + executable bit and reject symlinks (check-wiring
already includes symlinks in orphan detection and asserts `-x`).

The Codex/Copilot Bash aggregators (`pre-tool-use.sh`,
`post-tool-use.sh`) are ordinary instances of the same templates.
Neither the private write helper nor the kernel writer sets the
executable bit or creates bare root directories — shim emission needs
an explicit mode step, and the bare-root `mkdir` behavior pinned by
`generate-hook-wiring.test.ts:30` must survive any writer swap.

`check-wiring.sh` then demotes — but not to nothing. The
manifest↔config mapping, unique-reference, unreferenced-adapter, and
the **manifest-body edge assertions stay** as the independent semantic
backstop: generated-byte freshness validates the generator against
itself and cannot replace a check that validates committed files
without trusting the generator (that split was landed deliberately,
`2bad7c39`). What goes is the repetitive shim-shape fixture
scaffolding made redundant by generated bytes.

## Slice plan (one commit per slice)

- **S1** — pure shim renderers + tests in a sibling module
  (`generate-hook-wiring.ts` is 334 L with a 940 L test file; path
  ownership, templates, derivation, and mode handling are a coherent
  separate unit): per-adapter templates, shim-path derivation with the
  strict grammar above, copilot mode/surface derivation with
  fail-closed unknowns (including `Stop`). Tests assert every harness
  association yields one unique confined path and exact rendering
  against small fixture manifests — not a hard-coded list of the 32
  live paths, which would just be a second authored inventory.
- **S2** — wire shim emission into write mode (executable bit set,
  directory reconciliation with orphan pruning/reporting) and
  `--check` mode (byte compare + file-type/exec/symlink assertions +
  orphan detection in the three adapter dirs); run
  `bun run harness:wiring` and commit the one-time normalization diff
  (~20 shims, hyphen-canonical headers). Gate:
  `bash scripts/ai-hooks/test.sh` and `bun run harness:check` green.
- **S3** — registration and docs: extend the
  `check/harness-hook-wiring-generator` `generatedSurface` facet so
  `outputPaths` covers the shim dirs; regenerate the projections of
  that registration (freshness fragment and
  `scripts/tests/harness-check-fixture-manifest.generated.txt`, whose
  consumer is `scripts/tests/test-harness-check.sh:102-114`);
  reconcile `fixturePaths` — the two `.claude` shims currently copied
  as fixtures become generated outputs, so state explicitly how the
  harness-check fixture tree obtains them (declared copies or running
  the generator). Reconcile dir-prefix semantics across the facet's
  consumers (the freshness warner is prefix-aware for trailing-slash
  entries; the fixture-closure check exact-matches and is inert for
  `.sh`; `harness-check.ts` uses `outputPaths` as a label — record
  why that's acceptable or teach all three prefixes). Update
  `scripts/ai-hooks/README.md` (Shim Contract → generated projections;
  its current-events list is stale — it omits live `SubagentStop`
  wiring) and `docs/ai-harness.md`; fix the manifest principle text
  that still says only Claude and Codex are generated despite Copilot
  already being in the generator.
- **S4** — demote `check-wiring.sh`: delete the shim-shape fixture
  scaffolding made redundant by generated bytes, **keeping** the
  compact manifest-body edge assertion, unique-reference,
  unreferenced-adapter, and the existence/`-x`/reference-recording
  core of `assert_hook_shim` that the kept assertions depend on. Note:
  the kept swapped-adapter manifest-body fixture currently calls
  `assert_shim_exec_target`, and `assert_hook_shim` dispatches into
  both shape assertions — this slice is a rewiring, not a block
  deletion.

## Execution notes

- Branch `feat/harness-shim-generation` off `main`; conventional
  commits; fast-commit optional, land via `bash scripts/land.sh` if
  used.
- Sequencing with leaf 01 (atomic-write): its S1 deletes the private
  `writeFileAtomic` in `generate-hook-wiring.ts`. If both are picked
  up, run that S1 first or fold it into this S2 — do not let two
  branches edit the same helper concurrently.
- Prior rulings honored: substrate ruling (generator TS, emitted shims
  bash); lifecycle-event shims (`session-state.sh`,
  `failure-guidance.sh`, `stop-reminder.sh`,
  `subagent-stop-reminder.sh`) are plain Claude exec shims, no new
  template; cursor stays excluded per the manifest's recorded
  principle (enforced at `hook-wiring-schema.ts:345`).
- Acceptance: after S2, hand-editing any shim makes
  `bun run harness:wiring:check` (and `harness:check`) **fail** with a
  regenerate instruction, and the pre-commit freshness layer **warns**
  (it is advisory, `.husky/pre-commit:239`); removing or renaming a
  manifest entry reconciles its shim away; chmod drift, symlinks, and
  collisions are detected; adding a `hookWiring` harness entry
  materializes its shim with no hand-written `.sh`.
