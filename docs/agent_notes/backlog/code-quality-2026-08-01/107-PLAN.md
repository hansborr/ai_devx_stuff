# 107-PLAN. AI-hook command policy: declarative rules + bounded parser modules

Status: **Finished — all five slices landed**, each on its own lane branch
(`fix/cq-107-S0` through `fix/cq-107-S4`), executing the Proposed direction of
[`107-ai-hook-policy-2121-line-shell-parsing.md`](./107-ai-hook-policy-2121-line-shell-parsing.md)

Date: 2026-08-02 · Area: harness · Source leaf: 107 (XL, sliced to M / M-L / S)

## Scope decision (fixed at synthesis)

Behavior-preserving decomposition of `scripts/ai-hooks/policy.sh` (1,413
lines) and `scripts/ai-hooks/common.sh` (708 lines). Enforcement stays
bash+awk+jq end to end. Nothing is reimplemented: parser code moves verbatim
into bounded modules behind an unchanged `policy.sh`/`common.sh` sourcing
façade, so the existing shell corpus (`scripts/ai-hooks/test.sh`, 4,457 lines,
plus nine `test-*.sh` siblings and the sibling `test-support.sh` helper — 8,939
lines total) is the parity gate for every slice, with no dual-run machinery.
The eight binding rulings in the leaf's Scope section govern all slices; the
typed TS core is out of this plan entirely.

Corpus-green invariant, every slice: `bash scripts/ai-hooks/test.sh` passes
with zero test-file edits in the same commit as a code move; test-family
extraction remains owned by prior-pack
[code-quality-2026-07-25/27-PLAN.md](../code-quality-2026-07-25/27-PLAN.md)
slices 27.4–27.7 (CQ25-30).

## Slices

Each slice is one agent session and lands on its own with full gates.
Flags: **[G]** changes generated harness/subject/doc output.

| # | Slice | Done when | Verify |
|---|---|---|---|
| S0 **[G]** | **Rule data → manifest (leaf Slice A, part 1: data + generator).** Add a `commandPolicy` facet to `harness.controls.json` — one record per hard-deny rule with `{id, order, class, patterns[]\|predicate, message, scope}` — seeded 1:1 from the 19 message-emitting branches of `ai_policy_violation_reason` (`policy.sh:1059-1213`) and the message constants at `policy.sh:11-31`. Put Claude-native projection metadata on those same records, orthogonal to `patterns[]\|predicate`: every context-free hard deny that is representable natively supplies its matcher strings plus a reason when that projection is necessarily partial, while every other row supplies an explicit non-projection reason. Contextual rows — including stash and every other rule whose shared-policy context or reason would be preempted by native denial — remain shared-policy-only and are marked as intentional non-projections. Add a `scripts/harness` generator rendering `scripts/ai-hooks/policy-rules.generated.sh` (model: the generator behind `classified-bun-scripts.generated.sh`, sourced at `policy.sh:39`), register its generatedSurface facet, and source the fragment from `policy.sh`. The same generation/check path flattens only projected matcher lists, in rule and matcher order, into the expected `.claude/settings.json` `permissions.deny` array and freshness-checks the committed array through the existing localized settings scanner; it does not create a second policy registry or introduce `jsonc-parser`. The dispatcher is NOT rewired yet — the fragment ships alongside the constants it will replace, byte-equal messages asserted by the generator's own test. | Facet + generator + fragment landed and registered; `policy.sh` sources the fragment; messages byte-identical to the `:11-31` constants; projection metadata is total over all command-policy rows; the expected native deny array is derived only from projected rows and `.claude/settings.json` is freshness-checked against it; every partial projection and non-projection has a reason, including stash and all other context-sensitive exclusions | `bash scripts/ai-hooks/test.sh`; `bun run verify:steps`; `bun run verify:steps:check`; `bun run harness:check` |
| S1 | **Rule loop (leaf Slice A, part 2: dispatcher).** Collapse `ai_policy_violation_reason` into a generic ordered loop over the generated rule rows: pure-pattern rows match via the existing `ai_policy_has_command` helper; `predicate` rows call the named shell functions (hook-bypass flags, protected-file writes, dangerous reset, worktree loss, stash, push-to-main, commit-on-main), which keep their bodies unchanged. Delete the superseded inline constants/branches. Replace the family-only Claude parity classifier (`scripts/ai-hooks/test.sh:174-301`) and the one-off stash exclusion (`scripts/ai-hooks/test.sh:515-522`) with record-level projection coverage driven by the same `commandPolicy` records: every native matcher maps to its projected rule and a shared-policy fixture, every intentional non-projection remains absent from the native array, and fixtures preserve the contextual shared-policy reason, with stash pinned explicitly. Render a policy-reference table into `docs/generated/harness-controls.md` from the same records, including each rule's native matcher projection and any partiality reason, or its explicit non-projection reason. Update `scripts/ai-hooks/README.md` + `docs/ai-harness.md` in the same commit. | If-chain replaced by data-driven loop; rule order and every message unchanged (corpus proves it); generated docs table lists every rule id and projection disposition, including necessary partiality; record-level parity covers every projected matcher and every intentional non-projection; stash and all other context-sensitive exclusions remain native-absent so shared-policy reasons are not preempted | `bash scripts/ai-hooks/test.sh`; `bun run docs:harness-controls`; `bun run docs:harness-controls:check`; `bun run harness:check` |
| S2 | **Module decomposition (leaf Slice B, part 1: code moves).** Extract, verbatim-with-comments: `command-normalize.sh` (spec comment + awk heredoc stripper, `policy.sh:248-556`, with a "copy verbatim; spec = header comments + corpus" banner), `command-paths.sh` (tokenizer cluster `policy.sh:733-965`), `git-classify.sh` (git lexer/target/verdict helpers `common.sh:98-470` **and** `policy.sh`'s git predicates incl. `ai_is_git_commit_cmd` `:1247`, preserving the `common.sh:206-219` asymmetry comment verbatim), `policy-eval.sh` (rule loop + decision emission). `policy.sh` and `common.sh` become façades sourcing the modules — every existing sourcer (`bash-pre-tool-use.sh:14-19` etc.) and all test files are untouched. Update README/ai-harness.md in the same commit. | All four modules exist; `policy.sh`/`common.sh` are source-only façades plus what genuinely remains; zero test-file diffs; zero hook-entrypoint diffs | `bash scripts/ai-hooks/test.sh`; `bun run test:scripts`; `bun run harness:wiring:check`; `bun run harness:check` |
| S3 | **Complete `common.sh` shrink (leaf Slice B, part 2).** Prior-pack CQ25-30 ([code-quality-2026-07-25/27-PLAN.md](../code-quality-2026-07-25/27-PLAN.md)) slices 27.4–27.7 already own splitting `test.sh` into the command-policy, backlog-note-lint, commit/worktree/queue, and failure-guidance/output-filter families; do not duplicate that work here. Move only remaining non-adapter helpers out of `common.sh` toward its documented role (`common.sh:3-4`), and repoint already-split suites if needed. | `common.sh` contains only adapter-shared helpers and façade sources; any prior-pack-created family suites still run through the aggregate unchanged | `bash scripts/tests/test-ai-hooks.sh`; `bun run test:scripts`; `bun run harness:check` |
| S4 | **Decision-record boundary (leaf Slice C).** One boundary function in `policy-eval.sh` returning `(verdict: block\|advise\|allow, ruleId, message)`; `ai_preflight_or_block` and the hook adapters consume it. `advise` maps to the (currently empty) soft-guidance class — no rule changes class in this slice. Document the record shape in README/ai-harness.md as the interface any future typed model must match. | Hooks consume the record; observable JSON emissions unchanged (corpus proves it) | `bash scripts/ai-hooks/test.sh`; `bun run harness:check` |

## Dependency edges

- `S0 → S1 → S2 → S3 → S4` — strictly sequential; each slice's parity claim
  assumes the previous landed shape.
- Manifest coordination: S0 edits `harness.controls.json`; do not run
  concurrently with
  [114-harness-controls-represented-competing.md](./114-harness-controls-represented-competing.md) /
  [116-generated-surface-dependencies-manually.md](./116-generated-surface-dependencies-manually.md) /
  [125-manifest-copies-verify-slot-programs-across.md](./125-manifest-copies-verify-slot-programs-across.md) /
  [126-hook-wiring-repeats-adapter-templates-leaves.md](./126-hook-wiring-repeats-adapter-templates-leaves.md)
  (see [107-ai-hook-policy-2121-line-shell-parsing.md](./107-ai-hook-policy-2121-line-shell-parsing.md)
  Scope). If
  [114-harness-controls-represented-competing.md](./114-harness-controls-represented-competing.md)
  lands a new facet model first, S0 adopts it.
- Docs: every seam updates `scripts/ai-hooks/README.md` and
  `docs/ai-harness.md` in the same commit — no trailing docs slice exists.

## Operational risk

1. **This is the fail-closed command gate for every agent Bash call.** A
   broken `policy.sh` blocks the session that would fix it. Mitigations:
   façade keeps all entry symbols; each slice is corpus-green before commit;
   the generated fragment is committed bytes, and native expected-array
   generation/freshness checks run only in harness tooling (no runtime
   generation in the deny path, no runtimes beyond bash/awk/jq/git — binding
   ruling).
2. **S1 is the only behavior-shaped slice.** The loop must preserve rule
   *order* (first match wins — e.g. protected-file check `:1098` fires before
   the amend rule `:1105`). `order` is an explicit facet field; the generator
   test asserts the rendered order equals the manifest order. Native
   projection must not erase a contextual shared-policy reason: S1's
   record-level fixtures assert every intentional non-projection, especially
   stash, stays absent from the native deny array.
3. **Hook shims must not drift.** The entrypoints are byte-compared generated
   projections (`README.md:7-18`); S2's zero-hook-diff "done when" plus
   `bun run harness:wiring:check` guards this.
4. **Prior-pack coordination:** CQ25-30
   ([code-quality-2026-07-25/27-PLAN.md](../code-quality-2026-07-25/27-PLAN.md))
   slices 27.4–27.7 own the test-family extraction; S3 must consume that landed
   shape or avoid touching `test.sh`.
5. **Latency**: hooks source one more file per module split. Sourcing is
   cheap relative to the ruled-out bun spawn
   (`arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md:91-97`), but
   keep the module count at the four named — no deeper nesting.

## Rejected alternatives + why

| Rejected | Why |
|---|---|
| Bun/TS enforcement core (the original sketch's destination) | Puts bun in the fail-closed deny path of a hook firing on every Bash call — broken bun would block the commands needed to fix bun. Destroys bash+awk+jq copy-anywhere universality a public reference harness trades on. Binding ruling. |
| Porting/tuning the awk heredoc stripper or tokenizers | Their conservative semantics are load-bearing and specified only by header comments + the 8,939-line corpus; a port needs dual-run machinery the façade approach makes unnecessary. Binding ruling. |
| Thinning hook entrypoints | Already generated thin projections; the fusion is in the shared bodies. Binding ruling. |
| One XL land | Un-reviewable on a safety surface; the three-part sequence keeps every intermediate tree corpus-green and independently revertable. Binding ruling. |
| In-shell rule table without the manifest facet | A throwaway intermediate — the repo-idiomatic home for rule data is `harness.controls.json` + generated projection, already sourced by this exact file (`policy.sh:39`). |
| Independent Claude-native policy registry | Preserves two policy authorities and synchronized edits. Native matcher lists and explicit non-projection reasons belong on the same S0 `commandPolicy` records as the shared rule. |
| Project every hard deny into Claude native permissions | Native denial happens before the shared hook can supply contextual policy. Stash and every other rule whose shared-policy context or reason would be preempted must remain explicit, parity-covered non-projections. |
| Replace the localized settings scanner with `jsonc-parser` | Prior-pack [code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md) CQ25-129 already rejected that dependency and rewrite. Extending the existing policy authority's expected-array freshness check does not reopen it. |
| Enforcing typed simulator in CI now | Sanctioned only as a conditional follow-up (non-enforcing explain/simulator dual-run against the corpus), after S4's decision record fixes the interface it must match. |
