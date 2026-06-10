import { defaultPathProbe, detectTargetInstall } from "./adapter-support.js";
import type { CheckOutcome, CheckRunContext } from "./check-plugin.js";
import { defineCheckPlugin } from "./check-plugin.js";
import { assessGraph } from "./import-cycles.js";
import { defaultModuleGraphRunner } from "./import-cycles-graph.js";
import {
  buildLayerDirectionFindings,
  buildLayerDirectionGraphErrorFinding,
  type LayerDirectionServices,
} from "./layer-direction.js";
import {
  layerDirectionCheckConfig,
  type LayerDirectionConfig,
} from "./layer-direction-check-config.js";

export const layerDirectionCheck = defineCheckPlugin<
  LayerDirectionConfig,
  LayerDirectionServices,
  "layer-direction"
>({
  ...layerDirectionCheckConfig,
  resolveServices: (env) => ({
    moduleGraph: env.overrides.moduleGraph ?? defaultModuleGraphRunner(),
    pathExists: env.overrides.pathExists ?? defaultPathProbe(env.repoRoot),
    tsconfigOverride: env.cli.tsconfig ?? null,
  }),
  run: runLayerDirectionCheck,
});

function runLayerDirectionCheck(ctx: CheckRunContext<LayerDirectionServices>): CheckOutcome {
  const result = ctx.services.moduleGraph({
    repoRoot: ctx.repoRoot,
    roots: ctx.roots,
    tsconfigOverride: ctx.services.tsconfigOverride,
    sourceExtensions: ctx.sourceExtensions,
    ignore: ctx.config.ignore,
  });

  if (!result.ok) {
    if ("reason" in result) {
      return {
        status: "skipped",
        reason: result.reason,
        ...(result.code === undefined ? {} : { code: result.code }),
      };
    }
    return { status: "ran", findings: [buildLayerDirectionGraphErrorFinding(result.error)] };
  }

  const assessment = assessGraph(result.graph, detectTargetInstall(ctx.services.pathExists));
  if (assessment.kind === "skip") {
    return {
      status: "skipped",
      reason: assessment.reason,
      ...(assessment.code === undefined ? {} : { code: assessment.code }),
    };
  }

  return {
    status: "ran",
    findings: buildLayerDirectionFindings(result.graph, ctx.detectorScope),
  };
}
