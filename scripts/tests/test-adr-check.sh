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
# smoke-subjects: eslint-config/local-plugin.generated.js
# smoke-subjects: eslint.config.js
# smoke-subjects: packages/server/src/utils/prisma-types.ts
# smoke-subjects: packages/server/src/routers/invite-concurrency.test.ts
# smoke-subjects: packages/server/src/socket/broadcast-registry.test.ts
# smoke-subjects: docs/guides/add-race-sensitive-mutation.md
# smoke-subjects: docs/guides/add-socket-broadcast.md
# smoke-subjects: eslint-config/
set -euo pipefail

cd "$(dirname "$0")/../.."

# The expected counts are derived, not hardcoded: an independent awk pass over the
# ADR frontmatter has to agree with what adr-check.ts reports. That keeps what the
# old literal "2 ADR(s), 8 gate locator(s)" existed to prove — the check visited
# every ADR and every locator rather than reporting a vacuous OK — without a new
# ADR falsifying the smoke every time one lands.
read -r EXPECTED_ADRS EXPECTED_LOCATORS <<EOF
$(awk '
  FNR == 1 { in_frontmatter = 0 }
  FNR == 1 && $0 == "---" { in_frontmatter = 1; adrs += 1; next }
  in_frontmatter && $0 == "---" { in_frontmatter = 0; next }
  in_frontmatter && /^  - / { locators += 1 }
  END { printf "%d %d\n", adrs, locators }
' docs/adr/[0-9][0-9][0-9][0-9]-*.md)
EOF

if [ "$EXPECTED_ADRS" -lt 1 ] || [ "$EXPECTED_LOCATORS" -lt "$EXPECTED_ADRS" ]; then
  echo "derived ADR expectations look empty: $EXPECTED_ADRS ADR(s), $EXPECTED_LOCATORS locator(s)" >&2
  exit 1
fi
EXPECTED_OUTPUT="adr:check OK — $EXPECTED_ADRS ADR(s), $EXPECTED_LOCATORS gate locator(s) checked."

# The fixture mirrors the live tree through symlinks so that every guide and gate
# locator any ADR names resolves without a hand-maintained copy list. Only the
# directories a mutation writes into are real: docs/ and docs/guides/ hold one
# symlink per entry, so removing a guide from the fixture cannot touch the repo.
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/adr-check-smoke-XXXXXX")
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$TMP_ROOT/docs/guides"
for entry in eslint-rules eslint-config eslint.config.js package.json packages scripts node_modules; do
  ln -s "$PWD/$entry" "$TMP_ROOT/$entry"
done
for entry in docs/*; do
  [ "$entry" = "docs/guides" ] && continue
  ln -s "$PWD/$entry" "$TMP_ROOT/$entry"
done
for entry in docs/guides/*; do
  ln -s "$PWD/$entry" "$TMP_ROOT/$entry"
done

VALID_OUTPUT=$(cd "$TMP_ROOT" && bun scripts/adr-check.ts)
case "$VALID_OUTPUT" in
  "$EXPECTED_OUTPUT") ;;
  *) echo "unexpected valid-fixture output: $VALID_OUTPUT (expected: $EXPECTED_OUTPUT)" >&2; exit 1 ;;
esac

rm "$TMP_ROOT/docs/guides/add-socket-broadcast.md"
if (cd "$TMP_ROOT" && bun scripts/adr-check.ts >broken.out 2>broken.err); then
  echo "adr:check unexpectedly accepted a missing guide" >&2
  exit 1
fi
grep -q "guide does not resolve" "$TMP_ROOT/broken.err"

LIVE_OUTPUT=$(bun run adr:check)
case "$LIVE_OUTPUT" in
  "$EXPECTED_OUTPUT") ;;
  *) echo "unexpected live-tree output: $LIVE_OUTPUT (expected: $EXPECTED_OUTPUT)" >&2; exit 1 ;;
esac

echo "test-adr-check OK"
