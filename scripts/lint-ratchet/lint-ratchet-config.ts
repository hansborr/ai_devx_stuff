import type {
  LintRatchetConfig,
  LintRatchetThirdPartyPluginAllowlistEntry,
} from "@musi/lint-ratchet/kernel/config-types.js";

import {
  clientSourceFiles,
  clientTestAndHelperSourceFiles,
  codeFiles,
  productionFunctionStructureFiles,
  productionFunctionStructureIgnores,
} from "../../eslint-config/path-glob-policy.js";
import {
  scriptFixtureIgnores,
  scriptTestAssertFunctionNames,
} from "../../eslint-config/script-test-policy.js";
import {
  localTypeAssertionBoundaryRatchet,
  vitestValidExpectRatchet,
} from "./registry-builders.js";

// prettier-ignore
export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] = [
  { pluginModule: "typescript-eslint", ruleNamespace: "@typescript-eslint", pluginExport: "plugin" },
  { pluginModule: "@vitest/eslint-plugin", ruleNamespace: "vitest", pluginExport: "default" },
  { pluginModule: "eslint-plugin-react", ruleNamespace: "react", pluginExport: "default" },
  { pluginModule: "eslint-plugin-react-refresh", ruleNamespace: "react-refresh", pluginExport: "default" },
  { pluginModule: "eslint-plugin-react-hooks", ruleNamespace: "react-hooks", pluginExport: "default" },
  { pluginModule: "eslint-plugin-playwright", ruleNamespace: "playwright", pluginExport: "default" },
  { pluginModule: "eslint-plugin-regexp", ruleNamespace: "regexp", pluginExport: "default" },
  { pluginModule: "eslint-plugin-simple-import-sort", ruleNamespace: "simple-import-sort", pluginExport: "default" },
  { pluginModule: "eslint-plugin-testing-library", ruleNamespace: "testing-library", pluginExport: "default" },
];

// testing-library implementation-detail debt floors (leaf 06). Normal lint
// enables the clean testing-library/flat-react rules at error on client
// component tests; these three carry existing debt, so they are held as
// message-count floors here and turned off in normal lint until drained.
const testingLibraryClientTestFiles = ["packages/client/src/**/*.test.tsx"] as const;
// Shared ignore floor for ratchets that only need to skip build output; reused
// by every entry whose ignores are exactly the dist/generated/node_modules set.
const commonRatchetIgnores = ["**/dist/**", "**/generated/**", "**/node_modules/**"] as const;
// Code-wide ratchets mirror the main repository's lint scope: self-contained
// examples own their lint CI, and script fixtures stay outside the script TS
// project. Keep this named posture reusable for future code-wide entries.
const codeWideRatchetIgnores = [
  ...commonRatchetIgnores,
  "examples/**",
  ...scriptFixtureIgnores,
] as const;
const testingLibraryDrainExitPath = "docs/agent_notes/finished_work/lint-followups-2026-06.md";
const harnessReview202607Index = "docs/agent_notes/backlog/harness-review-2026-07/00-index.md";
const noDirectGitExecScriptsRestrictedSyntax = [
  {
    selector:
      'CallExpression[arguments.0.type="Literal"][arguments.0.value="git"][callee.type="Identifier"][callee.name=/^(?:execFile|execFileSync|spawn|spawnSync)$/]',
    message:
      "Route production Git commands through named scripts/lib/git.ts primitives; keep accepted fixture and injected-runner calls within this ratcheted floor.",
  },
] as const;
const noRealTimeInPackageTestsRestrictedSyntax = [
  {
    selector:
      "CallExpression[callee.object.name='Date'][callee.property.name='now'][arguments.length=0]",
    message:
      "Avoid Date.now() in tests. Use vi.useFakeTimers()/vi.setSystemTime() or inject a clock so test time is deterministic.",
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      "Avoid no-arg new Date() in tests. Use vi.useFakeTimers()/vi.setSystemTime() or pass an explicit timestamp so test time is deterministic.",
  },
] as const;

// The drift-ai vitest option-pin families cover the whole drift metrics/
// reporting family: drift-ai plus scripts/drift-triage/**, the triage reducer
// relocated out of drift-ai (drift-triage-collapse S2) — mirroring the ESLint
// family policy in eslint-config/script-configs.js, which spans the entry and
// the directory. The triage-* tests were in these families before the
// relocation; the entry-adjacent tests (drift-triage.test.ts,
// drift-triage-collect.test.ts) were flat and never were, but they are the
// same test family, so the directory glob deliberately includes them.
const driftAiVitestTestFiles = [
  "scripts/drift-ai.test.ts",
  "scripts/drift-ai/**/*.test.ts",
  "scripts/drift-triage/**/*.test.ts",
] as const;
const driftAiVitestTestIgnores = ["scripts/drift-ai/fixtures/**"] as const;
const scriptVitestOptionPinnedFiles = [
  "scripts/code-intel/**/*.test.ts",
  "scripts/lint-coverage-map-check.test.ts",
  "scripts/lint-ratchet/baseline.test.ts",
] as const;
const designTokenLintExitPath =
  "docs/agent_notes/backlog/harness-research-followups-2026-06/02-design-token-lint.md";
const errorSemanticsDrainExitPath =
  "docs/agent_notes/backlog/lint-adoption-2026-07/12-broaden-error-semantics-coverage.md";

// prettier-ignore
export const lintRatchets = [
  {
    id: "ratchet/local-no-arbitrary-tailwind-value-client",
    ruleId: "local/no-arbitrary-tailwind-value",
    files: clientSourceFiles,
    ignores: clientTestAndHelperSourceFiles,
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    principle: "Freeze the accepted client arbitrary Tailwind bracket-value inventory so new one-off class values fail while the design-token cleanup drains incrementally.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "client class strings should use DESIGN.md and packages/client/src/app.css @theme tokens; once the existing arbitrary-value inventory drains, normal lint should enforce the rule directly",
      exitPath: designTokenLintExitPath,
    },
  },
  {
    id: "ratchet/local-no-commented-out-code",
    ruleId: "local/no-commented-out-code",
    files: codeFiles,
    ignores: codeWideRatchetIgnores,
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    principle: "Prevent multi-line operative code from being preserved in comments, where it obscures the active implementation and can be resurrected as a stale alternative.",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "the deliberately conservative comment-shape heuristic should block new debt at commit time without becoming a normal-lint editor diagnostic across every maintained JS/TS file",
    },
  },
  {
    id: "ratchet/local-no-swallowed-errors-broader-semantics",
    ruleId: "local/no-swallowed-errors",
    files: codeFiles,
    ignores: codeWideRatchetIgnores,
    ruleOptions: [
      {
        checkLoggedRethrow: false,
        checkSwallowedError: false,
      },
    ],
    mode: "no-new",
    metric: "message-count",
    principle: "Prevent empty catches and log-then-return fallbacks from growing beyond the current inventory while the accepted error-semantics debt drains.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "once empty catches and logged fallbacks drain, remove the normal-lint adoption options so every no-swallowed-errors message is a hard error",
      exitPath: errorSemanticsDrainExitPath,
    },
  },
  localTypeAssertionBoundaryRatchet({
    id: "ratchet/local-type-assertion-boundary",
    files: [
      "e2e/**/*.ts",
      "packages/**/*.{ts,tsx}",
      "scripts/**/*.ts",
      // The lint-ratchet engine kernel moved to the tools/ workspace (leaf 02);
      // keep the moved sources under the same zero-floor type-assertion policy.
      "tools/**/*.ts",
    ],
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ...scriptFixtureIgnores,
      "scripts/vitest.config.ts",
    ],
    principle: "Prevent the known type-assertion debt pool from growing while cleanup proceeds incrementally.",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal ESLint enforces local/type-assertion-boundary on e2e and maintained script TypeScript; this ratchet keeps the package TypeScript zero floor without pulling script fixtures or script config files into the runtime-script policy",
    },
  }),
  {
    id: "ratchet/max-depth-production",
    ruleId: "max-depth",
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: productionFunctionStructureFiles,
    ignores: productionFunctionStructureIgnores,
    ruleOptions: [{ max: 3 }],
    mode: "no-new",
    metric: "message-count",
    principle: "Freeze production nesting beyond three blocks so new deeply nested handlers fail and repairs favor early returns, guard clauses, and focused helpers.",
  },
  {
    id: "ratchet/max-lines-per-function-production",
    ruleId: "max-lines-per-function",
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: productionFunctionStructureFiles,
    ignores: productionFunctionStructureIgnores,
    // This calibrated first step deliberately does not adopt llm-core's
    // monorepo-wide 50-line limit. Revisit 60 for services and routers after
    // the production debt frozen here has drained.
    // Accepted cooperative-agent gap: message-count freezes the number of
    // over-100-line functions, not each finding's rendered line count, so an
    // existing violation can grow while it remains below the normal-lint
    // 200-line ceiling. A precise per-function severity vector would require a
    // new metric across collection, baseline schema/merge, comparison,
    // debt-log, reporting, and portability surfaces. That machinery is
    // disproportionate for this accidental-drift rollout; revisit if
    // within-function growth becomes recurring evidence rather than a
    // theoretical evasion.
    ruleOptions: [{ max: 100, skipBlankLines: true, skipComments: true }],
    mode: "no-new",
    metric: "message-count",
    principle: "Prevent the number of production functions over 100 effective lines from growing while the 200-line normal-lint ceiling remains the hard cap and existing debt drains without artificial splits.",
  },
  {
    id: "ratchet/no-direct-git-exec-scripts",
    ruleId: "no-restricted-syntax",
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: ["scripts/**/*.ts"],
    ignores: [...codeWideRatchetIgnores, "scripts/lib/git.ts"].toSorted(),
    ruleOptions: noDirectGitExecScriptsRestrictedSyntax,
    mode: "no-new",
    metric: "message-count",
    principle: "Freeze direct child-process Git calls outside scripts/lib/git.ts so new production bypasses cannot erode the named Git seam while accepted fixtures and injectable adapters drain opportunistically.",
  },
  {
    id: "ratchet/no-real-time-in-package-tests",
    ruleId: "no-restricted-syntax",
    source: { kind: "core" },
    parserProfile: "minimal-ts",
    files: ["packages/**/*.{test,spec}.{ts,tsx}"],
    ignores: commonRatchetIgnores,
    ruleOptions: noRealTimeInPackageTestsRestrictedSyntax,
    mode: "no-new",
    metric: "message-count",
    principle: "Freeze real-clock usage in package tests so new Date.now() and no-arg new Date() calls cannot grow while existing tests migrate to fake timers or injected clocks.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "package tests should use deterministic clocks; once the current real-time inventory drains, normal test lint should enforce the Date.now()/no-arg new Date() ban directly",
      exitPath: harnessReview202607Index,
    },
  },
  {
    id: "ratchet/react-hooks-set-state-in-effect-client",
    ruleId: "react-hooks/set-state-in-effect",
    source: { kind: "third-party", pluginModule: "eslint-plugin-react-hooks" },
    parserProfile: "minimal-ts",
    files: clientSourceFiles,
    ignores: clientTestAndHelperSourceFiles,
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    principle: "Freeze the accepted set-state-in-effect floor so finding #25 fails at commit time while cleanup proceeds opportunistically.",
  },
  {
    id: "ratchet/react-refresh-only-export-components-client",
    ruleId: "react-refresh/only-export-components",
    source: { kind: "third-party", pluginModule: "eslint-plugin-react-refresh" },
    parserProfile: "minimal-ts",
    files: ["packages/client/src/**/*.tsx"],
    ignores: clientTestAndHelperSourceFiles,
    ruleOptions: [
      {
        allowConstantExport: true,
      },
    ],
    mode: "no-new",
    metric: "message-count",
    principle: "Prevent Fast Refresh unsafe mixed exports in client TSX modules from growing while shared constants and helpers move out of component files.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "client TSX modules should export components only for reliable Fast Refresh; once the mixed-export inventory drains, normal client React lint should enforce the rule directly",
      exitPath: harnessReview202607Index,
    },
  },
  {
    id: "ratchet/strict-boolean-expressions-server-encounter-combat",
    ruleId: "@typescript-eslint/strict-boolean-expressions",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: ["packages/server/src/services/encounter-combat/**/*.{ts,tsx}"],
    ignores: [
      ...commonRatchetIgnores,
      "packages/server/src/**/*-test-helper.{ts,tsx}",
      "packages/server/src/**/*.{test,spec}.{ts,tsx}",
      "packages/server/src/test/**/*.{ts,tsx}",
    ],
    ruleOptions: [
      {
        allowAny: false,
        allowNullableBoolean: false,
        allowNullableEnum: false,
        allowNullableNumber: false,
        allowNullableObject: true,
        allowNullableString: false,
        allowNumber: false,
        allowString: false,
      },
    ],
    mode: "no-new",
    metric: "message-count",
    principle: "Hold a strict-boolean-expressions zero floor over the packages/server/src/services/encounter-combat slice while package-wide server cleanup proceeds incrementally.",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint deliberately keeps @typescript-eslint/strict-boolean-expressions off; this ratchet extends the zero floor to the server encounter-combat slice without forcing a package-wide rollout",
    },
  },
  {
    id: "ratchet/strict-boolean-expressions-server-services",
    ruleId: "@typescript-eslint/strict-boolean-expressions",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: ["packages/server/src/services/**/*.{ts,tsx}"],
    ignores: [
      ...commonRatchetIgnores,
      "packages/server/src/**/*-test-helper.{ts,tsx}",
      "packages/server/src/**/*.{test,spec}.{ts,tsx}",
      "packages/server/src/services/encounter-combat/**",
      "packages/server/src/test/**/*.{ts,tsx}",
    ],
    ruleOptions: [
      {
        allowAny: false,
        allowNullableBoolean: false,
        allowNullableEnum: false,
        allowNullableNumber: false,
        allowNullableObject: true,
        allowNullableString: false,
        allowNumber: false,
        allowString: false,
      },
    ],
    mode: "no-new",
    metric: "message-count",
    principle: "Extend strict-boolean-expressions coverage across server services while excluding the existing encounter-combat slice that already owns its zero floor.",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint deliberately keeps @typescript-eslint/strict-boolean-expressions off; this services ratchet is the next staged slice before evaluating routers",
    },
  },
  {
    id: "ratchet/strict-boolean-expressions-shared",
    ruleId: "@typescript-eslint/strict-boolean-expressions",
    source: { kind: "third-party", pluginModule: "typescript-eslint" },
    parserProfile: "type-aware-ts",
    files: ["packages/shared/src/**/*.{ts,tsx}"],
    ignores: [
      ...commonRatchetIgnores,
      // Codepoint order (`t` < `{`): registry ignores must be codepoint-sorted.
      "packages/shared/src/**/*.test-helper.{ts,tsx}",
      "packages/shared/src/**/*.{test,spec}.{ts,tsx}",
      "packages/shared/src/test/**/*.{ts,tsx}",
    ],
    ruleOptions: [
      {
        allowAny: false,
        allowNullableBoolean: false,
        allowNullableEnum: false,
        allowNullableNumber: false,
        allowNullableObject: true,
        allowNullableString: false,
        allowNumber: false,
        allowString: false,
      },
    ],
    mode: "no-new",
    metric: "message-count",
    principle: "Prevent strict-boolean-expressions debt from growing in packages/shared/src production code while cleanup proceeds incrementally.",
    zeroBaselineDisposition: {
      kind: "intentional-ratchet-only",
      reason: "normal ESLint deliberately keeps @typescript-eslint/strict-boolean-expressions off; this ratchet preserves a shared-package zero floor without forcing a package-wide rollout",
    },
  },
  {
    id: "ratchet/testing-library-no-container-client-tests",
    ruleId: "testing-library/no-container",
    source: { kind: "third-party", pluginModule: "eslint-plugin-testing-library" },
    parserProfile: "minimal-ts",
    files: testingLibraryClientTestFiles,
    ignores: commonRatchetIgnores,
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    principle: "Prevent render-result container querying (testing-library/no-container) in client component tests from growing past the current inventory while the debt drains toward normal-lint promotion.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "querying through the render() container in client component tests bypasses Testing Library queries; floored at the current inventory and promoted to normal-lint error once the debt drains to zero",
      exitPath: testingLibraryDrainExitPath,
    },
  },
  {
    id: "ratchet/testing-library-no-node-access-client-tests",
    ruleId: "testing-library/no-node-access",
    source: { kind: "third-party", pluginModule: "eslint-plugin-testing-library" },
    parserProfile: "minimal-ts",
    files: testingLibraryClientTestFiles,
    ignores: commonRatchetIgnores,
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    principle: "Prevent direct DOM-node access (testing-library/no-node-access) in client component tests from growing past the current inventory while the debt drains toward normal-lint promotion.",
    zeroBaselineDisposition: {
      kind: "promote-to-normal-lint",
      reason: "direct DOM-node access in client component tests bypasses Testing Library queries; floored at the current inventory and promoted to normal-lint error once the debt drains to zero",
      exitPath: testingLibraryDrainExitPath,
    },
  },
  {
    id: "ratchet/vitest-expect-expect-drift-ai-tests",
    ruleId: "vitest/expect-expect",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: driftAiVitestTestFiles,
    ignores: driftAiVitestTestIgnores,
    ruleOptions: [
      {
        assertFunctionNames: ["expect"],
      },
    ],
    mode: "no-new",
    metric: "message-count",
    principle: "Keep the drift-ai test expect-expect floor pinned to assertFunctionNames [\"expect\"] only, stricter than the resolved plugin defaults normal lint applies (keep verdict, lint-review-2026-06 leaf 03e).",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint uses resolved plugin defaults for expect-expect; this drift-ai ratchet narrows the assertFunctionNames allowlist to expect only",
    },
  },
  {
    id: "ratchet/vitest-expect-expect-script-tests",
    ruleId: "vitest/expect-expect",
    source: { kind: "third-party", pluginModule: "@vitest/eslint-plugin" },
    parserProfile: "minimal-ts",
    files: scriptVitestOptionPinnedFiles,
    ignores: [],
    ruleOptions: [{ assertFunctionNames: scriptTestAssertFunctionNames }],
    mode: "no-new",
    metric: "message-count",
    principle: "Prevent script tests without recognized assertions from growing beyond the selected linted test inventory.",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint resolves extra plugin-default expect-expect options; this ratchet pins the assertFunctionNames allowlist (expect plus the named script-test helpers) scoped to the selected script tests",
    },
  },
  vitestValidExpectRatchet({
    id: "ratchet/vitest-valid-expect-drift-ai-tests",
    files: driftAiVitestTestFiles,
    ignores: driftAiVitestTestIgnores,
    principle: "Keep the drift-ai test valid-expect floor pinned to maxArgs 2, stricter than the resolved plugin defaults normal lint applies (keep verdict, lint-review-2026-06 leaf 03e).",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint resolves valid-expect defaults in addition to maxArgs:2; this drift-ai ratchet keeps the selected test-family floor",
    },
  }),
  vitestValidExpectRatchet({
    id: "ratchet/vitest-valid-expect-script-tests",
    files: scriptVitestOptionPinnedFiles,
    ignores: [],
    principle: "Prevent malformed Vitest expect calls from growing in the selected script-test inventory.",
    zeroBaselineDisposition: {
      kind: "narrow-floor",
      reason: "normal Vitest lint resolves valid-expect defaults in addition to maxArgs:2; this ratchet keeps the selected script-test floor",
    },
  }),
] as const satisfies readonly LintRatchetConfig[];
