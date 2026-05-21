# Leaf 19 Adoption: scripts/lint-rule-docs.ts

Status: Resolved - verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-19-lint-rule-docs.
Probe: temporary inclusion in `eslint.config.js` then full
`bun run lint` run.

Scope: extend ESLint coverage to one additional script-family file —
`scripts/lint-rule-docs.ts`. This is the shared loader for the
`local/*` ESLint rule `meta.docs` contract, consumed by
`scripts/generate-lint-guidance.ts` (already linted),
`scripts/generate-harness-controls.ts`, and `scripts/lint-agent.ts`.

## Resolution

- Verdict: **adopt full** — `scripts/lint-rule-docs.ts` is now covered by
  ESLint with the existing scripts-tier rule set, including the
  `local/type-assertion-boundary` block applied to the linted scripts
  subset.
- Findings before adoption: **0** ESLint findings. No code changes
  required. The file already conformed to the same standards as the
  sibling generator `scripts/generate-lint-guidance.ts` it pairs with.
- Why this file: it is the shared loader behind the PR 1 `meta.docs`
  contract enforcement and shares both producers (`generate-lint-guidance`)
  and tooling shape with an already-linted script. Mirroring coverage
  closes a one-file gap without expanding into broader script families.

## Inventory probe

```bash
bunx eslint scripts/lint-rule-docs.ts --no-warn-ignored
# (zero output, exit 0)
bun run lint -- --max-warnings=0
# (passed)
```

## Lint config changes

Three additions in `eslint.config.js`:

1. Exempt the file from the `scripts/**/*` ignore block:

   ```text
   "!scripts/lint-rule-docs.ts",
   ```

   placed immediately after the existing exemption for
   `scripts/generate-lint-guidance.ts` (line ~143).

2. Add the file to the `tsconfig.scripts.json` parser-options block
   (line ~940) so it picks up project-aware lint:

   ```text
   "scripts/lint-rule-docs.ts",
   ```

3. Add the file to the `local/type-assertion-boundary` rules block
   (line ~955) so it ratchets at `error` like sibling linted scripts:

   ```text
   "scripts/lint-rule-docs.ts",
   ```

No production code, tests, or other docs changed.

## Verification

- `bun run lint -- --max-warnings=0` passed.
- `bun run typecheck` passed (`tsc -b && tsc -p tsconfig.scripts.json`).
- `bun run test:scripts:changed` passed (5 smoke tests:
  generate-lint-guidance, generate-harness-controls, harness-check,
  lint-agent, lint-ratchet).

## Revisit triggers

- The next narrow file gap is `scripts/generate-harness-controls.ts`,
  which has a smoke test in `test:scripts:changed` and is a sibling
  consumer of `lint-rule-docs.ts`. Promote as a separate single-file
  leaf when a future slice picks it up.
- Broader script families (codemods, drift-ai, logs-audit, top-level
  utilities) remain parked in Leaf 19 and Leaf 11 until their inventories
  are tractable.
