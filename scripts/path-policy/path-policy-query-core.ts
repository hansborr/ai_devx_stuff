// Musi's adapter over the portable query engine.
//
// The engine in `path-policy-query-engine.ts` holds the selector language, the
// query names, and the handlers. This module supplies the repository-specific
// half — the concrete `PATH_POLICY`, the generated smoke-subject registry, and
// H15's memoized smoke-name discovery — and re-exports the CLI-facing API
// unchanged so `path-policy-query.ts` and its shell consumers see no seam.
//
// Both smoke dependencies are passed as providers: `scriptSmokeTestNames` is
// itself the lazy provider (its memo lives in the discovery module so
// `vi.resetModules()` clears it), and the registry is read per query rather
// than snapshotted here.

import { PATH_POLICY } from "./path-policy.js";
import {
  createPathPolicyQueryHandlers,
  type PathPolicyQueryName,
} from "./path-policy-query-engine.js";
import { scriptSmokeTestNames } from "./path-policy-smoke-subjects.js";
import { SCRIPT_SMOKE_SUBJECTS } from "./path-policy-smoke-subjects-data.js";
import { SMOKE_METADATA_FRESHNESS_TEST_NAME } from "./smoke-test-files.js";

export {
  formatPathPolicyOutput,
  isPathPolicyQueryName,
  parsePathPolicyInput,
  PATH_POLICY_QUERY_NAMES,
  type PathPolicyQueryName,
} from "./path-policy-query-engine.js";

const queryHandlers = createPathPolicyQueryHandlers({
  policy: PATH_POLICY,
  smokeTestNames: scriptSmokeTestNames,
  smokeSubjects: () => SCRIPT_SMOKE_SUBJECTS,
  smokeMetadataFreshnessTestName: SMOKE_METADATA_FRESHNESS_TEST_NAME,
});

export const queryPathPolicy = (query: PathPolicyQueryName, paths: readonly string[]): string[] =>
  queryHandlers[query](paths);
