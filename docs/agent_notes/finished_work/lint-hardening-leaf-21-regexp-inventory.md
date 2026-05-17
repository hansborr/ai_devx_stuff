# Leaf 21 Pass 1 - eslint-plugin-regexp Inventory

Status: stopped by the Leaf 21 high-finding threshold on 2026-05-16.

## Probe

Temporarily installed `eslint-plugin-regexp@3.1.0` and added a code-file
ESLint block scoped to the existing `codeFiles` glob:

```js
{
  files: codeFiles,
  plugins: { regexp },
  rules: {
    ...regexp.configs["flat/recommended"].rules,
    "regexp/prefer-named-capture-group": "off",
  },
}
```

The installed plugin exposes `configs["flat/recommended"]` as a flat-config
object with `plugins` and `rules`. In `eslint-plugin-regexp@3.1.0`, that
recommended rule map has 67 entries: 58 `error`, 6 `warn`, and 3 `off`. The
probe preserved those severities, and `--max-warnings=0` made the two warnings
visible in the failure. A future adoption pass should normalize the adopted
recommended rules to `error`.

Then ran:

```bash
bun run lint -- --max-warnings=0 2>&1 | tee /tmp/leaf21-probe.log
```

The probe produced 35 problems: 33 errors and 2 warnings. ESLint reported
6 errors and 2 warnings as potentially fixable with `--fix`, but no fixes were
applied because the total exceeded the leaf's `>15` stop threshold. The
temporary dependency and config were reverted; keep them out until an
orchestrated Pass 2.

## Scope Count

The probed ESLint scope contained 1,182 regex sites across 1,204 parsed code
files:

- 1,165 regex literals.
- 17 `RegExp` constructor/call sites.

The finding inventory touched 20 reported regex line sites.

## Findings By Rule

| Rule | Count | Reported sites | Triage |
| --- | ---: | ---: | --- |
| `regexp/no-super-linear-backtracking` | 24 errors | 10 | Needs semantic review and targeted tests; dominant blocker. |
| `regexp/no-dupe-characters-character-class` | 5 errors | 5 | Mechanical cleanup candidate; likely auto-fixable. |
| `regexp/no-useless-flag` | 2 warnings | 2 | Mechanical cleanup candidate; auto-fixable. |
| `regexp/prefer-d` | 1 error | 1 | Mechanical cleanup candidate; auto-fixable. |
| `regexp/no-unused-capturing-group` | 1 error | 1 | Small hand-fix or suggestion; likely convert to non-capturing group. |
| `regexp/no-misleading-capturing-group` | 1 error | 1 | Shares a site with a backtracking finding; fix with that rewrite. |
| `regexp/no-contradiction-with-assertion` | 1 error | 1 | Needs semantic review of the section-header matcher. |

`regexp/prefer-named-capture-group` was explicitly overridden to `off` per the
Leaf 21 instruction. In `eslint-plugin-regexp@3.1.0` it is not part of
`flat/recommended`, but keep the explicit override if the rule remains a
style-only non-goal in Pass 2.

## Reported Sites

### `regexp/no-super-linear-backtracking`

- `packages/client/src/components/homebrew/monster/monster-form-data.ts:325`
  - comma-pair parser `^(\w+)\s*([+-]?\d+)$`; also triggers
    `regexp/no-misleading-capturing-group`.
- `packages/server/src/seed/generate-class-features.ts:130` - markdown class
  feature heading regex with `\s+` followed by `(.+)`.
- `packages/server/src/seed/generate-srd-spells.ts:42` - preamble header
  capture `^###\s+\*{0,2}(.+?)\*{0,2}\s*$`.
- `packages/server/src/seed/generate-subclasses.ts:81` - feature heading regex
  with `\s+` followed by `(.+)`.
- `packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.ts:8`
  - glossary header capture with lazy title and optional bracketed category.
- `packages/server/src/seed/spell-parser/parse-spell-block.ts:84` - casting
  time field extraction through `FIELD_BOUNDARY_LOOKAHEAD`.
- `packages/server/src/seed/spell-parser/parse-spell-block.ts:91` - range field
  extraction through `FIELD_BOUNDARY_LOOKAHEAD`.
- `packages/server/src/seed/spell-parser/parse-spell-block.ts:96` - components
  field extraction through `FIELD_BOUNDARY_LOOKAHEAD`.
- `packages/server/src/seed/spell-parser/parse-spell-block.ts:102` - duration
  field extraction through `FIELD_BOUNDARY_LOOKAHEAD`.
- `scripts/code-intel/graph-cache.ts:129` - gitfile `gitdir:` parser
  `^gitdir:\s*(.+)$`.

### Other Rules

- `regexp/no-dupe-characters-character-class`
  - `packages/server/src/seed/generate-class-features.ts:48`
  - `packages/server/src/seed/generate-subclasses.ts:44`
  - `packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.ts:21`
  - `packages/server/src/seed/spell-parser/spell-corrections.ts:18`
  - `scripts/code-intel/cli-values.ts:5`
- `regexp/no-useless-flag`
  - `packages/server/src/routers/authz-logging-plumbing.test.ts:9`
  - `packages/server/src/routers/authz-logging-plumbing.test.ts:11`
- `regexp/prefer-d`
  - `packages/server/src/test/test-database-url.ts:6`
- `regexp/no-unused-capturing-group`
  - `scripts/code-intel/cli-values.ts:14`
- `regexp/no-contradiction-with-assertion`
  - `packages/server/src/seed/generate-srd-spells.ts:25`

## Follow-Up Shape

Do not adopt the plugin as one broad cleanup without first choosing a Pass 2
split. A reasonable sequence is:

- apply the mechanical autofixable cleanup first
  (`no-dupe-characters-character-class`, `no-useless-flag`, `prefer-d`);
- hand-fix `scripts/code-intel/cli-values.ts:14` if the group is truly unused;
- then handle the parser/backtracking cluster with context-specific rewrites
  and targeted tests for any production parser or seed-code behavior changed;
- re-add the plugin config only after the inventory is clean, with
  `prefer-named-capture-group` still off and adopted recommended rules
  normalized to `error`.
