#!/usr/bin/env bash
# smoke-order: 090
# smoke-subjects: scripts/tests/test-ai-hooks.sh
# smoke-subjects: scripts/harness/generate-hook-wiring.ts
# smoke-subjects: scripts/harness/hook-wiring-schema.ts
# smoke-subjects: scripts/lib/verify-metadata.sh
# smoke-subjects: scripts/lib/verify-commit-queue.sh
# smoke-subjects: scripts/lib/verify-fast-commit.sh
# smoke-subjects: scripts/lib/verify-markers.sh
# smoke-subjects: scripts/lib/verify-path-policy.sh
# smoke-subjects: scripts/lib/verify-run-meta.sh
# smoke-subjects: scripts/lib/verify-state-paths.sh
# smoke-subjects: scripts/path-policy/path-policy-query.ts
# smoke-subjects: scripts/path-policy/path-policy-query-core.ts
# smoke-subjects: scripts/path-policy/segment-pattern.ts
# smoke-subjects: scripts/path-policy/path-policy.ts
# smoke-subjects: scripts/path-policy/smoke-test-files.ts
# smoke-subjects: scripts/lib/records.ts
# smoke-subjects: scripts/ai-hooks/check-wiring.sh
# smoke-subjects: scripts/ai-hooks/
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: .claude/hooks/
# smoke-subjects: .codex/hooks/
# smoke-subjects: .copilot/hooks/
# smoke-subjects: .claude/settings.json
# smoke-subjects: .codex/hooks.json
# smoke-subjects: .github/hooks/copilot.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/../ai-hooks/test.sh"
