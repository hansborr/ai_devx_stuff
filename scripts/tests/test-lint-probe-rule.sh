#!/usr/bin/env bash
# smoke-subjects: scripts/lint-probe-rule.ts
# smoke-subjects: scripts/lint-probe-rule.test.ts
# smoke-subjects: scripts/tests/test-lint-probe-rule.sh
# smoke-subjects: tools/lint-ratchet/src/kernel/eslint-config.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/baseline.ts
# smoke-subjects: scripts/lint-ratchet/lint-ratchet-config.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/metrics-types.ts
# smoke-subjects: scripts/lint-ratchet/paths.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/rule-source.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/runtime-config.ts
# smoke-subjects: eslint-rules/
# smoke-subjects: package.json
# Smoke test for bun run lint:probe-rule.

set -euo pipefail

cd "$(dirname "$0")/../.."

PASS=0
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); printf 'ok %d - %s\n' "$PASS" "$1"; }

bash -n scripts/tests/test-lint-probe-rule.sh || fail "test-lint-probe-rule.sh fails bash -n"
ok "test-lint-probe-rule.sh passes bash -n"

set +e
output=$(
  printf '// TODO\nconst value = 1;\n' |
    bun run lint:probe-rule -- --stdin --filename scripts/probe.ts local/no-llm-artifacts 2>&1
)
status=$?
set -e
[ "$status" -eq 1 ] || fail "lint:probe-rule should return ESLint status 1 on findings, got $status: $output"
grep -qF "local/no-llm-artifacts" <<< "$output" \
  || fail "lint:probe-rule output should name the probed rule: $output"
ok "lint:probe-rule reports a single local-rule finding from stdin"

printf 'const value = 1;\n' |
  bun run lint:probe-rule -- --stdin --filename scripts/probe.ts local/no-llm-artifacts >/dev/null \
  || fail "lint:probe-rule should pass for clean stdin"
ok "lint:probe-rule exits 0 for clean stdin"

probe_cache_dir="node_modules/.cache/eslint-ratchet/configs"
mkdir -p "$probe_cache_dir"
rm -f "$probe_cache_dir"/probe-local-no-llm-artifacts-*.mjs
printf 'const value = 1;\n' |
  bun run lint:probe-rule -- --stdin --filename scripts/probe.ts local/no-llm-artifacts >/dev/null \
  || fail "lint:probe-rule should pass for shared-cache pollution check"
polluted_probe_config="$(find "$probe_cache_dir" -maxdepth 1 -name 'probe-local-no-llm-artifacts-*.mjs' -print -quit)"
if [ -n "$polluted_probe_config" ]; then
  rm -f "$probe_cache_dir"/probe-local-no-llm-artifacts-*.mjs
  fail "lint:probe-rule should not write probe configs to shared ratchet cache: $polluted_probe_config"
fi
ok "lint:probe-rule does not write probe configs to shared ratchet cache"

set +e
output=$(bun run lint:probe-rule -- no-console scripts/probe.ts 2>&1)
status=$?
set -e
[ "$status" -eq 2 ] || fail "non-local rule id should be a usage error, got $status: $output"
grep -qF "rule id must start with local/" <<< "$output" \
  || fail "non-local rule id error should explain the local/ requirement: $output"
ok "lint:probe-rule rejects non-local rule ids"

printf 'lint-probe-rule tests passed (%d)\n' "$PASS"
