#!/usr/bin/env bash
# smoke-order: 385
# smoke-subjects: docs/agent_notes/backlog/code-quality-2026-08-01/drain.mjs
# smoke-subjects: docs/agent_notes/backlog/code-quality-2026-08-01/drain.test.mjs
# smoke-subjects: docs/agent_notes/backlog/code-quality-2026-08-01/drain-queue.json
# smoke-subjects: docs/agent_notes/backlog/code-quality-2026-08-01/drain-carriers.jsonl
# smoke-subjects: scripts/tests/test-cq-drain.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
DRAIN="$REPO_ROOT/docs/agent_notes/backlog/code-quality-2026-08-01/drain.mjs"

node --test "$REPO_ROOT/docs/agent_notes/backlog/code-quality-2026-08-01/drain.test.mjs"
node "$DRAIN" --check
