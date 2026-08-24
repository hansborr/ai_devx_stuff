# 220. Add a joined explain view for harness control provenance

Status: Landed on fix/cq-220
Theme: Harness provenance remains split across non-joinable views · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: medium

## Problem

The harness records controls, package scripts, generated surfaces, verify
slots, hooks, smoke subjects, and changed-path policy, but exposes them through
separate validation and inventory surfaces. A maintainer starting with a path
or script name cannot ask which controls govern it, why a smoke test is
selected, which hook or verify slot consumes it, or which generated outputs
must remain fresh.

That missing join turns routine harness work into a manual correlation exercise
across code, manifest data, generated documentation, and path policy. It also
makes omissions difficult to distinguish from intentional absence: each
existing view can be internally correct while the maintainer still lacks an
end-to-end explanation of the governing chain.

## Evidence

- `scripts/README.md:126-140` — adding or moving a script requires manually
  correlating smoke coverage, path policy, package scripts, manifest metadata,
  and prose references.
- `scripts/harness/registration-check.ts:19-30` — the registration result
  exposes failures, parsed manifest state, and generated-surface records, but
  no query result keyed by a path, control, or package script.
- `scripts/harness/registration-check.ts:66-80` — the shared API runs
  registration validation and returns its aggregate state; its only secondary
  surface reduces that result to failures.
- `scripts/path-policy/path-policy-query-core.ts:136-154` — changed paths are
  reduced to selected smoke-test names after matching smoke subjects, without
  returning the matched subject or joining the result to controls, slots,
  hooks, or generated outputs.
- `docs/generated/harness-controls.md:3-8` — the generated authoritative view is
  a kind-grouped control inventory projected from the manifest, not a query
  keyed by an input path or package-script name.
- `package.json:135-136` — `harness:registration:check` and `harness:check`
  already provide registered entrypoints that can host a read-only mode.

## Proposed direction

Add a read-only `--explain` mode to the existing
`harness:registration:check` entrypoint rather than registering another
command. Accept an explicitly typed selector for a repository path, control
ID, or package-script name, plus a text/JSON output choice so names that happen
to overlap cannot be interpreted heuristically.

Build one query model from the existing parsed manifest/registration state and
path-policy authorities. For each match, report the reason it matched and the
applicable control ID, invocation or script, smoke subject and selected smoke
test, verify slot or hook relation, and generated trigger, fixture, and output
paths. Preserve distinctions when a query has several matches rather than
collapsing them into one inferred owner.

Make text and JSON deterministic: define a versioned JSON shape, use stable
field names, sort records and nested values by declared identifiers, and
represent an authoritative empty result explicitly. Keep ordinary
registration-check behavior and exit codes unchanged when `--explain` is
absent.

Add focused coverage at three seams:

1. Query-model tests using injected manifest and path-policy fixtures.
2. CLI tests for each selector kind, text/JSON parity, malformed selectors, and
   deterministic ordering.
3. A non-vacuity fixture that introduces a unique control, path, script, slot,
   and generated output and proves each query direction discovers it without
   adding those answers to a production allowlist.

## Scope / caveats

- Do not create the separately registered provenance command rejected during
  triage. The mode belongs to an existing registration/check entrypoint.
- Do not add a second manifest or hand-maintained join table. Relations must be
  derived from `harness.controls.json`, parsed registration state, package
  scripts, and existing path-policy/smoke-subject authorities.
- Discovery must be independent of any allowlist used to validate completeness.
  Tests may state expected fixture results, but production discovery cannot
  enumerate the same expected paths, controls, or scripts as a parallel source
  of truth.
- [085-specialist-package-script-surface-has-no.md](./085-specialist-package-script-surface-has-no.md)
  proposes a command-keyed catalog; consume its metadata if available, but do
  not turn that generated documentation into the explain engine's authority.
- [094-two-documents-both-claim-be-authoritative.md](./094-two-documents-both-claim-be-authoritative.md)
  settles which inventory is authoritative but does not provide a joined query.
  Preserve that authority model.
- [152-path-policy-query-core-closed-over-musis.md](./152-path-policy-query-core-closed-over-musis.md)
  refactors path-policy ownership while explicitly preserving query results. If
  it lands first, build against its injected engine; neither proposal should
  expand the other's result contract implicitly.
- No prior-pack record supplies this joined provenance view.
