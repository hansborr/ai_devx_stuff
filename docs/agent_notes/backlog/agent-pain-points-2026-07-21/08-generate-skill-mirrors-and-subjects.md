# Generate Skill Mirrors and Smoke Subjects

Status: Implemented — 2026-07-22
Date: 2026-07-21
Priority: P2
Size: L
Risk: medium-high
Source: `pain_points.log` line 17; Claude memory
`skill-reference-file-registration.md`; architecture-review findings T4/Tier 3

## Problem

The manifest already describes each skill's canonical tree, target trees, and
permitted overlays, but maintenance still stops at comparison. Adding one
`agent-cli` reference currently requires a hand-created `.codex` copy, another
filename in the wrapper smoke's mirror loop, matching `# smoke-subjects:`
headers, regenerated smoke-subject data, and another
`skillWiring.smokeSubjects` entry. Missing only the manifest entry makes the
wrapper smoke pass and defers the failure to `harness:check`.

Routing is incomplete even for the current tree:
`.codex/skills/agent-cli/agents/openai.yaml` is target-owned and has behavioral
assertions in `test-skill-dispatch-wrappers.sh`, but it is absent from that
test's exact subjects. The root-wide `.codex/skills/` subject belongs to
`test-lint-config-sensors.sh`; it does not route this file to the wrapper smoke.

This is derivable work. The fix should turn the existing skill inventory into a
refresh/check contract for committed mirrors and smoke routing, without making
either runtime depend on the other harness's skill directory.

## Evidence

- [`scripts/harness/skill-inventory-schema.ts`](../../../../scripts/harness/skill-inventory-schema.ts)
  parses `canonical`, `targets`, and the four supported overlay shapes, but it
  also accepts a manually repeated `smokeSubjects` array.
- [`scripts/harness/check-skill-inventory.ts`](../../../../scripts/harness/check-skill-inventory.ts)
  compares canonical and target trees and exact-compares the manifest's subject
  set with test headers; it has no refresh path.
- [`harness.controls.json`](../../../../harness.controls.json) declares the
  `agent-cli` canonical/target topology and overlays, then repeats every shared
  file path in `skillWiring.smokeSubjects`.
- [`scripts/tests/test-skill-dispatch-wrappers.sh`](../../../../scripts/tests/test-skill-dispatch-wrappers.sh)
  repeats the reference filenames in its header and mirror loop and tells the
  maintainer to copy files by hand. The same test also owns legitimate
  harness-specific content assertions which are not generated inventory.
- The former `scripts/harness/skill-tree-comparison.ts`
  defines byte identity by default, `canonical-only`, `target-only`, one marked
  `harness-block`, and one permitted frontmatter field present on exactly one
  side. The live `ts-graph` `allowed-tools` overlay is canonical/Claude-only,
  not target-specific.
- The behavioral wrapper smoke separately checks that harness-block BEGIN
  markers are addressed to `claude` and `codex`. The inventory comparator only
  counts blocks today; a refresh contract must bind a preserved block to the
  corresponding `target.harness` rather than accepting any marker label.
- The existing architecture review already recommends a generated checked-in
  `.codex` tree; this leaf makes that observation actionable rather than
  creating a runtime symlink or a second skill-loading path.

## Scope

- Add paired `harness:skills:refresh` and `harness:skills:check` commands for
  skill artifacts, backed by the existing `harness.controls.json` skill
  records. The checked-in target trees remain the artifacts consumed by Claude
  and Codex.
- For ordinary shared files, copy canonical bytes into each non-canonical
  target. For declared overlays:
  - omit `canonical-only` paths from the target;
  - retain `target-only` paths as target-owned files;
  - rebuild the shared portion around a `harness-block` from canonical content,
    retaining exactly one existing target block whose BEGIN marker names that
    target's `target.harness`; and
  - preserve the existing one-sided `frontmatter-field` semantics. The field
    must occur exactly once across canonical and target: if canonical owns it,
    omit it from the target; if canonical lacks it, retain the target's authored
    field and value while refreshing all other content.
- Compute and validate the complete projection for every target and generated
  subject block before writing anything. Reject malformed or duplicate
  declarations, same-path and nested/overlapping overlays, unmatched overlays,
  wrong/missing/duplicate harness markers, invalid one-sided frontmatter,
  forbidden-side files, symlinks, and repo-root escapes before mutation.
- Materialize each validated target in a sibling temporary tree and replace it
  atomically; write the smoke header through the repository atomic-write helper.
  Delete stale ordinary mirrored paths which disappeared from canonical, while
  retaining declared `target-only` paths. Check mode is read-only, including on
  failure.
- Bootstrap a missing target only when its entire projection is derivable from
  canonical bytes. If a missing target needs an authored `target-only` file, a
  target-side frontmatter value, or a target-specific harness block, fail with
  instructions to seed those overlay-owned inputs; never synthesize metadata,
  prose, or dispatch configuration.
- For every skill with `skillWiring.smokeTest`, derive all concrete canonical
  and target file paths, including overlay-owned files, into a clearly marked
  generated `# smoke-subjects:` block in that test. Multiple skills may
  contribute to one smoke test; hand-authored subjects outside the block stay
  untouched. This must add the currently missing exact subject for
  `.codex/skills/agent-cli/agents/openai.yaml`.
- Let the existing smoke-subject generator continue to own
  `path-policy-smoke-subjects-data.ts` and its fixture. The skill refresh command
  updates the marked header block and then composes with that generator, so the
  exact one-command repair for mirror and routing drift is
  `bun run harness:skills:refresh`; do not implement a second path-policy
  generator.
- Remove the per-file `skillWiring.smokeSubjects` repetition. Root-wide or
  non-skill subjects such as the lint-config sensor's `.codex/skills/` subject
  remain owned by their actual smoke test, not assigned to `skill/agent-cli` as
  inventory ballast.
- Make `checkSkillInventory` (and its extracted pure projection/check core) the
  sole owner of mirror completeness, byte identity, overlay structure, and
  smoke-subject derivation. Remove the wrapper smoke's reference filename loop
  and shared-core mirror parser; the behavioral shell test must not parse the
  inventory. Preserve genuine wrapper execution, harness-specific prose/model
  assertions, and target metadata behavior.
- Register the new refresh/check pair as a generated surface, including repair
  and check package scripts, trigger/output metadata, Bun-hook classification,
  and harness-check fixture closure. Ensure the generator/checker's own source,
  manifest facet, target artifacts, marked header, and downstream generated
  subject outputs all stale or select the appropriate checks.
- Wire freshness into `harness:check` with the single exact repair command above,
  and document the edit flow: edit canonical/shared or target overlay content,
  run refresh, inspect, and commit both checked-in trees plus generated subjects.

## Acceptance

- Adding, renaming, changing, or deleting a canonical reference and running
  `bun run harness:skills:refresh` produces the expected checked-in target
  change, stale-target deletion, marked-header update, and downstream smoke
  routing regeneration; check mode is then clean without hand-editing a
  filename list.
- Check mode fails before refresh for a missing/stale target file or stale
  subject block and prints exactly `bun run harness:skills:refresh` as the repair
  for both.
- Fixtures cover all overlay kinds, overlapping-overlay rejection, stale-file
  deletion, all-or-nothing prevalidation, and target bootstrap refusal. They
  include preservation of Codex's `agents/openai.yaml`, omission of Claude-only
  scripts, exact `target.harness` block labels, a canonical-only frontmatter
  field like `allowed-tools`, and a target-only frontmatter field.
- Refresh is deterministic and idempotent. A second refresh produces no diff,
  check mode never writes, and a validation failure leaves every target and
  generated header byte-identical to its pre-run state.
- Changing `.codex/skills/agent-cli/agents/openai.yaml` selects
  `test-skill-dispatch-wrappers`; the unrelated broad lint-config sensor subject
  is not used as a substitute for that exact routing.
- `bun run test:scripts:subjects:check`, the focused skill-inventory tests, the
  wrapper smoke, and `bun run harness:check` pass after regeneration.
- A newly added skill target or shared reference cannot require a new hardcoded
  filename in the wrapper test or a copied subject list in the manifest.

## Boundaries

- Do not replace checked-in skill targets with symlinks, runtime imports,
  loader indirection, or fallback reads from the canonical tree.
- Do not erase or synthesize harness-specific prose, target metadata, or
  canonical-only scripts. Overlay content remains deliberately authored; only
  its surrounding shared material is generated.
- Do not weaken the exact inventory tripwires for undeclared skill roots,
  forbidden-side files, symlinks, or content outside permitted overlays.
- Do not absorb unrelated smoke subjects or wrapper behavioral assertions into
  the generator.

## Sequencing

Land this leaf before leaf 09. The fast-commit registration preflight should
reuse the resulting non-spawning skill projection/check core and exact repair
diagnostic, not freeze the current repeated `smokeSubjects` contract or add a
second skill checker.

## Implemented design

The manifest remains the single inventory and both harness targets remain
checked-in runtime artifacts. Refresh builds a complete in-memory projection
from canonical bytes plus preserved overlay-owned inputs, validates every
target and marked smoke header before mutation, stages changed target trees in
sibling directories, and atomically rewrites the header. The marked block is
the only generated portion of a smoke test; hand-authored subjects outside it
remain untouched. The command then calls the existing smoke-subject projection
and writer for downstream data, avoiding a second path-policy generator.

### Cross-model panel follow-up — 2026-07-22

- Content overlays are now required to name an exact canonical file. A
  `harness-block` or `frontmatter-field` path found only in the target fails
  pre-mutation with a dedicated diagnostic, so it cannot fall through to stale
  target deletion.
- Projection diffs now compare permission modes as well as bytes. Check mode
  reports mode-only drift and refresh rebuilds the target with the canonical
  mode. Smoke-header replacement also explicitly reapplies its original mode
  after the atomic write, avoiding `umask`-dependent execute-bit loss.
- Pre-mutation validation diagnostics no longer prescribe refresh; they direct
  maintainers to repair the manifest or authored overlay input and state that
  refresh cannot repair the failure. Ordinary generated drift retains the
  exact `bun run harness:skills:refresh` advice.
- `.gitignore` is registered as a skill-artifact generator trigger because its
  skill opt-ins are authoritative inventory input. The harness-check fixture no
  longer includes the retired `skillWiring.smokeSubjects` field.
- Accepted limitation: replacement is atomic per target directory, not as one
  transaction across all target directories. All projections are validated and
  all changed trees are staged before the first swap, minimizing the window,
  and an ordinary failed rename restores that target's backup. A process or
  machine crash between successful target swaps can still leave earlier
  targets refreshed and later targets unchanged. Durable multi-directory crash
  atomicity would require a transaction journal and startup recovery machinery
  disproportionate to this checked-in generator; rerunning
  `bun run harness:skills:refresh` is the deterministic recovery.
