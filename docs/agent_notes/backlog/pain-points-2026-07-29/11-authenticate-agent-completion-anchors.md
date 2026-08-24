# Prevent Backend Output from Forging Wrapper Records

Status: Closed — superseded redesign implemented
Date: 2026-07-29
Priority: P1
Size: S
Source: `agent-cli-and-external-reviews.md` — “Trailer trust and nested
dispatch”

## Decision

The original leaf design is permanently withdrawn. There is no
`correlation-v1`, run id, versioned frame, exit 23, waiter change, record-grammar
change, or caller migration.

Instead, the wrapper owns the anchored `^agent-run:` namespace by construction.
At each of the three backend-to-stdout boundaries, a backend line beginning
`agent-run` is surfaced as `[backend] agent-run...`:

- Claude/Cursor capture replay
- normalized Copilot answer replay
- Codex live stream

Copilot stderr is captured separately from its JSONL stdout, then replayed
through the same filter so diagnostics remain visible without entering the
parser. Raw capture bytes remain unchanged for envelope, answer, and session
parsing.

This is namespace isolation under the existing same-UID trust model, not
authentication against an adversarial backend. Supported consumers parse only
anchored `^agent-run:` records. Log reuse remains a caller error, so every
dispatch and retry must use a fresh log path; no attempt-record precondition
was added to `agent-wait.sh`.

## Compatibility and limits

Wrapper records, waiter behavior, caller interfaces, and trailer grammar are
unchanged. Codex still streams live, preserving the early `session-id:`
guarantee.

The Codex pipeline uses `tee` for a byte-identical raw capture, followed by a
line-buffered `stdbuf sed` filter on the stdout copy. This preserves live
streaming without `sed -u`'s one-byte reads. Tests pin capture identity for
NUL-bearing output and a final line without a newline.

## Evidence

The wrapper smoke suite pauses one run at each distinct ingress boundary
(Claude/Cursor capture replay, Copilot answer replay, Codex live stream, and
Copilot stderr). The default waiter—whose trusted anchors are a superset of
`--finalized-only`—remains running before release, finalizes afterward,
excludes forged summary values, and leaves the escaped diagnostic visible.
Existing Codex drain, status, fatal-signal, and early-session-id cases pass
unchanged.

Verification:

- `bash scripts/tests/test-skill-dispatch-wrappers.sh`
- `bun run harness:skills:check`
- `bun run harness:check`
