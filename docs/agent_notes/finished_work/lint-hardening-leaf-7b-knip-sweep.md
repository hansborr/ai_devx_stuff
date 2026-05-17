# Leaf 7b Knip Sweep

Date: 2026-05-17
Branch: feat/lint-hardening-leaf-7b

## Result

Fresh baseline reported 87 unused exports, 74 unused exported types, one
unused devDependency (`@commitlint/cli`), and one unlisted dependency
(`@commitlint/types`).

Disposition for the 161 export/type findings:

- 5 deleted.
- 41 carved out as intentional API/test surface.
- 115 made module-private by dropping exports.

Dependency fixes:

- `@commitlint/cli` is ignored because `.husky/commit-msg` invokes it through
  `bunx commitlint`.
- `@commitlint/types` is declared because `commitlint.config.js` imports its
  JSDoc config type.

Final `bun run sensor:knip` exits 0.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run typecheck`
- `bun run sensor:knip`
- `bun run test:server`
- `bun run test:client`
- `bun run vitest run --project=scripts`

`bun run test:scripts` was attempted but rejected the dirty worktree in its
`verify --changed` smoke before reaching script tests; the targeted `scripts`
Vitest project was run directly instead.
