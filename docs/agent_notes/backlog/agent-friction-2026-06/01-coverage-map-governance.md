# 01 — Lint coverage-map governance (A1–A6 + architectural)

> Proposals only — not implemented. Verified against current HEAD.
> Canonical doc today: `docs/generated/lint-coverage-map.md` (~419 rows). The
> logs' `docs/agent_notes/backlog/lint-followups/lint-coverage-map.md` path is
> gone. Checker hardcodes the current path at
> `scripts/lint-coverage-map-check-io.ts:10`.

This is the single most-logged friction. The plan has **tactical** fixes (ship
now, low risk) and a **strategic** redesign (own leaf) that dissolves the class.

Key files:
- `scripts/lint-coverage-map-check.ts` (+ `-findings.ts`, `-io.ts`, `-patterns.ts`, `-eslint-reach.ts`, `-types.ts`)
- `scripts/lint-coverage-map-check.test.ts`
- `scripts/ai-hooks/lint-coverage-check.sh` (edit-time hook), `lint-coverage-state.sh`
- `docs/generated/lint-coverage-map.md`
- `package.json` (`docs:lint-coverage-map:check`, currently `:81`)

Gate wiring confirmed: `verify`/`verify:parallel` run the **non-staged +
`--check-eslint-reach`** form; `verify:changed` and **pre-commit** run `--staged`,
and `--staged` forces `checkEslintReach=false`
(`scripts/lint-coverage-map-check.ts:68`; early return at
`scripts/lint-coverage-map-check-eslint-reach.ts:66`).

---

## A1 + A6 — Every new file is flagged late; the error names neither the file nor the row format; no scaffold

**Status: DONE (a7abb730) — `--suggest` mode added in
`lint-coverage-map-check-suggest.ts` plus a `git add` hint in `findings.ts`.**

**Evidence.** `collectUnaccountedFileFindings`
(`scripts/lint-coverage-map-check-findings.ts:95-104`) flags every tracked file
that is in-scope (`trackedFileIsInScope`, `patterns.ts:144-148`) and matches no
pattern. So a single new `.ts` in an existing directory whose row enumerates bare
filenames (not a `**` glob) is unaccounted. `formatFindings` (findings.ts:54-57)
prints the file grouped by directory but **does not** print the map path, the row
template, or which existing row to extend. The edit-time hook reminder undersells
the rule: `scripts/ai-hooks/lint-coverage-check.sh:136` says to add a row only
"*If you added a new lint surface (a new directory or file group)*", but the gate
fires for any single new file. The base-dir row convention (first rooted full
path sets the base; later bare filenames resolve against it) is implicit in
`extractPathPatterns` (`patterns.ts:69-84`, `stableBaseForPattern` :38-45,
`resolvePatternSource` :58-67) and documented nowhere.

**Root-cause fix.**

1. **Add a `--suggest` mode to the checker.** Extend `parseCliArgs` and
   `LintCoverageMapCheckOptions` (`types.ts:35-44`) with `suggest?: boolean`. In
   `findings.ts`, for each unaccounted file, emit a ready-to-paste row using the
   real header columns
   (`Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up`).
   Pre-fill `Path / group` with `` `<file>` ``, `Files` with `1 .<ext>`, and
   derive `Normal lint`/`Status` defaults from the existing ESLint-reach probe
   (`createEslintReachChecker` in `-eslint-reach.ts`) and `lintRatchets`
   membership (matcher already shared at `scripts/lint-ratchet/ratchet-globs.ts`).
   When the file shares a directory with an existing row's base, **suggest
   appending the bare filename to that row** (and print its line number) rather
   than a new row — matching the doc's own convention, so the agent never has to
   learn the base-dir rule.
2. **Make the edit-time hook name the exact file + show the template.** In
   `scripts/ai-hooks/lint-coverage-check.sh`, add a *tracked-but-unmapped* tier
   that runs `bun scripts/lint-coverage-map-check.ts --suggest` scoped to the
   just-edited paths (the hook already shells to bun for ratchet coverage at
   `:49`) and emits the suggested row. This converts the ~130–160 s-late
   `verify:changed` failure into an at-create-time, copy-pasteable fix. Keep the
   per-session throttle (`lint-coverage-state.sh`) so it fires at most once per
   session per file set.
3. **Better error text even without `--suggest`.** In `formatFindings`, always
   print the map path and a one-line "first full path sets the base dir for
   subsequent bare filenames" note in the unaccounted section.
4. **Add an 8–10 line "Maintaining this map" section** to
   `docs/generated/lint-coverage-map.md` after line 15: column meanings, the
   base-dir rule, and "run `bun run scripts/lint-coverage-map-check.ts --suggest`".

**Why not doc-only.** The rule has effectively been "documented" via repeated log
notes for months and still recurs because the failure is 130 s late and the error
is unhelpful. The scaffold removes the need to know the rule at all.

**Effort:** M. **Risk:** low (additive flag + hook tier; existing gate unchanged).
**Test impact:** add `--suggest` cases to `lint-coverage-map-check.test.ts`;
extend `scripts/ai-hooks/test-lint-coverage.sh` for the new hook tier.

---

## A2 — `--staged` reads the map from the index but the file list from `git ls-files` → "matched 0 tracked files"

**Status: DONE (a7abb730) — `--suggest` mode added in
`lint-coverage-map-check-suggest.ts` plus a `git add` hint in `findings.ts`.**

**Evidence.** In `--staged` mode `loadMapText` reads the map from the staged index
(`git show :path`, `scripts/lint-coverage-map-check-io.ts:20-27`), but
`loadTrackedFiles` **always** runs plain `git ls-files` (io.ts:12-18). A
brand-new file you `Write`-created and added to the map (but did not `git add`)
is invisible to `git ls-files`, so its new pattern matches 0 files and
`collectStalePathFindings` (findings.ts:66-79) prints
`line N: \`path\` matched 0 tracked files` — which reads like a typo, not "you
forgot `git add`". No staging hint exists anywhere.

**Root-cause fix.**

1. **Staging hint (ship always).** In `collectStalePathFindings`, when a
   non-glob pattern matches 0 tracked files **and** the path exists in the
   worktree (cheap `fs.existsSync`, pass it in from `io.ts`) but is not tracked,
   append: `— matched 0 tracked files; did you forget to \`git add\` it?`.
2. **Staged file-set consistency (optional, removes the false positive).** When
   `staged === true`, load tracked files from the index too:
   `git ls-files --cached` plus `git diff --cached --name-only --diff-filter=A`.
   Then map and file list are both index-based: a staged file appears; a merely
   written one does not (and the map, also read from the index, only fails if it
   too is unstaged). The common "add file + add its row in one staged change"
   case passes cleanly. Leave non-staged behaviour (worktree `git ls-files`)
   unchanged so local pre-flight is unaffected.

**Why not doc-only.** "Remember to `git add` before re-running the check" is the
exact workaround that kept recurring. The hint alone removes the confusion; the
file-set change removes the false positive.

**Effort:** S (hint) / M (both). **Risk:** low (hint) / low–med (staged file-set
touches gate semantics — covered by the staged test at
`lint-coverage-map-check.test.ts:64-85`, extend it with an added-file case).

---

## A3 — Standalone `docs:lint-coverage-map:check` reports reach gaps the real gate never trips

**Status: DONE (a7abb730) — `package.json` now carries the `:check`/`:audit`
split. The *specific* file in the log (`scripts/harness-audit.test.ts`) was stale
— it moved to `scripts/harness/harness-audit.test.ts` and now resolves an ESLint
config, so that exact gap no longer reproduces.**

**Evidence.** `docs:lint-coverage-map:check` runs **non-staged +
`--check-eslint-reach`** (`package.json:81`); the committing gate runs
`--staged`, which disables the reach check entirely (`-eslint-reach.ts:66`,
coupling at `lint-coverage-map-check.ts:68`). So manual pre-flight legitimately
reports `eslint-reach-missing` findings the pre-commit gate will never raise.

**Root-cause fix.** Make the standalone command default to the gate's behaviour
and move the deeper audit behind an explicit name:
- `"docs:lint-coverage-map:check": "bun run scripts/lint-coverage-map-check.ts"`
- `"docs:lint-coverage-map:audit": "bun run scripts/lint-coverage-map-check.ts -- --check-eslint-reach"`

Optionally label reach findings `(advisory — not enforced by pre-commit)` in
`formatFindings`. Keep `verify`/`verify:parallel` pointed at the `:audit` form if
you still want full reach enforcement in local verify (one line in the
verify-steps source/generator).

**Decision (2026-06-12) — adopt the split; it is *not* an isolated "S."**
Confirmed wiring: full `verify`/`verify:parallel` invoke the map via the
**generated** `scripts/verify/steps.generated.sh`, and `verify:changed`/pre-commit
pass `-- --staged`. So two couplings the "S" rating hides, plus a sibling fix:
- Repointing full verify to `:audit` edits the **manifest + generator**, and the
  `harness-check` freshness gate (`harness-check.ts:215-219`) must stay green —
  the regen lands as one unit.
- `docs:lint-coverage-map:audit` is a new `docs:`-prefixed script, so it **trips
  the `harness:check` control-prefix parity gate** ("unaccounted script"). Either
  register it in `harness.controls.json` (e.g. a second invocation of the existing
  coverage-map control) or add it to `EXEMPT_SCRIPTS` with a justifying comment.
- **Pair with M1** ([06](06-drift-scan-harness-governance.md#m1)): A3 *creates*
  exactly the unaccounted-script friction M1 improves. Do them together.

**Why not doc-only.** A pre-flight that disagrees with the gate is a footgun;
aligning the default is cheaper than documenting the discrepancy.

**Effort:** S (script split) + the harness-controls/generated-steps regen above.
**Risk:** low.

---

## A4 — "linted vs ratcheted" / "Normal lint yes|no" has no internal-consistency check (invisible under `--staged`)

**Status: the specific "same glob marked oppositely" example appears stale; the
validation gap is real and not addressed.**

**Evidence.** Status validation only checks that the status string is a known
token combination (`isValidStatus`/`VALID_STATUS_PARTS`, findings.ts:4-16). It
does not cross-check that a `linted` row actually resolves an ESLint config, nor
that the `Normal lint` column agrees with the status token. The only thing that
would catch a misclassification is `--check-eslint-reach`, which (a) only
validates `linted` rows (`-eslint-reach.ts:70`) and (b) is skipped under
`--staged` — i.e. invisible to pre-commit. (At HEAD all `scripts/drift-ai/*`
code rows are uniformly `Normal lint: yes` + `linted + ratcheted`; the only `no`
rows are the `excluded` fixtures rows — a legitimate difference, not a
contradiction. So A4's exact example is no longer present.)

**Root-cause fix.** Add `collectStatusConsistencyFindings` (findings.ts): parse
the `Normal lint` column (requires keeping `cells[NORMAL_LINT_COLUMN]` in
`parseRows`, `patterns.ts:3-5,27-33`) and assert `yes` ⇔ status contains
`linted`, `no` ⇔ status contains one of `ratcheted/excluded/not-code/...`. Pure
string logic, cheap enough to **run always, including `--staged`**, closing the
"invisible to the gate" hole. When the reach probe does run (A3 `:audit`), also
validate the inverse (a row marked not-linted whose files *do* resolve a config).

**Effort:** M. **Risk:** low.

---

## A5 — Validates ratchet *ids* but not file-membership → prose rots; the doc advertises a generator that doesn't exist

**Status: DONE (76b5a209) — ratchet membership is validated and the
direct-child `scripts/drift-ai/*.ts` row is marker-generated from tracked files,
fail-closed ESLint reach, and live ratchet membership.**

**Evidence.** `collectRowFindings` (findings.ts:81-93) only verifies that each
`ratchet/<id>` token is a known id (`ratchetIds`, check.ts:34). It does not check
that the row's files are actually members of that ratchet's `files` glob (or not
pruned by its `ignores`), so a row can claim a ratchet that doesn't cover it and
stay green. `docs/generated/lint-coverage-map.md:14` explicitly says "*if/when
a generator script is added…*" — advertising a generator that does not exist.

**Root-cause fix.**

- **Membership validation (ship first, S–M).** Reuse the shared matcher
  (`scripts/lint-ratchet/ratchet-globs.ts`): for each row naming `ratchet/X`, for
  each tracked file the row matches, assert the file is in `ratchet/X`'s
  membership and not in its `ignores`. Emit `ratchet-membership-mismatch`
  findings. Pure glob matching against `lintRatchets`; runnable under `--staged`.
- **Partial generation (M–L, root fix for rot).** Add
  `scripts/lint-coverage-map-gen.ts` that emits the *rote* sections (notably the
  uniform `scripts/drift-ai/**` family) between
  `<!-- BEGIN generated: drift-ai -->` / `<!-- END -->` markers from
  `git ls-files` × ESLint reach × ratchet membership; the gate diffs the
  generated block against the committed block (same pattern as
  `scripts/harness/generate-verify-steps.ts`). Keep curated rows (with their
  human `Blocker/follow-up` prose) hand-written but membership-validated.

**Why not doc-only.** Fixing the "generator" sentence changes none of the actual
rot. Membership validation is the cheap durable guard.

**Effort:** M (membership) / L (generation). **Risk:** low (membership) / med
(generation — mitigate clobbering curated prose with explicit markers).

---

## Architectural recommendation

**The 419-line hand-registered table is itself the root cause of A1/A5/A6.** The
doc is, by its own header (`lint-coverage-map.md:10-13`), a *manually-maintained
denormalisation of three machine-readable sources* (`git ls-files` ×
`eslint.config.js` reach × `lint-ratchet-config.ts`). Denormalised caches of
derivable data always drift — that is A5 in one sentence — and requiring a row
per file is what makes A1/A6 a daily tax.

**Preferred redesign — invert to an EXEMPT allowlist.** The gate's real value is
"no tracked code surface silently escapes both ESLint and ratchets." You do not
need a row per file for that; you need the opposite: derive coverage
programmatically (`eslint.calculateConfigForFile`, already used at
`-eslint-reach.ts:39`; `lintRatchets` membership, already at check.ts:34) and
require a hand entry **only** for files that are neither linted nor ratcheted.
That exemption list is tiny and rarely changes. New covered files — the
overwhelmingly common case (every new `scripts/**/*.ts` is linted by default per
`lint-coverage-map.md:53`) — need **zero** human action. This kills A1 (no row
for covered files), A6 (almost nobody adds rows), and most of A5 (the big
derivable sections vanish). The table shrinks to an exemptions list + rationale
prose.

**Caveat — non-JS/TS surfaces need explicit semantics preserved (Codex review).**
`trackedFileIsInScope` (`-patterns.ts:144-148`) puts more than JS/TS in scope:
Markdown, shell, Prisma, SQL, etc. "Linted or ratcheted by ESLint" does not
describe these — a `.sql`/`.prisma`/`.sh`/`.md` file is governed by *other* tools
(or is legitimately not code). So the inverted model is not simply
"linted-or-ratcheted ⇒ no entry; else exempt". It must keep first-class,
explicit classifications — e.g. `owned-by: <tool>`, `not-code`, `excluded` — for
those surfaces, derived where possible (tie a surface to the tool/check that owns
it) and hand-listed only where no tool claims it. Retiring the table must
preserve, not flatten, this ownership taxonomy.

**Alternative — generate the table, keep it as documentation.** Lower payoff
(agents still occasionally touch generated regions) but preserves the
human-readable inventory if the team values it.

**Recommendation.** Ship the tactical fixes (A1/A6, A2, A3, A4) now — all S/M,
low risk, valuable regardless of the eventual redesign — and pursue the inverted
allowlist as a separate leaf. **Effort:** L. **Risk:** med (re-points the gate;
do behind a transition where both old table and new derivation must agree before
the table is retired).

**Decision (2026-06-12) — commit to the inversion as a separate leaf, after the
tactical fixes.** The payoff is concrete, not aspirational: of ~194 data rows,
~157 are `linted`/`linted + ratcheted` (they vanish — and they are exactly the
high-churn `scripts/**/*.ts` surface that incurs the per-file row tax), while only
~37 are `excluded`/`not-code` and survive as the hand list (low-churn:
Prisma-managed, lockfiles, fixtures, markdown templates). An ~80% cut concentrated
on the churny rows. Three constraints on the leaf:

1. **Two-speed derivation; A3 is a precursor.** Deriving coverage for every
   tracked file on every pre-commit would blow the gate budget (the table exists
   as a cache precisely to avoid that). Derive **staged files only at pre-commit**
   and the **full set in CI/full verify** — which is literally A3's `:check` vs
   `:audit` split. Land A3 first so the two-speed pattern already exists.
2. **Dual-run de-risks the cutover but does not relieve the pain.** While both run,
   the 419-row table is still enforced, so the daily row tax continues. Define the
   agreement/exit criterion up front and keep the window short — otherwise it is
   the cost of two systems plus continued friction.
3. **The `owned-by` remainder is not fully machine-derivable.** There is no
   machine-readable "this `.sh` is owned by shellcheck / this `.sql` is not-code"
   source today, so that ~37-entry classification stays hand-listed. "Derive
   coverage, hand-maintain only exemptions" is right, but the exemption list is
   ~37, not "a handful" — sell it as an 80% cut, not zero-maintenance.

## Critical files
`scripts/lint-coverage-map-check.ts`, `-findings.ts`, `-io.ts`, `-patterns.ts`,
`-eslint-reach.ts`, `scripts/ai-hooks/lint-coverage-check.sh`,
`docs/generated/lint-coverage-map.md`, `package.json:81`,
`scripts/lint-ratchet/ratchet-globs.ts`.
