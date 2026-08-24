# Portability and prerequisites

Notes for copying this skill into another repo or provisioning a new
environment. Callers dispatching in an already-working repo do not need them.

## Threat model

The wrapper trusts same-UID processes, including every delegated backend. It
defends against crashes, fatal signals, concurrent instances of the wrapper,
and caller mistakes with `-o` and `--share` paths. Adversarial same-UID races
on wrapper-private paths are deliberately out of scope: `work` grants its
backend full permissions as the same UID, so the temporary-path machinery
does not cross or enforce a privilege boundary.

- The wrapper is plain bash with no build step. The copy set is two pieces:
  `scripts/agent-cli/` (the `agent-run.sh`/`agent-wait.sh` executables, which
  are provider-neutral and live outside every skill tree) plus your provider's
  skill directory (`.claude/skills/agent-cli/` or `.codex/skills/agent-cli/` —
  the documentation projection, including this file and the trailer contract).
- Normal dispatch needs Bash 4.4 or newer (for `mapfile`, associative arrays,
  and `set -u`-safe `"${arr[@]}"` expansion of an empty array — the script
  expands empty arrays on every run), the target CLI on `PATH`, `git`, `flock`,
  GNU-compatible `realpath -m`, file-operand `sync FILE`, `mv -fT`, `ln -T`,
  `stat -c`, GNU-compatible `sed`, `stdbuf`, `/dev/fd`, and standard Unix
  text/process utilities.
  Copilot additionally needs a logged-in `copilot login`; cursor needs
  `agent login`.
- Backend protocols are line-oriented JSON/text. Codex first `tee`s raw output
  byte-for-byte into its private capture, then line-buffers only the filtered
  stdout copy with `stdbuf`. Tests pin NUL-bearing output and a final line
  without a newline.
- For cursor consults to gather their own branch diff (rather than depending on
  `-f` attachments), the target repo must commit a `.cursor/cli.json` with a
  read-only `git` allowlist — copy Musi's. It re-permits read-only `git` in
  ask mode; without it, cursor consults fall back to file reads plus whatever
  `-f` material the caller supplies. Requires the cursor account's default
  `approvalMode: "allowlist"` (sandbox disabled). See [cursor.md](cursor.md).
  Copy `.cursor/cli.json` **whenever you copy the skill for cursor consults**:
  the injected consult preamble now promises "git diff is fine" unconditionally,
  so porting only the two-piece copy set without the allowlist leaves a
  false contract — cursor's `git` commands are denied and it silently degrades
  to the `-f` fallback while still being told the diff is reachable.
- `flock` is required for every answer-producing run (`consult`/`work`) because
  the answer path has an ownership lock independent of the worktree lock.
  `work` also takes the existing per-worktree lock. Native `review codex` has
  no answer path and remains lock-free; without `flock` it only loses the
  drift-attribution probe.
- `python3` is needed by the claude, copilot, and cursor backends (structured
  result parsing for `-o` and trailers).
- Attempt bookkeeping is flushed by file operand, including containing
  directories where namespace changes must become durable. It never requests
  filesystem-wide `sync -f`. Answer-producing runs preflight file-operand
  support against the existing output directory before creating or retiring
  any answer-path state; failure is a pre-launch environment error (exit 3).
  A newly claimed caller-owned Copilot share flushes both the share inode and
  its own containing directory, which may differ from the answer directory.
- Read-only drift checks ask Git for raw diffs (`--no-textconv --no-ext-diff`),
  temporarily force ctime trust, and add tracked-path `stat` identity metadata.
  The expected detection contract is default Git configuration on a filesystem
  with fine-grained timestamps; the environment features that degrade it — clean
  filters, text/EOL normalization, coarse timestamp granularity, textconv,
  external diff, fsmonitor, index flags, `core.trustctime=false` — and the
  reason an unchanged result is only `best-effort-clean` are specified once
  under "Finalize Records" in
  [trailer-contract.md](trailer-contract.md#finalize-records). Porting note: the
  snapshot needs GNU `stat` (`--printf` with `%d:%i:%f:%s:%y:%z`, invoked once
  for the whole tracked set) and `cksum`.
- Degraded gracefully: `setsid` (when present) lets TERM/INT/HUP signal the
  whole backend process group; `fuser`/`lsof` only improve the busy-lock
  holder message and distinguish a live holder from a likely-stale
  `index.lock` after KILL escalation. Without either tool, the wrapper still
  preserves the lock and requires inspection before the recovery command.
- The wrapper logs its pid immediately before fatal-signal traps become active,
  then logs the attempt record as part of the durable claim before branch or
  runtime setup. `agent-wait.sh` can therefore classify every post-trap abort,
  falling back from `dispatched:` to `attempt:` to `starting:`.
- Validation: run `shellcheck scripts/agent-cli/agent-run.sh`
  (in Musi the lint lane already ShellChecks `scripts/**/*.sh`).
- The backend references name CLI versions and model ids that age quickly
  (the "Verified against ..." lines); re-check the local CLI help/catalog
  after upgrades or when porting the skill.
