# 129. Post-merge baseline truth-up and pre-push classify tool verdicts by grepping human diagnostics instead of reading exit codes

Status: Landed on fix/cq-224
Theme: exit codes as verdict contract · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

After every merge, `scripts/git/baseline-post-merge-truth-up.sh` — the shared
keyed body sourced by the four per-family shims that `.husky/post-merge` and
`.husky/post-commit` dispatch — decides which repair instruction to print by
capturing a checker's combined output and grepping for presentation strings.
Three independent tools' human diagnostics are load-bearing: the lint-ratchet
handler looks for `^lint:ratchet:`, the knip handler branches on `^FAIL:` /
`^WARN: baseline summary does not match the entries` / `^ERROR: baseline`, and
the near-duplicates handler looks for `^FAIL:` again. A fourth copy of the same
capture-and-grep lives in `.husky/pre-push`, and there it does more than pick
wording — it decides whether the push is blocked.

This makes diagnostic prose a hidden API. Rewording a FAIL banner or the
`lint:ratchet:` prefix is, to its author, a cosmetic change; no test fails, but
the truth-up silently stops recognizing the verdict and routes the contributor
to the wrong repair advisory — or, in pre-push, stops blocking a genuinely
stale baseline. Each grep site also carries multi-line SIGPIPE-herestring
defense commentary (grep -q closing a pipe early returns 141 under pipefail)
— real complexity spent hardening a channel that should not be a channel. The
one thing the greps genuinely defend against — an uncaught bun exception
exiting 1 must not read as a verdict — is already broken in the knip handler,
whose bare exit-1 fallback routes a crash to the stale-baseline advisory
anyway. And every state-mutating decision (truth-up marker consumption) already
keys off exit codes alone, so the exit-code channel is the de-facto contract;
the greps are a second, fragile classification layer on top of it. Each new
baseline family invites another copy.

## Evidence

- `scripts/git/baseline-post-merge-truth-up.sh:170` — lint-ratchet handler:
  `[ "$full_check_status" -eq 1 ] && grep -q '^lint:ratchet:' <<<"$full_check_output"`
  selects the stale-baseline advisory; the SIGPIPE-herestring defense
  commentary is at `:158-164`.
- `scripts/git/baseline-post-merge-truth-up.sh:205-212` — knip handler: three
  grep branches (`^FAIL:` → stale, `^WARN: baseline summary does not match the
  entries` → summary drift, exit 2 + `^ERROR: baseline` → corrupt), plus the
  bare `elif [ "$check_status" -eq 1 ]` fallback at `:209-210` that routes any
  other exit-1 (including a crash) to the stale advisory.
- `scripts/git/baseline-post-merge-truth-up.sh:252` — near-duplicates handler:
  exit 1 + `grep -qE '^FAIL:'` selects the stale advisory; herestring defense
  comment at `:244-248`.
- `.husky/pre-push:310` — the fourth copy: exit 1 + `grep -qE '^FAIL:'` on the
  same near-duplicates check returns 1 (push blocked, `:329`); any other
  nonzero returns 0 (`:332-335`). Here wording drift changes push blocking,
  not just advisory text.
- Exit codes already govern all state: marker consumption happens only on
  exit 0 (`baseline-post-merge-truth-up.sh:165-166`, `:202-204`, `:249-250`),
  and every truth-up handler exits 0 — so grep misrouting yields a wrong repair
  instruction, not a wrong gate outcome (pre-push excepted, above).
- Every verdict the greps disambiguate is already a distinct return site, so
  the ambiguity is purely in the exit-code mapping:
  - `scripts/lint-ratchet.ts:155-157` — the sole `WorseBaselineError` catch
    (exit 1); `UsageError`/`ConfigError` exit 2 at `:149-154`, and all three
    print the same `lint:ratchet:` prefix the grep matches.
  - `scripts/sensor-knip-unused-exports-core.ts:111` (knip run failure →
    exit 2 `ERROR:`), `:126` (unreadable baseline → exit 2 `ERROR: baseline
    …`), `:147` (summary-drift-only → exit 1 `WARN:`), and the entry-mismatch
    verdicts at `scripts/sensor-knip-unused-exports-baseline.ts:179-180`
    (exit 1 `FAIL:`). Exit 1 currently conflates stale-entries with
    summary-drift; exit 2 conflates corrupt-baseline with transient failure.
  - `scripts/sensor-near-duplicates-core.ts:196-206` — the sole stale
    `FAIL:` verdict (exit 1) behind `--check-baseline` (dispatched at `:285`).
- `examples/lint-ratchet-demo/scripts/git/baseline-post-merge-truth-up.sh:126-136`
  — the public demo's truth-up hook already classifies by exit code only, no
  grep; the main repo is the outlier, not the showcase.
- Measured: 4 capture-grep-classify sites total (3 truth-up handlers + 1
  pre-push), each with its own copy of the SIGPIPE defense commentary.

## Proposed direction

Make dedicated exit codes at the tools' existing return sites the complete,
documented, test-pinned verdict contract; do not add envelope emission. This
shrinks the work from M to S.

1. **lint-ratchet CLI** (`scripts/lint-ratchet.ts:155-157` error mapping):
   give `WorseBaselineError` a dedicated exit code 3; exit 1 remains
   unclassified failure.
2. **knip sensor** (`scripts/sensor-knip-unused-exports-core.ts` return sites
   at `:111`/`:126`/`:147` plus the verdict sites in
   `scripts/sensor-knip-unused-exports-baseline.ts:179-180`): assign dedicated
   codes >=3 for stale-entries, summary-drift-only, and corrupt-baseline;
   leave 1/2 as unclassified/transient failure so an uncaught bun exception
   (exit 1) can never masquerade as a verdict — this structurally replaces the
   one real defense the greps provide today.
3. **near-duplicates `--check-baseline`**
   (`scripts/sensor-near-duplicates-core.ts:196-206`): move the stale FAIL
   verdict to a dedicated code >=3 for the same crash-safety reason.
4. **Truth-up handlers**: in `scripts/git/baseline-post-merge-truth-up.sh`
   delete all three grep branches (`:170`, `:205-212`, `:252`) and their
   SIGPIPE-herestring defense commentary; each handler becomes a case switch
   on the exit code, keeping captured output only for the `tail -n 20` display
   path. Advisory wording stays in the bash handlers.
5. **pre-push**: `.husky/pre-push:310` repeats the same `^FAIL:` herestring
   grep for near-duplicates, and there it decides push blocking — convert it
   to the same exit-code switch.
6. **Document and pin**: record each tool's verdict-code map in its
   usage/contract header and in the truth-up comments, and pin every code with
   exit-code assertions in the existing smokes/unit tests
   (`scripts/tests/test-lint-ratchet.sh`, `scripts/tests/test-pre-push.sh`,
   `scripts/tests/test-merge-driver-dispatch.sh`,
   `scripts/sensor-knip-unused-exports.test.ts`; run one smoke directly with
   `bash <path>`).
7. **No change to `examples/lint-ratchet-demo`** — at the audit pin it already
   classifies by exit code only (`:126-136`); the fix converges the main repo
   to the demo's shape. Refresh guide/truth-up commentary (the truth-up guides
   under `docs/guides/lint-ratchet*.md` and `docs/guides/lint-overview.md`) to
   name the layering: exit code is the verdict contract, stdout is
   presentation, consumers never parse prose.
8. **Deferral guard**: if a payload consumer (counts, repair commands) ever
   materializes, extend the existing HarnessDiagnostics emission
   (`packages/shared/src/schemas/harness-diagnostics.ts`) with a
   verdict-as-data note — never a bespoke per-tool status JSON.

## Scope / caveats

Binding rulings from the direction review:

- **No machine-readable status envelope** for baseline truth-up classification
  — neither a new format nor HarnessDiagnostics emission. Dedicated per-tool
  exit codes at the existing return sites are the complete verdict contract,
  documented in each tool's usage header and pinned by exit-code test
  assertions.
- **No grep or SIGPIPE-herestring fallback survives**: delete all four grep
  branches (`scripts/git/baseline-post-merge-truth-up.sh:170`/`:205-212`/`:252`
  and `.husky/pre-push:310`) and branch on exit codes only, keeping captured
  output solely for tail display.
- **Never assign verdict meaning to exit codes 1 or 2.** Verdict codes go at
  3+; unclassified nonzero routes to the could-not-run/generic advisory,
  because an uncaught bun exception exits 1 and must never read as a
  stale-baseline verdict (or block a push).
- **Do not modify the demo's truth-up hook** — it is already exit-code-only
  and is the reference shape; correct any guide or review text claiming the
  demo greps prose.
- **No bun classifier helper or `HARNESS_DIAGNOSTICS_OUTPUT` temp-file
  plumbing in the git hooks**; a future payload consumer extends
  HarnessDiagnostics (verdict-as-data note convention), never a bespoke
  per-tool status JSON.

Other scope notes:

- The max-lines-exceptions handler in the same file is advisory-only (no check
  command, no grep) and is out of scope, as is restructuring the keyed body
  itself — the four skeletons were already unified into one sourced body, so
  only the per-key capture-grep-advise handlers change.
- Exit-code changes ripple only to deliberate consumers: verify gate slots
  consume zero/nonzero only; the remaining consumers are the truth-up/pre-push
  handlers and the smokes being updated in step 6. Exit 127 keeps its
  could-not-run meaning throughout (`baseline-post-merge-truth-up.sh:146-148`).
- Prior pack: CQ25-124 is a do-not-reopen on the bash-facade-over-TS-core
  precedent (2026-07-25 leaf
  [29-bash-to-ts-cores.md](../code-quality-2026-07-25/29-bash-to-ts-cores.md)),
  not on this problem, and no 2026-07-25 leaf schedules or declines truth-up
  output-parsing work. The prior pack's "baseline merge-driver family is
  already parameterized" ruling covers the installer family, a different
  surface.
