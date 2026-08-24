# 33. Harness env vars carry several unrelated prefixes and no documented rule for choosing between them

Status: Scheduled work landed 2026-07-31 on `fix/cq-harness-h16-h17` (merge
`c6e1be2a2`) — H17 landed; no scheduled slice remains
Theme: Undocumented harness configuration conventions · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The harness reads environment variables under several different prefixes
(`MUSI_`, `AI_`, `HARNESS_`, plus unprefixed names), and nothing in the repo
says which one a new knob should use.

The prefixes are not meaningless — in places they do track a producer.
`scripts/verify-logs.sh:38` reads `${MUSI_VERIFY_LOG_DIR:-…}` for
verify/pre-commit logs and `:39` reads `${AI_BUN_LOG_DIR:-…}` for the AI-hook
Bun wrapper's logs, and `log_source()` at `:135-141` reports those two roots as
`verify/precommit` and `ai-hook` respectively. But that split is nowhere
written down, and it is not applied consistently: the same Bun-log directory is
also overridable as `MUSI_STANDARD_BUN_LOG_DIR`
(`scripts/lib/verify-metadata.sh:247-251`), so one directory answers to two
prefixes — `scripts/logs-audit/logs-audit-latest.ts:105-107` resolves it as
`env.AI_BUN_LOG_DIR ?? env.MUSI_STANDARD_BUN_LOG_DIR ?? <default>`, both
prefixes in one expression.

The cost is entirely at authoring time and it is real: someone adding a knob has
no way to answer "what do I call this?" except by guessing from whichever
neighbouring file they happened to open. It also makes the knobs hard to
enumerate — there is no single `rg` that finds them, so `.env` templates,
per-worktree env generation, and CI configuration each carry their own partial
view.

`rg` over `docs/ai-harness.md` and `docs/guides/` finds no env-prefix rule
anywhere. That absent rule is the finding. The size of the sprawl is *not*
established by this leaf: no one has inventoried the actual environment reads
(see the caveat below).

## Evidence

- Two prefixes for the same concept, one line apart: `scripts/verify-logs.sh:38` reads `${MUSI_VERIFY_LOG_DIR:-...}`, `:39` reads `${AI_BUN_LOG_DIR:-...}`, and `:25` lists both in the same header comment. `scripts/verify.sh:76` reads `MUSI_VERIFY_LOG_DIR` too.
- Two prefixes for one directory: the AI-hook Bun log root is `AI_BUN_LOG_DIR` at the call site and `MUSI_STANDARD_BUN_LOG_DIR` at the default (`scripts/lib/verify-metadata.sh:247-251`); `scripts/logs-audit/logs-audit-latest.ts:105-107` chains both.
- A third prefix for a repo-owned output path: `HARNESS_DIAGNOSTICS_OUTPUT`, the file a diagnostics producer writes its `HarnessDiagnostics` envelope to, set in four `env` blocks in `harness.controls.json` (`:628`, `:709`, `:789`, `:2060`) and documented in `docs/ai-harness.md` under **Environment Variable Naming**, **Sensors**, and **Current Gaps**.
- `docs/ai-harness.md` and `docs/guides/` — no env-var naming rule in either; the convention is undocumented, not merely inconsistent.
- The env vars documented with a `NAME=` spelling in `docs/ai-harness.md` are `FORCE_VERIFY` (**Green-Output Policy**), `HARNESS_DIAGNOSTICS_OUTPUT` (**Environment Variable Naming**, **Sensors**, **Current Gaps**), `MUSI_VERIFY_MEMORY_ALLOW_SOLO_FALLBACK`, `NON_SERVER_TEST_MAX_WORKERS`, and `MUSI_TOOL_MEMORY_ADMISSION_BYPASS` (**Heavy-tool memory admission**), and `MUSI_SLOW_DRIFT_MUTATION` (**Slow Drift Schedule**) — six names under two prefixes plus two that carry no prefix at all. The unprefixed pair are the most hand-set knobs of the six: the variables a developer is most likely to type are the ones with no convention applied.
- Do not inventory by grepping uppercase identifiers. Most `MUSI_*`/`AI_*`/`AGENT_*`/`LINT_*`/`VERIFY_*`/`HARNESS_*`/`DRIFT_*` identifiers in the tree are not environment variables: local shell variables in test scripts (`VERIFY_REPO` at `scripts/ai-hooks/test-stop-policy.sh:457`, `LINT_COVERAGE_CACHE_STATE` at `scripts/ai-hooks/test-lint-coverage.sh:80`), TypeScript constants (12 of the 13 distinct `HARNESS_*` names — only `HARNESS_DIAGNOSTICS_OUTPUT` is read from the environment; the `DRIFT_*` group is almost entirely constants such as `DRIFT_SCHEMA_VERSION` and `DRIFT_AI_START_MARKER`), and test fixture filenames (`scripts/harness/harness-audit.test.ts:37` declares `const DRIFT_AI_FINDINGS = "drift-ai-findings.json";`, never an environment read). Classify by read site.

## Proposed direction

The whole of the recommended work is the first step. Steps 2-3 are optional
follow-ups and should only be scheduled if step 1 shows they are worth it.

1. **Write the rule down, and only the rule.** Add a short section to
   `docs/ai-harness.md` (or a new `docs/guides/env-var-naming.md` linked from it)
   that states: which prefix a new variable takes and why; which existing
   prefixes are frozen legacy that new code must not extend; and the separate
   convention for test-only fakes and sandbox overrides (`AI_BUN_FAKE_STARTED`,
   `AI_FAKE_NOW`, `AGENT_FAKE_*`), which should be explicitly exempted rather
   than treated as user-facing knobs. Documenting the existing producer split
   (`MUSI_` for the verify pipeline, `AI_` for the AI-hook wrapper) is a valid
   answer as long as the rule says what a *new* subsystem does; a single-prefix
   answer is equally valid. Either way, the rule can be written without an
   inventory; that is the point of doing it first. One commit, docs only, zero
   runtime risk.
2. **Optionally, inventory the real knobs.** Produce a table (in the same doc) of
   the user-facing variables only — the ones a developer or CI job would actually
   set — with prefix, owner, and default. Derive it from actual reads, not from
   grepping uppercase identifiers. Four read forms cover the tree:
   `process.env.X` / `Bun.env.X` in TypeScript; `${X:-…}` and bare `$X` in shell;
   the `env` blocks in `harness.controls.json`; and typed env-object seams — a
   `readonly NAME?: string` field on an env type fed from `process.env` or
   `node:process`'s `env`, as in `scripts/logs-audit/logs-audit-latest.ts:12-18`,
   which reads six names with no `process.env.X` text anywhere in the file.
   Ignore assignments that are command prefixes (`NAME=1 cmd`) — those are
   callers setting a knob, not owners of it; `FORCE_VERIFY` is a real user-facing
   knob (`scripts/ai-hooks/bun-run-quiet.sh:242`) that `scripts/land.sh:343`
   happens to assign that way. This is the artefact that makes the sprawl
   legible, and it is also the only way to find out whether the sprawl is large
   enough to be worth more than step 1.
3. **Optionally, and only after 1 and 2, add enforcement.** A harness check that
   rejects a *newly introduced* name under a frozen prefix is cheap and does not
   require renaming anything. It needs step 2's read-detection to avoid firing on
   ordinary constants and local shell variables. If you go this way, wire it
   through `bun run harness:check` and read `docs/guides/lint-ratchet.md` if it
   lands as a ratcheted count rather than a hard failure.

## Scope / caveats

- **Do not schedule a rename.** The cheap and correct first move is the
  documented rule alone. An actual rename touches `.env` files, per-worktree env
  generation (`docs/guides/per-worktree-dev.md`), CI configuration, and hook
  wiring — none of which are in one place, and several of which live outside the
  repo. That work is L-sized and high-risk for a benefit that the documented rule
  already captures. If a rename is ever attempted it must be a separate leaf with
  its own migration plan and a deprecation window where both names are read.
- **Nobody has measured how many user-facing environment variables this repo
  actually has.** Any inventory or enforcement built on raw identifier counts
  will spend most of its effort on names no human ever sets; classify by read
  site first. Test-only fakes (`AI_BUN_FAKE_STARTED`, `AI_FAKE_NOW`,
  `AGENT_FAKE_*`) are real environment reads but not user-facing knobs, so they
  need their own bucket rather than exclusion.
- The rule must be chosen, not derived. `MUSI_` is the prefix the documented
  knobs mostly use, `AI_` currently marks the hook wrapper's own state, and
  `HARNESS_` is arguably the more honest description of what all of them
  configure; picking a scheme and freezing the rest is a decision to make and
  record, not a measurement to take, and it does not wait on step 2's inventory.
  Record it where the next author will look — beside the harness docs, not in a
  backlog file.
- No sequencing dependency on other leaves in this pack. Leaves 31 and 32 touch
  the same tree but share no files with this one.
