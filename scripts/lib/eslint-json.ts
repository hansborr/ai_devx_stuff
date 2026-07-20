// Scripts-local indirection over the lint-ratchet kernel's ESLint
// `--format=json` parser, mirroring `scripts/lib/atomic-write.ts`. The parser
// is an entry of the package's utility contract (generic helpers exported for
// adapter convenience — lint-arch-review leaf 14, `docs/agent_notes/backlog/`
// `lint-ratchet-arch` review pack `14-enumerated-subpath-exports.md`), kept as
// one shared implementation because `scripts/lint-agent.ts` and the kernel's
// `eslint-runner` deliberately deduplicated their previously drifting copies.
// Every `scripts/` consumer imports from here, not from
// `@musi/lint-ratchet/kernel/eslint-json.js` directly, so the utility seam
// stays one file wide on the adapter side.
export type { ESLintFileResult, ESLintMessage } from "@musi/lint-ratchet/kernel/eslint-json.js";
export { parseEslintOutput } from "@musi/lint-ratchet/kernel/eslint-json.js";
