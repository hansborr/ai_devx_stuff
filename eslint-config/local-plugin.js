// @ts-check

import concurrencyGuard from "../eslint-rules/concurrency-guard.js";
import e2ePreferRoleSelectors from "../eslint-rules/e2e-prefer-role-selectors.js";
import maxLines from "../eslint-rules/max-lines.js";
import noAsyncArrayCallbacks from "../eslint-rules/no-async-array-callbacks.js";
import noArbitraryTailwindValue from "../eslint-rules/no-arbitrary-tailwind-value.js";
import noBarrel from "../eslint-rules/no-barrel.js";
import noBroadcastInTransaction from "../eslint-rules/no-broadcast-in-transaction.js";
import noExplicitAny from "../eslint-rules/no-explicit-any.js";
import noLlmArtifacts from "../eslint-rules/no-llm-artifacts.js";
import noRedundantCentralMock from "../eslint-rules/no-redundant-central-mock.js";
import noSwallowedErrors from "../eslint-rules/no-swallowed-errors.js";
import socketRegistryBroadcasts from "../eslint-rules/socket-registry-broadcasts.js";
import strictSharedSchemas from "../eslint-rules/strict-shared-schemas.js";
import strictTrpcInput from "../eslint-rules/strict-trpc-input.js";
import structuredLogging from "../eslint-rules/structured-logging.js";
import testFileLocation from "../eslint-rules/test-file-location.js";
import trpcRequireOutputSchema from "../eslint-rules/trpc-require-output-schema.js";
import trpcSharedInputSchema from "../eslint-rules/trpc-shared-input-schema.js";
import trpcSharedOutputSchema from "../eslint-rules/trpc-shared-output-schema.js";
import typeAssertionBoundary from "../eslint-rules/type-assertion-boundary.js";

export const localPlugin = {
  rules: {
    "concurrency-guard": concurrencyGuard,
    "max-lines": maxLines,
    "no-async-array-callbacks": noAsyncArrayCallbacks,
    "no-arbitrary-tailwind-value": noArbitraryTailwindValue,
    "no-barrel": noBarrel,
    "no-explicit-any": noExplicitAny,
    "no-llm-artifacts": noLlmArtifacts,
    "no-redundant-central-mock": noRedundantCentralMock,
    "no-swallowed-errors": noSwallowedErrors,
    "type-assertion-boundary": typeAssertionBoundary,
    "e2e-prefer-role-selectors": e2ePreferRoleSelectors,
    "no-broadcast-in-transaction": noBroadcastInTransaction,
    "test-file-location": testFileLocation,
    "socket-registry-broadcasts": socketRegistryBroadcasts,
    "structured-logging": structuredLogging,
    "strict-trpc-input": strictTrpcInput,
    "trpc-require-output-schema": trpcRequireOutputSchema,
    "trpc-shared-input-schema": trpcSharedInputSchema,
    "trpc-shared-output-schema": trpcSharedOutputSchema,
    "strict-shared-schemas": strictSharedSchemas,
  },
};
