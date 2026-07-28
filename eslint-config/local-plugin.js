// @ts-check

import badComparisonSequence from "../eslint-rules/bad-comparison-sequence.js";
import badMinMaxFunc from "../eslint-rules/bad-min-max-func.js";
import concurrencyGuard from "../eslint-rules/concurrency-guard.js";
import e2ePreferRoleSelectors from "../eslint-rules/e2e-prefer-role-selectors.js";
import maxLines from "../eslint-rules/max-lines.js";
import missingThrow from "../eslint-rules/missing-throw.js";
import noAsyncArrayCallbacks from "../eslint-rules/no-async-array-callbacks.js";
import noArbitraryTailwindValue from "../eslint-rules/no-arbitrary-tailwind-value.js";
import noBarrel from "../eslint-rules/no-barrel.js";
import noBroadcastInTransaction from "../eslint-rules/no-broadcast-in-transaction.js";
import noCommentedOutCode from "../eslint-rules/no-commented-out-code.js";
import noExplicitAny from "../eslint-rules/no-explicit-any.js";
import noEffectMisuse from "../eslint-rules/no-effect-misuse.js";
import noIncorrectSort from "../eslint-rules/no-incorrect-sort.js";
import noLlmArtifacts from "../eslint-rules/no-llm-artifacts.js";
import noOuterClientInTransaction from "../eslint-rules/no-outer-client-in-transaction.js";
import noPlainErrorInTrpc from "../eslint-rules/no-plain-error-in-trpc.js";
import noRedundantCentralMock from "../eslint-rules/no-redundant-central-mock.js";
import noRetiredParseSuccessImport from "../eslint-rules/no-retired-parse-success-import.js";
import noSwallowedErrors from "../eslint-rules/no-swallowed-errors.js";
import noUnboundedPromiseAll from "../eslint-rules/no-unbounded-promise-all.js";
import socketListenerCleanup from "../eslint-rules/socket-listener-cleanup.js";
import socketRegistryBroadcasts from "../eslint-rules/socket-registry-broadcasts.js";
import strictSharedSchemas from "../eslint-rules/strict-shared-schemas.js";
import strictTrpcInput from "../eslint-rules/strict-trpc-input.js";
import structuredLogging from "../eslint-rules/structured-logging.js";
import testFileLocation from "../eslint-rules/test-file-location.js";
import trpcRequireOutputSchema from "../eslint-rules/trpc-require-output-schema.js";
import trpcSharedInputSchema from "../eslint-rules/trpc-shared-input-schema.js";
import trpcSharedOutputSchema from "../eslint-rules/trpc-shared-output-schema.js";
import typeAssertionBoundary from "../eslint-rules/type-assertion-boundary.js";
import uninvokedArrayCallback from "../eslint-rules/uninvoked-array-callback.js";

export const localPlugin = {
  rules: {
    "bad-comparison-sequence": badComparisonSequence,
    "bad-min-max-func": badMinMaxFunc,
    "concurrency-guard": concurrencyGuard,
    "max-lines": maxLines,
    "missing-throw": missingThrow,
    "no-async-array-callbacks": noAsyncArrayCallbacks,
    "no-arbitrary-tailwind-value": noArbitraryTailwindValue,
    "no-barrel": noBarrel,
    "no-commented-out-code": noCommentedOutCode,
    "no-effect-misuse": noEffectMisuse,
    "no-explicit-any": noExplicitAny,
    "no-incorrect-sort": noIncorrectSort,
    "no-llm-artifacts": noLlmArtifacts,
    "no-outer-client-in-transaction": noOuterClientInTransaction,
    "no-plain-error-in-trpc": noPlainErrorInTrpc,
    "no-redundant-central-mock": noRedundantCentralMock,
    "no-retired-parse-success-import": noRetiredParseSuccessImport,
    "no-swallowed-errors": noSwallowedErrors,
    "no-unbounded-promise-all": noUnboundedPromiseAll,
    "socket-listener-cleanup": socketListenerCleanup,
    "type-assertion-boundary": typeAssertionBoundary,
    "uninvoked-array-callback": uninvokedArrayCallback,
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
