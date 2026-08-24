# 68. One 809-line lint-ratchet acceptance suite serializes 32 blocking CLI runs in a single Vitest worker

Status: Landed on fix/cq-068
Theme: acceptance-suite decomposition and parallelism · Area: tests · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/lint-ratchet/output.test.ts` is the acceptance suite for the lint-ratchet
CLI's output contracts — envelope emission, the merge-driver presence warning,
the diagnostics output file, propose mode, rule-source drift reporting, update
preflight, and tracked-file collection. Those are independent contracts, but all
of them live in one 809-line file, and every acceptance invocation goes through a
`spawnSync`-based runner that blocks the Vitest worker until a full
`bun run scripts/lint-ratchet.ts` child process exits. The file performs 32
child-process CLI executions this way, one after another.

Vitest distributes work per file, so a single file means a single worker: the
scripts project is configured for up to 6 workers, and this suite can use exactly
one of them while the other subject groups queue behind whichever is running.
The cost lands on contributors twice. Focused feedback is slow — touching propose
mode still pays for the merge-driver scenario's five sequential CLI launches
under a 60-second timeout — and per-subject cost is invisible, because one
filename absorbs the runtime of seven unrelated contract groups. lint-ratchet is
a surface contributors touch often (every baseline change routes through it), and
the repo demonstrably cares about gate latency: fast-commit mode exists precisely
because the tests slot is slow.

The file already contains the seams the split needs: the subject groups are
separate `describe` blocks, most tests build their own isolated fixture via
`makeFixture`, and only the diagnostics-file group deliberately shares a
suite-lifetime fixture (a documented byte-identical contract).

## Evidence

- `scripts/lint-ratchet/output.test.ts` — 809 lines (`wc -l`), one Vitest file,
  therefore one worker for all seven subject groups.
- `scripts/lint-ratchet/output.test.ts:312-338` — `runLintRatchet` filters the
  environment, then at `:330` calls
  `spawnSync("bun", ["run", "scripts/lint-ratchet.ts", ...args], …)` with
  `maxBuffer: OUTPUT_BUFFER_BYTES` (10 MB, `:23`) — a blocking child-process API.
- 32 runtime child-process executions, re-counted at the pin: 22 direct
  `runLintRatchet` call sites plus 10 `seedCleanBaseline` call sites
  (`seedCleanBaseline` at `:340-343` wraps one more `runLintRatchet --update`).
- `scripts/lint-ratchet/output.test.ts:423-459` — a single merge-driver-warning
  test performs five sequential CLI launches (`:431`, `:436`, `:441`, `:445`,
  `:455`) plus a `bash` installer run (`:451`) under one
  `{ timeout: 60_000 }` (`:426`).
- `scripts/lint-ratchet/output.test.ts:480-561` — the diagnostics-output-file
  group: the comment at `:481-488` documents the deliberate contract (four
  read-only cases share ONE byte-identical clean+seeded fixture built in
  `beforeAll`, each reading/writing a unique output filename so
  negative-existence assertions stay meaningful; the mutating `writeDebugSource`
  case at `:535-551` keeps its own throwaway fixture). The shared fixture uses
  `registerTempRootCleanup(afterAll)` at `:489`.
- `scripts/vitest.config.ts:13` — `maxWorkers: NON_SERVER_TEST_MAX_WORKERS`;
  the default is 6 (`vitest.config.ts:10`, env-overridable, capped at 8 by
  `vitest.config.ts:11`). File-level distribution is available and unused.
- Zero `it.concurrent` occurrences anywhere in `scripts/` or `packages/`
  (repo-wide grep at the pin) — within-file concurrency would be a first.
- `scripts/lint-ratchet/lint-ratchet.test-helper.ts` — the existing sibling
  `.test-helper.ts` convention; `output.test.ts:72` already filters
  `.test-helper.ts` files out of `lintRatchetAdapterFiles()`, and the
  copy-closure test's `allowedFiles` (`:91`) is built from that same function,
  so an extracted helper stays out of the fixture copy set with no list edits.
- `scripts/test-support/tmp-repo.test-helper.ts:39-47` — the default
  `afterEach` cleanup handle drains ALL tracked temp roots after each completing
  test; safe today because tests run serially within the file.
- Registration surfaces keyed to the current filename:
  `lint-ratchet.baseline.json:646` holds `ratchet/no-direct-git-exec-scripts`
  `{count: 4}` for `scripts/lint-ratchet/output.test.ts` (the four
  `execFileSync("git", …)` sites at `:66`, `:277-278`, `:282`), and
  `scripts/tests/test-lint-ratchet.sh:15` lists the file as an explicit
  `# smoke-subjects:` line (the whole-dir subject at `:4` covers new files).

## Proposed direction

1. **Extract the fixture machinery into a sibling
   `output-fixture.test-helper.ts`**, following the existing
   `lint-ratchet.test-helper.ts` convention: `runtimeFiles` /
   `ADAPTER_SUPPORT_FILES` / `MERGE_DRIVER_FILES`, `lintRatchetAdapterFiles()`,
   `copyRuntimeFile`, the `writeFixture*` / `write*Source` writers,
   `makeFixture`, `runLintRatchet`, `seedCleanBaseline`, the baseline-mutation
   helpers (`replaceFixtureRuleSourceHash` etc.), and `parseEnvelope`. The
   `.test-helper.ts` suffix matters: `lintRatchetAdapterFiles()` and the
   copy-closure `allowedFiles` already filter that suffix, so the helper stays
   out of the fixture copy set with no list edits.
2. **Split the suite by subject group into 4-6 focused files** over that helper,
   e.g. output-emission (copy-closure + envelope-adapter unit tests, no CLI
   runs), output-merge-driver-warn (the five-launch 60s scenario plus the
   stale-annotation warn), output-diagnostics-file (the shared-`beforeAll`
   group, kept exactly as today: one suite-lifetime fixture via
   `registerTempRootCleanup(afterAll)`, plain serialized `it` blocks),
   output-propose, output-drift, and output-update-collection (update preflight
   + tracked-file + inline-suppression). File-level Vitest worker distribution
   (`maxWorkers` default 6 in `scripts/vitest.config.ts`) is the primary
   parallelism win, and the split restores focused per-subject feedback via
   `bun run test:scripts:file -- <file>`. Keep per-test timeouts (15s/60s) with
   the tests they belong to.
3. **Convert `runLintRatchet` from `spawnSync` to an async promise-returning
   runner** (promisified `execFile`/`spawn` with the same env-filtering and
   `maxBuffer` semantics) so tests `await` it.
4. **Enable `it.concurrent` only selectively, and only after the split lands
   safe-serial.** Apply it only inside files where every test builds its own
   isolated `makeFixture`. The repo currently has zero `it.concurrent` usage,
   and any file that enables it must use a per-file
   `registerTempRootCleanup(afterAll)` handle: the default `afterEach` handle
   drains ALL tracked temp roots after each completing test and would delete
   the fixtures of still-running concurrent siblings.

**Landed scope (`fix/cq-068`): steps 1-3 only. Step 4 was deliberately not
taken.** The split produced six files over the extracted helper, which already
saturates the six configured workers (`scripts/vitest.config.ts:13`), so
within-file concurrency would multiply concurrent `bun` CLI spawns for no
further worker-distribution win — the leaf itself names file-level
distribution as the primary parallelism win, and its own Risks section makes
safe-serial first the ordering. `it.concurrent` therefore still has zero
occurrences repo-wide, and step 3's async runner is a deliberate prerequisite
rather than a forgotten one. Anyone reopening step 4 must first re-read its
precondition above: any file that enables `it.concurrent` needs its own
`registerTempRootCleanup(afterAll)` handle, because the default `afterEach`
handle (`scripts/test-support/tmp-repo.test-helper.ts:39-47`) drains ALL
tracked temp roots and would delete a live sibling's fixture.

Registration surfaces the split must carry:

- `lint-ratchet.baseline.json` holds `ratchet/no-direct-git-exec-scripts` items
  `{count: 4}` keyed at `scripts/lint-ratchet/output.test.ts`, and the git
  `execFileSync` calls move into the helper — run `bun run lint:ratchet:update`
  after the move. The known-open net-neutral-rename gap may force accepting the
  same debt under the helper's new path via the CLI's
  `--allow-worse --reason …` flags.
- `scripts/tests/test-lint-ratchet.sh:15` names
  `scripts/lint-ratchet/output.test.ts` in an explicit `# smoke-subjects:` line;
  update the explicit header lines for the new filenames and regenerate with
  `bun run test:scripts:subjects`, committing the two generated files.
- The scripts coverage exclude strips only `**/*.test.ts`
  (`scripts/vitest.config.ts:32`), so the new `.test-helper.ts` enters scripts
  coverage exactly like the existing `lint-ratchet.test-helper.ts` does —
  acceptable, no config change.
- Verify per file with `bun run test:scripts:file -- <file>` (not
  `test:scripts -- <file>`; that wrapper rejects file args).

## Scope / caveats

- **Out of scope:** subject-cluster splitting of the separate shell suite
  `scripts/tests/test-lint-ratchet.sh` — that is the live 2026-07-25 pack item
  CQ25-31 (scheduled as open-ended slices under
  `../code-quality-2026-07-25/27-PLAN.md`, splitting the 5,059-line shell suite
  one subject cluster per session). CQ25-31 is a scope boundary only, not a
  dependency: it never touches this Vitest file, so novelty holds both ways.
- **Out of scope:** any change to the CLI under test, and any change to fixture
  semantics — in particular the byte-identical shared-fixture contract
  documented at `output.test.ts:481-488`. Preserve that group's contracts
  verbatim: suite-lifetime fixture built once in `beforeAll` with
  `registerTempRootCleanup(afterAll)`, unique per-test output filenames so
  negative-existence checks stay meaningful, and the mutating `writeDebugSource`
  case on its own throwaway fixture.
- **Risks:** within-file `it.concurrent` plus the shared `afterEach` temp-root
  drain is a real flake generator (cleanup deletes live fixtures), and
  concurrent `bun` CLI spawns across up to 6 workers raise peak gate load on a
  suite family that already competes with itself — hence step 4's safe-serial
  first, selective-enable ordering. A forgotten baseline update after the helper
  extraction (or the net-neutral-rename gap forcing `--allow-worse`) breaks the
  commit gate.
- **Sequencing:** coordinate with
  [067-lint-ratchet-acceptance-fixtures-emit-321.md](./067-lint-ratchet-acceptance-fixtures-emit-321.md)
  — a near-miss pair on the same file; both edit the
  `writeFixtureRatchetConfig` emitted-type block (`output.test.ts:155-243`).
  Prefer landing 067's content fix first so this leaf relocates the corrected
  writer into the helper; otherwise a mechanical rebase of one over the other is
  required. The two must not run concurrently.
