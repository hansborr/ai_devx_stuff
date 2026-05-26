# Task 25 - ESLint Config Composition

`eslint.config.js` is now a short composition entry point. The extracted modules
under `eslint-config/` follow ownership boundaries:

- base language setup and ignores;
- package dependency tiers;
- broad repo code-quality rules;
- local ESLint rule authoring policy;
- script and process-boundary overrides;
- package architecture boundaries;
- client framework/runtime rules;
- JSON and config-file rules;
- test and e2e rules.

`eslint-config/shared-policy.js` now treats all `eslint-config/*.js` files as
config support files so new composition modules stay under the dedicated root
JS config lint profile.
