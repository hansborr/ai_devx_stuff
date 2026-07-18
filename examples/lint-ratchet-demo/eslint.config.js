// The demo lists its `local/*` rules here so an adopter can see where a rule is
// declared. This is NOT the config used to lint — the @musi/lint-ratchet engine
// generates its own isolated ESLint config per ratchet at run time.
//
// This demo ratchets one demo-authored, repository-neutral local rule; a real
// adopter adds their own rules to the same map and to the registry in
// scripts/lint-ratchet/adapter.ts.

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
