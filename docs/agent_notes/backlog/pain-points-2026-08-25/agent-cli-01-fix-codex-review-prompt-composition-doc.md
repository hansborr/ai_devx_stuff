# Fix codex.md's False Claim That Review Prompts Compose With Diff Flags

Status: Implemented — clap conflict re-verified live on codex-cli 0.151.0 (spec reproduced on 0.149.0); doc cites 0.151.0
Date: 2026-08-25
Priority: P2
Size: S
Source: `agent-cli-and-external-reviews.md` — “`review codex` rejects a `-p`
instruction whenever `--base` is passed” and “The native `review codex` seat
may delegate the whole review outward”

## Problem

`.claude/skills/agent-cli/references/codex.md` ("Native review harness")
states: "An optional wrapper `-p` adds custom review instructions and
composes with the mode flags." This is false for the live codex CLI.
Reproduced directly against the installed binary:

```
$ codex --version
codex-cli 0.149.0
$ codex review --base main -- "test instruction"
error: the argument '--base <BRANCH>' cannot be used with '[PROMPT]'

Usage: codex review --base <BRANCH> [PROMPT]
```

The same clap-level conflict holds for `--commit` and `--uncommitted`; a bare
`codex review -- "test instruction"` (no mode flag) is accepted. Reproduced
end-to-end through the wrapper itself, from the primary checkout:

```
$ scripts/agent-cli/agent-run.sh review codex -p 'focus on auth' -- --base main
agent-run: starting: wrapper-pid 2045610
agent-run: dispatched: review codex wrapper-pid 2045610
agent-run: backend-pid: 2046118
error: the argument '--base <BRANCH>' cannot be used with '[PROMPT]'
agent-run: backend-exit: 2
```

This exactly reproduces the pain-point note's incident text. The note also
records the practical consequence recurring across at least five drain units
(137, 177, 207, 209, 243, 253): because `-p` can never ride alongside a diff
mode flag, there is no way to hand the native `review codex` seat a "do not
dispatch other agents/CLIs" instruction, and the seat has repeatedly spent its
run sub-dispatching `consult claude -m fable`, `consult copilot`, or
`consult cursor` and quoting the nested result back as its own untagged
summary — once (unit 209) exhausting a `consult cursor` pool a merge-gate
seat needed minutes later.

The wrapper's own smoke test
(`scripts/tests/test-skill-dispatch-wrappers.sh:1053`, `"codex: review
composes a custom-instruction prompt with mode flags"`) passes only because it
exercises a `FAKE_BIN` stub that does not model codex's real argument grammar,
so the suite gives no signal that the documented composition is broken
against the real CLI.

## Scope

- In `.claude/skills/agent-cli/references/codex.md` under "Native review
  harness (`review codex`)", replace the false composition claim with the
  actual constraint: `-p` and any of `--base`/`--commit`/`--uncommitted` are
  mutually exclusive on the native CLI (a clap `conflicts_with`, not a wrapper
  restriction), so a caller who needs both a diff mode and a custom
  instruction — including "do not dispatch other agents/CLIs" — must use
  `consult codex` instead, per the existing "prefer `consult codex`" guidance
  already at `SKILL.md:38`.
- Add one line documenting the observed self-delegation behavior: the native
  `review codex` seat has repeatedly sub-dispatched other agent-cli backends
  when given only a diff-mode flag and no accompanying instruction, sometimes
  returning the nested answer as an untagged two-line summary of its own;
  treat an untagged summary from this seat as a cue to grep its log for a
  nested `consult` dispatch before trusting it as an independent read, and
  budget the seat at roughly ten minutes regardless of diff size.
- Run `bun run harness:skills:refresh` so the `.codex/skills/agent-cli` mirror
  picks up the corrected text, and confirm the projected file matches.
- Out of scope: changing `agent-run.sh`'s argument construction (the conflict
  lives in the real codex binary, not the wrapper, and the wrapper only
  forwards the caller's passthrough args as given); adding a wrapper-side
  pre-flight rejection of `-p` combined with mode flags (would require parsing
  arbitrary passthrough to detect the three specific native flags, for a
  caller mistake the corrected doc already prevents); retitling or otherwise
  touching `scripts/tests/test-skill-dispatch-wrappers.sh:1053` (its
  `FAKE_BIN` limitation is noted here for context but fixing test coverage of
  a third-party CLI's argument grammar is a separate, larger effort); and any
  change to DRAIN-protocol or merge-gate seat policy (no current backlog pack
  references `review codex` as a live gate seat, so that policy already
  appears to have moved off this seat).

## Verification

- `codex review --base main -- "x"` (and `--commit`/`--uncommitted`
  equivalents) continuing to exit 2 with the clap conflict error is the live
  fact the doc must match; re-run it after editing to confirm the corrected
  text still describes reality.
- `bun run harness:skills:refresh` produces only the expected `codex.md` diff
  in both the `.claude` and `.codex` trees, and a second refresh is clean.
- `bash scripts/tests/test-skill-dispatch-wrappers.sh` continues to pass
  unchanged.
- `bun run harness:check` and `bun run docs:harness-controls:check` pass.
