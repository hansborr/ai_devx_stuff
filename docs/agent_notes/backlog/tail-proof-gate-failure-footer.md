# Tail-proof failure footer for verify and land

Status: Done — 2026-07-19, implemented in this branch (fix/land-gate-footer-prisma).
Date: 2026-07-19
Source: 2026-07-19 drain friction — a backgrounded `land.sh ... | tail -N`
lost a test-slot failure's details; recovery required knowing (from agent
memory) that per-slot logs persist in the verify log dir. Structural fix
requested by the owner: the harness, not memory, should guarantee the
breadcrumb survives truncation.
Size: S.

## Evidence

On a slot failure, `musi_verify_print_failure_summary`
(`scripts/lib/verify-engine.sh`) prints the log-path pointer as a section
HEADER — `--- test (full log: <dir>/test.log) ---` — followed by a 30-line
excerpt per failed slot plus lint/format hints. In `--branch` land mode,
`land.sh` then appends its own multi-line recovery guidance, and the EXIT
trap prints the one-line trailer last. Net effect: the only lines that
survive `| tail -N` for small N are recovery boilerplate and the trailer,
neither of which names the failing slot's log.

Routing a pointer to stderr does NOT fix this: the observed loss was via
`2>&1 | tail`, and background/tool-captured runs merge the streams anyway.
The tail-proof property is positional — pointers must be within the final
few lines of COMBINED-stream output. That is the guarantee this leaf buys:
plain `land.sh | tail` (stdout only) still drops the stderr trailer from
the pipe (it lands on the TTY instead), and stdout/stderr-capturing tools
need not preserve total cross-stream order — the footer and the trailer
each cover their own stream, which is why both changes below are needed
(the verify footer alone does not survive land's post-summary output).

## Proposed fix

1. `musi_verify_print_failure_summary`: after the excerpts and hints,
   print one compact footer as the summary's LAST line, wipe warning
   folded in so `tail -1` still carries the path, e.g.
   `verify: failure logs: <log_dir> (per-slot <slot>.log; wiped by the
   next verify/pre-commit run — read or copy first)`. Use a distinct
   prefix, not another `FAILED:`-shaped line; mention
   `test-timings.json` only when it exists (early failures may not write
   it). Benefits every verify consumer, not just land.
2. `land.sh`: when the land verify fails (exit 2 verify-failed path), fold
   the log dir into `LAND_ACTION`, so the EXIT-trap trailer (final stderr
   line) carries the breadcrumb: `land: exit: 2 (verify-failed) — inspect
   <log_dir>/<slot>.log, fix, re-run land`. The dir is already resolvable
   before verify runs via the same
   `${MUSI_VERIFY_LOG_DIR:-$(musi_standard_verify_log_dir ...)}`
   expression land.sh uses post-verify; the failing-slot list is optional
   at size S (derivable later from nonzero `meta/*.json` entries, the
   `stop-policy.sh` cached-failure approach).

## Registration

- `test-verify.sh`'s failure assertions are presence checks, not exact-set
  — add an assertion that the breadcrumb is the final summary line, plus
  direct `2>&1 | tail -n 1` coverage for verify and land (with a custom
  `MUSI_VERIFY_LOG_DIR`).
- `test-land.sh` covers the trailer contract; the exit-status contract
  comment at the top of `land.sh` documents trailer wording and must stay
  truthful if the action line changes.
- The `verify:logs` viewer parses these logs; footer is additive output,
  but grep for consumers of the `=== FAILED ===` banner before reshaping
  anything above it.
