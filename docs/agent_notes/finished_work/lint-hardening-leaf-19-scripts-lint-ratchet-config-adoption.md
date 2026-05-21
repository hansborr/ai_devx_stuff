# Leaf 19 Slice 3 Adoption: scripts/lint-ratchet-config.ts

Status: Resolved - verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-19-lint-ratchet-config.
Probe: temporary inclusion in `eslint.config.js` then full
`bun run lint` run.

Scope: extend ESLint coverage to one additional `tsconfig.scripts.json`
input — `scripts/lint-ratchet-config.ts`. The file is the central
configuration module for the custom lint ratchet (PR 4); it exports the
ratchet's allow/deny lists and the registered rule metadata used by
`scripts/lint-ratchet.ts` and `scripts/lint-ratchet-baseline.ts`.

## Resolution

- Verdict: **adopt full** — `scripts/lint-ratchet-config.ts` is now
  covered by ESLint with the existing scripts-tier rule set, including
  the `local/type-assertion-boundary` block applied to the linted
  scripts subset.
- Findings before adoption: **0** ESLint findings. No code changes
  required.
- Why this file: at 166 lines it is well under the `local/max-lines`
  300 ceiling, it has no function exceeding the complexity ceiling, and
  it is the configuration module for the now-PR-4-landed lint ratchet
  infrastructure. Mirroring coverage of the surrounding ratchet runtime
  (already partially linted via `scripts/code-intel/**` indirection)
  closes another small file gap.

## Inventory probe

```bash
bunx eslint scripts/lint-ratchet-config.ts --no-warn-ignored
# (zero output, exit 0)
bun run lint -- --max-warnings=0
# (passed)
```

## Lint config changes

Three additions in `eslint.config.js`:

1. Exempt the file from the `scripts/**/*` ignore block, after the
   existing `!scripts/lint-rule-docs.ts` exemption:

   ```text
   "!scripts/lint-ratchet-config.ts",
   ```

2. Add the file to the `tsconfig.scripts.json` parser-options block so
   it picks up project-aware lint:

   ```text
   "scripts/lint-ratchet-config.ts",
   ```

3. Add the file to the `local/type-assertion-boundary` rules block so
   it ratchets at `error` like sibling linted scripts:

   ```text
   "scripts/lint-ratchet-config.ts",
   ```

No production code, tests, or other docs changed.

## Verification

- `bun run lint -- --max-warnings=0` passed.
- `bun run typecheck` passed (`tsc -b && tsc -p tsconfig.scripts.json`).
- `bun run test:scripts:changed` passed (5 smoke tests:
  generate-lint-guidance, generate-harness-controls, harness-check,
  lint-agent, lint-ratchet).

## Revisit triggers

- The next narrow candidates are `scripts/lint-agent.ts` (332 lines, at
  the 300 `local/max-lines` ceiling), `scripts/harness-check.ts` (529),
  `scripts/lint-ratchet.ts` (846), and `scripts/lint-ratchet-baseline.ts`
  (880). All four likely surface `local/max-lines` and/or complexity
  findings and need explicit budget to either split or take a warn-only
  override — the same shape as slice 2's deferral.
- Broader script families (codemods, drift-ai, logs-audit, top-level
  utilities) remain parked in Leaf 19 and Leaf 11 until their
  inventories are tractable in feature-family slices.
