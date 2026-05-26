# Path Policy Data Model

Status: Done
Order: 14

## Context

After the inventory, Musi needs one reviewed data model for maintained lint,
format, source-relevance, config, shell, and script-smoke surfaces. This task
defines the shared data shape only; the shell interface and caller migrations
remain separate leaves so the first implementation stays reviewable.

## Scope

- Define the shared data shape for lintable extensions, source-relevant paths,
  full-scan triggers, config/shell surfaces, script-smoke subject paths, and
  format-check files.
- Add the initial data source in the smallest module/script shape that later
  shell callers can consume.
- Keep the data descriptive. Do not encode staged/base/untracked/deletion
  behavior here.
- Add focused tests or fixtures for data validation, including JSON/JSONC
  classification and representative full-scan trigger entries.

## Definition Of Done

Adding a maintained config surface or lintable extension can be represented in
one data source before any caller migration begins.

## Verification

- Data-model tests or fixture smoke
- `bun run test:scripts:changed`
- `bun run verify:changed`

## Implementation Note

Shared data should cover descriptive path classes: lintable extensions,
lint-affecting full-scan trigger paths, maintained shell/config surfaces,
source-relevant paths, format-check candidate surfaces, script-smoke subject
paths, directory-prefix subjects, and deletion classes such as `.husky/*` and
`scripts/*`.

Caller-specific behavior should stay out of the data model: staged versus
base/working-tree selection, whether untracked files are rejected, ignored, or
included, deletion fallback behavior, missing-base fallback behavior, NUL versus
newline transport, write versus check formatting mode, env override semantics,
marker/fingerprint behavior, and each caller's output and exit-code wording.
