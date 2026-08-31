# 85. The 177-key package-script surface has no contributor-facing command catalog — its only documentation is a raw manifest dump, and 22 root scripts are described nowhere

Status: Landed on fix/cq-085
Theme: command-surface discoverability · Area: docs · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The repo's command surface is 177 package-script keys across six tracked
manifests — 147 of them in the root `package.json` alone — and the only
"reference" for the specialist majority is an instruction to print the raw
script object: README's "Specialist / CI tooling" section says the remaining
scripts "are CI and maintenance machinery — use
`bun --cwd="$(git rev-parse --show-toplevel)" pm pkg get scripts` to list every
script. See `AGENTS.md` for the non-obvious ones." A raw `scripts` dump conveys
none of what a contributor actually needs at lookup time: what a command is
for, who it is for, whether it mutates anything (check vs repair vs generator
vs lifecycle hook), which package/cwd it must run from, or which guide owns it.
AGENTS.md documents only a hand-picked "non-obvious" subset, and the gap at the
bottom is total: 22 root script keys are never genuinely mentioned in any
onboarding doc, guide, or tracked README — 20 of them never appear even as a
substring. A contributor who encounters `verify:async:status` or
`harness:hook-timeouts:check` in a hook error or a generated file has nowhere
to look but the script's own shell source.

The repo already has the machinery this problem wants: `harness.controls.json`
describes 179 controls with `invocation`, `kind`, `source`, and `pairedGuide`
fields, doc-generators built on `scripts/lib/doc-generator.ts` emit committed
pages under `docs/generated/` with freshness wired into `harness:check`, and a
script-parity check already forces every *prefix-convention* root script to be
declared, aliased, or exempted. What is missing is the last mile: turning that
metadata into a grouped, human-readable catalog, and extending the parity rule
so the 22 undocumented keys — and every future script — cannot exist without a
purpose line. For a repo meant to be copied as a harness-engineering
reference, the command surface is the front door, and right now it is a wall
of 147 unlabeled keys.

## Evidence

- `package.json:22-170` — the root manifest's `scripts` object: 147 keys in
  one undifferentiated block (count re-derived from the pinned tree).
- 177 script keys across the six tracked manifests (`git ls-files` shows
  exactly six `package.json` files): root 147, `packages/server` 17,
  `examples/lint-ratchet-demo` 8, `packages/client` 3, `packages/shared` 2,
  `tools/lint-ratchet` 0 — so 30 non-root keys.
- `README.md:128-133` — the "Specialist / CI tooling" section documents the
  entire non-everyday surface by pointing at the raw
  `bun --cwd="$(git rev-parse --show-toplevel)" pm pkg get scripts` dump plus
  "See `AGENTS.md` for the non-obvious ones". The same dump tip appears at
  `README.md:86` and `AGENTS.md:13`.
- 20 root script keys have zero occurrences — even as substrings — anywhere in
  AGENTS.md, CLAUDE.md, README.md, `docs/**` (excluding `docs/agent_notes/`),
  or any tracked README (re-derived with per-key fixed-string `git grep` over
  that corpus). Examples: `code:intel:perf`, `test:slow`, `test:client:split`,
  `harness:hook-timeouts:check`, and all five `verify:async:*` keys
  (`changed`/`slow`/`status`/`tail`/`stop`). Two more keys appear only inside
  longer tokens, never as themselves — `format:changed` only within
  `format:changed:check` (e.g. `docs/generated/harness-controls.md:1090`) and
  `concurrency:relation-graph:check` only within
  `package-script:concurrency:relation-graph:check`
  (`docs/adr/0007-runtime-guarded-mutation-boundaries.md:10`) — for 22 keys
  with no genuine mention under exact-token matching.
- `harness.controls.json` — top-level keys are `$comment`,
  `scriptParityExemptions` (31 entries), `ciGateControlIds`, and `controls`
  (179 entries); control records carry `invocation`, `kind`, `source`,
  `pairedGuide`, and `generatedSurface.checkScript` already encodes the
  writer/check pairing. The metadata substrate for a catalog largely exists.
- `scripts/harness/registration-manifest-checks.ts:26-27` —
  `CONTROL_PREFIX_PATTERN` limits script parity to twelve prefixes
  (`sensor|verify|codemod|drift|logs|doctor|module|docs|db|worktree|harness|lint`).
- `scripts/harness/harness-gate-parity.ts:47` — the parity loop `continue`s
  past every root script that does not match the prefix pattern, so `dev`,
  `build`, `e2e:*`, `test:*`, `check:*`, `typecheck:*`, and `format:*` are
  invisible to it; non-root manifests are not scanned at all. Lines 37-44
  implement the "redundant alias-covered exemption fails" rule the extension
  below must preserve.
- `scripts/lib/doc-generator.ts` plus `docs/generated/` (currently
  `harness-controls.md`, `lint-coverage-map.md`, `local-lint-rules.md`,
  `observed_flaky_tests.md`) — the established generated-doc family, each with
  a `--check` twin and freshness wired into `harness:check`
  (`scripts/harness-check.ts:1-17` lists the parity and freshness guarantees).

## Proposed direction

Build the catalog as a generated doc in the existing doc-generator family,
single-sourced from `harness.controls.json` — not a new standalone data file
(preferring the manifest also avoids a new
`eslint-config/config-surface-manifest.json` declaration; if a separate
committed data file is nonetheless added, it must be declared there and the
generator rerun).

1. **One dataset, two metadata sources.** Union: (a) rows derived
   automatically from existing controls — each already carries
   `invocation`/`kind`/`source`/`pairedGuide`, and
   `generatedSurface.checkScript` already encodes writer/check pairing; (b) a
   new top-level catalog section in `harness.controls.json` holding an entry
   for every script key *not* reachable from a control: the current 31
   `scriptParityExemptions` scripts, the non-prefix root scripts (`dev`,
   `build`, `e2e:*`, `test:*`, `check:*`, `typecheck:*`, `format:*`,
   `prepare`, `postinstall`, …), and the 30 non-root scripts in the other five
   tracked manifests. Each entry is keyed by (manifest, scriptKey) and carries
   a one-line purpose, an audience/function group, a side-effect class
   (check | repair | generator | CI primitive | lifecycle | dev utility), the
   required cwd/package invocation form, and an optional owning-doc pointer.
   Writer/check relationships must be *derived* (from
   `generatedSurface.checkScript` aliases and the `X` / `X:check` naming
   convention), never hand-entered.
2. **Generator and registration.** A generator
   (`scripts/harness/generate-command-catalog.ts`, built on
   `scripts/lib/doc-generator.ts`) emits `docs/generated/command-catalog.md`
   grouped by audience/function. Register it exactly like the other
   doc-generators — registration is single-sourced: add ONE doc-generator
   control with a `generatedSurface` facet (checkScript
   `docs:command-catalog:check`, a new script) to `harness.controls.json` and
   rerun `bun run verify:steps`; the closure validator and parity aliases
   catch misses. Do not hand-edit `scripts/verify/steps.generated.sh`. This
   wires freshness into `bun run harness:check` for free.
3. **Completeness rule.** Extend the script-parity check
   (`scripts/harness/harness-gate-parity.ts`) with a generalization of the
   current prefix-only rule: every script key across the six tracked
   `package.json` manifests must have exactly one metadata source
   (control-derived or catalog entry), so any new script fails
   `bun run harness:check` until it gets a purpose line. This is what closes
   the undocumented-keys gap permanently. Make sure a `checkScript` alias
   counts as covered exactly once so the existing "redundant alias-covered
   exemption fails" invariant (`harness-gate-parity.ts:37-44`) keeps holding.
4. **Pointers.** Replace the raw `pm pkg get scripts` dump instruction in
   README's "Specialist / CI tooling" section (`README.md:128-133`) with a
   link to the generated catalog (the `pm pkg` command can stay as a listing
   tip), and add a pointer to the catalog in `docs/ai-harness.md`'s harness
   inventory.

The 22 zero-mention root keys in Evidence are the acceptance sample: each must
end up with a genuine purpose line, not a restatement of its key name. Judge
grouping and field choices on copyability for outside harness adopters — the
catalog page should read as a template another repo could adopt.

## Scope / caveats

- **Out of scope:** renaming, pruning, or restructuring any script; changing
  `scriptParityExemptions` semantics beyond optionally deriving it from (or
  cross-checking it against) the new catalog section; the scripts/-directory
  layout inventory (see prior-pack ref below); and rewriting AGENTS.md prose —
  its non-obvious-commands section stays, optionally gaining a catalog link.
- **The metadata pass is the real work.** Only key-completeness is
  machine-checkable; the one-line purposes and side-effect classes are prose
  that can rot or be backfilled with shallow key-name restatements across the
  147+ keys. Budget genuine effort for the population pass, not just the
  plumbing, and use the 22-key acceptance sample to check it.
- **Schema/validator blast radius.** Extending `harness.controls.json` touches
  its schema validation (`scripts/harness/control-field-validation.ts`, the
  manifest loader) and the parity logic in `scripts/harness-check.ts` /
  `harness-gate-parity.ts`. A wrong completeness rule could either
  double-count `checkScript` aliases or force redundant entries that the
  existing redundant-exemption rule then rejects — the alias-counted-once
  requirement in step 3 is the guard.
- **Authority, not a third divergent copy.** The catalog becomes a third
  command-description surface (alongside README tables and AGENTS.md prose);
  it must be clearly declared the authority, with the others linking to it,
  or the surfaces will diverge.
- **Prior pack:** CQ25-37 — plan slice 28.4 of the live 2026-07-25 pack's
  [28-scripts-layout-families.md](../code-quality-2026-07-25/28-scripts-layout-families.md)
  — inventories the direct children of the `scripts/` *directory* for layout
  governance and also wires into `harness:check`, but its data and checks are
  disjoint from this leaf's package-command surface. Land in any order; do not
  re-scope either into the other.
- **Sequencing:** no hard ordering edges.
  [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md)
  covers the lint-ratchet CLI's own command catalog — an independent CLI
  stack whose fix shares no artifacts with this leaf.
- The zero-mention measurement counts 20 keys absent even as substrings plus 2
  substring-only appearances (22 total under exact-token matching); any
  re-measurement should state its matching rule, since the corpus contains
  keys embedded in longer command names.
