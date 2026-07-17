// The ratchet reads this file only to validate `local/*` rule metadata
// (scripts/lib/lint-rule-docs.ts): every rule under `plugins.local.rules` must
// carry a valid `meta.docs`. It is NOT the config used to lint — each ratchet
// generates its own isolated ESLint config at run time.
//
// This demo ratchets one demo-authored, repository-neutral local rule. The
// manifest-copied max-lines rule is a runtime dependency of ratchet diagnostics,
// not the adoption example; its Musi-specific policy is intentionally not wired.

import noConsoleLog from "./eslint-rules/no-console-log.js";

export default [
  {
    plugins: {
      local: {
        rules: { "no-console-log": noConsoleLog },
      },
    },
  },
];
