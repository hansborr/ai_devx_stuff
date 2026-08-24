# Reject Shell Smokes Passed to the Vitest Wrapper

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: S
Source: `focused-verification-gaps.md` — “Shell smoke false greens”

## Problem

The root `test:scripts:file` command invokes the scripts Vitest project with
`--passWithNoTests` (`package.json:55-57`). Passing a shell smoke path to that
command runs no test and exits zero; `scripts/vitest.sh:69-71` deliberately
normalizes the no-test result as success. The persisted source records this
mistake recurring independently three times
(`/home/node/persist/musi/pain_points/focused-verification-gaps.md:10-19`).

Code-quality leaf `27-shell-test-substrate.md` is proposed but not promoted
(`:1-4`) and only documents direct Bash as a warning inside its migration
procedure (`:117-123`). It does not prevent the false green, and its broader
test-substrate work need not land first.

## Scope

- In `scripts/vitest.sh`, before dependency preflight or Vitest dispatch, reject
  a path-like positional argument ending `.sh`. Exit 2 with a diagnostic that
  names the bad path and directs the caller to `bash <path>` for one smoke or
  `bun run test:scripts` for the registered shell-smoke suite.
- Do not invoke dependency preflight or Vitest after rejecting the shell path.
  Preserve forwarding for `.test.ts`/`.test.tsx` files, option-only calls,
  `--version`, and ordinary Vitest filters.
- Add regression cases beside the direct wrapper coverage in
  `scripts/tests/test-test-changed.sh:637-650`: a `.sh` positional exits 2,
  prints the remediation, and leaves the Vitest stub untouched; a scripts
  TypeScript test and `--version` still reach the stub with unchanged argv.
- Update root `AGENTS.md` command guidance to say explicitly that
  `test:scripts:file` is for Vitest files and shell smokes run with direct Bash.
- Do not change `package.json`, remove `--passWithNoTests`, redesign shell-smoke
  discovery, or absorb code-quality leaf 27's test-substrate migration.

## Acceptance

- `bun run test:scripts:file -- scripts/tests/example.sh` exits 2 before
  Vitest, names the path, and recommends the direct Bash command.
- A valid scripts Vitest path, option-only invocation, and `--version` retain
  their current argv and exit semantics.
- The guard does not infer that every no-test result is an error; it rejects
  only the known invalid shell-path input.
- `bash scripts/tests/test-test-changed.sh` and
  `bash scripts/tests/test-test-scripts.sh` pass.

## Resolved decisions

- Promote the guard instead of treating code-quality leaf 27 as the owner.
  Documentation inside an unpromoted migration plan does not close a
  repeatedly-hit false green, while this fail-fast check is independent and
  bounded.
- Keep the guard in the shared Vitest wrapper so every package-script spelling
  receives the same diagnostic without adding or changing package aliases.

## Open questions

None.
