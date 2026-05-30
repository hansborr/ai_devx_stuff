// The import-cycles CheckPlugin: a config-honoring structural adapter (adapter
// contract §1/§2) over the target's tsconfig. It builds the module graph via the
// injected ModuleGraphRunner (ts-morph / ts resolver), finds strongly-connected
// import cycles, and reports them stamped with target-config provenance. The
// skip-vs-partial decision (adapter contract §4) happens in `run` after the build,
// because partiality is only known once resolution is attempted.

import { defaultPathProbe, detectTargetInstall } from "./adapter-support.js";
import type { CheckOutcome, CheckRunContext } from "./check-plugin.js";
import { defineCheckPlugin } from "./check-plugin.js";
import {
  assessGraph,
  buildCycleFindings,
  buildCycleProvenance,
  buildGraphErrorFinding,
  findCycles,
  type ImportCyclesServices,
  resolveImportCyclesConfig,
} from "./import-cycles.js";
import { importCyclesCheckConfig, type ImportCyclesConfig } from "./import-cycles-check-config.js";
import { defaultModuleGraphRunner } from "./import-cycles-graph.js";

export const importCyclesCheck = defineCheckPlugin<
  ImportCyclesConfig,
  ImportCyclesServices,
  "import-cycles"
>({
  ...importCyclesCheckConfig,
  resolveServices: (env) => ({
    moduleGraph: env.overrides.moduleGraph ?? defaultModuleGraphRunner(),
    pathExists: env.overrides.pathExists ?? defaultPathProbe(env.repoRoot),
    tsconfigOverride: env.cli.tsconfig ?? null,
  }),
  run: runImportCyclesCheck,
});

function runImportCyclesCheck(ctx: CheckRunContext<ImportCyclesServices>): CheckOutcome {
  const resolution = resolveImportCyclesConfig(ctx);
  const result = ctx.services.moduleGraph({
    repoRoot: ctx.repoRoot,
    roots: ctx.roots,
    tsconfigOverride: resolution.tsconfigOverride,
    sourceExtensions: ctx.sourceExtensions,
    ignore: ctx.config.ignore,
  });

  // Attempted-and-failed (the engine threw): a single diagnostic finding, not a
  // skip — something the operator can act on actually broke (adapter contract §4).
  if (!result.ok) {
    if ("reason" in result) {
      return {
        status: "skipped",
        reason: result.reason,
        ...(result.code === undefined ? {} : { code: result.code }),
      };
    }
    return { status: "ran", findings: [buildGraphErrorFinding(result.error)] };
  }

  const assessment = assessGraph(result.graph, detectTargetInstall(ctx.services.pathExists));
  if (assessment.kind === "skip") {
    return {
      status: "skipped",
      reason: assessment.reason,
      ...(assessment.code === undefined ? {} : { code: assessment.code }),
    };
  }

  const provenance = buildCycleProvenance(resolution);
  const cycles = findCycles(result.graph);
  return {
    status: "ran",
    findings: buildCycleFindings(cycles, ctx.detectorScope, provenance),
  };
}
