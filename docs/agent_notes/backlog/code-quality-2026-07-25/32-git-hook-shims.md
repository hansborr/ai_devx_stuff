# 32. Git hooks hold 900 lines of gate orchestration inline, and hook-wiring generation hand-rolls a JSON text editor

Status: Scheduled work landed 2026-07-31 on `fix/cq-harness-h16-h17` (merge
`c6e1be2a2`) — H16 and H17 landed; no scheduled slice remains
Theme: Hook wiring surfaces carry work that is not hook wiring · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

The repo has an explicit shim convention for agent-harness hooks:
`scripts/harness/hook-shims.ts:1-11` states that it derives thin adapter shims for
`.claude/hooks/`, `.codex/hooks/`, and `.copilot/hooks/` from
`harness.controls.json`, and that shim bodies must live in
`scripts/ai-hooks/<safe-name>.sh`. Git hooks are outside that convention entirely,
and they are the largest hooks in the tree: `.husky/pre-commit` is 461 lines,
`.husky/pre-push` 346, `.husky/post-commit` 103. `pre-commit` sources ten
libraries unconditionally at top level plus three more conditionally, and then
implements the commit gate inline. So the single most load-bearing script in the
repo — the one that runs on every commit in every worktree — is the one script
that is neither a shim nor a normal file under `scripts/`.

The consequence for a maintainer is discoverability, not correctness. The body is
in fact heavily exercised, but under the wrong name: `.husky/pre-commit` is a
declared smoke subject in `scripts/path-policy/path-policy-smoke-subjects-data.ts`
(`:86`, `:123`), and `scripts/tests/test-dependency-freshness.sh` executes
`sh .husky/pre-commit` at `:296`, `:321`, `:375`, `:426`, `:455`, `:501`, `:558`,
`:614`, `:660`, `:718`, `:743` and elsewhere — 53 executions across 61 referencing
lines in a 2386-line file named after a different script. No file under
`scripts/tests/` is named after the commit hook at all, so anyone looking for the
commit gate's tests will not find them. Leaf 27 step 5 refiles that coverage; the
body split here waits on it.

The same layer has two smaller shape problems. `scripts/harness/generate-hook-wiring.ts`
carries a 101-line hand-written JSON text scanner (`:144-244`) whose only job is
to locate and replace the `hooks` key inside `.claude/settings.json` without
touching the rest of the file. And `scripts/harness/hook-wiring-schema.ts` — a
file whose name promises parsing and validation — ends with 40 lines of Markdown
rendering (`:373-412`) that exist for exactly one consumer.

## Evidence

Git hook bodies:

- `.husky/pre-commit` — 461 lines; `.husky/pre-push` — 346; `.husky/post-commit` — 103.
- `.husky/pre-commit:41`, `:62`, `:64`, `:66`, `:68`, `:70`, `:72`, `:74`, `:76`, `:78` — ten unconditional top-level `.` sources (`scripts/lib/gate-env.sh`, `scripts/dependency-freshness.sh`, `scripts/prisma-client-freshness.sh`, `scripts/doc-length-policy.sh`, `scripts/ai-hooks/output-filter.sh`, `scripts/lib/verify-metadata.sh`, `scripts/process-tree.sh`, `scripts/lib/parallel-step.sh`, `scripts/lib/lint-dist-preflight.sh`, `scripts/lib/verify-engine.sh`), plus three conditional sources: `:57` (`scripts/ai-hooks/policy.sh`, soft-sourced behind `[ -f ]` — see the comment at `:50-54`), `:257` (the freshness fragment), and `:397`/`:399` (the generated verify step list).
- `scripts/harness/hook-shims.ts:1-11` — the documented shim convention; it covers `.claude`/`.codex`/`.copilot` and no git hooks.
- `scripts/path-policy/path-policy-smoke-subjects-data.ts:86`, `:123` — `.husky/pre-commit` is already a declared smoke subject.
- `scripts/tests/test-dependency-freshness.sh:19` (the `# smoke-subjects:` header), `:283`, `:296` (and 58 more referencing lines in the same file) — the actual coverage for the pre-commit body, filed under the dependency-freshness subject.
- `docs/agent_notes/backlog/arch-plans-2026-07/03-harness-hook-shim-generation.md` — the adapter shim-generation plan, Status: Done, landed 2026-07-19 (`3e9b28df`). Overlapping scope: it owns the generated `.claude`/`.codex`/`.copilot` shims; this leaf owns the git hooks that convention excludes.

Hand-rolled JSON editing:

- `scripts/harness/generate-hook-wiring.ts:144-244` — `indentJsonValue`, `findJsonStringEnd`, `parseJsonStringAt`, `findJsonValueEnd`, `findHooksValueStart`, `isJsonObjectKeyPosition`, `findClaudeHooksRange` (`:207`), `replaceClaudeHooksInSettings` (`:238`). 101 lines of character-level scanning.
- `scripts/harness/generate-hook-wiring.ts:301` — `--check` mode compares whole-file text: `claudeSettingsText === outputs.claudeSettingsJson`.
- `.claude/settings.json` — 210 lines; the generated `hooks` key starts at `:90`. The 89 lines before it are hand- and tool-maintained `env`, `permissions`, and `enabledPlugins`, and Claude Code itself rewrites the file (e.g. via `/permissions`). `.claude/` is prettier-ignored, so no formatter arbitrates the result.
- `scripts/harness/generate-hook-wiring.test.ts:823-918` — ~95 lines of dedicated tests encoding the scanner's contract (escaped keys, compact JSON, nested `hooks` keys, string-value decoys), including "replaces only the Claude hooks key" (`:823`) asserting `"env": {\n    "KEEP": "yes"\n  }` survives byte-for-byte.

Validation mixed with rendering:

- `scripts/harness/hook-wiring-schema.ts` — 412 lines: capability data and type declarations `:1-138` (`HOOK_MATCHER_POLICY` at `:44`, `HOOK_OUTPUT_SUPPORT` at `:106`), guards/parsers/asserts `:140-371` (`resolveHookWiring` at `:332`), Markdown projection `:373-412`.
- The projection is four functions: `formatOutputs` (`:373`), `formatCommandDetails` (`:379`), `formatHarnessLine` (`:389`), `formatHookWiring` (`:399`).
- `scripts/harness/generate-harness-controls.ts:28` imports `formatHookWiring`; `:248` is the sole call site. No other consumer anywhere.

## Proposed direction

Ordered so the zero-risk item lands first and the commit gate is touched last.

1. **Move the Markdown projection out of the schema module.** Cut
   `formatOutputs`, `formatCommandDetails`, `formatHarnessLine`, and
   `formatHookWiring` from `scripts/harness/hook-wiring-schema.ts:373-412` into
   `scripts/harness/hook-wiring-doc.ts` (or directly into
   `scripts/harness/generate-harness-controls.ts`, its only consumer), and update
   the import at `generate-harness-controls.ts:28`. Mechanical cut, no behaviour
   change, and it makes the `*-schema.ts` name truthful. Run
   `bun run harness:check` and `docs:harness-controls:check` afterwards.
2. **Replace the hand-rolled scanner with a localized-edit library, not a
   reserialiser.** Swap `scripts/harness/generate-hook-wiring.ts:144-244` for a
   dependency that performs a *surgical* text edit of one key while preserving
   every other byte (the `jsonc-parser` `modify`/`applyEdits` shape is the right
   category). Keep `replaceClaudeHooksInSettings` as the public entry point so
   `:301`'s whole-file comparison keeps working unchanged. Re-point the ~95
   lines at `scripts/harness/generate-hook-wiring.test.ts:823-918` (the
   "replaces only the Claude hooks key" case is at `:823`) at the new
   implementation *before* deleting the old one — those tests are the contract,
   and every case in them (escaped keys, compact JSON, nested `hooks`, string
   decoys) must still pass.
3. **Take the pre-commit test extraction as a dependency, not as work.** Leaf 27
   step 5 owns it: it moves everything from
   `scripts/tests/test-dependency-freshness.sh:271` to the end of that file into
   `scripts/tests/test-pre-commit.sh`, owns that filename, and regenerates the
   smoke-subject data. Do not plan, duplicate or rename any part of it here; step
   4 below is blocked until it has landed.
4. **Give the pre-commit body its own file.** With the gate's assertions already
   filed under their own name, move the orchestration out of `.husky/pre-commit`
   into e.g. `scripts/hooks/pre-commit-gate.sh`, leaving `.husky/pre-commit` as a
   thin dispatcher that resolves the repo root and execs it. Update the smoke
   subject registration so the new body, not the dispatcher, is the declared
   subject. This step changes a documented ownership claim and carries three
   mandatory sub-tasks:
   - Update `docs/guides/verify-gate-lifecycle.md`. It currently says at `:33-35`
     that "The hook remains the policy adapter: it visibly owns protected-branch
     policy, advisories, changed-input preflight, fast-commit provenance, and the
     bounded 30-second memory-deferral policy", and links `.husky/pre-commit` at
     `:24` and `:13` as that adapter. The seam that sentence protects is
     policy-adapter versus engine, not file location — the same paragraph already
     names `scripts/verify.sh` as "the manual policy adapter for the same entry
     point", and that adapter lives under `scripts/`. Moving the pre-commit
     adapter body to `scripts/hooks/pre-commit-gate.sh` keeps the seam and makes
     the two adapters symmetric, individually testable, and findable by name.
     Re-point the doc's links and diagram at the new file and state plainly that
     `.husky/pre-commit` is a dispatcher.
   - Move the same claim in the hook's own comment. `.husky/pre-commit:416-418`
     reads "The hook visibly owns policy (including the protected-branch guard
     and 30-second memory-deferral cap), while verify-engine owns gate mechanics"
     — that comment belongs with `PRECOMMIT_GATE_POLICY` in the new body file.
   - Update the fixtures in the same commit. Six sandboxes copy
     `.husky/pre-commit`: `copy_precommit_fixture` plus five direct copies, at
     `scripts/tests/test-dependency-freshness.sh:115`, `:283`, `:687`, `:812`,
     `:1012` and `:1483` today, and in `scripts/tests/test-pre-commit.sh` plus
     `scripts/tests/lib/` once leaf 27 step 5 has landed. Each must also copy the
     new body file. Register the new path by editing the consuming suite's
     `# smoke-subjects:` header and running `bun run test:scripts:subjects`, then
     committing the regenerated
     `scripts/path-policy/path-policy-smoke-subjects-data.ts` and
     `scripts/fixtures/test-scripts/all-smoke-tests.txt`. Both are generated —
     `path-policy-smoke-subjects-data.ts:1` reads "Generated by
     `scripts/path-policy/generate-smoke-subjects.ts`. Do not edit by hand." — and
     a hand edit is rejected by the freshness check. `bun run harness:check` is a
     post-step, not the regenerator. Without the registration the fixture copy-set
     gate (`cc1f8a86`, `c8b27f49`) fails.

   Land this as its own commit on its own branch — see the risk caveat below.
5. **Apply the same treatment to `.husky/pre-push` and `.husky/post-commit`**
   once the pre-commit split has survived a few days of real use — same shape,
   lower stakes.
6. **Settle where git hooks sit relative to the shim convention.**
   `docs/agent_notes/backlog/arch-plans-2026-07/03-harness-hook-shim-generation.md`
   is Done (`3e9b28df`); read it for what the generated shim convention now
   covers, then update `docs/ai-harness.md` (see **Adapter Boundary**, which
   describes shim templates and `bun run harness:wiring`) so the convention
   explicitly states whether git hooks are in or out of scope.

## Scope / caveats

- **The pre-commit body's coverage is misfiled, not absent.** `.husky/pre-commit`
  is a declared smoke subject (`scripts/path-policy/path-policy-smoke-subjects-data.ts:86`,
  `:123`) and is executed 53 times by `scripts/tests/test-dependency-freshness.sh`.
  That strengthens step 4 — the body deserves its own file and its own named
  subject — and it means the gate already has the assertions it needs. Do not
  write fresh coverage for the gate here; leaf 27 step 5 refiles what exists.
- **Sequencing with leaf 27.** Leaf 27 steps 1-4 (the shell-test substrate) and
  then leaf 27 step 5 (the pre-commit extraction) must both land before step 4
  here. Steps 1-2 and 6 carry no such dependency and can be scheduled at any time.
- **Leaf 31 step 13 changes smoke-subject discovery.** Step 4 re-points a declared
  smoke subject from `.husky/pre-commit` to the new body file, which runs through
  `scripts/path-policy/path-policy-smoke-subjects.ts` — the module that discovers
  smoke test names by reading `scripts/tests/` at import time. Land that
  re-registration before leaf 31 reworks the discovery, or the two changes will be
  debugged together.
- **`.claude/settings.json` byte preservation is load-bearing, not cosmetic.**
  The scanner exists because the file is co-owned: `env`, `permissions`, and
  `enabledPlugins` occupy the 89 lines before the `hooks` key, Claude Code
  rewrites the file itself, `--check` mode compares the whole file text at
  `generate-hook-wiring.ts:301`, and `.claude/` is prettier-ignored so no
  formatter would re-normalise a churned file. **Do not replace the scanner with
  `JSON.parse` + `JSON.stringify`** — a parse-and-restringify will reformat the
  human-owned region and put `--check` into permanent failure.
- **Do not try to move the generated hooks into an included generated file.**
  Claude Code's settings format has no include mechanism for hooks. The
  localized-edit-library path in step 2 is the only viable replacement; if no
  suitable library is acceptable, keeping the current scanner is a defensible
  outcome and step 2 should be closed as "won't do" rather than forced.
- **Step 4 is the highest-risk change in this pack.** `.husky/pre-commit` is the
  commit gate; a dispatcher bug blocks every commit in every worktree, including
  the commit that would fix it. Do it on its own branch, verify by making real
  commits in a secondary worktree (see `docs/guides/per-worktree-dev.md`), and
  preserve the repo-root resolution and the exit-status propagation exactly.
  Land it separately from steps 1-2.
- Preserve all three conditional sources — `.husky/pre-commit:57`, `:257`, and
  `:397`/`:399` — verbatim; each is conditional for a reason. `:57`
  (`scripts/ai-hooks/policy.sh`) is soft-sourced because the minimal pre-commit
  fixtures copy only the ten unconditional libs
  (`scripts/tests/test-dependency-freshness.sh:105-114`) and deliberately omit it;
  the guard has direct coverage via `ai_guard_commit_branch_or_die` in
  `scripts/ai-hooks/test.sh`, and hoisting it into the unconditional source block
  aborts `sh .husky/pre-commit` in every one of those fixtures. `:257` (the
  freshness fragment) and `:397`/`:399` (the generated verify step list) would
  change gate behaviour if hoisted. When step 4 moves the body to
  `scripts/hooks/pre-commit-gate.sh`, all three guards move with it unchanged.
- Steps 1 and 2 touch generated harness surfaces; run `bun run harness:check`
  after each, per `AGENTS.md`. Step 4 changes what the commit gate is, so read
  `docs/guides/verify-gate-lifecycle.md` first.
- Steps 1-2 (hook-wiring generation) and steps 4-5 (git hook bodies) are
  independent of each other and can be scheduled separately. They are one leaf
  because they are the same class of problem — the hook layer holding work that
  is not hook wiring — but nothing sequences step 4 after step 2.
- **Operational risk exceeds the size.** The work is a 101-line scanner replaced
  against a ~95-line contract test, a 461-line gate body split behind a
  dispatcher, and then the same treatment for `pre-push` (346 lines) and
  `post-commit` (103). This is the only leaf in the pack that can block every
  commit in every worktree, so it should be scheduled with slack around it and
  never bundled with unrelated work.
