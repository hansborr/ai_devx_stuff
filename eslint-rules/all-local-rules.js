// @ts-check
//
// Shared local-plugin rule set as consumed by the meta-contract suite
// (message-guidance.test.js) and the registry-completeness guard
// (local-plugin-registry.test.js). Deriving from `localPlugin.rules` keeps the
// message-guidance suite on the same registry that lint actually runs; the
// registry test compares that registry against the rule files on disk.
//
// This module is intentionally NOT a `*.test.js` file so the eslint-rules
// vitest project (include: ["*.test.js"]) does not collect it as a suite.

import { localPlugin } from "../eslint-config/local-plugin.js";

export const ALL_LOCAL_RULES = Object.entries(localPlugin.rules).map(([id, rule]) => ({
  id,
  rule,
}));
