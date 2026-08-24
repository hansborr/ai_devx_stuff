import { defaultPathProbe, detectTargetInstall } from "./adapter-support.js";
import type { CheckOutcome, CheckRunContext } from "./check-plugin.js";
import { defineCheckPlugin } from "./check-plugin.js";
import type { DriftAiLayerDirectionConfig } from "./config.js";
import { assessGraph } from "./import-cycles.js";
import { defaultModuleGraphRunner, type ModuleGraph } from "./import-cycles-graph.js";
import {
  buildLayerDirectionFindings,
  buildLayerDirectionGraphErrorFinding,
  findInertLayerDirectionRuleIds,
  type LayerDirectionServices,
} from "./layer-direction.js";
import { layerDirectionCheckConfig } from "./layer-direction-check-config.js";

export const layerDirectionCheck = defineCheckPlugin<
  DriftAiLayerDirectionConfig,
  LayerDirectionServices,
  "layer-direction"
>({
  ...layerDirectionCheckConfig,
  resolveServices: (env) => ({
    moduleGraph: env.overrides.moduleGraph ?? defaultModuleGraphRunner(),
    pathExists: env.overrides.pathExists ?? defaultPathProbe(env.repoRoot),
    tsconfigOverride: env.cli.tsconfig ?? null,
  }),
  // The built-in default is zero rules (layering policy is repo policy), so a
  // run without configured rules can only ever be empty. Skip with an explicit
  // notice instead of letting that empty result read as a layering verdict —
  // and skip before paying for the whole-project module graph.
  preflight: (_ctx, config) =>
    config.rules.length === 0
      ? "no layer-direction rules configured (the built-in default is zero rules, so an empty run is not evidence); add checks.layer-direction.rules to the target's drift-ai.config.json"
      : undefined,
  run: runLayerDirectionCheck,
});

function runLayerDirectionCheck(
  ctx: CheckRunContext<LayerDirectionServices>,
  config: DriftAiLayerDirectionConfig,
): CheckOutcome {
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

  warnForInertRules(ctx, config, result.graph);
  return {
    status: "ran",
    findings: buildLayerDirectionFindings(result.graph, ctx.detectorScope, config),
  };
}

// A configured rule whose prefixes match zero files in the module graph cannot
// produce findings, so its silence proves nothing. Name such rules on stderr so
// an empty result is never silently authoritative (a mistyped prefix would
// otherwise read as a clean layering verdict).
function warnForInertRules(
  ctx: CheckRunContext<LayerDirectionServices>,
  config: DriftAiLayerDirectionConfig,
  graph: ModuleGraph,
): void {
  const inert = findInertLayerDirectionRuleIds(graph, config.rules);
  if (inert.length === 0) return;
  ctx.warnStderr(
    `drift:ai: layer-direction rule(s) [${inert.join(", ")}] matched zero files in the module graph; their empty result is not evidence — check sourcePrefix/targetPrefix against this repo's layout.`,
  );
}
