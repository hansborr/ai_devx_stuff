# Code Intel Follow-ups

Status: Parked, conditional follow-ups
Last triaged: 2026-05-08
Sources: `../finished_work/code-intel-review-followups.md`,
`code-intel-daemon-options.md`

`bun run code:intel --` is implemented as a read-only CLI with `def`,
`exports`, `dependents`, `refs`, and `tests`, optionally backed by a per-repo
daemon. The review follow-ups for runtime type-only edge filtering, bounded
tests, project filters, and usage polish are landed.

## Remaining Work

- Add or support JSON consumers only when a hook, dashboard, MCP adapter, or
  other concrete reader exists. The CLI already supports `--format json`.
- Add caching, a daemon, or a persistent file index only if repeated lookup
  latency becomes visible friction. Use `code-intel-daemon-options.md` for the
  implementation tradeoffs.
- Add cycle/debug output only with a concrete confusing query. The current
  reverse graph walk already terminates across cycles.
- Revisit definition ambiguity formatting only if a real query produces a
  misleading header or output.

## Non-Goals

- Do not make `code:intel` a verification gate.
- Do not hide useful behavior behind an MCP-only interface; keep the CLI as the
  stable repo contract.
