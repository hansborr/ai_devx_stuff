# 165. Fifteen drift command fakes accept unexpected Git invocations

Status: Landed on fix/cq-165
Theme: strict dependency fakes · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Seven drift-AI command-test files use lenient Git callbacks alongside an existing strict fake. The lenient callbacks inspect only `args[0]`: any `rev-parse` variant receives the repository root, while every other unrecognized invocation commonly receives an empty string.

Those tests can therefore stay green when production adds a Git call, changes its arguments, or sends the wrong `rev-parse` operation. Contributors reading the suites also see two incompatible descriptions of the command dependency contract.

## Evidence

- `scripts/drift-ai/birth-size-delta-command.test.ts:70-73` exemplifies the weak form: it accepts every invocation whose first argument is `rev-parse` and returns `""` for every miss.
- A pin-local inventory finds 15 such callbacks across seven files, not eight across six: four in `scripts/drift-ai/test-orphaning-command.test.ts:52,91,116,138`, four in `scripts/drift-ai/ownership-command.test.ts:52,94,119,138`, and three in `scripts/drift-ai/birth-size-delta-command.test.ts:71,122,146`.
- The remaining four are the `gitRoot` helpers in `scripts/drift-ai/class-construction-command.test.ts:135-136`, `scripts/drift-ai/coverage-evidence-command.test.ts:57-58`, `scripts/drift-ai/coverage-unused-correlation-command.test.ts:76-77`, and `scripts/drift-ai/env-branches-command.test.ts:77-78`.
- Correction recorded at landing (2026-08-20): the live count is **16 callbacks across eight files**. The pin-local inventory above missed `scripts/drift-ai/config-inspect.test.ts:229`, a `gitRoot` helper of the identical weak form that predates the audit pin (added 2026-06-04 in `1405fa3a6`) and was almost certainly skipped by a `*-command.test.ts` glob, though it is a drift-AI command test for the `config-inspect` subcommand. It is excluded nowhere in `## Scope / caveats`, so `fix/cq-165` converted it with the other seven files.
- `scripts/drift-ai/git-runner.test-helper.ts:22-30` matches the complete `args.join(" ")` key and throws `unexpected git invocation` on every unregistered command.
- `scripts/drift-ai/git-runner.test-helper.ts:33-38` builds `currentRepoGit` from that strict matcher with exactly one permitted invocation: `rev-parse --show-toplevel`.
- The helper’s own contract test confirms that an unregistered key throws at `scripts/drift-ai/git-runner.test-helper.test.ts:5-10`.

## Proposed direction

Replace all 15 lenient `args[0]`-matching callbacks across the seven command-test files with `currentRepoGit` or `makeStubGit`, adding explicit response entries only for Git invocations that a scenario intentionally permits.

Use `currentRepoGit(repoRoot)` for rev-parse-only scenarios. Where a scenario intentionally serves more than repository-root discovery, use `makeStubGit` with complete joined-command keys rather than extending `currentRepoGit` or adding another prefix matcher.

## Scope / caveats

- Preserve each scenario’s intended responses, including the additional Git operations explicitly exercised by ownership and history cases; strictness must expose accidental calls, not reject documented ones.
- Do not fold `boundedGit`, `gitBuffer`, or other injected command channels into this helper. They represent separate dependencies and frequently model history, config, or binary output.
- Keep the specialized coldspots and hotspots fakes out of this sweep. They parse window arguments and `-G` branches that the flat response map cannot express, as documented at `scripts/drift-ai/git-runner.test-helper.ts:10-12`; those fakes already throw on misses at `scripts/drift-ai/coldspots.test.ts:48-56` and `scripts/drift-ai/hotspots.test.ts:39-48`.
- Do not weaken `makeStubGit` with a default response. Throwing on every unregistered invocation is the behavior this work is intended to adopt.
