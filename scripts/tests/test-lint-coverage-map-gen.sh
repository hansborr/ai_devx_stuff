#!/usr/bin/env bash
# smoke-subjects: scripts/tests/test-lint-coverage-map-gen.sh
# smoke-subjects: scripts/lint-coverage-map-gen.ts
# smoke-subjects: scripts/lint-coverage-map-gen-core.ts
# smoke-subjects: scripts/lint-coverage-map-gen-core.test.ts
# smoke-subjects: scripts/lint-coverage-map-check-eslint-reach.ts
# smoke-subjects: scripts/lint-coverage-map-check-io.ts
# smoke-subjects: scripts/lint-coverage-map-check-types.ts
# The fixture copies and executes the whole manifest family (see the glob-driven
# copy loop below), so every module in it is a subject: a fixture-copy or
# import-closure break in any one of them must select this smoke in changed
# verification, not wait for a full scripts run.
# smoke-subjects: scripts/lint-coverage-map-manifest.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-schema.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-sections.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-prose.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-codemods.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-config-files.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-config-sensors.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-docs.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-drift-ai.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-harness-scripts.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-lint-rules-and-shell.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-linted-scripts-a.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-linted-scripts-b.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-misc.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-packages.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-portable-tooling.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-ratchet-runtime.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-script-entrypoints.ts
# smoke-subjects: scripts/lint-coverage-map-manifest-script-fixtures.ts
# smoke-subjects: scripts/lib/codepoint-compare.ts
# smoke-subjects: scripts/lib/doc-generator.ts
# smoke-subjects: scripts/lib/git.ts
# smoke-subjects: scripts/lib/records.ts
# smoke-subjects: scripts/lib/error-message.ts
# smoke-subjects: scripts/lib/process-argv.ts
# smoke-subjects: scripts/lint-ratchet/lint-ratchet-config.ts
# smoke-subjects: scripts/lint-ratchet/registry-builders.ts
# smoke-subjects: tools/lint-ratchet/package.json
# smoke-subjects: tools/lint-ratchet/src/kernel/ratchet-globs.ts
# smoke-subjects: docs/generated/lint-coverage-map.md
# smoke-subjects: scripts/drift-ai/
# smoke-subjects: eslint.config.js
# smoke-subjects: eslint-config/
# smoke-subjects: eslint-rules/
# smoke-subjects: tsconfig.scripts.json
# smoke-subjects: package.json
# smoke-subjects: harness.controls.json

set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/lint-coverage-map-gen-XXXXXX")
FIXTURE="$TMP_ROOT/repo"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

copy_file() {
  local path=$1
  mkdir -p "$FIXTURE/$(dirname "$path")"
  # fixture-closure: unmodelled-copy - the copy set is the literal `for path in`
  # list below, handed to this helper one path at a time through $1; the
  # fixture-copy-set checker does not model parameter passing, so it cannot see
  # what this seeds.
  cp "$REPO_ROOT/$path" "$FIXTURE/$path"
}

for path in \
  eslint-config/config-surface-manifest.json \
  eslint-config/config-surfaces.js \
  eslint-config/path-glob-policy.js \
  eslint-config/script-test-policy.js \
  scripts/lib/codepoint-compare.ts \
  scripts/lib/doc-generator.ts \
  scripts/lib/git.ts \
  scripts/lint-coverage-map-check-eslint-reach.ts \
  scripts/lint-coverage-map-check-io.ts \
  scripts/lint-coverage-map-check-types.ts \
  scripts/lint-coverage-map-gen-core.ts \
  scripts/lint-coverage-map-gen.ts \
  scripts/lint-ratchet/lint-ratchet-config.ts \
  scripts/lint-ratchet/registry-builders.ts; do
  copy_file "$path"
done

# The generator renders the whole document from the typed manifest, so the
# fixture needs every manifest module. They are a closed family under one
# prefix; enumerating the 19 filenames here would rot on every area split. The
# copy set is the glob expansion below, seeded through the same `copy_file`
# helper whose `cp` already carries the fixture-closure annotation.
for absolute in "$REPO_ROOT"/scripts/lint-coverage-map-manifest*.ts; do
  copy_file "scripts/${absolute##*/}"
done

mkdir -p \
  "$FIXTURE/docs/generated" \
  "$FIXTURE/node_modules/@musi" \
  "$FIXTURE/scripts/drift-ai/fixtures/sample"
ln -s "$REPO_ROOT/node_modules/eslint" "$FIXTURE/node_modules/eslint"
ln -s "$REPO_ROOT/node_modules/zod" "$FIXTURE/node_modules/zod"
ln -s "$REPO_ROOT/tools/lint-ratchet" "$FIXTURE/node_modules/@musi/lint-ratchet"

cat >"$FIXTURE/eslint.config.js" <<'JS'
// "Normal lint reaches this file" means at least one rule resolves for it, so
// an empty `rules` block would read as unreached and trip the generator's
// fail-closed drift-ai check.
export default [{ files: ["scripts/drift-ai/*.ts"], rules: { "no-debugger": "error" } }];
JS
cat >"$FIXTURE/package.json" <<'JSON'
{
  "type": "module",
  "scripts": {
    "docs:lint-coverage-map:generate": "bun run scripts/lint-coverage-map-gen.ts",
    "docs:lint-coverage-map:generate:check": "bun run scripts/lint-coverage-map-gen.ts -- --check"
  }
}
JSON
cat >"$FIXTURE/docs/generated/lint-coverage-map.md" <<'MD'
stale whole-document bytes
MD
: >"$FIXTURE/scripts/drift-ai/a.ts"
: >"$FIXTURE/scripts/drift-ai/b.test.ts"
: >"$FIXTURE/scripts/drift-ai/fixtures/sample/nested.ts"

git -C "$FIXTURE" init -q
git -C "$FIXTURE" config user.email fixture@example.com
git -C "$FIXTURE" config user.name Fixture
git -C "$FIXTURE" add .
git -C "$FIXTURE" commit -qm "test: initialize generator fixture"

if (cd "$FIXTURE" && bun run docs:lint-coverage-map:generate:check >/dev/null 2>&1); then
  echo "expected stale generated bytes to fail check mode" >&2
  exit 1
fi
(cd "$FIXTURE" && bun run docs:lint-coverage-map:generate >/dev/null)
(cd "$FIXTURE" && bun run docs:lint-coverage-map:generate:check >/dev/null)

grep -qF '| `scripts/drift-ai/*.ts` | 2 .ts |' \
  "$FIXTURE/docs/generated/lint-coverage-map.md"
grep -qF '# Lint Coverage Map' "$FIXTURE/docs/generated/lint-coverage-map.md"
grep -qF '## Current Cross-Cutting Policy' "$FIXTURE/docs/generated/lint-coverage-map.md"
if grep -qF 'stale whole-document bytes' "$FIXTURE/docs/generated/lint-coverage-map.md"; then
  echo "generation preserved bytes it no longer owns" >&2
  exit 1
fi
if grep -qF 'generated: lint-coverage-map' "$FIXTURE/docs/generated/lint-coverage-map.md"; then
  echo "the retired marker span reappeared in generated output" >&2
  exit 1
fi
if grep -qF '| `scripts/drift-ai/*.ts` | 3 .ts |' \
  "$FIXTURE/docs/generated/lint-coverage-map.md"; then
  echo "nested fixture TypeScript entered the direct-child count" >&2
  exit 1
fi

# The whole document is generated now, so a hand edit to narrative prose — not
# just to a table cell — must stale check mode and be reverted by generation.
# This is a strictly stronger claim than the stale-whole-document case above,
# which any weak "does it contain the expected rows" check would also reject:
# here the file is valid generator output with one narrative line changed, so
# only a byte-exact comparison fails it. The regeneration is load-bearing too —
# the unaccounted-file assertions below need a fresh document to start from.
sed -i 's/^# Lint Coverage Map$/# Hand-Edited Heading/' \
  "$FIXTURE/docs/generated/lint-coverage-map.md"
if (cd "$FIXTURE" && bun run docs:lint-coverage-map:generate:check >/dev/null 2>&1); then
  echo "expected a hand-edited heading to fail check mode" >&2
  exit 1
fi
(cd "$FIXTURE" && bun run docs:lint-coverage-map:generate >/dev/null)
grep -qF '# Lint Coverage Map' "$FIXTURE/docs/generated/lint-coverage-map.md"

: >"$FIXTURE/scripts/drift-ai/new.ts"
git -C "$FIXTURE" add scripts/drift-ai/new.ts
if (cd "$FIXTURE" && bun run docs:lint-coverage-map:generate:check >/dev/null 2>&1); then
  echo "expected a newly tracked direct-child file to stale the block" >&2
  exit 1
fi
(cd "$FIXTURE" && bun run docs:lint-coverage-map:generate >/dev/null)
grep -qF '| `scripts/drift-ai/*.ts` | 3 .ts |' \
  "$FIXTURE/docs/generated/lint-coverage-map.md"

sed -i 's/| `scripts\/drift-ai\/\*.ts` | 3 \.ts |/| `scripts\/drift-ai\/*.ts` | 99 .ts |/' \
  "$FIXTURE/docs/generated/lint-coverage-map.md"
if (cd "$FIXTURE" && bun run docs:lint-coverage-map:generate:check >/dev/null 2>&1); then
  echo "expected an edited generated count to fail check mode" >&2
  exit 1
fi
(cd "$FIXTURE" && bun run docs:lint-coverage-map:generate >/dev/null)
(cd "$FIXTURE" && bun run docs:lint-coverage-map:generate:check >/dev/null)

echo "lint coverage-map generator smoke OK"
