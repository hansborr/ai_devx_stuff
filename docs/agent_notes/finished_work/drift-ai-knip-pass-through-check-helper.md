# Drift:ai knip pass-through check helper

Task: `/home/node/drift-ai-review/36-knip-pass-through-adapter-helper.md`

Landed a shared knip-backed check helper:

- `knip-pass-through-check.ts` resolves common services from `CheckServiceEnv`,
  runs the shared `resolveKnipConfig` / `detectTargetInstall` preflight, resolves
  the selected-check-aware memoizing knip runner, and maps tool-unavailable,
  timeout, spawn-failed, and unreadable JSON outcomes consistently.
- `knip-orphan-files-check.ts` and `knip-unused-exports-check.ts` now provide only
  parser and finding-builder callbacks, preserving their check-specific output.
- `knip-pass-through-check.test.ts` locks parity across both checks for
  tool-unavailable, timeout, spawn failure, and unreadable JSON diagnostics.

Validation:

- `bun run test -- scripts/drift-ai/knip-pass-through-check.test.ts scripts/drift-ai/knip-orphan-files.test.ts scripts/drift-ai/knip-unused-exports.test.ts scripts/drift-ai/knip-runner.test.ts`
- `bun run typecheck`
