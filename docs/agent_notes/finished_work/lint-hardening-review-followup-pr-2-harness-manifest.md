# Lint-hardening review follow-up — PR 2: Harness Manifest + Generated Map

Branch: `feature/lint-hardening-review-followup`
Landed: 2026-05-17
Commit: `0d82461a feat(harness): add controls manifest, generated map, and validator`
Supersedes (partially): Leaf 25 sensor-half (`backlog/lint-hardening/25-diagnostic-rule-metadata.md`)

## Outcome

`harness.controls.json` declares every harness control in one machine-readable
manifest using PR 1's `meta.docs` vocabulary. A new generator emits the
agent-facing map at `docs/generated/harness-controls.md`, and a new validator
asserts parity with the live tree and `package.json`. Both are wired into
doctor and CI; both have fixture-based smoke tests in `test:scripts`.

Final manifest stats (`bun run harness:check`):

> `55 control(s) validated; 18 lint rule(s); 23 package.json script(s) declared.`

Kinds and counts:

| Kind | Count |
| --- | --- |
| `lint-rule` | 18 |
| `sensor` | 5 |
| `verify-wrapper` | 6 |
| `doctor-check` | 5 |
| `drift-scope` | 4 |
| `doc-generator` | 3 |
| `logs-audit` | 1 |
| `codemod` | 5 |
| `hook` | 8 |

For `kind: lint-rule` entries the manifest stays minimal (`id`, `kind`,
`ruleName`, `source`, `invocation`); the generator and validator re-project
`category` / `principle` / `pairedGuide` / `repairKind` / `repairCommand`
from each rule's own `meta.docs`. The `$comment` field at the top of the
manifest documents this contract so a future editor doesn't try to restate
the fields and accidentally desync.

## Decisions worth preserving

- **Re-project lint-rule fields, never restate them.** The manifest is the
  enumeration; PR 1's `meta.docs` is the source of truth for category /
  principle / pairedGuide / repairKind / repairCommand. The validator
  rejects manifest entries that try to restate these fields for
  `kind: lint-rule`, so drift cannot accumulate silently.
- **`CONTROL_PREFIX_PATTERN` is broad.** Final pattern is
  `^(sensor|verify|codemod|drift|logs|doctor|module|docs|db|worktree|harness|lint):/u`.
  The narrow Claude-review draft (`sensor|verify|codemod|drift|logs|doctor|module|docs`)
  missed `db:migrate`, `worktree:init`, `lint:fix`, and `harness:check` —
  scripts that look like harness controls but landed under different prefixes.
  Widening the pattern and expanding `EXEMPT_SCRIPTS` for the legitimately
  one-off entries was the right trade.
- **`EXEMPT_SCRIPTS` lists the script subjects, not the manifest IDs.** Each
  exempt entry carries a short comment explaining why (e.g.
  `verify:async:*` sub-commands ride the same background wrapper that
  `verify:async` already declares). The exempt set is the second source of
  truth alongside the manifest; both grow together when a new harness
  prefix lands.
- **Validator throws on non-object manifest entries.** Codex review P2:
  the earlier draft used `.filter(isObject)` which silently dropped malformed
  entries. The validator now iterates `parsed.controls` with explicit index
  reporting (`harness.controls.json: control entry at index N is not an
  object`) so a typo surfaces immediately. The smoke covers it
  (`mutate_non_object_manifest_entry`).
- **CI runs `harness:check` before `docs:harness-controls:check`.** Claude
  review P2 ordering: structural drift (manifest vs. live tree) is the more
  informative failure, so it surfaces first. Doc drift is downstream of
  structural correctness.
- **Smoke subjects intentionally wide.** Both new smokes
  (`test-generate-harness-controls`, `test-harness-check`) list
  `eslint-rules/`, `harness.controls.json`, `package.json`,
  `tsconfig.scripts.json`, the generator/validator scripts, the fixture
  expected file, and the generated doc. Any of these edits can move the
  rendered output or the validation surface, so the smoke must rerun.
- **Drift smoke checks the real tree, not only the fixture.** Both smokes
  invoke the generator / validator with `--check` against the real
  `harness.controls.json` after exercising the fixture. Catches drift
  introduced by adding a sensor or codemod without updating the manifest.
- **`tsconfig.scripts.json` includes both new scripts.** Codex review P2:
  `harness-check.ts` was initially missing from the include array, so the
  scripts-only typecheck wasn't validating it. Both are now listed.

## What this enables

- **PR 3 (Machine-Readable Diagnostics)** can hang a structured-diagnostics
  schema off the manifest: every emitted finding carries the manifest `id`
  of the control that produced it, and consumers look up `category` /
  `repairKind` / `repairCommand` from one place.
- **Future audits** can ask "which controls exist?" without reading prose.
  The generated map groups by kind; the manifest is a query target.

## Verification (as-committed)

```
bun run typecheck
bun run lint:changed
bun run harness:check                                       # 55 controls validated
bash scripts/test-generate-harness-controls.sh              # 13 failure cases + golden + drift
bash scripts/test-harness-check.sh                          # 10 failure cases + real-tree check
bun run test:scripts                                        # 21 smokes
bun run docs:harness-controls:check                         # up to date
```

`FORCE_VERIFY=1 bun run verify:changed` fails on a pre-existing
`test-dependency-freshness` fragility — the env var leaks into the
fixture's `sh .husky/pre-commit` invocation and defeats the bridge-skip
path the test asserts. The test passes standalone. Tracked separately;
not a PR 2 regression.

## Out of scope (deliberate)

- New harness controls. PR 2 only catalogs what already exists. Any new
  sensor / codemod / wrapper added in a later PR adds one manifest entry
  and reruns `harness:check`.
- Replacing `docs/ai-harness.md`. The prose narrative stays; the generated
  map is the machine-readable companion.
- Machine-readable diagnostic emission from sensors — that is PR 3.
- Structured `scope` arrays for lint-rule entries. The scout proposed
  enumerating per-rule file globs; in practice the existing
  `docs/generated/local-lint-rules.md` already renders these per rule
  from `meta.docs`, so duplicating them in the manifest is restatement.
