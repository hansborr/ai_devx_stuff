import { codemodEntries } from "./lint-coverage-map-manifest-codemods.js";
import { rootAndPackageConfigEntries } from "./lint-coverage-map-manifest-config-files.js";
import { configSensorEntries } from "./lint-coverage-map-manifest-config-sensors.js";
import { markdownAndDocEntries } from "./lint-coverage-map-manifest-docs.js";
import {
  driftAiDirectChildEntries,
  driftAiFixtureEntries,
  driftAiRootEntries,
} from "./lint-coverage-map-manifest-drift-ai.js";
import { generateHarnessControlsEntries } from "./lint-coverage-map-manifest-harness-scripts.js";
import {
  localEslintRuleEntries,
  shellScriptEntries,
} from "./lint-coverage-map-manifest-lint-rules-and-shell.js";
import { lintedScriptEntriesA } from "./lint-coverage-map-manifest-linted-scripts-a.js";
import { lintedScriptEntriesB } from "./lint-coverage-map-manifest-linted-scripts-b.js";
import { webAssetAndMiscEntries } from "./lint-coverage-map-manifest-misc.js";
import {
  endToEndTestEntries,
  packageTestEntries,
  productionPackageSourceEntries,
} from "./lint-coverage-map-manifest-packages.js";
import { portableToolingEntries } from "./lint-coverage-map-manifest-portable-tooling.js";
import { ratchetRuntimeScriptEntries } from "./lint-coverage-map-manifest-ratchet-runtime.js";
import type { CoverageSection } from "./lint-coverage-map-manifest-schema.js";
import { topLevelScriptEntrypointEntries } from "./lint-coverage-map-manifest-script-entrypoints.js";
import {
  harnessAuditEntries,
  otherScriptFixtureEntries,
} from "./lint-coverage-map-manifest-script-fixtures.js";

// Document skeleton: heading order, section prose, and which entry list feeds
// each table. Row data lives in the sibling `-manifest-<area>.ts` modules so a
// module stays reviewable as one topic and under the shared max-lines cap.
export const coverageSections: readonly CoverageSection[] = [
  {
    heading: "Production Package Source",
    level: 2,
    groups: [{ entries: productionPackageSourceEntries }],
  },
  {
    heading: "Package Tests And Test Helpers",
    level: 2,
    groups: [{ entries: packageTestEntries }],
  },
  {
    heading: "End-To-End Tests",
    level: 2,
    groups: [{ entries: endToEndTestEntries }],
  },
  {
    heading: "Linted Scripts (`scripts/**/*.ts` Default Coverage)",
    level: 2,
    intro:
      "Maintained script TypeScript is linted by default through\n`tsconfig.scripts.json` and additionally applies\n`local/type-assertion-boundary` per a dedicated `rules` block. Fixtures and\ngenerated snapshots stay excluded by targeted ignores.",
    groups: [{ entries: [...lintedScriptEntriesA, ...lintedScriptEntriesB] }],
  },
  {
    heading: "Additional Script Families (Default Linted)",
    level: 2,
    intro:
      "All maintained TypeScript rows below are normal-linted by the default\n`scripts/**/*.ts` project mapping, with fixture/generated paths excluded.\nAdditional broad floors are listed in each row's\n`Existing ratchet/floor` cell. The `Proposed rule/tool` column is reserved\nfor still-missing broad-shallow floors; deeper rule adoption and drains are\nrecorded in `Blocker/follow-up` when a concrete action remains.",
    groups: [],
  },
  {
    heading: "Generate-Harness-Controls",
    level: 3,
    groups: [{ entries: generateHarnessControlsEntries }],
  },
  {
    heading: "Drift-AI Coverage",
    level: 3,
    intro:
      "The root entrypoint and root integration test stay hand-maintained because they\nare siblings of the generated directory scope. Direct-child maintained\nTypeScript under `scripts/drift-ai/` is derived from tracked files, proven\nESLint reach, and live ratchet membership. Nested fixtures stay excluded and\nhand-maintained below.\n\nThe family retains its deliberate CLI reporting policy in\n`eslint-config/script-configs.js` (`allowNumber` template interpolation,\n`max-params` 6, and `no-magic-numbers` off). Normal lint enforces the\ncomplexity and max-lines policies; the two test-only Vitest ratchets are\nintentional option-pinning floors.",
    groups: [
      { entries: driftAiRootEntries },
      { entries: driftAiDirectChildEntries },
      {
        note: "Fixture and documentation ownership remains hand-maintained:",
        entries: driftAiFixtureEntries,
      },
    ],
  },
  {
    heading: "Codemods",
    level: 3,
    groups: [{ entries: codemodEntries }],
  },
  {
    heading: "Top-Level Script Entrypoints",
    level: 3,
    groups: [{ entries: topLevelScriptEntrypointEntries }],
  },
  {
    heading: "Ratchet/Harness Runtime Scripts",
    level: 3,
    groups: [{ entries: ratchetRuntimeScriptEntries }],
  },
  {
    heading: "Harness Audit",
    level: 3,
    groups: [{ entries: harnessAuditEntries }],
  },
  {
    heading: "Other Script Fixtures (Always Excluded)",
    level: 3,
    groups: [{ entries: otherScriptFixtureEntries }],
  },
  {
    heading: "Local ESLint Rules",
    level: 2,
    groups: [{ entries: localEslintRuleEntries }],
  },
  {
    heading: "Shell Scripts And Git Hooks",
    level: 2,
    intro:
      "`bun run lint:shell` checks all maintained shell scripts and hooks, and `bun run lint` /\n`bun run lint:changed` include the same floor through `scripts/lint-shell.sh`\nand `scripts/lint-changed.sh`. ShellCheck resolves through the system\n`shellcheck` binary on `PATH` (install with your system package manager:\n`dnf`/`apt`/`brew`; this container reports `/usr/bin/shellcheck` 0.9.0), enables\n`--external-sources`, and enforces `--severity=info` (so pattern-safety checks\nlike SC2295 gate) with reviewed-noise info codes excluded\n(SC1091/SC2015/SC2016/SC2030/SC2031/SC2317; see `scripts/lint-shell.sh`) while\npreserving shebang-based shell dialect detection.",
    groups: [{ entries: shellScriptEntries }],
  },
  {
    heading: "Workflows And Agent/Devcontainer YAML/TOML/JSON",
    level: 2,
    intro:
      "`@eslint/json` covers tracked JSON (excluding targeted script fixtures;\n`tsconfig*.json` follows the jsonc track), so most JSON manifest hygiene is\nfloored. `bun run lint:config-sensors` covers workflow, maintained YAML, TOML,\nand Dockerfile sensors; full `bun run lint` and\n`lint:changed` include the same floor.",
    groups: [{ entries: configSensorEntries }],
  },
  {
    heading: "Root And Package Config Files",
    level: 2,
    groups: [{ entries: rootAndPackageConfigEntries }],
  },
  {
    heading: "Portable Tooling",
    level: 2,
    intro:
      "The portable `@musi/harness-diagnostics` workspace package owns the open\ntransport envelope schema that harness adapters consume, while\n`@musi/lint-ratchet` owns the kernel, governance, and pure git-rail machinery\nbehind an injected engine-context/binding seam. Both package boundaries reject\nimports that reach outside the package or into sibling Musi packages;\n`@musi/lint-ratchet` additionally proves its enumerated self-import exports in\na boundary test. The `ratchet/local-type-assertion-boundary` ratchet covers\n`tools/**/*.ts` at its zero floor, and `examples/lint-ratchet-demo` is a\nworkspace consumer of the ratchet engine.",
    groups: [{ entries: portableToolingEntries }],
  },
  {
    heading: "Markdown And Other Docs",
    level: 2,
    groups: [{ entries: markdownAndDocEntries }],
  },
  {
    heading: "Web Assets, Lockfiles, And Misc Tracked Files",
    level: 2,
    groups: [{ entries: webAssetAndMiscEntries }],
  },
];
