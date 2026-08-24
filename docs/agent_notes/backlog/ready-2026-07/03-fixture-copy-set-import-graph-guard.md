# Fixture copy-set vs import-graph guard

Status: Done — main scope landed 2026-07-19 (c566a122); the TS/JS-entry
import-closure follow-up landed 2026-07-25 (1656c76a), with the pre-land
review fixes in the same branch (cc1f8a86, bb6ea97a, c8b27f49).
Date: 2026-07-07 (re-verified 2026-07-25)
Source: agent-cli consolidation burn-in incident (drift-triage fix workflow,
2026-07-07); routed out of the agent-cli pack — not a wrapper defect.

## Context

A new leaf module (`scripts/harness/harness-paths.ts`) broke sandboxing test
fixtures in three separate copy sets, each surfacing only at the next-deeper
gate (changed smokes → full scripts slot → full test slot). The tail cost
three fix rounds across dispatched lanes because nothing enumerates which
fixture copy sets must mirror a new module.

## Scope

- A repo-level guard that compares each sandboxing fixture copy set against
  the import graph of the entry points it sandboxes, so adding a leaf module
  fails one fast check that lists every copy set needing the file — instead of
  failing gate-by-gate.
- Until the guard exists: dispatch missions that add leaf modules under
  `scripts/` should require a fixture-copy-set sweep up front (prompt-side
  mitigation; noted in the agent-cli pack index).

## Follow-up: TS entry files copied into shell fixtures (landed 2026-07-25)

`scripts/path-policy/fixture-shell-dependencies.ts` only follows shell
`source` edges; a TS/JS entry script copied into a fixture gets no
import-closure check. This exact class produced three incidents on
2026-07-19 alone (latest: `test-generate-harness-controls.sh` missing
`harness-manifest-schema.ts` after the typed-parser split — the smoke failed
silently because the fixture's bun stderr is redirected into the cleaned-up
temp dir). Design sketch:

- In `parseFixtureCopyCommand`, keep walkable TS/JS copies (today
  `isShellPath` drops them) and closure-walk each copied entry with
  `validateSeedImportClosure` (`scripts/worktree-seed-import-closure.ts`,
  already reused by `scripts/harness/fixture-closure-check.ts`), requiring
  every closure file to be in the group's copy set.
- Two satisfaction channels beyond plain copies must be modelled or the
  harness-controls fixture false-fails: heredoc-synthesized stubs
  (`cat >"$fixture_dir/scripts/..." <<'TS'` — treat heredoc-target paths
  under the fixture root as satisfied) and node_modules symlinks
  (`ln -s "$PWD/..." "$fixture_dir/node_modules/<pkg>"` — feed the linked
  package names into the walker's `externalPackages`).
- Scope guard: entry-file closures only (no tsconfig path aliases in
  scripts/), same smoke-file scan population as the shell check.

Deliberately not squeezed into the 2026-07-19 review pass: the two extra
channels plus tests put it well past a ~150-line proportionate fix.

### What actually landed (1656c76a)

The sketch above held, with four corrections found while implementing it:

- **Four satisfaction channels, not two.** Beyond heredoc stubs and
  `node_modules` symlinks, real smokes also seed a sandbox with directory
  copies (`cp -R eslint-config/. "$dir/eslint-config/"`) and with a whole-tree
  `git clone` (`scripts/tests/test-doctor-json.sh` clones the repo and then
  overlays a handful of files). Without the clone channel that one smoke alone
  false-failed with 44 diagnostics.
- **Heredoc stubs must also terminate the walk**, not merely count as present:
  the fixture's stub for `scripts/lint-ratchet/lint-ratchet-config.ts` is not
  the real module's import graph, so walking through it demanded copies the
  sandbox has no use for. `validateSeedImportClosure` gained a `terminalFiles`
  option for this.
- **Copy destinations outside the fixture's `scripts/` subtree had to be
  attributed too.** `fixtureRootFromDestination` only recognized `/scripts/`
  destinations, so `cp .../harness-diagnostics.ts "$repo/packages/shared/..."`
  was invisible and reported as missing. Roots are now discovered from
  `scripts/` destinations and any later destination under a known root is
  attributed to it.
- **Sandbox state merges per fixture root, not per function scope.** The shell
  check's scope precision is right for it, but one sandbox is routinely
  composed by sibling helpers (one copies entries, another writes stubs, a
  third links `node_modules`); scope-splitting that composition reported each
  helper's partial view as a gap. *(Superseded by the review pass below: the
  merge is now scoped and composition-driven.)*

Entry points are restricted to copied `scripts/**` TS/JS files. Fixtures also
copy TS/JS as *data* for the tool under test (`eslint.config.js`, server test
files a checker parses); treating those as entries demanded ~150 copies no
fixture executes.

## Pre-land review pass (2026-07-25)

Two independent reviews returned "land after these fixes". All three findings
were closed in the branch.

- **Smoke-subject metadata only covered `.sh` copies** (cc1f8a86). Metadata
  validation filtered candidates with `isShellPath`, so a copied TS module was
  invisible to it: changing that module never selected the smoke, so in changed
  mode the new closure guard never ran on the files it exists for. Metadata now
  reads the sandbox model — copied files and copied directories, code and data
  alike — and matches subjects the way the changed-mode selector does (exact
  path or trailing-slash prefix). 46 subject headers were missing across 12
  smokes, including `scripts/lib/doc-generator.ts` in both doc-generator smokes.
  Copied data counts because a copied file is a smoke input by construction.
- **Per-root merging let unrelated fixtures cross-satisfy** (bb6ea97a). Keying
  only on the literal root token meant separate lint-ratchet fixtures sharing
  `$repo` satisfied each other's closures, and one `git clone` or
  `node_modules` symlink could switch checking off for every fixture sharing
  the token. Sandboxes are now keyed by (function scope, fixture root) and join
  only through explicit helper call sites, exactly like the shell check; a
  scope folded into a caller is a fragment, checked in its composed contexts
  rather than on its partial view. Five isolation counterexamples cover it.
- **Unmodelled seeding forms passed silently** (c8b27f49). Entry selection only
  saw literal resolvable `cp` sources with a literal `/scripts/` destination,
  which left the three densest sandboxes invisible. Unresolvable sources are
  now reported; loop variables resolve (scoped, so `runtime_file` in one helper
  is not the other's list); roots are discovered from `mkdir` as well as `cp`;
  and modules inside a copied `scripts/**` directory are entries themselves.

Two escape hatches were added, both requiring a reason and both failing when
they govern nothing:

- `# fixture-closure: not-an-entry - <reason>` — the copied `scripts/**` module
  is never executed in this sandbox (one live user: the write-guard fixture in
  `test-lint-ratchet.sh`, which poisons `bun` so every render fails).
- `# fixture-closure: unmodelled-copy - <reason>` — the copy set is built at
  runtime and cannot be enumerated. Three live users: `build_fixture` in
  `test-lint-ratchet.sh` (a `git ls-files` pipeline), `copy_validator` in
  `test-harness-check.sh` (a manifest loop, separately covered by
  `scripts/harness/fixture-closure-check.ts`), and `copy_file` in
  `test-lint-coverage-map-gen.sh` (a helper parameter).

### Known limitations, stated rather than guessed

- Entry selection is a path heuristic, not an execution one:
  `eslint-rules/type-assertion-boundary.js` is copied into a fixture and
  imported from an executed fixture ESLint config, but is outside `scripts/`
  so it is not walked. It is import-free today, so there is no live gap;
  extracting a helper out of it would under-close that fixture silently. Noted
  in the `fixture-import-closure.ts` module comment. There is no positive
  "this non-scripts file is an entry" annotation because no live fixture needs
  one yet.
- `ln -s "$REPO_ROOT/scripts" "$repo/scripts"` is not modelled. It seeds a tree
  that *is* the repository, so it is closed by construction and contributes no
  entries.
- Copies through a helper's positional parameters are not modelled; such call
  sites must carry `unmodelled-copy`.

## Verification

- `scripts/path-policy/fixture-shell-dependencies.test.ts` covers the guard and
  each satisfaction channel (11 new cases);
  `scripts/worktree-seed-import-closure.test.ts` covers `terminalFiles`.
- Manual proof of the original incident: deleting the
  `harness-manifest-schema.ts` copy line from
  `scripts/tests/test-generate-harness-controls.sh` makes
  `test:scripts:subjects:check` fail with `... copies
  scripts/harness/generate-harness-controls.ts but omits imported dependency
  scripts/harness/harness-manifest-schema.ts`.
- The live tree needed no copy-set fixes: every existing sandbox was already
  closed once the four channels were modelled. The one tree change is a
  `typescript` `node_modules` symlink in
  `scripts/tests/test-harness-check.sh`, because that fixture runs the
  smoke-subjects generator, which now loads the TypeScript-backed walker.
- `bun run test:scripts:changed` green (`test-dependency-freshness` failed once
  under parallel load because its coarse outer elapsed assertion fired; the
  memory deadline and lock-release checks passed).
