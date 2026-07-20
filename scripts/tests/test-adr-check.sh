#!/usr/bin/env bash
# smoke-order: 345
# smoke-subjects: scripts/adr-check.ts
# smoke-subjects: scripts/adr-check-parse.ts
# smoke-subjects: scripts/adr-check-locators.ts
# smoke-subjects: scripts/adr-check.test.ts
# smoke-subjects: scripts/tests/test-adr-check.sh
# smoke-subjects: package.json
# smoke-subjects: docs/adr/
# smoke-subjects: eslint-rules/concurrency-guard.js
# smoke-subjects: eslint-rules/no-broadcast-in-transaction.js
# smoke-subjects: eslint-rules/socket-registry-broadcasts.js
# smoke-subjects: eslint-config/package-boundary-configs.js
# smoke-subjects: eslint-config/local-plugin.js
# smoke-subjects: eslint.config.js
# smoke-subjects: packages/server/src/utils/prisma-types.ts
# smoke-subjects: packages/server/src/routers/invite-concurrency.test.ts
# smoke-subjects: packages/server/src/socket/broadcast-registry.test.ts
set -euo pipefail

cd "$(dirname "$0")/../.."

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/adr-check-smoke-XXXXXX")
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p \
  "$TMP_ROOT/scripts" \
  "$TMP_ROOT/docs/adr" \
  "$TMP_ROOT/docs/guides" \
  "$TMP_ROOT/eslint-rules" \
  "$TMP_ROOT/eslint-config" \
  "$TMP_ROOT/packages/server/src/utils" \
  "$TMP_ROOT/packages/server/src/routers" \
  "$TMP_ROOT/packages/server/src/socket"

cp scripts/adr-check.ts scripts/adr-check-parse.ts scripts/adr-check-locators.ts "$TMP_ROOT/scripts/"
cp docs/adr/*.md "$TMP_ROOT/docs/adr/"
cp docs/guides/add-race-sensitive-mutation.md docs/guides/add-socket-broadcast.md "$TMP_ROOT/docs/guides/"
cp eslint-rules/concurrency-guard.js eslint-rules/no-broadcast-in-transaction.js eslint-rules/socket-registry-broadcasts.js "$TMP_ROOT/eslint-rules/"
cp -R eslint-config/. "$TMP_ROOT/eslint-config/"
cp eslint.config.js package.json "$TMP_ROOT/"
cp packages/server/src/utils/prisma-types.ts "$TMP_ROOT/packages/server/src/utils/"
cp packages/server/src/routers/invite-concurrency.test.ts "$TMP_ROOT/packages/server/src/routers/"
cp packages/server/src/socket/broadcast-registry.test.ts "$TMP_ROOT/packages/server/src/socket/"
ln -s "$PWD/node_modules" "$TMP_ROOT/node_modules"

VALID_OUTPUT=$(cd "$TMP_ROOT" && bun scripts/adr-check.ts)
case "$VALID_OUTPUT" in
  "adr:check OK — 2 ADR(s), 8 gate locator(s) checked.") ;;
  *) echo "unexpected valid-fixture output: $VALID_OUTPUT" >&2; exit 1 ;;
esac

rm "$TMP_ROOT/docs/guides/add-socket-broadcast.md"
if (cd "$TMP_ROOT" && bun scripts/adr-check.ts >broken.out 2>broken.err); then
  echo "adr:check unexpectedly accepted a missing guide" >&2
  exit 1
fi
grep -q "guide does not resolve" "$TMP_ROOT/broken.err"

LIVE_OUTPUT=$(bun run adr:check)
case "$LIVE_OUTPUT" in
  "adr:check OK — 2 ADR(s), 8 gate locator(s) checked.") ;;
  *) echo "unexpected live-tree output: $LIVE_OUTPUT" >&2; exit 1 ;;
esac

echo "test-adr-check OK"
