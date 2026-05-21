# Lint-hardening review follow-up — PR 1: Local Lint Rule Contract

Branch: `feature/lint-hardening-review-followup`
Landed: 2026-05-17
Commit: `acee0f7f feat(lint): enforce meta.docs contract for local ESLint rules`
Supersedes: Leaf 25 (`backlog/lint-hardening/25-diagnostic-rule-metadata.md`)

## Outcome

All 18 `local/*` ESLint rules now carry a structured `meta.docs` contract
(`description`, `principle`, `category`, `pairedGuide`, `repairKind`,
`repairCommand` iff codemod). The generator validates the contract on every
run; the regenerated `docs/generated/local-lint-rules.md` is grouped by
category so an agent reading a diagnostic can navigate to the paired guide
and repair path. `message-guidance.test.js` now enforces both the metadata
contract and the `Why: ... How to fix: ...` diagnostic shape on every rule,
gated by a narrowly-scoped exempt set.

`bun run verify:changed` exited 0 (lint, typecheck, test, scripts) on the
committed snapshot.

## Rule metadata table (as-landed)

| Rule | Category | Paired guide | Repair |
| --- | --- | --- | --- |
| `concurrency-guard` | behavior | `add-race-sensitive-mutation.md` | codemod (`codemod:concurrency-guard`) |
| `e2e-prefer-role-selectors` | maintainability | `add-e2e-test.md` | manual |
| `max-lines` | maintainability | `local-eslint-rules.md` | manual |
| `no-async-array-callbacks` | behavior | none | manual |
| `no-barrel` | architecture-fitness | `local-eslint-rules.md` | codemod (`codemod:expand-barrel`) |
| `no-broadcast-in-transaction` | behavior | `add-socket-broadcast.md` | manual |
| `no-explicit-any` | maintainability | `local-eslint-rules.md` | manual |
| `no-llm-artifacts` | maintainability | `local-eslint-rules.md` | manual |
| `no-swallowed-errors` | behavior | `local-eslint-rules.md` | manual |
| `socket-registry-broadcasts` | behavior | `add-socket-broadcast.md` | manual |
| `strict-shared-schemas` | architecture-fitness | `add-trpc-procedure.md` | autofix |
| `strict-trpc-input` | architecture-fitness | `add-trpc-procedure.md` | manual |
| `structured-logging` | maintainability | `local-eslint-rules.md` | codemod (`codemod:structured-logging-fix`) |
| `test-file-location` | maintainability | none | manual |
| `trpc-require-output-schema` | architecture-fitness | `add-trpc-procedure.md` | manual |
| `trpc-shared-input-schema` | architecture-fitness | `add-trpc-procedure.md` | codemod (`codemod:trpc-shared-input`) |
| `trpc-shared-output-schema` | architecture-fitness | `add-trpc-procedure.md` | codemod (`codemod:trpc-shared-output`) |
| `type-assertion-boundary` | maintainability | `local-eslint-rules.md` | manual |

## Decisions worth preserving

- **Category vocabulary is fixed at three values.** `maintainability`,
  `architecture-fitness`, `behavior`. These match `docs/ai-harness.md`'s
  authoritative table (lines 84–96) and are validated identically in the
  generator and the test (`ACCEPTED_CATEGORIES`). Adding a fourth requires
  changes in both places — `as const` arrays in the generator are
  intentionally not exported because the test should not collapse onto the
  generator's source of truth (defence in depth against a single typo
  silently widening acceptance).
- **`pairedGuide: "none"` is the explicit absence marker.** A blank string
  or missing field is rejected. Two rules currently use `"none"`:
  `no-async-array-callbacks` (no dedicated guide) and `test-file-location`
  (the rule itself is the canonical reference; pointing it at any of the
  existing guides was misleading during review).
- **`strict-shared-schemas` paired guide kept at `add-trpc-procedure.md`**
  even though the rule fires outside tRPC files too. The mapping matches
  `docs/ai-harness.md`'s established pairing and the autofix repairs land
  in the right place either way; carving out a second guide for this rule
  is more churn than signal.
- **`strict-trpc-input` is `architecture-fitness`, not `behavior`.** Symmetry
  with `strict-shared-schemas`: both rules enforce explicit unknown-key
  policy on the API contract surface. Treating one as `behavior` and the
  other as `architecture-fitness` would split a single architectural rule
  across two doc sections.
- **`structured-logging` is `maintainability`, not `behavior`.** The rule
  enforces log-aggregation hygiene (static messages with structured fields)
  — it doesn't catch a runtime correctness bug. Reclassified to match the
  ai-harness table.
- **`type-assertion-boundary` is `maintainability`.** Type-system hygiene
  is closer to maintainability (assertions hide bugs at the typechecker
  layer) than to runtime behavior. Same logic as `no-explicit-any`.
- **Generator validates `pairedGuide` with `existsSync` against repoRoot.**
  Catches typos and renamed guides at generation time, not as broken
  markdown links discovered later. The `"none"` literal escapes this check.
- **Generator rejects `repairCommand` unless `repairKind === "codemod"`.**
  Symmetric requirement: a codemod rule must carry the command, and any
  other rule must not. Prevents drift where `repairCommand` is set on a
  manual rule but no script exists.
- **`message-guidance.test.js` exempt set is grouped by reason, not by
  rule.** Three groups: (1) one-line policy reminders where the diagnostic
  IS the rule (no useful "Why" beyond restating); (2) `no-barrel/noBarrel`
  where the repair is the codemod command and prose would just restate it;
  (3) existing narrative diagnostics whose wording predates the Why/How
  convention — rewriting them is a separate sweep tracked outside PR 1's
  scope. Comment in the file explains each grouping so a future reader
  doesn't read it as a TODO list.
- **`scripts/test-scripts.sh` smoke subjects widened to directory prefix
  `eslint-rules/`** for the `test-generate-lint-guidance` smoke. Listing
  the three rules currently exercised by the generator was a codex review
  [P2] finding — any of the 18 rules can affect the rendered output, so
  the smoke must re-run on edits to any of them, plus the fixture dir.

## What this enables

- **PR 2 (Harness Manifest)** can read `category` / `pairedGuide` /
  `repairKind` directly off the validated rules instead of duplicating the
  table in markdown. The manifest schema's rule section becomes a thin
  re-projection of `meta.docs`.
- **PR 3 (Machine-Readable Diagnostics)** can map a diagnostic's `ruleId`
  to its repair path (kind + optional command) deterministically without
  parsing prose.

## Verification (as-committed)

```
bun run vitest run --project=eslint-rules    # 20 files, 26 tests passed
bun run docs:lint-guidance                   # regenerated
bun run docs:lint-guidance:check             # up to date
bun run lint -- --max-warnings=0
bun run typecheck
bun run verify:changed                       # 204s, OK — lint typecheck test scripts
```

## Out of scope (deliberate)

- Rewriting the existing narrative diagnostics on `no-async-array-callbacks`,
  `no-swallowed-errors`, `socket-registry-broadcasts`, `strict-shared-schemas`,
  `strict-trpc-input`, `trpc-require-output-schema` to the canonical Why/How
  shape. They're listed in the exempt set; a separate Tier 3 sweep can
  visit them once the contract is stable.
- Adding new local rules or changing rule behavior.
- Sensor manifest metadata — that's PR 2.
- The `repairKind: "suggestion"` path is declared in the vocabulary but no
  rule currently uses it. Validated end-to-end via the fixture but no
  real-rule example yet.
