# Leaf 21 Pass 2b Fix A

Landed the warm-up Pass 2b regex rewrite batch for three previously deferred
sites, without enabling the deferred regexp rules.

## Scope

- `packages/client/src/components/homebrew/monster/monster-form-data.ts`
  rewrites `parseCommaPairs` to avoid backtracking while preserving spaced and
  compact signed values (`STR +4`, `STR+4`, `STR-2`).
- `packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.ts`
  replaces the glossary header regex with string parsing that extracts the
  final trailing tag via the last ` [`.
- `scripts/code-intel/graph-cache.ts` replaces gitfile regex parsing with
  explicit `gitdir:` string parsing.

## Behavior

- Monster comma pairs now reject ambiguous digit-bearing keys such as `STR12`
  and `12`; malformed entries are silently dropped by the existing caller
  contract.
- Rules Glossary parsing remains scoped to `#### ` entry headers. The current
  `08_RulesGlossary.md` feed has no `### ` entries, so third-level support was
  not broadened in this pass.
- `resolveGitDir` now rejects gitfile values containing embedded line breaks,
  including `gitdir:\npath`. Empty or rejected gitfiles fall through to the
  existing `no-git` manifest behavior.

## Tests

- Monster parser: 4 tests added.
- Glossary parser: 5 tests added.
- Graph-cache gitfile parser: 6 tests added.

Red/green notes:

- Monster malformed-input test failed first with legacy outputs
  `{ str1: 2, "1": 2, dex: 6 }`.
- Glossary malformed-header tests failed first because the old regex accepted
  `### Foo` and `#### Foo [Condition`.
- Graph-cache newline test failed first because the old regex resolved
  `gitdir:\n../x`.

## Followup

Fix Pass C still needs to clean the remaining eight deferred regexp sites and
only then promote `regexp/no-super-linear-backtracking`,
`regexp/no-misleading-capturing-group`, and
`regexp/no-contradiction-with-assertion`.
