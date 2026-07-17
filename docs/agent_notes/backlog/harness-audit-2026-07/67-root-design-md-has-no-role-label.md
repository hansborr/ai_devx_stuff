# 67 — Root `DESIGN.md` has no role label

Status: Done
Track: DOC (docs) · Priority: P3 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** The file is a product UI token system, is grouped with root guidance in the coverage map, and appears in neither first-contact index. A one-line role label is sufficient.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `DESIGN.md:1-7` — content defines a dark-fantasy, dark-only product UI token system.
- `docs/generated/lint-coverage-map.md:427` — the file is grouped with root guidance.
- `README.md` Project Structure and `docs/README.md` topic index do not identify its role.

Failure: A root listing mixes product design guidance into the harness reference without telling first-contact readers that it is unrelated to copyable harness policy.

## Do

Add one concise README or docs-index entry labeling `DESIGN.md` as VTT UI-token guidance, not part of the copyable harness. A move is unnecessary unless broader docs organization work calls for it.

## Verify

```
rg -n "DESIGN.md|UI tokens|copyable harness" README.md docs/README.md
```

## Acceptance

- At least one first-contact index labels `DESIGN.md` as product UI guidance.
- The label distinguishes it from harness policy.
