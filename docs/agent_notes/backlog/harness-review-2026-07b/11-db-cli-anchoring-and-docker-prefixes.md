# 11. DB CLI checks are unanchored substrings (live false positives); docker check misses env/bash -c prefixes

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: policy-guards · Area: hooks-policy · Severity: high · Size: S-M · Confidence: high
Theme: command-policy-precision · Source: harness review 2026-07-06 (Sonnet breadth + Codex CONFIRMED; false positive reproduced live)

## Problem
Two opposite miscalibrations in the infra-CLI guards:
- The Postgres/Redis checks match bare substrings anywhere in the command,
  so read-only text (`grep -n "psql" …`, `echo "don't use psql"`) is
  hard-blocked. An audit subagent tripped this live on 2026-07-06 while
  merely searching the codebase for the word `psql` — the same
  false-positive class leaf 53 of the previous pack fixed for the
  hook-bypass guard.
- The docker check is command-start anchored but does not route through
  `ai_policy_command_re`, so `bash -c "docker ps"` and
  `env FOO=bar docker ps` evade it while equivalent wrapping does NOT
  evade the Postgres/Redis checks. Neither trade-off is documented as
  intentional.

## Evidence
- `scripts/ai-hooks/policy.sh:349` — `\b(psql|pgcli|pg_dump|…)\b` plain grep.
- `scripts/ai-hooks/policy.sh:354` — `\bredis-cli\b` plain grep.
- `scripts/ai-hooks/policy.sh:359` — docker anchored but prefix-blind.
- Codex verification: CONFIRMED all three with the same citations.

## Proposed direction
Route all three through the segment-aware executable-position matcher
(`ai_policy_has_command`/`ai_policy_command_re`) like the git guards,
mirroring leaf 53's fix shape. Add both-direction fixtures to
`scripts/ai-hooks/test.sh`: allowed (`grep -n "psql" scripts/`,
`echo redis-cli`), blocked (`psql -c …`, `env PGX=1 psql`,
`bash -c "docker compose down"`).

## Scope / caveats
Keep the DB checks' broad spirit where wrapping is common (`timeout 30
psql` should stay blocked — `timeout`/`xargs`-style runners may need the
prefix list extended rather than pure command-start anchoring). Note the
policy is a behavioral nudge, not a sandbox: client-library one-liners
(`node -e "require('pg')…"`) are out of scope by design. One commit
(policy.sh + test.sh).
