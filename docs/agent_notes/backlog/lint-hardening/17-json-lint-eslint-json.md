# Leaf 17: JSON Lint via @eslint/json

Status: Landed (2026-05-16); full adoption.
Related: Leaf 19 (package and dependency policy sensors)

Promotion note: this leaf does not inherently need Leaf 1 if every adopted
JSON rule lands at `error`, but its verification command will still be blocked
by the repo's existing warning baseline until Leaf 1 lands. Before Leaf 1, use
`bun run lint -- --max-warnings=0` as an inventory probe only and verify the
JSON slice with targeted ESLint output.

## Problem

Musi has many JSON and JSONC files where syntax errors or schema drift cause
real failures: `package.json`, `tsconfig*.json`, `playwright.config.ts`'s
JSON neighbours, `eslint-rules/*.json` fixtures, and the various drift-ai /
code-intel manifests. There is no lint coverage today; syntax errors surface
only at runtime.

`@eslint/json` is the official JSON linter under flat config and can run
alongside the TypeScript lint.

## Rule Goals

- `@eslint/json` flat-config integration with explicit language selection:
  `language: "json/json"` for strict JSON and `language: "json/jsonc"` for
  JSONC-style files.
- Recommended rules: `json/no-duplicate-keys`, `json/no-empty-keys`,
  `json/no-unnormalized-keys`, and `json/no-unsafe-values`.
- Pair with Leaf 19 if a manifest policy script needs to consume JSON
  diagnostics. Do not expect `@eslint/json` to validate package fields or
  dependency policy; that belongs to Leaf 19.

## Possible Outcomes

- **Adopt recommended (expected default).** The four rules above are pure
  correctness — duplicates, empty keys, unnormalised keys, unsafe numeric
  values.
- **Adopt subset.** Drop `json/no-unnormalized-keys` if Musi has known
  intentional non-NFC keys somewhere; verify before adopting.
- **Reject.** Unlikely. If the JSON file inventory turns out to be entirely
  generated content, scoping is the right move, not rejection.

## Rollout

1. Install `@eslint/json`.
2. Add one config block for strict JSON files with `plugins: { json }`,
   `language: "json/json"`, and `extends: ["json/recommended"]`.
3. Add a separate block for JSONC-style files (`**/*.jsonc`, `.vscode/*.json`,
   and any `tsconfig*.json` files that need comments/trailing commas) with
   `language: "json/jsonc"`. Use `languageOptions.allowTrailingCommas: true`
   only for files that need it.
4. Run as inventory; fix syntax and recommended-rule findings.
5. Promote to `error`.
6. If any recommended rule is dropped, an entire file family is deferred, or
   the plugin lands with scoped exceptions, record the reason in
   `evaluation-verdicts.md`.

## Open Question

Some JSON files are generated (Prisma migration meta, code-intel cache,
playwright reports). Confirm those are already in the ignore list before
enabling JSON lint, or extend the ignore.

## Verification

- `bun run lint -- --max-warnings=0` after Leaf 1 lands, or as an inventory
  probe before then.
- `bun run verify:changed`
- If any rule or file family is rejected, deferred, subset-adopted, or fully
  adopted with caveats/scoped exceptions, append a row to
  `evaluation-verdicts.md` before closing the leaf.

## Implementation Result

- Installed `@eslint/json@1.2.0`.
- Added strict JSON and JSONC flat-config blocks with
  `json/no-duplicate-keys`, `json/no-empty-keys`,
  `json/no-unnormalized-keys`, and `json/no-unsafe-values` at `error`.
- Strict JSON uses `language: "json/json"` for `**/*.json`, excluding
  `tsconfig*.json` and `.vscode/*.json`; JSONC uses
  `language: "json/jsonc"` with trailing commas allowed for `**/*.jsonc`,
  `tsconfig*.json`, and `.vscode/*.json`.
- Scoped the existing JavaScript and TypeScript rule stacks to code file
  extensions so native JSON language files do not inherit ESTree-only rules.
- Inventory after existing top-level ignores: 22 JSON-family files in ESLint
  scope, split into 14 strict JSON files and 8 JSONC-style `tsconfig*.json`
  files. Existing `scripts/**/*` ignores keep codemod and drift fixture JSON
  outside ESLint scope.
- `bun run lint -- --max-warnings=0` found 0 findings for all four JSON
  recommended rules; no JSON source fixes were needed.
