# 107. The AI-hook command policy is a 2,121-line bespoke shell-language analyzer fused into two shared files, and every rule change taxes several private parsers

Status: Landed on fix/cq-107-S4
Theme: Declarative policy over bespoke parsers · Area: harness · Severity: high · Size: XL

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every Bash command an agent issues in this repo passes through
`scripts/ai-hooks/policy.sh` and `scripts/ai-hooks/common.sh` — together 2,121
lines and 90 shell functions that fuse four different jobs into two files:
the safety **policy** (what is forbidden and why), command **tokenization**
(several hand-rolled lexers plus a 287-line embedded awk heredoc parser),
**Git semantics** (which checkout and branch a command actually acts on), and
**decision emission** for the hook adapters.

The cost lands on the most common maintenance action this subsystem sees:
changing one command rule. The hard-deny rules live interleaved inside a
single 155-line ordered if-chain, so adding or adjusting a rule means reading
enough of the surrounding parser layers — heredoc stripping, path-token
cleaning, git-target resolution, the two deliberately different git-commit
matchers — to be confident the new pattern meets the command text in the form
those layers deliver it. Rule edits dominate this file's history (61 commits
touched `policy.sh` since 2026-06-01), and each one pays that
comprehension tax.

For a repo whose stated purpose is being a copyable harness-engineering
reference, the shape is also the biggest copyability defect in the harness:
an adopter who wants "this deny list, my commands" cannot lift the rule set
without taking the whole analyzer, because the rules are code woven through
it rather than data beside it. The repo already has the exact cure wired into
this very file — `policy.sh` sources a generated classifier fragment rendered
from `harness.controls.json` — but the deny rules themselves never adopted
that pattern.

Claude's native permission layer also maintains a second representation of
part of this policy as matcher strings in `.claude/settings.json`. The current
family-level parity corpus detects broad omissions, but it neither derives
those matchers from the shared policy nor proves that each native matcher is
an intentional projection. A rule change can therefore require synchronized
edits in two policy languages, while contextual exceptions such as stash must
remain deliberately absent from the native layer so the shared policy can
supply the correct reason.

## Evidence

Measurement commands (run from the repository root at the pin): line/function totals: `for f in scripts/ai-hooks/{common,policy}.sh; do git show ebf096580b31f604861fadb3d4cbd4079da4f017:$f | wc -l; git show ebf096580b31f604861fadb3d4cbd4079da4f017:$f | rg -c '^[[:alpha:]_][[:alnum:]_]*[(][)][[:space:]]*[{]'; done`; dispatcher span/branch count: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/ai-hooks/policy.sh | sed -n '1059,1213p' | wc -l` and `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/ai-hooks/policy.sh | sed -n '1059,1213p' | rg -c '^    return 0$'`; native deny count: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:.claude/settings.json | jq '.permissions.deny | length'`; spec/parser spans: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/ai-hooks/policy.sh | sed -n '248,269p' | wc -l` and `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/ai-hooks/policy.sh | sed -n '270,556p' | wc -l`; adapter/main-corpus counts: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/ai-hooks/bash-pre-tool-use.sh | wc -l` and `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/ai-hooks/test.sh | wc -l`; sibling-suite count: `git ls-tree -r --name-only ebf096580b31f604861fadb3d4cbd4079da4f017 scripts/ai-hooks | rg '^scripts/ai-hooks/test-[^/]+[.]sh$' | rg -v '/test-support[.]sh$' | wc -l`; all corpus lines: `git ls-tree -r --name-only ebf096580b31f604861fadb3d4cbd4079da4f017 scripts/ai-hooks | rg '^scripts/ai-hooks/(test[.]sh|test-[^/]+[.]sh)$' | while read -r f; do git show ebf096580b31f604861fadb3d4cbd4079da4f017:$f; done | wc -l`.

- Measured at the pin: `scripts/ai-hooks/common.sh` is 708 lines /
  34 function definitions; `scripts/ai-hooks/policy.sh` is 1,413 lines /
  56 function definitions — 2,121 lines, 90 functions total.
- `scripts/ai-hooks/policy.sh:1059-1213` — `ai_policy_violation_reason`, the
  central hard-deny dispatcher: one ordered if-chain with 19
  message-emitting branches (measured). Several use direct
  regex/`grep` matches (postgres/redis/docker CLIs, `--amend`, history
  rewrite, force-push, `git clean -f`, `gh auth`/`gh pr` mutations, …); others
  route through named procedural predicates (hook-bypass flags,
  protected-file writes, dangerous reset, worktree loss, stash, push-to-main,
  commit-on-main). The user-facing messages are constants at `policy.sh:11-31`.
- `.claude/settings.json:5-88` — Claude's native permissions independently
  maintain an 81-entry hard-deny matcher array.
- `scripts/ai-hooks/test.sh:174-301` — a bespoke classifier maps native
  destructive-Git matcher strings into families, then checks a separately
  authored corpus in both directions; neither representation is derived from
  the other.
- `scripts/ai-hooks/test.sh:515-522` — the parity suite separately forbids a
  native stash matcher because native denial would preempt the shared policy's
  contextual stash reason.
- `scripts/ai-hooks/policy.sh:248-556` — `ai_strip_noncommand_text`: a
  22-line conservative-model spec comment (`:248-269`) followed by an
  embedded awk program (`:270-556`) that classifies heredoc bodies as data
  vs. executable text and fails closed (callers scan raw text) on anything it
  does not model.
- `scripts/ai-hooks/policy.sh:733-965` — a second tokenizer/classifier
  cluster: `ai_policy_clean_shell_path_token` (`:733`) through
  `ai_policy_bash_write_candidate_paths` (`:958-965`), which unions
  redirect-, `sed`-, `tee`-, and copy-like write-path extractors.
- `scripts/ai-hooks/common.sh:98-470` — a third layer:
  `ai_unquote_token` (`:98`), the character-loop lexer
  `ai_git_commit_prefixes` (`:112`, self-described at `:107-112` as
  "deliberately only a lexer, not a shell parser"), and the git
  target-resolution helpers through `ai_resolve_target_dir` (`:452-470`).
- `scripts/ai-hooks/common.sh:206-219` — the two git-commit parsers
  (`ai_is_real_git_commit_cmd` here, `ai_is_git_commit_cmd` at
  `policy.sh:1247`) are documented as "NOT interchangeable": routing must
  over-match, a verdict must under-match. Load-bearing asymmetry any
  restructuring must preserve.
- `scripts/ai-hooks/policy.sh:33-39` — the declarative-data precedent already
  lives in this file: `:39` sources
  `scripts/ai-hooks/classified-bun-scripts.generated.sh`, rendered from
  `harness.controls.json` `generatedSurface` bunHook facets.
- `scripts/ai-hooks/policy.sh:1215-1219` — `ai_policy_is_soft_guidance`
  returns 1 unconditionally ("No soft guidance policies are currently
  active"): hard-vs-soft classification is a latent data field, not a
  migration burden.
- `scripts/ai-hooks/README.md:7-18` — the hook entrypoints under
  `.claude/hooks/`, `.codex/hooks/`, `.copilot/hooks/` are already
  **generated projections** (`bun run harness:wiring`, byte-compared by
  `bun run harness:wiring:check`). The fusion is in the shared bodies, not
  the entrypoints; `scripts/ai-hooks/bash-pre-tool-use.sh` is a 116-line
  adapter that sources `common.sh` + `policy.sh` and calls
  `ai_policy_violation_reason` (`:14-19`, `:37-39`).
- Behavioral spec is a shell corpus, not prose:
  `scripts/ai-hooks/test.sh` is 4,457 lines, plus nine sibling
  `test-*.sh` suites and the sibling `test-support.sh` helper — 8,939 lines
  total — run via the registered smoke `scripts/tests/test-ai-hooks.sh`
  (`:25` execs `test.sh`).
- Churn: 84 commits touch `policy.sh` over its history (reproduce with
  `git log ebf096580b31f604861fadb3d4cbd4079da4f017 --follow --format=%H -- scripts/ai-hooks/policy.sh | wc -l`),
  61 of them since 2026-06-01 (reproduce with
  `git log ebf096580b31f604861fadb3d4cbd4079da4f017 --since=2026-06-01 --follow --format=%H -- scripts/ai-hooks/policy.sh | wc -l`).
- Latency constraints are already ruled on:
  `docs/agent_notes/backlog/arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md:91-97`
  rules that hot-path hooks must not spawn bun for cheap checks, and
  `:207-223` records hook-local jq as an allowed exception territory.

## Proposed direction

Behavior-preserving decomposition of the shared policy bodies — **no TS
enforcement core**. The finding is rescoped from the hook entrypoints (already
thin generated projections) to the shared bodies `policy.sh`/`common.sh`.
Enforcement stays bash+awk+jq; the existing 8,939-line shell corpus is the
parity gate throughout, with no dual-run machinery, because nothing is
reimplemented — code moves verbatim behind an unchanged sourcing façade.

Three sequenced, corpus-green slices (full plan with per-slice scope and
proof: [`./107-PLAN.md`](./107-PLAN.md)):

1. **Slice A (M) — extract the deny-rule set into declarative data.** Move
   the hard-deny rules out of the `ai_policy_violation_reason` if-chain
   (`policy.sh:1059-1213`) into a `commandPolicy` facet in
   `harness.controls.json` — fields `{id, order, class, patterns[]|predicate,
   message, scope}` — rendered by a `scripts/harness` generator into
   `scripts/ai-hooks/policy-rules.generated.sh` (the exact
   `classified-bun-scripts.generated.sh` precedent already sourced at
   `policy.sh:39`). Add projection metadata to the same records: every
   context-free hard deny either supplies its Claude-native matcher strings,
   plus a reason when those strings are necessarily a partial projection, or
   records an explicit non-projection reason. Have the generation/check path
   flatten those projected matchers and freshness-check
   `.claude/settings.json`'s `permissions.deny` array against them. Contextual
   predicates remain shared-policy-only and explicitly excluded.

   The dispatcher collapses to a generic ordered loop: the pure-pattern
   rules become data rows; the procedural predicates (protected-file
   writes, push/commit-on-main, reset/stash/worktree-loss, hook-bypass) stay
   as named shell functions referenced by row. Replace the family-only native
   parity classifier with record-level projection coverage, including fixtures
   proving that every non-projection is intentional, every partial projection
   is documented, and stash remains absent. Render a policy-reference table
   into the generated harness docs (`docs/generated/harness-controls.md`) from
   the same records. Extend the
   companion 107-PLAN S0/S1 sequence in lockstep: S0 owns projection metadata,
   expected-array generation and freshness checking; S1 consumes the same
   records in the dispatcher and generated reference table. This slice alone
   fixes "changing one rule requires understanding several parsers."
2. **Slice B (M-L) — split the bodies by responsibility behind a façade.**
   `command-normalize.sh` (the awk heredoc stripper `policy.sh:270-556`,
   moved verbatim with its spec comments and a "copy verbatim; spec = header
   comments + corpus" banner), `command-paths.sh` (tokenizer cluster
   `:733-965`), `git-classify.sh` (git semantics from `common.sh:112-470`
   and the git predicates in `policy.sh`), `policy-eval.sh` (rule loop +
   decision emission). `policy.sh` remains as a compatibility façade sourcing
   them, so every caller and the whole test corpus are untouched and serve as
   the parity gate. Shrink `common.sh` toward its documented role ("Shared
   helpers for agent hook adapters", `common.sh:3-4`). Prior-pack
   `27-PLAN.md` slices 27.4–27.7 already own splitting `test.sh` into the
   command-policy, backlog-note-lint, commit/worktree/queue, and
   failure-guidance/output-filter families; consume that landed shape or leave
   the corpus in place rather than duplicating the split here.
3. **Slice C (S) — formalize one decision-record boundary.** A single
   boundary function returning `(verdict: block|advise|allow, ruleId,
   message)` consumed by the hooks — the interface any future typed core
   must match.

Update `scripts/ai-hooks/README.md` and `docs/ai-harness.md` in the same
commit as each seam (both currently document the shell-body architecture,
`docs/ai-harness.md:70-78,139`); run `bun run harness:check` per slice.

A typed TS model is demoted out of this work to a conditional follow-up: at
most a non-enforcing explain/simulator command (a future
`harness:policy:explain` — name illustrative, does not exist today) dual-run
against the shell corpus as a CI parity check. Effective size drops from one
XL change to three sequential M/M-L/S slices; severity high stands.

## Scope / caveats

Binding rulings (recorded at synthesis; do not relitigate in execution):

- **No Bun/TS enforcement core in this pack.** Extract deny-rule data to a
  `harness.controls.json` `commandPolicy` facet with a generated `.sh`
  projection and a generic ordered rule loop; enforcement stays bash+awk+jq.
- **Nothing beyond bash/awk/jq/git in the fail-closed deny path** of
  `bash-pre/post-tool-use` hooks (a broken bun must never block the commands
  needed to fix bun). A typed model ships only as a non-enforcing
  explain/simulator dual-run against the shell corpus in CI.
- **Do not reimplement or tune the awk heredoc stripper or tokenizer
  semantics.** Move them verbatim with their spec comments into bounded
  modules behind an unchanged `policy.sh` sourcing façade, so the existing
  corpus remains the parity gate with no dual-run machinery.
- **Do not land this as one XL change.** Sequence as corpus-green slices —
  rule-data extraction (M), module decomposition behind the façade (M-L),
  decision-record boundary (S) — with `README.md`/`docs/ai-harness.md`
  updated in the same commit as each seam.
- **Do not spend effort thinning hook entrypoints** — they are already
  generated thin projections (`scripts/ai-hooks/README.md:7-18`); the fusion
  to fix is in the shared bodies.
- **Do not create an independent native-policy registry.** Claude projection
  metadata belongs on Slice A's `commandPolicy` records and lands through the
  107-PLAN S0/S1 sequence.
- **Project only context-free hard denies.** Stash and every other rule whose
  shared-policy context or reason would be preempted by native denial remain
  explicit non-projections with parity coverage.
- **Do not replace the localized settings scanner.** Prior-pack CQ25-129
  ([code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md))
  refused the `jsonc-parser` rewrite; freshness-checking the deny array from
  the existing policy authority does not reopen that decision.

Other caveats:

- **Preserve the over-match/under-match asymmetry** documented at
  `common.sh:206-219` between `ai_is_real_git_commit_cmd` and
  `ai_is_git_commit_cmd` — the two parsers are intentionally not unified, and
  `git-classify.sh` must keep both with that comment intact.
- **Do not expand the threat model.** `policy.sh:3-9` deliberately leaves
  ssh-wrapped commands and double-wrapped `bash -c` strings unhandled;
  restructuring must not re-flag them.
- **Do not revive soft guidance.** `ai_policy_is_soft_guidance` currently
  matches nothing (`policy.sh:1215-1219`); `class` becomes a manifest field
  and the hard/soft seam carries over as data, not new behavior.
- **Latency budget.** Hot-path hooks fire on every Bash call; arch-plan
  `arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md:91-97,207-223`
  records no-bun-spawn for cheap checks and hook-local awk/jq as accepted.
  The generator runs at build time; the hooks keep sourcing pre-rendered
  shell.
- **Manifest coordination.** Slice A adds a facet to `harness.controls.json`,
  which [114-harness-controls-represented-competing.md](./114-harness-controls-represented-competing.md),
  [116-generated-surface-dependencies-manually.md](./116-generated-surface-dependencies-manually.md),
  [125-manifest-copies-verify-slot-programs-across.md](./125-manifest-copies-verify-slot-programs-across.md)
  and [126-hook-wiring-repeats-adapter-templates-leaves.md](./126-hook-wiring-repeats-adapter-templates-leaves.md)
  also restructure. No hard ordering edge, but do not edit the manifest
  concurrently with those leaves, and if 114 lands a new facet model first,
  the `commandPolicy` facet adopts it.
- **Prior pack**: `code-quality-2026-07-25/27-PLAN.md` (Planned) slices
  27.4–27.7 already own the `test.sh` family split and must not be duplicated
  here; `code-quality-2026-07-25/37-ai-hooks-contracts.md` (Done)
  covered two narrow ai-hooks contracts only;
  `code-quality-2026-07-25/29-bash-to-ts-cores.md:174-175` explicitly fenced
  `scripts/ai-hooks/policy.sh` out of its bash→TS core step — a scoping
  fence, not a decline, so nothing prior rules this work out.
- Prior-pack CQ25-122
  ([code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md))
  owns generated `.claude`/`.codex`/`.copilot` provider shims, not Claude's
  native permission-deny array. Projecting that array from `commandPolicy`
  therefore extends Slice A without duplicating the landed shim work.
- The main dissent during shaping — that rule-data extraction alone captures
  most of the win and rewriting carefully-tuned conservative parsers is not
  worth the risk — is resolved by the rulings above: nothing is rewritten,
  Slice A leads, and the typed core is out.
