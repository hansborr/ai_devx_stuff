// Single source of truth for repo-root-relative harness file paths.
//
// LEAF module: imports nothing so it can be shared by both the generators that
// write these paths and the validators (harness:check, path-policy) that
// assert against them, without risking an import cycle. Follow this pattern
// when adding constants shared across the harness surface (see
// scripts/harness/hook-timeout-constants.ts for the sibling precedent).
//
// Deliberately NOT in the portable lint-ratchet copy set: these constants are
// this repo's multi-agent hook-wiring and generated-output vocabulary. The
// manifest reader an adopter actually needs lives in harness-manifest.ts.

// Generated output paths, owned here so each generator and harness:check's
// freshness validator agree on the target by construction rather than by
// hand-copied string literals.
export const GENERATED_VERIFY_STEPS_PATH = "scripts/verify/steps.generated.sh";
export const GENERATED_SURFACE_FRESHNESS_PATH =
  "scripts/harness/generated-surface-freshness.generated.sh";
export const GENERATED_HARNESS_CONTROLS_DOC_PATH = "docs/generated/harness-controls.md";
export const GENERATED_HARNESS_PORTING_MANIFEST_PATH = "docs/generated/harness-porting-manifest.md";
export const GENERATED_PRE_PUSH_SCOPE_TRIGGER_PATH =
  "scripts/harness/pre-push-scope-trigger.generated.sh";

// Generated hook-config outputs, shared by the hook generators (which write
// them), harness:check freshness, and path-policy source-relevance.
export const CLAUDE_SETTINGS_PATH = ".claude/settings.json";
export const CODEX_HOOKS_PATH = ".codex/hooks.json";
export const COPILOT_HOOKS_PATH = ".github/hooks/copilot.json";
export const GENERATED_HOOK_TIMEOUT_CONSTANTS_PATH = "scripts/ai-hooks/hook-timeouts.generated.sh";
export const GENERATED_CLASSIFIED_BUN_SCRIPTS_PATH =
  "scripts/ai-hooks/classified-bun-scripts.generated.sh";
export const AI_HOOKS_POLICY_PATH = "scripts/ai-hooks/policy.sh";
/**
 * The shell files that together define the command policy the agent hooks
 * evaluate: the `policy.sh` facade plus the bounded modules it sources. A
 * manifest-named predicate or haystack transform may live in any of them, so
 * the generator scans the whole set rather than the facade alone.
 */
export const AI_HOOKS_COMMAND_POLICY_SHELL_PATHS = [
  AI_HOOKS_POLICY_PATH,
  "scripts/ai-hooks/command-normalize.sh",
  "scripts/ai-hooks/command-paths.sh",
  "scripts/ai-hooks/git-classify.sh",
  "scripts/ai-hooks/policy-eval.sh",
] as const;
export const GENERATED_COMMAND_POLICY_PATH = "scripts/ai-hooks/policy-rules.generated.sh";
export const GENERATED_HARNESS_CHECK_FIXTURE_MANIFEST_PATH =
  "scripts/tests/harness-check-fixture-manifest.generated.txt";
