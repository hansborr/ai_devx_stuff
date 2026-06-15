# PR-1 - PR diff-size warning (~300-line soft warn)

> **STATUS: DESIGN-GATED — DO NOT IMPLEMENT YET.**
> The mechanism is cheap; whether it earns its keep in a single-author repo is
> the open question. Do not promote during routine backlog draining.

## Problem

The harness research's central process finding (`17-team-process-and-org.md`,
and the overview thesis) is that human comprehension is the new bottleneck and
review quality degrades past roughly **300 changed lines**. The recommendation
is to shrink the unit of review: warn at ~300 lines, prefer small stacked
changes.

Musi has no diff-size signal — no CI step, no script, nothing in the PR
template. The new `harness-strictness-comprehension-2026-06/02` comprehension
prompt is the natural companion to this, but does not address size.

## Why this is design-gated

1. **Solo repo.** With one author/merger (≈2,772 commits, single contributor),
   a size warning is a *self-nudge*, not a reviewer-protection gate. That can
   still be valuable as discipline, but it is a weaker case than in a team and
   should be a conscious choice, not an automatic add.
2. **Legitimately large diffs are common here.** Prisma migrations, generated
   files (`scripts/verify/steps.generated.sh`, lockfile), codemod sweeps, and
   ratchet-baseline updates routinely exceed 300 lines for good reasons. A
   useful warning must exclude generated/vendored/migration paths or it cries
   wolf immediately.
3. **Warn vs block, and where.** A hard block would be hostile to the above; a
   soft warning needs a surface. Options: a non-blocking CI comment, a PR
   template reminder line, or a local pre-push note. Each has different
   value/noise.

## Open questions to answer before implementing

- Is a self-nudge worth any tooling in a solo repo, or is a single PR-template
  line ("If this diff is >~300 significant lines, say why / consider splitting")
  the right, near-zero-cost answer?
- What counts toward the line budget? (Definitely exclude lockfiles, generated
  files, migrations; probably exclude pure test fixtures.)
- Warn-only via CI comment, or template-only, or both?
- Does this overlap enough with the comprehension template (HC-1) that they
  should ship together as one "review-unit" change?

## Sketch (only after the above is decided)

- Lightest viable: add one line to `.github/pull_request_template.md` under a
  size/comprehension note. No tooling.
- If tooling is wanted: a non-blocking CI step that computes significant changed
  lines (excluding an ignore-glob) and posts/*updates* a sticky comment when
  over threshold. Reuse the existing sticky-PR-comment mechanism in `ci.yml`.

Do not implement until the warn-vs-template decision is made.
