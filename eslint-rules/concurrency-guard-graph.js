// @ts-check

import relationGraph from "../packages/server/src/prisma/concurrency-relation-graph.generated.json" with { type: "json" };

/** @param {string} model */
function delegateNameForModel(model) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export const GATED_DELEGATES = new Set(relationGraph.gatedModels.map(delegateNameForModel));
export const GATED_MUTATORS = new Set(relationGraph.gatedOperations);
export const DATA_SCALAR_MODELS = new Set(relationGraph.dataScalarModels.map(delegateNameForModel));
export const DIRECT_WRITE_SUGGESTIONS = new Map(Object.entries(relationGraph.repairSuggestions));

/** @type {Map<string, Map<string, string>>} */
export const RELATIONS_BY_MODEL = new Map(
  Object.entries(relationGraph.models).map(([model, relations]) => [
    delegateNameForModel(model),
    new Map(
      Object.entries(relations).map(([field, target]) => [field, delegateNameForModel(target)]),
    ),
  ]),
);

export const PAYLOAD_ENVELOPE_KEYS = new Set(relationGraph.payloadEnvelopeKeys);
