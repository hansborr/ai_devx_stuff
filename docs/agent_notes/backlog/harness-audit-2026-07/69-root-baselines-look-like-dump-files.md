# 69 — Root baselines look like dump files

Status: Done
Track: DOC (docs) · Priority: P3 · Size: XS

> **Amended — 2026-07-13 adversarial triage.** README already links the ratchet guide, so the remaining delta is only to name the three root baseline files as intentional committed floors.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `.gitignore:20` and `.gitignore:74-77` — transient `tmp/`, reports, and test results are correctly ignored.
- `lint-ratchet.baseline.json:1-30` — the root commits per-file lint debt as policy data.
- `sensor-knip-unused-exports.baseline.json` and `eslint-config/max-lines-exceptions.baseline.json` are also intentional root floors.
- `README.md:114` — Quality Gates already links the ratchet guide but does not name these files.

Failure: A public-repo scan can read the committed baselines as stray build output until the reader finds deeper ratchet documentation.

## Do

Add one README Quality Gates bullet naming the three baseline files as intentional committed floors and retain the existing ratchet-guide link.

## Verify

```
rg -n "lint-ratchet\.baseline|sensor-knip-unused-exports|maximum-lines|max-lines-exceptions" README.md
```

## Acceptance

- README names all three root baseline files and their policy role.
- The wording distinguishes committed floors from ignored runtime output.
