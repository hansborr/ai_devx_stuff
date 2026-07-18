#!/usr/bin/env bash
# smoke-order: 370
# smoke-subjects: scripts/lint-ratchet.ts
# smoke-subjects: scripts/lint-ratchet/
# smoke-subjects: scripts/lint-ratchet/debt-log.test.ts
# smoke-subjects: scripts/lint-ratchet/debt-log-schema.test.ts
# smoke-subjects: scripts/lint-ratchet/debt-log-write.test.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/baseline-compare.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/baseline-spec-parse.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/baseline.ts
# smoke-subjects: scripts/lint-ratchet/baseline.test.ts
# smoke-subjects: scripts/lint-ratchet/check-registry.ts
# smoke-subjects: scripts/lint-ratchet/check-registry.test.ts
# smoke-subjects: scripts/lint-ratchet/output.ts
# smoke-subjects: scripts/lint-ratchet/output.test.ts
# smoke-subjects: scripts/lint-ratchet/registry-builders.ts
# smoke-subjects: scripts/lint-ratchet/report.ts
# smoke-subjects: scripts/lint-ratchet/report.test.ts
# smoke-subjects: tools/lint-ratchet/src/governance/
# smoke-subjects: scripts/lint-ratchet/summary.test.ts
# smoke-subjects: scripts/lint-ratchet/zero-baseline.test.ts
# smoke-subjects: scripts/fixtures/lint-ratchet/
# smoke-subjects: scripts/git/check-lint-ratchet-merge-driver.sh
# smoke-subjects: scripts/git/install-lint-ratchet-merge-driver.sh
# smoke-subjects: scripts/git/baseline-merge-driver-lib.sh
# smoke-subjects: scripts/git/baseline-info-attributes.ts
# smoke-subjects: scripts/git/check-baseline-merge-driver.sh
# smoke-subjects: scripts/git/install-baseline-merge-driver.sh
# smoke-subjects: scripts/git/check-knip-unused-exports-merge-driver.sh
# smoke-subjects: scripts/git/install-knip-unused-exports-merge-driver.sh
# smoke-subjects: scripts/git/baseline-merge-driver.sh
# smoke-subjects: scripts/git/knip-unused-exports-merge-driver-lib.sh
# smoke-subjects: scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/git/check-near-duplicates-merge-driver.sh
# smoke-subjects: scripts/git/install-near-duplicates-merge-driver.sh
# smoke-subjects: scripts/git/near-duplicates-merge-driver-lib.sh
# smoke-subjects: scripts/git/near-duplicates-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/sensor-near-duplicates-merge-cli.ts
# smoke-subjects: scripts/git/check-max-lines-exceptions-merge-driver.sh
# smoke-subjects: scripts/git/install-max-lines-exceptions-merge-driver.sh
# smoke-subjects: scripts/git/max-lines-exceptions-merge-driver-lib.sh
# smoke-subjects: scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/git/lint-ratchet-merge-driver-lib.sh
# smoke-subjects: scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh
# smoke-subjects: scripts/git/baseline-post-merge-truth-up.sh
# smoke-subjects: scripts/git/restore-generated-baseline-stage.sh
# smoke-subjects: scripts/max-lines-exceptions-merge-cli.ts
# smoke-subjects: scripts/max-lines-exceptions-merge-cli.test.ts
# smoke-subjects: scripts/lib/lint-rule-docs.ts
# smoke-subjects: tools/lint-ratchet/src/kernel/atomic-write.ts
# smoke-subjects: tools/lint-ratchet/src/git-rail/
# smoke-subjects: scripts/harness/harness-manifest.ts
# smoke-subjects: scripts/lint-ratchet/ratchet-manifest-message.ts
# smoke-subjects: scripts/tests/lib/test-git-env.sh
# smoke-subjects: scripts/tests/lib/test-lint-ratchet-edit-check-fixtures.sh
# smoke-subjects: scripts/tests/test-lint-ratchet.sh
# smoke-subjects: docs/guides/lint-ratchet.md
# smoke-subjects: docs/guides/lint-ratchet-merges.md
# smoke-subjects: scripts/generate-baseline-conflict-recipes.ts
# smoke-subjects: .gitattributes
# smoke-subjects: .husky/post-checkout
# smoke-subjects: .husky/post-merge
# smoke-subjects: .husky/post-commit
# smoke-subjects: lint-ratchet.baseline.json
# smoke-subjects: packages/shared/src/schemas/harness-diagnostics.ts
# smoke-subjects: eslint.config.js
# smoke-subjects: eslint-config/
# smoke-subjects: eslint-rules/
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# Smoke test for scripts/lint-ratchet.ts.
#
# Covers the committed registry/baseline shape plus fixture regressions, update
# refusal, check-baseline validation, and strict improvement failures.
set -euo pipefail

cd "$(dirname "$0")/../.."

# shellcheck source=scripts/tests/lib/test-git-env.sh
. scripts/tests/lib/test-git-env.sh
musi_clear_inherited_git_hook_env
musi_exit_after_git_hook_env_assertion_if_requested

REPO_ROOT="$(pwd)"
MERGE_DRIVER_CONFIG_HASH="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
MERGE_DRIVER_SOURCE_HASH="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

# The still-present portable runtime file set: the Musi adapter under
# scripts/lint-ratchet/ (every non-test .ts except the registry the fixture writes
# its own copy of) plus the cross-directory helpers it imports. The engine
# resolves as the symlinked @musi/lint-ratchet workspace member (see
# build_fixture); merge-driver files are intentionally omitted from this fixture
# copy. (The copy manifest + expander that used to derive this list were deleted
# in leaf 02 S5; copyability is now proven by the package's §2 structural checks
# and the examples/lint-ratchet-demo consumer.)
mapfile -t PORTABLE_RUNTIME_FILES < <(
  {
    printf '%s\n' \
      eslint-rules/max-lines.js \
      packages/shared/src/schemas/harness-diagnostics.ts \
      scripts/harness/harness-diagnostics-output.ts \
      scripts/harness/harness-manifest.ts \
      scripts/lib/lint-rule-docs.ts \
      scripts/lint-ratchet.ts
    git ls-files scripts/lint-ratchet |
      grep -E '\.ts$' |
      grep -vE '\.test\.ts$|\.test-helper\.ts$' |
      grep -v '^scripts/lint-ratchet/lint-ratchet-config\.ts$'
  }
)

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/lint-ratchet-smoke-XXXXXX")
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_usage_failure() {
  local description=$1
  local expected_substring=$2
  shift 2
  local err status
  set +e
  err=$(bun run scripts/lint-ratchet.ts "$@" 2>&1 >/dev/null)
  status=$?
  set -e
  [ "$status" -eq 2 ] || fail "$description: expected exit 2, got $status (stderr: $err)"
  grep -qF -- "$expected_substring" <<< "$err" \
    || fail "$description: stderr missing '$expected_substring': $err"
}

assert_envelope() {
  local file=$1
  local expected_blocking=$2
  # bun -e strips `--`, so positional args after it land back-to-back in
  # process.argv with no consistent index. Pass through env vars instead so
  # the smoke does not depend on bun's argv convention.
  ASSERT_FILE="$file" ASSERT_BLOCKING="$expected_blocking" bun -e '
    const fs = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
    const expectedBlocking = Number(process.env.ASSERT_BLOCKING);
    if (env.version !== "1") assertionFailed("bad version");
    if (env.tool !== "lint:ratchet") assertionFailed(`bad tool ${env.tool}`);
    if (!Array.isArray(env.findings)) assertionFailed("findings not array");
    if (env.summary.blocking !== expectedBlocking) {
      assertionFailed(`blocking expected ${expectedBlocking}, got ${env.summary.blocking}`);
    }
  ' || fail "invalid lint-ratchet envelope: $file"
}

assert_regression_recovery_note() {
  local file=$1
  ASSERT_FILE="$file" bun -e '
    const fs = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
    const note = (env.notes ?? []).find((entry) => entry.kind === "recovery-command");
    const command = "bun run lint:ratchet:update -- --allow-worse --reason \"<why accepting this baseline increase is better than forcing a low-quality fix now>\"";
    if (!note) assertionFailed("missing recovery-command note");
    if (note.command !== command) {
      assertionFailed(`bad recovery command: ${note.command}`);
    }
    if (!note.message.includes("intentional")) {
      assertionFailed(`recovery note should explain intentional debt: ${note.message}`);
    }
  ' || fail "lint-ratchet envelope missing recovery command note: $file"
}

build_fixture() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/scripts" "$fixture_dir/packages/shared/src/schemas"
  mkdir -p "$fixture_dir/eslint-rules" "$fixture_dir/docs/guides"
  mkdir -p "$fixture_dir/eslint-config"
  cp eslint-config/max-lines-exceptions.baseline.json "$fixture_dir/eslint-config/max-lines-exceptions.baseline.json"
  # Copy the still-present portable runtime file set (adapter + cross-dir deps);
  # engine sources moved to the @musi/lint-ratchet package (leaf 02 S3) and come
  # in via the symlinked workspace member below. The import-boundary self-
  # containment proof this smoke used to run moved to the package's §2 resolver-
  # aware boundary checker (tools/lint-ratchet/test/boundary/). Every entry is
  # repo-relative, so the destination path mirrors the source path.
  mkdir -p "$fixture_dir/scripts/lint-ratchet"
  local runtime_file
  for runtime_file in "${PORTABLE_RUNTIME_FILES[@]}"; do
    # Engine sources resolve via the symlinked @musi/lint-ratchet workspace member
    # below rather than being copied, so skip any listed path that no longer
    # resolves here.
    [ -e "$runtime_file" ] || continue
    mkdir -p "$fixture_dir/$(dirname "$runtime_file")"
    cp "$runtime_file" "$fixture_dir/$runtime_file"
  done
  cp eslint-rules/type-assertion-boundary.js \
    "$fixture_dir/eslint-rules/type-assertion-boundary.js"
  mkdir -p "$fixture_dir/node_modules"
  ln -s "$REPO_ROOT/node_modules/.bin" "$fixture_dir/node_modules/.bin"
  ln -s "$REPO_ROOT/node_modules/eslint" "$fixture_dir/node_modules/eslint"
  ln -s "$REPO_ROOT/node_modules/minimatch" "$fixture_dir/node_modules/minimatch"
  ln -s "$REPO_ROOT/node_modules/typescript" "$fixture_dir/node_modules/typescript"
  ln -s "$REPO_ROOT/node_modules/typescript-eslint" \
    "$fixture_dir/node_modules/typescript-eslint"
  # The portable debt-log schema resolves zod from scripts/lint-ratchet, so the
  # fixture needs zod at its own node_modules root (packages/shared's copy only
  # covers the diagnostics envelope's imports).
  ln -s "$REPO_ROOT/node_modules/zod" "$fixture_dir/node_modules/zod"
  ln -s "$REPO_ROOT/packages/shared/node_modules" "$fixture_dir/packages/shared/node_modules"
  # The copied adapter imports @musi/lint-ratchet/*; resolve it to the source-only
  # package via a scoped node_modules symlink (leaf 02 S3).
  mkdir -p "$fixture_dir/node_modules/@musi"
  ln -s "$REPO_ROOT/tools/lint-ratchet" "$fixture_dir/node_modules/@musi/lint-ratchet"

  cat >"$fixture_dir/package.json" <<'JSON'
{
  "name": "lint-ratchet-fixture",
  "private": true,
  "type": "module"
}
JSON

  write_fixture_tsconfig "$fixture_dir"

  cat >"$fixture_dir/eslint.config.js" <<'JS'
import maxLines from "./eslint-rules/max-lines.js";
import typeAssertionBoundary from "./eslint-rules/type-assertion-boundary.js";

export default [
  {
    files: ["**/*.ts"],
    plugins: {
      local: {
        rules: {
          "max-lines": maxLines,
          "type-assertion-boundary": typeAssertionBoundary,
        },
      },
    },
    rules: {
      "local/type-assertion-boundary": "off",
    },
  },
];
JS

  printf '# Local ESLint Rules Fixture\n' >"$fixture_dir/docs/guides/local-eslint-rules.md"
  printf '# Lint Ratchet Fixture\n' >"$fixture_dir/docs/guides/lint-ratchet.md"
}

assert_generated_config_matches_expected() {
  local actual_file=$1
  local expected_template=$2
  ACTUAL_FILE="$actual_file" EXPECTED_TEMPLATE="$expected_template" \
    REPO_ROOT="$REPO_ROOT" bun -e '
      const fs = require("fs");
      const assertionFailed = (message) => { console.error(message); process.exit(1); };
      const { pathToFileURL } = require("url");
      const expected = fs
        .readFileSync(process.env.EXPECTED_TEMPLATE, "utf8")
        .replaceAll("%REPO_ROOT_FILE_URL%", pathToFileURL(process.env.REPO_ROOT).href);
      const actual = fs.readFileSync(process.env.ACTUAL_FILE, "utf8");
      if (actual !== expected) {
        assertionFailed(`generated config drifted for ${process.env.ACTUAL_FILE}`);
      }
    ' || fail "generated config drifted: $actual_file"
}

assert_local_identity_regression() {
  local identity_paths
  local type_config type_cache
  local -a paths

  identity_paths=$(bun -e '
      const { lintRatchets, lintRatchetThirdPartyPluginAllowlist } =
        await import("./scripts/lint-ratchet/lint-ratchet-config.ts");
      const { writeEslintConfig, eslintCachePathFor } =
        await import("@musi/lint-ratchet/kernel/eslint-config.js");
      const { buildRuleSourceHashesById } =
        await import("@musi/lint-ratchet/kernel/rule-source.js");
      const binding = {
        repoRoot: process.cwd(),
        thirdPartyPluginAllowlist: lintRatchetThirdPartyPluginAllowlist,
      };
      const hashes = buildRuleSourceHashesById(lintRatchets, binding);
      const cases = ["ratchet/local-type-assertion-boundary"];
      const paths = [];
      for (const id of cases) {
        const ratchet = lintRatchets.find((entry) => entry.id === id);
        if (ratchet === undefined) throw new Error(`missing ratchet ${id}`);
        const hash = hashes.get(id);
        if (hash === undefined) throw new Error(`missing rule source hash ${id}`);
        paths.push(writeEslintConfig(ratchet, hash, binding));
        paths.push(eslintCachePathFor(ratchet, hash, binding.repoRoot));
      }
      console.log(paths.join("\n"));
    ') || fail "local generated config/cache identity derivation failed"
  mapfile -t paths <<<"$identity_paths"
  [ "${#paths[@]}" -eq 2 ] \
    || fail "local generated config/cache identity derivation returned unexpected paths: $identity_paths"
  type_config=${paths[0]}
  type_cache=${paths[1]}
  [ -f "$type_config" ] \
    || fail "local type-assertion cache key changed or config missing: $type_config"
  [[ "$type_cache" == */.eslintcache ]] \
    || fail "local type-assertion cache path no longer points at an ESLint cache file: $type_cache"
  assert_generated_config_matches_expected "$type_config" \
    "$REPO_ROOT/scripts/fixtures/lint-ratchet/expected-local-type-assertion-boundary.config.mjs"
}

# A standalone single-installer run on an old checkout whose .git/info/attributes
# still carries the legacy shared block must migrate its own rows into the managed
# block while preserving sibling drivers' rows as loose lines, so the knip and
# max-lines baselines do not silently revert to a plain text merge until the next
# hook firing. The unterminated-block fail-loud must stay intact.
assert_baseline_merge_driver_legacy_block_migration() {
  local repo="$TMP_ROOT/merge-driver-legacy-block"
  local info_attributes install_out

  mkdir -p "$repo/scripts/git"
  cp scripts/git/install-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/lint-ratchet-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-info-attributes.ts "$repo/scripts/git/"
  # The attributes wrapper imports @musi/lint-ratchet/git-rail (leaf 02 S4);
  # resolve the source-only package via a scoped node_modules symlink.
  mkdir -p "$repo/node_modules/@musi"
  ln -s "$REPO_ROOT/tools/lint-ratchet" "$repo/node_modules/@musi/lint-ratchet"
  git -C "$TMP_ROOT" init -q -b main "merge-driver-legacy-block"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" commit --allow-empty -qm seed

  mkdir -p "$repo/.git/info"
  info_attributes="$repo/.git/info/attributes"
  cat >"$info_attributes" <<'EOF'
unrelated/path merge=union
# BEGIN musi baseline merge attributes
/lint-ratchet.debt-log.jsonl merge=union
/lint-ratchet.baseline.json merge=lint-ratchet-baseline
/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline
/eslint-config/max-lines-exceptions.baseline.json merge=max-lines-exceptions-baseline
# END musi baseline merge attributes
EOF

  install_out="$TMP_ROOT/merge-driver-legacy-block-install.out"
  ( cd "$repo" && bash scripts/git/install-lint-ratchet-merge-driver.sh ) >"$install_out" 2>&1 \
    || fail "standalone lint-ratchet install on a legacy block should succeed: $(cat "$install_out")"

  # The legacy shared markers are migrated away and lint-ratchet gains its block.
  grep -qxF '# BEGIN musi baseline merge attributes' "$info_attributes" \
    && fail "standalone install should strip the legacy shared block markers"
  grep -qxF '# BEGIN musi lint-ratchet baseline driver attributes' "$info_attributes" \
    || fail "standalone install should add the lint-ratchet managed block"
  grep -qxF '/lint-ratchet.baseline.json merge=lint-ratchet-baseline' "$info_attributes" \
    || fail "standalone install should keep the lint-ratchet baseline attribute"

  # The core fix: sibling drivers' rows survive as loose lines, and Git still
  # resolves their merge driver from those preserved rows.
  grep -qxF '/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline' \
    "$info_attributes" \
    || fail "standalone lint-ratchet install must preserve the sibling knip merge attribute"
  grep -qxF '/eslint-config/max-lines-exceptions.baseline.json merge=max-lines-exceptions-baseline' \
    "$info_attributes" \
    || fail "standalone lint-ratchet install must preserve the sibling max-lines merge attribute"
  grep -qxF 'unrelated/path merge=union' "$info_attributes" \
    || fail "standalone install should preserve unrelated info attributes"
  [ "$(git -C "$repo" check-attr merge -- sensor-knip-unused-exports.baseline.json)" \
    = "sensor-knip-unused-exports.baseline.json: merge: knip-unused-exports-baseline" ] \
    || fail "preserved knip loose row should still resolve the knip merge driver"
  [ "$(git -C "$repo" check-attr merge -- eslint-config/max-lines-exceptions.baseline.json)" \
    = "eslint-config/max-lines-exceptions.baseline.json: merge: max-lines-exceptions-baseline" ] \
    || fail "preserved max-lines loose row should still resolve the max-lines merge driver"

  # An unterminated legacy block still fails loud: render returns non-zero, so the
  # installer warns and leaves the attributes file untouched rather than silently
  # dropping everything after the dangling marker.
  cat >"$info_attributes" <<'EOF'
unrelated/path merge=union
# BEGIN musi baseline merge attributes
/lint-ratchet.baseline.json merge=lint-ratchet-baseline
EOF
  ( cd "$repo" && bash scripts/git/install-lint-ratchet-merge-driver.sh ) \
    >"$TMP_ROOT/merge-driver-legacy-unterminated.out" 2>&1
  grep -qF "WARN" "$TMP_ROOT/merge-driver-legacy-unterminated.out" \
    || fail "an unterminated legacy block should make the installer warn: $(cat "$TMP_ROOT/merge-driver-legacy-unterminated.out")"
  grep -qxF '# BEGIN musi lint-ratchet baseline driver attributes' "$info_attributes" \
    && fail "an unterminated legacy block must not be rewritten (fail-loud, leave file untouched)"
  grep -qxF '# BEGIN musi baseline merge attributes' "$info_attributes" \
    || fail "an unterminated legacy block should be left untouched for the operator to fix"
}

assert_lint_ratchet_merge_driver() {
  local repo="$TMP_ROOT/merge-driver"
  local fake_bun_dir semantic_base semantic_current semantic_err semantic_other
  local linked_common_dir linked_current linked_git_dir linked_marker linked_merge_head_file
  local linked_repo merge_head_arg_log merge_head_file semantic_marker shared_marker
  local attr_output driver_command git_common_dir info_attributes installed_driver installed_hash source_hash
  local status unmerged_count

  mkdir -p "$repo/scripts/git"
  cp scripts/git/check-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/check-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/lint-ratchet-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-info-attributes.ts "$repo/scripts/git/"
  # The attributes wrapper imports @musi/lint-ratchet/git-rail (leaf 02 S4);
  # resolve the source-only package via a scoped node_modules symlink.
  mkdir -p "$repo/node_modules/@musi"
  ln -s "$REPO_ROOT/tools/lint-ratchet" "$repo/node_modules/@musi/lint-ratchet"
  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" commit --allow-empty -qm seed

  mkdir -p "$repo/.git/info"
  cat >"$repo/.git/info/attributes" <<'EOF'
unrelated/path merge=union
lint-ratchet.baseline.json -merge
/lint-ratchet.baseline.json -merge
sensor-knip-unused-exports.baseline.json -merge
eslint-config/max-lines-exceptions.baseline.json -merge
lint-ratchet.debt-log.jsonl merge=text
EOF

  mkdir -p "$repo/nested/invoke"
  (
    cd "$repo/nested/invoke"
    bash ../../scripts/git/install-lint-ratchet-merge-driver.sh
  ) >"$TMP_ROOT/merge-driver-install.out"

  grep -qF "merge driver installed" "$TMP_ROOT/merge-driver-install.out" \
    || fail "merge-driver install did not report success: $(cat "$TMP_ROOT/merge-driver-install.out")"
  driver_command=$(git -C "$repo" config --get merge.lint-ratchet-baseline.driver)
  grep -qF "git rev-parse --git-common-dir" <<< "$driver_command" \
    || fail "merge-driver install should resolve the installed driver through git-common-dir: $driver_command"
  grep -qF "musi/baseline-merge-driver.sh" <<< "$driver_command" \
    || fail "merge-driver install did not configure the installed driver command: $driver_command"
  grep -qF "$repo/scripts/git" <<< "$driver_command" \
    && fail "merge-driver command should not depend on the installing worktree path: $driver_command"
  [ "$(git -C "$repo" config --get merge.lint-ratchet-baseline.recursive)" = "binary" ] \
    || fail "merge-driver install did not configure recursive=binary"
  git_common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
  case "$git_common_dir" in
    /*) installed_driver="$git_common_dir/musi/baseline-merge-driver.sh" ;;
    *) installed_driver="$repo/$git_common_dir/musi/baseline-merge-driver.sh" ;;
  esac
  [ -x "$installed_driver" ] \
    || fail "merge-driver install should copy an executable driver into the git common dir"
  # The installer prints the physical path (pwd -P), so canonicalize the
  # expected path the same way before comparing; on macOS $TMPDIR resolves
  # through the /var -> /private/var symlink.
  installed_driver=$(cd "$(dirname "$installed_driver")" && pwd -P)/$(basename "$installed_driver")
  grep -qF "  installed driver: $installed_driver" "$TMP_ROOT/merge-driver-install.out" \
    || fail "merge-driver install should print the absolute installed driver path: $(cat "$TMP_ROOT/merge-driver-install.out")"

  attr_output=$(git -C "$repo" check-attr merge -- lint-ratchet.baseline.json)
  [ "$attr_output" = "lint-ratchet.baseline.json: merge: lint-ratchet-baseline" ] \
    || fail "merge-driver install did not replace stale info attributes: $attr_output"
  attr_output=$(git -C "$repo" check-attr merge -- nested/lint-ratchet.baseline.json)
  [ "$attr_output" = "nested/lint-ratchet.baseline.json: merge: unspecified" ] \
    || fail "anchored baseline attribute should not match nested paths: $attr_output"
  grep -qF "unrelated/path merge=union" "$repo/.git/info/attributes" \
    || fail "merge-driver install should preserve unrelated info attributes"
  grep -qF "/lint-ratchet.debt-log.jsonl merge=union" "$repo/.git/info/attributes" \
    || fail "merge-driver install should mirror anchored debt-log union attribute"
  grep -qF "/lint-ratchet.baseline.json merge=lint-ratchet-baseline" \
    "$repo/.git/info/attributes" \
    || fail "merge-driver install should mirror anchored baseline driver attribute"
  grep -qF "/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline" \
    "$repo/.git/info/attributes" \
    && fail "lint-ratchet install should not add the knip merge driver attribute"
  grep -qF "/eslint-config/max-lines-exceptions.baseline.json merge=max-lines-exceptions-baseline" \
    "$repo/.git/info/attributes" \
    && fail "lint-ratchet install should not add the max-lines merge driver attribute"
  grep -qF "lint-ratchet.baseline.json -merge" "$repo/.git/info/attributes" \
    && fail "merge-driver install should remove stale baseline -merge attributes"
  grep -qF "sensor-knip-unused-exports.baseline.json -merge" "$repo/.git/info/attributes" \
    || fail "lint-ratchet install should preserve sibling knip attributes"
  grep -qF "eslint-config/max-lines-exceptions.baseline.json -merge" "$repo/.git/info/attributes" \
    || fail "lint-ratchet install should preserve sibling max-lines attributes"

  (
    cd "$repo/nested/invoke"
    bash ../../scripts/git/check-lint-ratchet-merge-driver.sh
  ) >"$TMP_ROOT/merge-driver-check-current.out"
  grep -qF "PASS: lint-ratchet merge driver is installed and current" \
    "$TMP_ROOT/merge-driver-check-current.out" \
    || fail "merge-driver health check should pass when current: $(cat "$TMP_ROOT/merge-driver-check-current.out")"

  (
    cd "$repo/nested/invoke"
    bash ../../scripts/git/install-lint-ratchet-merge-driver.sh
  ) >"$TMP_ROOT/merge-driver-install-noop.out"
  [ ! -s "$TMP_ROOT/merge-driver-install-noop.out" ] \
    || fail "merge-driver install should be silent when already current: $(cat "$TMP_ROOT/merge-driver-install-noop.out")"

  info_attributes="$repo/.git/info/attributes"
  awk '{ printf "%s\r\n", $0 }' "$info_attributes" >"$info_attributes.crlf"
  mv "$info_attributes.crlf" "$info_attributes"
  (
    cd "$repo/nested/invoke"
    bash ../../scripts/git/install-lint-ratchet-merge-driver.sh
  ) >"$TMP_ROOT/merge-driver-install-crlf.out"
  [ "$(tr -d '\r' <"$info_attributes" | grep -cxF '# BEGIN musi lint-ratchet baseline driver attributes')" -eq 1 ] \
    || fail "merge-driver install should refresh a CRLF managed block without duplicating it"
  [ "$(tr -d '\r' <"$info_attributes" | grep -cxF '# END musi lint-ratchet baseline driver attributes')" -eq 1 ] \
    || fail "merge-driver install should retain one CRLF-normalized managed block end marker"

  printf 'stale installed driver\n' >"$installed_driver"
  (
    cd "$repo/nested/invoke"
    bash ../../scripts/git/check-lint-ratchet-merge-driver.sh
  ) >"$TMP_ROOT/merge-driver-check-stale.out"
  [ "$(cat "$TMP_ROOT/merge-driver-check-stale.out")" = "WARN: lint-ratchet merge driver is missing or stale - run bun run lint:ratchet:install-merge-driver" ] \
    || fail "merge-driver health check should print one actionable stale line: $(cat "$TMP_ROOT/merge-driver-check-stale.out")"

  (
    cd "$repo/nested/invoke"
    bash ../../scripts/git/install-lint-ratchet-merge-driver.sh
  ) >"$TMP_ROOT/merge-driver-install-refresh.out"
  installed_hash="$(sha256sum "$installed_driver" | awk '{print $1}')"
  source_hash="$(sha256sum "$repo/scripts/git/baseline-merge-driver.sh" | awk '{print $1}')"
  [ "$installed_hash" = "$source_hash" ] \
    || fail "merge-driver install should refresh a stale installed copy by content hash"

  mkdir -p "$repo/scripts/lint-ratchet"
  : >"$repo/scripts/lint-ratchet/baseline-merge-cli.ts"
  fake_bun_dir="$TMP_ROOT/merge-driver-fake-bun"
  mkdir -p "$fake_bun_dir"
  cat >"$fake_bun_dir/bun" <<'EOF'
#!/usr/bin/env bash
if [ "$1" != "run" ] || [ "$2" != "scripts/lint-ratchet/baseline-merge-cli.ts" ]; then
  echo "unexpected bun invocation: $*" >&2
  exit 64
fi
printf '{"semantic":true}\n' >"$4"
if [ -n "${7:-}" ]; then
  printf 'truth-up required\npre-merge-head=%s\n' "${8:-}" >"$7"
fi
printf '%s\n' "${8:-}" >"${MERGE_DRIVER_MERGE_HEAD_ARG_LOG:?}"
EOF
  chmod +x "$fake_bun_dir/bun"
  semantic_base="$TMP_ROOT/merge-driver-base.json"
  semantic_current="$TMP_ROOT/merge-driver-current.json"
  semantic_other="$TMP_ROOT/merge-driver-other.json"
  semantic_err="$TMP_ROOT/merge-driver-semantic.err"
  merge_head_file=$(cd "$repo" && git rev-parse --git-path MERGE_HEAD)
  case "$merge_head_file" in
    /*) ;;
    *) merge_head_file="$repo/$merge_head_file" ;;
  esac
  merge_head_arg_log="$TMP_ROOT/merge-driver-merge-head.arg"
  printf '{"base":true}\n' >"$semantic_base"
  printf '{"current":true}\n' >"$semantic_current"
  printf '{"other":true}\n' >"$semantic_other"
  git -C "$repo" rev-parse HEAD >"$merge_head_file"
  (
    cd "$repo"
    PATH="$fake_bun_dir:$PATH" MERGE_DRIVER_MERGE_HEAD_ARG_LOG="$merge_head_arg_log" \
      bash "$installed_driver" lint-ratchet \
      "$semantic_base" "$semantic_current" "$semantic_other" "%L" "lint-ratchet.baseline.json"
  ) 2>"$semantic_err" \
    || fail "merge-driver should exit 0 when semantic merge succeeds: $(cat "$semantic_err")"
  [ "$(cat "$semantic_current")" = '{"semantic":true}' ] \
    || fail "merge-driver should let semantic merge rewrite the current file: $(cat "$semantic_current")"
  [ ! -s "$semantic_err" ] \
    || fail "semantic merge success should not print fallback guidance: $(cat "$semantic_err")"
  semantic_marker="$repo/.git/musi/lint-ratchet-baseline-postmerge-truth-up-required"
  [ "$(cat "$semantic_marker")" = "$(printf 'truth-up required\npre-merge-head=%s' "$(git -C "$repo" rev-parse HEAD)")" ] \
    || fail "semantic merge success should write the worktree-local truth-up marker"
  [ "$(cat "$merge_head_arg_log")" = "$(git -C "$repo" rev-parse HEAD)" ] \
    || fail "merge-driver should pass the pre-merge HEAD sha to the semantic driver: $(cat "$merge_head_arg_log")"

  rm -f "$merge_head_file" "$semantic_marker"
  printf '{"current":true}\n' >"$semantic_current"
  (
    cd "$repo"
    PATH="$fake_bun_dir:$PATH" MERGE_DRIVER_MERGE_HEAD_ARG_LOG="$merge_head_arg_log" \
      bash "$installed_driver" lint-ratchet \
      "$semantic_base" "$semantic_current" "$semantic_other" "%L" "lint-ratchet.baseline.json"
  ) 2>"$semantic_err" \
    || fail "non-merge semantic driver invocation should still succeed: $(cat "$semantic_err")"
  [ "$(cat "$semantic_current")" = '{"semantic":true}' ] \
    || fail "non-merge semantic driver invocation should rewrite current file: $(cat "$semantic_current")"
  [ "$(cat "$semantic_marker")" = "$(printf 'truth-up required\npre-merge-head=%s' "$(git -C "$repo" rev-parse HEAD)")" ] \
    || fail "semantic merge without MERGE_HEAD should write a pre-merge-head-stamped truth-up marker"
  [ "$(cat "$merge_head_arg_log")" = "$(git -C "$repo" rev-parse HEAD)" ] \
    || fail "non-merge semantic driver invocation should pass the current HEAD stamp: $(cat "$merge_head_arg_log")"
  rm -f "$semantic_marker"

  linked_repo="$TMP_ROOT/merge-driver-linked-worktree"
  git -C "$repo" worktree add -q "$linked_repo" HEAD
  mkdir -p "$linked_repo/scripts/lint-ratchet"
  : >"$linked_repo/scripts/lint-ratchet/baseline-merge-cli.ts"
  linked_git_dir=$(cd "$linked_repo" && git rev-parse --git-dir)
  case "$linked_git_dir" in
    /*) ;;
    *) linked_git_dir="$linked_repo/$linked_git_dir" ;;
  esac
  linked_common_dir=$(cd "$linked_repo" && git rev-parse --git-common-dir)
  case "$linked_common_dir" in
    /*) ;;
    *) linked_common_dir="$linked_repo/$linked_common_dir" ;;
  esac
  linked_marker="$linked_git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required"
  shared_marker="$linked_common_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required"
  [ "$linked_marker" != "$shared_marker" ] \
    || fail "linked worktree fixture should have distinct git-dir and common-dir marker paths"
  rm -f "$linked_marker" "$shared_marker"
  linked_merge_head_file=$(cd "$linked_repo" && git rev-parse --git-path MERGE_HEAD)
  case "$linked_merge_head_file" in
    /*) ;;
    *) linked_merge_head_file="$linked_repo/$linked_merge_head_file" ;;
  esac
  git -C "$linked_repo" rev-parse HEAD >"$linked_merge_head_file"
  linked_current="$TMP_ROOT/merge-driver-linked-current.json"
  printf '{"current":true}\n' >"$linked_current"
  (
    cd "$linked_repo"
    PATH="$fake_bun_dir:$PATH" MERGE_DRIVER_MERGE_HEAD_ARG_LOG="$merge_head_arg_log" \
      bash "$installed_driver" lint-ratchet \
      "$semantic_base" "$linked_current" "$semantic_other" "%L" "lint-ratchet.baseline.json"
  ) 2>"$semantic_err" \
    || fail "linked worktree semantic driver invocation should succeed: $(cat "$semantic_err")"
  [ "$(cat "$linked_marker")" = "$(printf 'truth-up required\npre-merge-head=%s' "$(git -C "$linked_repo" rev-parse HEAD)")" ] \
    || fail "linked worktree semantic merge should write the worktree-local truth-up marker"
  [ ! -e "$shared_marker" ] \
    || fail "linked worktree semantic merge should not write a shared common-dir truth-up marker"
  rm -f "$linked_merge_head_file" "$linked_marker" "$shared_marker"

  rm -rf "$repo/scripts"

  cat >"$repo/.gitattributes" <<'EOF'
/lint-ratchet.baseline.json merge=lint-ratchet-baseline
EOF
  cat >"$repo/lint-ratchet.baseline.json" <<'JSON'
{"version":1,"tests":{"base":{}}}
JSON
  git -C "$repo" add .gitattributes lint-ratchet.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  cat >"$repo/lint-ratchet.baseline.json" <<'JSON'
{"version":1,"tests":{"side":{}}}
JSON
  git -C "$repo" commit -qam side

  git -C "$repo" checkout -q main
  cat >"$repo/lint-ratchet.baseline.json" <<'JSON'
{"version":1,"tests":{"main":{}}}
JSON
  git -C "$repo" commit -qam main

  [ ! -e "$repo/scripts/git/baseline-merge-driver.sh" ] \
    || fail "merge-driver smoke should simulate a checkout without scripts/git"

  set +e
  git -C "$repo" merge side >"$TMP_ROOT/merge-driver-merge.out" \
    2>"$TMP_ROOT/merge-driver-merge.err"
  status=$?
  set -e
  [ "$status" -ne 0 ] || fail "merge-driver merge should leave a conflict"
  grep -qF "lint-ratchet baseline conflict" "$TMP_ROOT/merge-driver-merge.err" \
    || fail "merge-driver conflict guidance missing: $(cat "$TMP_ROOT/merge-driver-merge.err")"
  grep -qF "bun run lint:ratchet:update" "$TMP_ROOT/merge-driver-merge.err" \
    || fail "merge-driver guidance missing update command: $(cat "$TMP_ROOT/merge-driver-merge.err")"
  grep -qF \
    'bun run lint:ratchet:update -- --allow-worse --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"' \
    "$TMP_ROOT/merge-driver-merge.err" \
    || fail "merge-driver guidance missing allow-worse reason placeholder: $(cat "$TMP_ROOT/merge-driver-merge.err")"
  grep -qF "inspect the baseline diff against both sides" \
    "$TMP_ROOT/merge-driver-merge.err" \
    || fail "merge-driver guidance missing both-sides diff review: $(cat "$TMP_ROOT/merge-driver-merge.err")"
  grep -qF "During git rebase the sides are swapped" \
    "$TMP_ROOT/merge-driver-merge.err" \
    || fail "merge-driver guidance missing rebase side-swap note: $(cat "$TMP_ROOT/merge-driver-merge.err")"
  grep -qF "MERGE_HEAD exists only during git merge" \
    "$TMP_ROOT/merge-driver-merge.err" \
    || fail "merge-driver guidance missing MERGE_HEAD caveat: $(cat "$TMP_ROOT/merge-driver-merge.err")"
  grep -qF "CHERRY_PICK_HEAD during a cherry-pick" \
    "$TMP_ROOT/merge-driver-merge.err" \
    || fail "merge-driver guidance missing rebase/cherry-pick refs: $(cat "$TMP_ROOT/merge-driver-merge.err")"
  unmerged_count=$(git -C "$repo" ls-files -u -- lint-ratchet.baseline.json | wc -l | tr -d ' ')
  [ "$unmerged_count" = "3" ] \
    || fail "merge-driver should leave baseline unmerged, got $unmerged_count index stages"
  grep -qF "<<<<<<<" "$repo/lint-ratchet.baseline.json" \
    && fail "merge-driver should not write conflict markers into the baseline"
  grep -qF '"main"' "$repo/lint-ratchet.baseline.json" \
    || fail "merge-driver should keep the current-branch baseline placeholder"
  BASELINE="$repo/lint-ratchet.baseline.json" bun -e '
    const { readFileSync } = require("fs");
    JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
  ' || fail "merge-driver should leave parseable JSON"
}

assert_lint_ratchet_merge_recipe_docs_match_driver() {
  # The per-baseline recovery recipes in docs/guides/lint-ratchet-merges.md are
  # projected from a single source — the driver's own print_conflict_recovery
  # case blocks — by scripts/generate-baseline-conflict-recipes.ts, keyed by
  # baseline. Running that generator in --check mode is the parity guard: it
  # fails if the committed markdown block drifts from the driver text for any of
  # the four baselines (lint-ratchet, knip, near-duplicates, max-lines), not just
  # the lint-ratchet one this assertion originally hand-compared.
  bun run scripts/generate-baseline-conflict-recipes.ts --check \
    || fail "baseline conflict recipe docs drifted from the driver (run bun run docs:baseline-conflict-recipes)"
}

assert_max_lines_exceptions_fallback_recipe() {
  local driver=scripts/git/baseline-merge-driver.sh
  local guide=docs/guides/lint-ratchet-merges.md

  grep -qF 'git show :2:$path' "$driver" \
    || fail "max-lines fallback should show the kept stage-2 configuration"
  grep -qF 'git show :3:$path' "$driver" \
    || fail "max-lines fallback should show the other stage-3 configuration"
  grep -qF "Hand-edit the kept file's entries to incorporate the other side's intended cap changes" \
    "$driver" \
    || fail "max-lines fallback should require reconciling the other side's cap changes"
  grep -qF 'bun run lint:max-lines-exceptions:update' "$driver" \
    || fail "max-lines fallback should normalize the reconciled configuration"
  grep -qF 'bun run lint:max-lines-exceptions' "$driver" \
    || fail "max-lines fallback should validate the reconciled configuration"
  grep -qFx '  bun run lint' "$driver" \
    || fail "max-lines fallback should confirm caps suffice for the merged source"
  grep -qF 'Max-lines fallback is different: its entries are human-chosen caps' "$guide" \
    || fail "lint-ratchet guide should distinguish max-lines config reconciliation"
  grep -qF 'does not regenerate entries from the merged tree' "$guide" \
    || fail "lint-ratchet guide should state the max-lines update limitation"
  grep -qF 'reconcile its entries from stages 2 and 3 before running the update' "$guide" \
    || fail "driverless max-lines recovery should reconcile both sides before update"
  grep -qF 'full-lint commit gate' "$guide" \
    || fail "lint-ratchet guide should require a merged-source cap sufficiency check"
}

assert_entry_baseline_fallback_rebase_guidance() {
  # The knip and max-lines recovery recipes both live in the one generic driver
  # body now. Extract each recipe's own `case` heredoc block before asserting, so
  # dropping the rebase side-swap note from one recipe cannot be masked by the
  # other still carrying it (a whole-file grep could not tell them apart).
  local driver=scripts/git/baseline-merge-driver.sh
  local recipe body
  for recipe in knip-unused-exports max-lines-exceptions; do
    body=$(awk -v key="$recipe" '
      { line = $0; sub(/^[[:space:]]+/, "", line) }
      /print_conflict_recovery\(\)/ { in_fn = 1 }
      in_fn && line == key ")" { in_case = 1 }
      in_case && /cat >&2 <<EOF/ { in_body = 1; next }
      in_body && line == "EOF" { exit }
      in_body { print }
    ' "$driver")
    [ -n "$body" ] \
      || fail "could not extract the $recipe recovery recipe block from $driver"
    grep -qF "That is the current branch during git merge and git cherry-pick." <<<"$body" \
      || fail "$recipe recipe should identify the kept side during merge and cherry-pick"
    grep -qF "During git rebase the sides are swapped" <<<"$body" \
      || fail "$recipe recipe should explain the rebase side swap"
    grep -qF "base, not the branch being rebased." <<<"$body" \
      || fail "$recipe recipe should identify the kept rebase side as the upstream base"
  done
}

assert_policy_safe_recovery_docs() {
  if grep -R -n -E 'checkout --our[s]|checkout --their[s]' docs scripts; then
    fail "generated baseline recovery docs must not use policy-blocked checkout commands"
  fi
  grep -qF \
    'bun run baseline:restore-stage -- --ours lint-ratchet.baseline.json' \
    docs/guides/lint-ratchet-merges.md \
    || fail "lint-ratchet guide should use the policy-safe stage restore command"
  grep -qF 'During rebase Git swaps the sides' docs/guides/lint-ratchet-merges.md \
    || fail "lint-ratchet guide should explain the rebase side swap"
  grep -qF 'stage 2 is the' docs/guides/lint-ratchet-merges.md \
    || fail "lint-ratchet guide should identify stage 2 as the rebase upstream base"
  if grep -qF 'during rebase the sides swap, so use `--theirs`' \
      tools/lint-ratchet/src/kernel/entry-baseline.ts tools/lint-ratchet/src/kernel/baseline-validation.ts \
      eslint-config/shared-policy.js docs/guides/lint-ratchet-merges.md; then
    fail "driverless recovery guidance must keep stage 2 during rebase"
  fi
  grep -qF 'A matching marker left by cherry-pick or rebase is actionable' \
    docs/guides/lint-ratchet-merges.md \
    || fail "lint-ratchet guide should document actionable non-merge markers"
}

assert_generated_baseline_stage_restore() {
  local repo="$TMP_ROOT/generated-baseline-stage-restore"
  local fakebin="$TMP_ROOT/generated-baseline-stage-restore-fakebin"
  local outside_dir="$TMP_ROOT/generated-baseline-stage-restore-outside"
  local output path real_git status
  local -a baselines=(
    "lint-ratchet.baseline.json"
    "sensor-knip-unused-exports.baseline.json"
    "eslint-config/max-lines-exceptions.baseline.json"
  )

  grep -qF '"baseline:restore-stage": "bash scripts/git/restore-generated-baseline-stage.sh"' \
    package.json \
    || fail "package scripts should expose baseline:restore-stage"

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  mkdir -p "$repo/eslint-config"

  for path in "${baselines[@]}"; do
    printf 'base:%s\n' "$path" >"$repo/$path"
  done
  git -C "$repo" add .
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  for path in "${baselines[@]}"; do
    printf 'theirs:%s\n' "$path" >"$repo/$path"
  done
  git -C "$repo" commit -qam theirs

  git -C "$repo" checkout -q main
  for path in "${baselines[@]}"; do
    printf 'ours:%s\n' "$path" >"$repo/$path"
  done
  git -C "$repo" commit -qam ours

  set +e
  git -C "$repo" merge side >"$TMP_ROOT/generated-baseline-merge.out" 2>&1
  status=$?
  set -e
  [ "$status" -ne 0 ] \
    || fail "generated baseline fixture merge should conflict"

  for path in "${baselines[@]}"; do
    (cd "$repo" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
      --ours "$path") \
      || fail "stage restore should restore stage 2 for $path"
    [ "$(cat "$repo/$path")" = "ours:$path" ] \
      || fail "--ours should write stage 2 for $path"

    (cd "$repo" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
      --theirs "$path") \
      || fail "stage restore should restore stage 3 for $path"
    [ "$(cat "$repo/$path")" = "theirs:$path" ] \
      || fail "--theirs should write stage 3 for $path"
  done

  mkdir -p "$outside_dir"
  printf '%s\n' 'outside-destination-must-stay-intact' \
    >"$outside_dir/max-lines-exceptions.baseline.json"
  mv "$repo/eslint-config" "$repo/eslint-config.real"
  ln -s "$outside_dir" "$repo/eslint-config"
  set +e
  output=$(cd "$repo" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
    --ours eslint-config/max-lines-exceptions.baseline.json 2>&1)
  status=$?
  set -e
  [ "$status" -eq 1 ] \
    || fail "stage restore should reject a symlinked ancestor, got $status: $output"
  case "$output" in
    *"resolves outside the expected repository path"*) : ;;
    *) fail "stage restore should explain the unsafe resolved destination: $output" ;;
  esac
  [ "$(cat "$outside_dir/max-lines-exceptions.baseline.json")" = \
      'outside-destination-must-stay-intact' ] \
    || fail "stage restore should not write through a symlinked ancestor"
  rm "$repo/eslint-config"
  mv "$repo/eslint-config.real" "$repo/eslint-config"

  real_git=$(command -v git)
  mkdir -p "$fakebin"
  cat >"$fakebin/git" <<SH
#!/usr/bin/env bash
if [ "\${1-}" = show ] && [ "\${2-}" = ':2:lint-ratchet.baseline.json' ]; then
  printf '%s\n' 'partial-object-data'
  exit 73
fi
exec "$real_git" "\$@"
SH
  chmod +x "$fakebin/git"
  printf '%s\n' 'destination-must-stay-intact' >"$repo/lint-ratchet.baseline.json"
  set +e
  output=$(cd "$repo" && PATH="$fakebin:$PATH" \
    bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
      --ours lint-ratchet.baseline.json 2>&1)
  status=$?
  set -e
  [ "$status" -eq 1 ] \
    || fail "stage restore should report a failed object read, got $status: $output"
  case "$output" in
    *"failed to read stage 2 (--ours) for lint-ratchet.baseline.json"*) : ;;
    *) fail "stage restore should explain the failed object read: $output" ;;
  esac
  [ "$(cat "$repo/lint-ratchet.baseline.json")" = 'destination-must-stay-intact' ] \
    || fail "failed object read should leave the destination intact"
  if find "$repo" -name '.restore-generated-baseline-stage.*' -print -quit | grep -q .; then
    fail "failed object read should clean up its temporary file"
  fi

  set +e
  output=$(cd "$repo" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
    --ours docs/not-a-generated-baseline.json 2>&1)
  status=$?
  set -e
  [ "$status" -eq 2 ] \
    || fail "stage restore should reject an unknown path with exit 2, got $status: $output"
  case "$output" in
    *"only the three generated baseline paths are supported"*) : ;;
    *) fail "stage restore unknown-path error should name its narrow scope: $output" ;;
  esac

  git -C "$repo" merge --abort
  set +e
  output=$(cd "$repo" && bash "$REPO_ROOT/scripts/git/restore-generated-baseline-stage.sh" \
    --ours lint-ratchet.baseline.json 2>&1)
  status=$?
  set -e
  [ "$status" -eq 1 ] \
    || fail "stage restore should fail outside a conflict operation, got $status: $output"
  case "$output" in
    *"no merge, cherry-pick, or rebase conflict is in progress"*) : ;;
    *) fail "stage restore should explain the missing conflict operation: $output" ;;
  esac
}

copy_lint_ratchet_merge_runtime() {
  local repo=$1
  local runtime_file
  mkdir -p "$repo/scripts/git" "$repo/scripts/lint-ratchet" "$repo/scripts/harness" \
    "$repo/scripts/lib/baseline"
  cp scripts/git/check-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/check-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/lint-ratchet-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-info-attributes.ts "$repo/scripts/git/"
  cp scripts/harness/harness-manifest.ts "$repo/scripts/harness/harness-manifest.ts"
  # The merge CLI's grouped-codec closure (baseline codec, atomic writer, item
  # merge, git-rail merge-cli, codepoint comparator) moved to the
  # @musi/lint-ratchet package (leaf 02 S3). Provide it as a symlinked workspace
  # member — plus the node_modules the engine resolves at runtime — so the real
  # adapter CLI resolves in the sandbox, instead of copying the engine sources.
  mkdir -p "$repo/tools"
  ln -s "$REPO_ROOT/tools/lint-ratchet" "$repo/tools/lint-ratchet"
  ln -s "$REPO_ROOT/node_modules" "$repo/node_modules"
  cat >"$repo/package.json" <<'JSON'
{
  "name": "lint-ratchet-merge-sandbox",
  "private": true,
  "type": "module",
  "workspaces": ["tools/lint-ratchet"],
  "devDependencies": { "@musi/lint-ratchet": "workspace:*" }
}
JSON
  for runtime_file in scripts/lint-ratchet/*.ts; do
    case "$runtime_file" in
      *.test.ts) continue ;;
    esac
    cp "$runtime_file" "$repo/scripts/lint-ratchet/"
  done
}

write_merge_driver_semantic_baseline() {
  local file=$1
  local one_count=$2
  local two_count=$3
  local one_config_hash=${4-$MERGE_DRIVER_CONFIG_HASH}
  local two_config_hash=${5-$MERGE_DRIVER_CONFIG_HASH}

  cat >"$file" <<JSON
{
  "version": 1,
  "tests": {
    "ratchet/fixture-one": {
      "ruleId": "local/example-one",
      "mode": "no-new",
      "metric": "message-count",
      "files": ["packages/**/*.ts"],
      "ignores": [],
      "ruleOptions": [],
      "configHash": "$one_config_hash",
      "ruleSourceHash": "$MERGE_DRIVER_SOURCE_HASH",
      "items": {
        "packages/server/src/one.ts": {
          "count": $one_count
        }
      }
    },
    "ratchet/fixture-two": {
      "ruleId": "local/example-two",
      "mode": "no-new",
      "metric": "message-count",
      "files": ["packages/**/*.ts"],
      "ignores": [],
      "ruleOptions": [],
      "configHash": "$two_config_hash",
      "ruleSourceHash": "$MERGE_DRIVER_SOURCE_HASH",
      "items": {
        "packages/client/src/two.ts": {
          "count": $two_count
        }
      }
    }
  }
}

JSON
}

write_knip_merge_driver_baseline() {
  local file=$1
  shift
  local count=$#
  local index=0 symbol
  {
    printf '{\n'
    printf '  "version": 2,\n'
    printf '  "tool": "knip",\n'
    printf '  "metric": "unused-export-symbols",\n'
    printf '  "includeCategories": "exports,types,enumMembers,namespaceMembers,unlisted,dependencies",\n'
    printf '  "summary": {\n'
    printf '    "count": %s,\n' "$count"
    printf '    "categories": {\n'
    printf '      "exports": %s,\n' "$count"
    printf '      "types": 0,\n'
    printf '      "enumMembers": 0,\n'
    printf '      "namespaceMembers": 0\n'
    printf '    }\n'
    printf '  },\n'
    printf '  "entries": [\n'
    for symbol in "$@"; do
      index=$((index + 1))
      printf '    {\n'
      printf '      "key": "exports|src/a.ts|%s",\n' "$symbol"
      printf '      "path": "src/a.ts",\n'
      printf '      "category": "exports",\n'
      printf '      "symbol": "%s"\n' "$symbol"
      if [ "$index" -eq "$count" ]; then
        printf '    }\n'
      else
        printf '    },\n'
      fi
    done
    printf '  ]\n'
    printf '}\n'
  } >"$file"
}

write_max_lines_exceptions_merge_driver_baseline() {
  local file=$1
  shift
  local count=$#
  local cap=${MAX_LINES_EXCEPTION_CAP:-400}
  local index=0 path
  {
    printf '{\n'
    printf '  "version": 2,\n'
    printf '  "tool": "eslint-max-lines",\n'
    printf '  "metric": "file-line-cap-exceptions",\n'
    printf '  "summary": {\n'
    printf '    "count": %s\n' "$count"
    printf '  },\n'
    printf '  "entries": [\n'
    for path in "$@"; do
      index=$((index + 1))
      printf '    {\n'
      printf '      "path": "%s",\n' "$path"
      printf '      "cap": %s,\n' "$cap"
      printf '      "severity": "warn",\n'
      printf '      "reason": "legacy file pending split",\n'
      printf '      "lifecycle": "candidate-for-split",\n'
      printf '      "ratchetExcluded": true\n'
      if [ "$index" -eq "$count" ]; then
        printf '    }\n'
      else
        printf '    },\n'
      fi
    done
    printf '  ]\n'
    printf '}\n'
  } >"$file"
}

assert_lint_ratchet_merge_driver_real_semantic_merge() {
  local repo="$TMP_ROOT/merge-driver-real-semantic"
  local base_file current_file fallback_err fallback_status git_common_dir git_dir installed_driver
  local marker_content marker_file merge_head_file other_file status unmerged_count

  copy_lint_ratchet_merge_runtime "$repo"
  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  git -C "$repo" commit --allow-empty -qm seed
  (cd "$repo" && bash scripts/git/install-lint-ratchet-merge-driver.sh) >/dev/null \
    || fail "real semantic merge-driver install failed"
  git_common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
  case "$git_common_dir" in
    /*) installed_driver="$git_common_dir/musi/baseline-merge-driver.sh" ;;
    *) installed_driver="$repo/$git_common_dir/musi/baseline-merge-driver.sh" ;;
  esac
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required" ;;
  esac
  merge_head_file=$(cd "$repo" && git rev-parse --git-path MERGE_HEAD)
  case "$merge_head_file" in
    /*) ;;
    *) merge_head_file="$repo/$merge_head_file" ;;
  esac

  base_file="$TMP_ROOT/merge-driver-fallback-base.json"
  current_file="$TMP_ROOT/merge-driver-fallback-current.json"
  other_file="$TMP_ROOT/merge-driver-fallback-other.json"
  fallback_err="$TMP_ROOT/merge-driver-fallback.err"
  write_merge_driver_semantic_baseline "$base_file" 5 6
  write_merge_driver_semantic_baseline "$current_file" 3 6
  write_merge_driver_semantic_baseline \
    "$other_file" 4 6 "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  set +e
  (
    cd "$repo"
    bash "$installed_driver" lint-ratchet \
      "$base_file" "$current_file" "$other_file" "%L" "lint-ratchet.baseline.json"
  ) 2>"$fallback_err"
  fallback_status=$?
  set -e
  [ "$fallback_status" -ne 0 ] \
    || fail "metadata-drift semantic merge should fall back with nonzero status"
  grep -qF "semantic merge could not resolve lint-ratchet.baseline.json" "$fallback_err" \
    || fail "driver should show real CLI refusal before fallback: $(cat "$fallback_err")"
  grep -qF "semantic merge fell back to manual resolution" "$fallback_err" \
    || fail "driver should cover the CLI-exit-1 fallback branch: $(cat "$fallback_err")"
  grep -qF "lint-ratchet baseline conflict" "$fallback_err" \
    || fail "driver fallback should print manual conflict guidance: $(cat "$fallback_err")"
  [ ! -e "$marker_file" ] \
    || fail "semantic fallback should not leave a truth-up marker"
  BASELINE="$current_file" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const parsed = JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
    const item = parsed.tests["ratchet/fixture-one"].items["packages/server/src/one.ts"];
    if (item.count !== 3) assertionFailed(`current side was rewritten to ${item.count}`);
  ' || fail "fallback should leave the current temp file untouched"

  rm -f "$marker_file"
  write_merge_driver_semantic_baseline "$base_file" 5 6
  write_merge_driver_semantic_baseline "$current_file" 3 6
  write_merge_driver_semantic_baseline "$other_file" 4 6
  git -C "$repo" rev-parse HEAD >"$merge_head_file"
  (
    cd "$repo"
    bash "$installed_driver" lint-ratchet \
      "$base_file" "$current_file" "$other_file" "%L" "lint-ratchet.baseline.json"
  ) 2>"$fallback_err" \
    || fail "strict-min semantic merge should succeed: $(cat "$fallback_err")"
  [ -s "$marker_file" ] \
    || fail "strict-min semantic merge should leave a post-merge truth-up marker"
  BASELINE="$current_file" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const parsed = JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
    const item = parsed.tests["ratchet/fixture-one"].items["packages/server/src/one.ts"];
    if (item.count !== 3) assertionFailed(`current side was rewritten to ${item.count}`);
  ' || fail "strict-min semantic merge should keep the minimum floor"
  rm -f "$marker_file" "$merge_head_file"

  cat >"$repo/.gitattributes" <<'EOF'
/lint-ratchet.baseline.json merge=lint-ratchet-baseline
EOF
  write_merge_driver_semantic_baseline "$repo/lint-ratchet.baseline.json" 5 6
  git -C "$repo" add .gitattributes lint-ratchet.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  write_merge_driver_semantic_baseline "$repo/lint-ratchet.baseline.json" 3 6
  git -C "$repo" commit -qam side

  git -C "$repo" checkout -q main
  write_merge_driver_semantic_baseline "$repo/lint-ratchet.baseline.json" 2 6
  git -C "$repo" commit -qam main

  set +e
  git -C "$repo" merge --no-ff -m semantic-merge side >"$TMP_ROOT/merge-driver-real.out" \
    2>"$TMP_ROOT/merge-driver-real.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real semantic baseline git merge should succeed: $(cat "$TMP_ROOT/merge-driver-real.err")"
  grep -qF "fell back to manual resolution" "$TMP_ROOT/merge-driver-real.err" \
    && fail "real semantic baseline git merge should not use fallback: $(cat "$TMP_ROOT/merge-driver-real.err")"
  unmerged_count=$(git -C "$repo" ls-files -u -- lint-ratchet.baseline.json | wc -l | tr -d ' ')
  [ "$unmerged_count" = "0" ] \
    || fail "real semantic baseline git merge should leave no unmerged stages"
  BASELINE="$repo/lint-ratchet.baseline.json" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const parsed = JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
    const one = parsed.tests["ratchet/fixture-one"].items["packages/server/src/one.ts"].count;
    const two = parsed.tests["ratchet/fixture-two"].items["packages/client/src/two.ts"].count;
    if (one !== 2 || two !== 6) assertionFailed(`merged counts were ${one}/${two}`);
  ' || fail "real semantic baseline git merge should keep minimum floors"
  [ -s "$marker_file" ] \
    || fail "real semantic baseline git merge should leave a post-merge truth-up marker"
  marker_content=$(cat "$marker_file")
  [ "$marker_content" = "$(printf 'lint-ratchet baseline semantic merge requires post-merge truth-up\npre-merge-head=%s' "$(git -C "$repo" rev-parse HEAD^1)")" ] \
    || fail "real semantic baseline git merge should write a pre-merge-head marker while MERGE_HEAD is unavailable to the driver: $marker_content"
}

assert_knip_unused_exports_merge_driver_real_semantic_merge() {
  local repo="$TMP_ROOT/knip-merge-driver-real-semantic"
  local git_common_dir git_dir installed_driver marker_content marker_file status unmerged_count

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"

  (cd "$repo" && bash scripts/git/install-knip-unused-exports-merge-driver.sh) >/dev/null \
    || fail "knip semantic merge-driver install failed"
  git_common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
  case "$git_common_dir" in
    /*) installed_driver="$git_common_dir/musi/baseline-merge-driver.sh" ;;
    *) installed_driver="$repo/$git_common_dir/musi/baseline-merge-driver.sh" ;;
  esac
  [ -x "$installed_driver" ] \
    || fail "knip merge-driver installer should copy an executable driver into the git common dir"
  (
    cd "$repo"
    bash scripts/git/check-knip-unused-exports-merge-driver.sh
  ) >"$TMP_ROOT/knip-merge-driver-check.out"
  [ "$(cat "$TMP_ROOT/knip-merge-driver-check.out")" = "PASS: knip unused-exports merge driver is installed and current" ] \
    || fail "knip merge-driver health check should pass when current: $(cat "$TMP_ROOT/knip-merge-driver-check.out")"
  [ "$(git -C "$repo" check-attr merge -- sensor-knip-unused-exports.baseline.json)" = "sensor-knip-unused-exports.baseline.json: merge: knip-unused-exports-baseline" ] \
    || fail "knip merge-driver install should mirror the anchored baseline driver attribute"

  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" ;;
  esac

  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a b c
  git -C "$repo" add sensor-knip-unused-exports.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" b c
  git -C "$repo" commit -qam side

  git -C "$repo" checkout -q main
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a c
  git -C "$repo" commit -qam main

  set +e
  git -C "$repo" merge --no-ff -m semantic-merge side >"$TMP_ROOT/knip-merge-driver-real.out" \
    2>"$TMP_ROOT/knip-merge-driver-real.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real knip baseline git merge should succeed: $(cat "$TMP_ROOT/knip-merge-driver-real.err")"
  unmerged_count=$(git -C "$repo" ls-files -u -- sensor-knip-unused-exports.baseline.json | wc -l | tr -d ' ')
  [ "$unmerged_count" = "0" ] \
    || fail "real knip baseline git merge should leave no unmerged stages"
  BASELINE="$repo/sensor-knip-unused-exports.baseline.json" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const parsed = JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
    if (parsed.summary.count !== parsed.entries.length) {
      assertionFailed(`summary ${parsed.summary.count} vs entries ${parsed.entries.length}`);
    }
    if (parsed.summary.count !== 1 || parsed.entries[0]?.symbol !== "c") {
      assertionFailed(`unexpected merged baseline ${JSON.stringify(parsed)}`);
    }
  ' || fail "real knip baseline git merge should keep the shared drained-entry intersection"
  [ -s "$marker_file" ] \
    || fail "real knip baseline git merge should leave a post-merge truth-up marker"
  marker_content=$(cat "$marker_file")
  [ "$marker_content" = "$(printf 'knip unused-exports baseline semantic merge requires post-merge truth-up\npre-merge-head=%s' "$(git -C "$repo" rev-parse HEAD^1)")" ] \
    || fail "real knip baseline git merge should write a pre-merge-head marker while MERGE_HEAD is unavailable to the driver: $marker_content"
}

assert_knip_unused_exports_driverless_text_merge_blocks_summary_drift() {
  local repo="$TMP_ROOT/knip-driverless-text-merge"
  local output status

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test

  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a b c d e
  git -C "$repo" add sensor-knip-unused-exports.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" b c d e
  git -C "$repo" commit -qam side-drain

  git -C "$repo" checkout -q main
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a b c d
  git -C "$repo" commit -qam main-drain
  git -C "$repo" merge --no-ff -m driverless-text-merge side \
    >"$TMP_ROOT/knip-driverless-text-merge.out" \
    2>"$TMP_ROOT/knip-driverless-text-merge.err" \
    || fail "driverless disjoint knip drains should merge textually: $(cat "$TMP_ROOT/knip-driverless-text-merge.err")"

  BASELINE="$repo/sensor-knip-unused-exports.baseline.json" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const parsed = JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
    if (parsed.summary.count !== 4 || parsed.entries.length !== 3) {
      assertionFailed(`expected stale summary 4 over 3 entries, got ${parsed.summary.count}/${parsed.entries.length}`);
    }
  ' || fail "driverless textual merge should reproduce derived-summary drift"

  set +e
  output=$(FIXTURE_REPO="$repo" bun -e '
    import { runKnipUnusedExportsCli } from "./scripts/sensor-knip-unused-exports-core.ts";
    const reportJson = JSON.stringify({
      issues: [{
        file: "src/a.ts",
        exports: [{ name: "b" }, { name: "c" }, { name: "d" }],
      }],
    });
    const result = runKnipUnusedExportsCli({
      argv: [],
      cwd: process.env.FIXTURE_REPO,
      runner: () => ({ ok: true, reportJson, exitCode: 1, stderr: "" }),
    });
    console.log(result.stdout);
    process.exitCode = result.exitCode;
  ' 2>&1)
  status=$?
  set -e
  [ "$status" -eq 1 ] \
    || fail "the next knip sensor check should block driverless summary drift, got exit $status: $output"
  grep -qF 'WARN: baseline summary does not match the entries' <<<"$output" \
    || fail "driverless summary-drift failure should retain the parse warning: $output"
  grep -qF 'run: bun scripts/sensor-knip-unused-exports.ts --update' <<<"$output" \
    || fail "driverless summary-drift failure should print the update remediation: $output"
}

assert_max_lines_exceptions_merge_driver_real_semantic_merge() {
  local repo="$TMP_ROOT/max-lines-merge-driver-real-semantic"
  local git_common_dir installed_driver status unmerged_count

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  mkdir -p "$repo/eslint-config"

  (cd "$repo" && bash scripts/git/install-max-lines-exceptions-merge-driver.sh) >/dev/null \
    || fail "max-lines exceptions semantic merge-driver install failed"
  git_common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
  case "$git_common_dir" in
    /*) installed_driver="$git_common_dir/musi/baseline-merge-driver.sh" ;;
    *) installed_driver="$repo/$git_common_dir/musi/baseline-merge-driver.sh" ;;
  esac
  [ -x "$installed_driver" ] \
    || fail "max-lines exceptions merge-driver installer should copy an executable driver into the git common dir"
  (
    cd "$repo"
    bash scripts/git/check-max-lines-exceptions-merge-driver.sh
  ) >"$TMP_ROOT/max-lines-merge-driver-check.out"
  [ "$(cat "$TMP_ROOT/max-lines-merge-driver-check.out")" = "PASS: max-lines exceptions merge driver is installed and current" ] \
    || fail "max-lines exceptions merge-driver health check should pass when current: $(cat "$TMP_ROOT/max-lines-merge-driver-check.out")"
  [ "$(git -C "$repo" check-attr merge -- eslint-config/max-lines-exceptions.baseline.json)" = "eslint-config/max-lines-exceptions.baseline.json: merge: max-lines-exceptions-baseline" ] \
    || fail "max-lines exceptions merge-driver install should mirror the anchored nested baseline driver attribute"
  [ "$(git -C "$repo" check-attr merge -- nested/eslint-config/max-lines-exceptions.baseline.json)" = "nested/eslint-config/max-lines-exceptions.baseline.json: merge: unspecified" ] \
    || fail "max-lines exceptions baseline attribute should not match nested paths"

  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts src/b.ts src/c.ts
  git -C "$repo" add eslint-config/max-lines-exceptions.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/b.ts src/c.ts
  git -C "$repo" commit -qam side

  git -C "$repo" checkout -q main
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts src/c.ts
  git -C "$repo" commit -qam main

  set +e
  git -C "$repo" merge --no-ff -m semantic-merge side >"$TMP_ROOT/max-lines-merge-driver-real.out" \
    2>"$TMP_ROOT/max-lines-merge-driver-real.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real max-lines exceptions baseline git merge should succeed: $(cat "$TMP_ROOT/max-lines-merge-driver-real.err")"
  unmerged_count=$(git -C "$repo" ls-files -u -- eslint-config/max-lines-exceptions.baseline.json | wc -l | tr -d ' ')
  [ "$unmerged_count" = "0" ] \
    || fail "real max-lines exceptions baseline git merge should leave no unmerged stages"
  BASELINE="$repo/eslint-config/max-lines-exceptions.baseline.json" REPO_ROOT="$REPO_ROOT" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const { checkMaxLinesExceptionsBaseline } = await import(`${process.env.REPO_ROOT}/scripts/max-lines-exceptions-core.ts`);
    const text = readFileSync(process.env.BASELINE, "utf8");
    const checked = checkMaxLinesExceptionsBaseline(text);
    if (!checked.ok) assertionFailed(checked.error);
    const parsed = JSON.parse(text);
    if (parsed.summary.count !== parsed.entries.length) {
      assertionFailed(`summary ${parsed.summary.count} vs entries ${parsed.entries.length}`);
    }
    if (parsed.summary.count !== 1 || parsed.entries[0]?.path !== "src/c.ts") {
      assertionFailed(`unexpected merged baseline ${JSON.stringify(parsed)}`);
    }
  ' || fail "real max-lines exceptions baseline git merge should keep the shared drained-entry intersection and pass its hard-fail gate"
}

assert_max_lines_exceptions_merge_driver_real_additions_merge() {
  local repo="$TMP_ROOT/max-lines-merge-driver-real-additions"
  local attributes_file status unmerged_count

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  mkdir -p "$repo/eslint-config"
  cp "$REPO_ROOT/.gitattributes" "$repo/.gitattributes"

  (cd "$repo" && bash scripts/git/install-max-lines-exceptions-merge-driver.sh) >/dev/null \
    || fail "max-lines additions semantic merge-driver install failed"
  attributes_file=$(git -C "$repo" rev-parse --git-path info/attributes)
  case "$attributes_file" in
    /*) ;;
    *) attributes_file="$repo/$attributes_file" ;;
  esac
  rm -f "$attributes_file"
  [ "$(git -C "$repo" check-attr merge -- eslint-config/max-lines-exceptions.baseline.json)" = "eslint-config/max-lines-exceptions.baseline.json: merge: max-lines-exceptions-baseline" ] \
    || fail "committed .gitattributes should select the max-lines exceptions merge driver"

  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/c.ts
  git -C "$repo" add .gitattributes eslint-config/max-lines-exceptions.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/b.ts src/c.ts
  git -C "$repo" commit -qam side-addition

  git -C "$repo" checkout -q main
  write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts src/c.ts
  git -C "$repo" commit -qam main-addition

  set +e
  git -C "$repo" merge --no-ff -m semantic-additions-merge side \
    >"$TMP_ROOT/max-lines-merge-driver-additions.out" \
    2>"$TMP_ROOT/max-lines-merge-driver-additions.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real max-lines additions git merge should succeed: $(cat "$TMP_ROOT/max-lines-merge-driver-additions.err")"
  unmerged_count=$(git -C "$repo" ls-files -u -- eslint-config/max-lines-exceptions.baseline.json | wc -l | tr -d ' ')
  [ "$unmerged_count" = "0" ] \
    || fail "real max-lines additions git merge should leave no unmerged stages"
  BASELINE="$repo/eslint-config/max-lines-exceptions.baseline.json" REPO_ROOT="$REPO_ROOT" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const { checkMaxLinesExceptionsBaseline } = await import(`${process.env.REPO_ROOT}/scripts/max-lines-exceptions-core.ts`);
    const text = readFileSync(process.env.BASELINE, "utf8");
    const checked = checkMaxLinesExceptionsBaseline(text);
    if (!checked.ok) assertionFailed(checked.error);
    const parsed = JSON.parse(text);
    const paths = parsed.entries.map((entry) => entry.path);
    if (parsed.summary.count !== 3 || paths.join(",") !== "src/a.ts,src/b.ts,src/c.ts") {
      assertionFailed(`unexpected merged additions baseline ${JSON.stringify(parsed)}`);
    }
  ' || fail "real max-lines additions merge should preserve both additions and pass its hard-fail gate"
}

assert_max_lines_exceptions_merge_driver_real_truth_up_advisory() {
  local repo="$TMP_ROOT/max-lines-merge-driver-real-truth-up"
  local git_dir marker_file status

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  mkdir -p "$repo/eslint-config" "$repo/.githooks" "$repo/src"
  cp "$REPO_ROOT/.gitattributes" "$repo/.gitattributes"
  cat >"$repo/.githooks/post-merge" <<'SH'
#!/usr/bin/env bash
bash scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh
SH
  chmod +x "$repo/.githooks/post-merge"
  git -C "$repo" config core.hooksPath .githooks

  (cd "$repo" && bash scripts/git/install-max-lines-exceptions-merge-driver.sh) >/dev/null \
    || fail "max-lines truth-up semantic merge-driver install failed"
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/max-lines-exceptions-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/max-lines-exceptions-baseline-postmerge-truth-up-required" ;;
  esac

  yes '// source line' | head -n 425 >"$repo/src/a.ts" || true
  MAX_LINES_EXCEPTION_CAP=500 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" add .gitattributes .githooks/post-merge src/a.ts \
    eslint-config/max-lines-exceptions.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b side
  MAX_LINES_EXCEPTION_CAP=430 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" commit -qam side-cap

  git -C "$repo" checkout -q main
  MAX_LINES_EXCEPTION_CAP=420 write_max_lines_exceptions_merge_driver_baseline \
    "$repo/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$repo" commit -qam main-cap

  set +e
  git -C "$repo" merge --no-ff -m semantic-cap-merge side \
    >"$TMP_ROOT/max-lines-merge-driver-truth-up.out" \
    2>"$TMP_ROOT/max-lines-merge-driver-truth-up.err"
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "real max-lines cap-conflict git merge should succeed: $(cat "$TMP_ROOT/max-lines-merge-driver-truth-up.err")"
  grep -qF "post-merge: max-lines exception merge needs truth-up" \
    "$TMP_ROOT/max-lines-merge-driver-truth-up.err" \
    || fail "real max-lines cap-conflict merge should print a local truth-up advisory: $(cat "$TMP_ROOT/max-lines-merge-driver-truth-up.err")"
  grep -qF "bun run lint:max-lines-exceptions:update" \
    "$TMP_ROOT/max-lines-merge-driver-truth-up.err" \
    || fail "max-lines truth-up advisory should include the update command"
  grep -qF "bun run lint:max-lines-exceptions" \
    "$TMP_ROOT/max-lines-merge-driver-truth-up.err" \
    || fail "max-lines truth-up advisory should include the check command"
  grep -qF \
    "commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)" \
    "$TMP_ROOT/max-lines-merge-driver-truth-up.err" \
    || fail "max-lines truth-up advisory should lead with the follow-up commit option"
  BASELINE="$repo/eslint-config/max-lines-exceptions.baseline.json" bun -e '
    const { readFileSync } = require("fs");
    const assertionFailed = (message) => { console.error(message); process.exit(1); };
    const parsed = JSON.parse(readFileSync(process.env.BASELINE, "utf8"));
    if (parsed.summary.count !== 1 || parsed.entries[0]?.cap !== 420) {
      assertionFailed(`unexpected merged cap baseline ${JSON.stringify(parsed)}`);
    }
  ' || fail "real max-lines cap-conflict merge should keep the strict minimum cap"
  [ ! -e "$marker_file" ] \
    || fail "max-lines post-merge hook should consume the matching truth-up marker"

  printf 'truth-up required\npre-merge-head=%s\n' "$(printf 'a%.0s' {1..40})" >"$marker_file"
  set +e
  output=$(cd "$repo" && bash scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] || fail "max-lines stale-marker cleanup should stay advisory"
  [ "$output" = "post-merge: ignoring stale max-lines exceptions truth-up marker" ] \
    || fail "max-lines stale marker should be reported and ignored: $output"
  [ ! -e "$marker_file" ] || fail "max-lines stale marker should be consumed"
}

assert_lint_ratchet_cherry_pick_marker_leak_ignored() {
  local repo="$TMP_ROOT/lint-ratchet-cherry-pick-marker-leak"
  local fake_bin="$TMP_ROOT/lint-ratchet-cherry-pick-marker-leak-bin"
  local hook_log="$TMP_ROOT/lint-ratchet-cherry-pick-marker-leak.log"
  local git_dir marker_file output pre_cherry_pick_head

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  (cd "$repo" && bash scripts/git/install-lint-ratchet-merge-driver.sh) >/dev/null \
    || fail "lint-ratchet cherry-pick leak fixture install failed"
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required" ;;
  esac

  write_merge_driver_semantic_baseline "$repo/lint-ratchet.baseline.json" 5 6
  git -C "$repo" add lint-ratchet.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b picked
  write_merge_driver_semantic_baseline "$repo/lint-ratchet.baseline.json" 3 6
  printf 'picked\n' >"$repo/picked.txt"
  git -C "$repo" add lint-ratchet.baseline.json picked.txt
  git -C "$repo" commit -qm picked

  git -C "$repo" checkout -q main
  write_merge_driver_semantic_baseline "$repo/lint-ratchet.baseline.json" 2 6
  git -C "$repo" commit -qam main
  pre_cherry_pick_head=$(git -C "$repo" rev-parse HEAD)
  git -C "$repo" cherry-pick picked >/dev/null 2>"$TMP_ROOT/lint-ratchet-cherry-pick.err" \
    || fail "lint-ratchet cherry-pick should succeed: $(cat "$TMP_ROOT/lint-ratchet-cherry-pick.err")"
  grep -qF "pre-merge-head=$pre_cherry_pick_head" "$marker_file" \
    || fail "lint-ratchet cherry-pick should leave a pre-cherry-pick marker: $(cat "$marker_file")"

  git -C "$repo" checkout -q -b unrelated
  printf 'unrelated\n' >"$repo/unrelated.txt"
  git -C "$repo" add unrelated.txt
  git -C "$repo" commit -qm unrelated
  git -C "$repo" checkout -q main
  git -C "$repo" merge -q --no-ff -m unrelated-merge unrelated

  mkdir -p "$fake_bin"
  cat >"$fake_bin/bun" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${POST_MERGE_BUN_LOG:?}"
exit 0
SH
  chmod +x "$fake_bin/bun"
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "lint-ratchet post-merge hook should exit 0 for a stale cherry-pick marker"
  [ "$output" = "post-merge: ignoring stale lint-ratchet truth-up marker" ] \
    || fail "lint-ratchet stale cherry-pick marker should be reported and ignored: $output"
  [ ! -s "$hook_log" ] \
    || fail "lint-ratchet stale cherry-pick marker must not run truth-up checks: $(cat "$hook_log")"
  [ ! -e "$marker_file" ] \
    || fail "lint-ratchet stale cherry-pick marker should be consumed"
}

assert_knip_unused_exports_cherry_pick_marker_leak_ignored() {
  local repo="$TMP_ROOT/knip-cherry-pick-marker-leak"
  local fake_bin="$TMP_ROOT/knip-cherry-pick-marker-leak-bin"
  local hook_log="$TMP_ROOT/knip-cherry-pick-marker-leak.log"
  local git_dir marker_file output pre_cherry_pick_head

  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  (cd "$repo" && bash scripts/git/install-knip-unused-exports-merge-driver.sh) >/dev/null \
    || fail "knip cherry-pick leak fixture install failed"
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" ;;
  esac

  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a b c
  git -C "$repo" add sensor-knip-unused-exports.baseline.json
  git -C "$repo" commit -qm base

  git -C "$repo" checkout -q -b picked
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" b c
  printf 'picked\n' >"$repo/picked.txt"
  git -C "$repo" add sensor-knip-unused-exports.baseline.json picked.txt
  git -C "$repo" commit -qm picked

  git -C "$repo" checkout -q main
  write_knip_merge_driver_baseline "$repo/sensor-knip-unused-exports.baseline.json" a c
  git -C "$repo" commit -qam main
  pre_cherry_pick_head=$(git -C "$repo" rev-parse HEAD)
  git -C "$repo" cherry-pick picked >/dev/null 2>"$TMP_ROOT/knip-cherry-pick.err" \
    || fail "knip cherry-pick should succeed: $(cat "$TMP_ROOT/knip-cherry-pick.err")"
  grep -qF "pre-merge-head=$pre_cherry_pick_head" "$marker_file" \
    || fail "knip cherry-pick should leave a pre-cherry-pick marker: $(cat "$marker_file")"

  git -C "$repo" checkout -q -b unrelated
  printf 'unrelated\n' >"$repo/unrelated.txt"
  git -C "$repo" add unrelated.txt
  git -C "$repo" commit -qm unrelated
  git -C "$repo" checkout -q main
  git -C "$repo" merge -q --no-ff -m unrelated-merge unrelated

  mkdir -p "$fake_bin"
  cat >"$fake_bin/bun" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${POST_MERGE_BUN_LOG:?}"
exit 0
SH
  chmod +x "$fake_bin/bun"
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge hook should exit 0 for a stale cherry-pick marker"
  [ "$output" = "post-merge: ignoring stale knip unused-exports truth-up marker" ] \
    || fail "knip stale cherry-pick marker should be reported and ignored: $output"
  [ ! -s "$hook_log" ] \
    || fail "knip stale cherry-pick marker must not run truth-up checks: $(cat "$hook_log")"
  [ ! -e "$marker_file" ] \
    || fail "knip stale cherry-pick marker should be consumed"
}

assert_lint_ratchet_merge_driver_hash_tool_guard() {
  local repo="$TMP_ROOT/merge-driver-hash-guard"
  local restricted_bin="$TMP_ROOT/merge-driver-hash-guard-bin"
  local tool output installed_driver git_common_dir status sha256sum_bin

  mkdir -p "$repo/scripts/git" "$restricted_bin"
  cp scripts/git/check-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/check-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/lint-ratchet-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-info-attributes.ts "$repo/scripts/git/"
  # The attributes wrapper imports @musi/lint-ratchet/git-rail (leaf 02 S4);
  # resolve the source-only package via a scoped node_modules symlink.
  mkdir -p "$repo/node_modules/@musi"
  ln -s "$REPO_ROOT/tools/lint-ratchet" "$repo/node_modules/@musi/lint-ratchet"
  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test

  # A PATH with every tool the driver scripts need except sha256sum/shasum,
  # so the smoke can simulate a host with no hash tool at all. bun is included
  # because the attributes render now runs through baseline-info-attributes.ts;
  # the hash tools are what this smoke withholds, not the runtime.
  for tool in bash git awk mktemp cat rm mkdir cp chmod mv dirname flock sed grep bun; do
    ln -s "$(command -v "$tool")" "$restricted_bin/$tool"
  done

  (cd "$repo" && bash scripts/git/install-lint-ratchet-merge-driver.sh) \
    >/dev/null || fail "hash-guard install failed"

  git_common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
  case "$git_common_dir" in
    /*) installed_driver="$git_common_dir/musi/baseline-merge-driver.sh" ;;
    *) installed_driver="$repo/$git_common_dir/musi/baseline-merge-driver.sh" ;;
  esac

  # Fail closed: with no hash tool the check must never report PASS, even
  # though the installed state is actually current.
  set +e
  output=$(cd "$repo" && PATH="$restricted_bin" \
    bash scripts/git/check-lint-ratchet-merge-driver.sh 2>/dev/null)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "hash-tool-less check must stay advisory (exit 0), got $status: $output"
  [ "$output" = "WARN: lint-ratchet merge driver is missing or stale - run bun run lint:ratchet:install-merge-driver" ] \
    || fail "hash-tool-less check must fail closed with the WARN line: $output"

  # Fail closed: with no hash tool the installer must refresh a stale
  # installed driver copy instead of treating any two files as matching.
  printf 'stale installed driver\n' >"$installed_driver"
  (cd "$repo" && PATH="$restricted_bin" \
    bash scripts/git/install-lint-ratchet-merge-driver.sh) >/dev/null 2>&1 \
    || fail "hash-tool-less install should still exit 0"
  cmp -s "$repo/scripts/git/baseline-merge-driver.sh" "$installed_driver" \
    || fail "hash-tool-less install must refresh a stale installed driver copy"

  # shasum fallback: with shasum but no sha256sum on PATH (stock macOS), the
  # check must hash-compare via `shasum -a 256` and report PASS when current.
  sha256sum_bin=$(command -v sha256sum) \
    || fail "hash-guard smoke needs sha256sum on the host PATH"
  cat >"$restricted_bin/shasum" <<EOF
#!/usr/bin/env bash
[ "\$1" = "-a" ] && [ "\$2" = "256" ] \
  || { echo "unexpected shasum args: \$*" >&2; exit 64; }
shift 2
exec "$sha256sum_bin" "\$@"
EOF
  chmod +x "$restricted_bin/shasum"
  output=$(cd "$repo" && PATH="$restricted_bin" \
    bash scripts/git/check-lint-ratchet-merge-driver.sh) \
    || fail "shasum-only check should exit 0"
  [ "$output" = "PASS: lint-ratchet merge driver is installed and current" ] \
    || fail "shasum-only check should PASS on current state: $output"
}

assert_lint_ratchet_merge_driver_write_guard() {
  local repo="$TMP_ROOT/merge-driver-write-guard"
  local poison_bin="$TMP_ROOT/merge-driver-write-guard-bin"
  local bun_bin output status leftovers

  mkdir -p "$repo/scripts/git" "$poison_bin"
  cp scripts/git/check-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/check-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-lint-ratchet-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/install-baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/lint-ratchet-merge-driver-lib.sh "$repo/scripts/git/"
  cp scripts/git/baseline-merge-driver.sh "$repo/scripts/git/"
  cp scripts/git/baseline-info-attributes.ts "$repo/scripts/git/"
  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test

  mkdir -p "$repo/.git/info"
  printf 'unrelated/path merge=union\n' >"$repo/.git/info/attributes"

  # Poison the attributes render (baseline-info-attributes.ts). bun is used only
  # for that render in the installer, so failing any
  # `bun run …baseline-info-attributes…` leaves the temp file unwritten and drives
  # the installer to the hash-guarded mv with a truncated temp file unless the
  # render failure is caught first.
  bun_bin=$(command -v bun) \
    || fail "write-guard smoke needs bun on the host PATH"
  cat >"$poison_bin/bun" <<EOF
#!/usr/bin/env bash
for arg in "\$@"; do
  case "\$arg" in
    *baseline-info-attributes*)
      echo "simulated attributes render failure" >&2
      exit 1
      ;;
  esac
done
exec "$bun_bin" "\$@"
EOF
  chmod +x "$poison_bin/bun"

  set +e
  output=$(cd "$repo" && PATH="$poison_bin:$PATH" \
    bash scripts/git/install-lint-ratchet-merge-driver.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "installer must stay advisory when the attributes rewrite fails, got $status: $output"
  grep -qF "lint-ratchet merge driver install: WARN:" <<<"$output" \
    || fail "installer should warn when the attributes rewrite fails: $output"
  grep -qF "bun run lint:ratchet:merge-driver:check or bun run doctor" <<<"$output" \
    || fail "installer warning should name its enforcing checks: $output"
  [ "$(cat "$repo/.git/info/attributes")" = "unrelated/path merge=union" ] \
    || fail "failed attributes rewrite must leave existing attributes untouched: $(cat "$repo/.git/info/attributes")"
  leftovers=$(find "$repo/.git/info" -name 'attributes.*' -print)
  [ -z "$leftovers" ] \
    || fail "failed attributes rewrite should clean up its temp file: $leftovers"
}

assert_merge_driver_installers_replace_atomically() {
  local fake_bin="$TMP_ROOT/atomic-merge-driver-bin"
  local state_root="$TMP_ROOT/atomic-merge-driver-state"
  local case_entry installer driver_file repo installed_driver git_common_dir state_dir
  local cp_bin chmod_bin mktemp_bin mv_bin output
  # Every installer now copies the one generic driver body; the metric only keys
  # the throwaway repo/state dirs so the three cases stay isolated.
  local cases=(
    "install-lint-ratchet-merge-driver.sh|lint-ratchet"
    "install-knip-unused-exports-merge-driver.sh|knip-unused-exports"
    "install-max-lines-exceptions-merge-driver.sh|max-lines-exceptions"
  )

  cp_bin=$(command -v cp) || fail "atomic installer smoke needs cp"
  chmod_bin=$(command -v chmod) || fail "atomic installer smoke needs chmod"
  mktemp_bin=$(command -v mktemp) || fail "atomic installer smoke needs mktemp"
  mv_bin=$(command -v mv) || fail "atomic installer smoke needs mv"
  mkdir -p "$fake_bin" "$state_root"

  cat >"$fake_bin/mktemp" <<'EOF'
#!/usr/bin/env bash
set -eu
result=$("$REAL_MKTEMP" "$@")
case "$result" in
  "$EXPECTED_DRIVER_DIR"/*) printf '%s\n' "$result" >"$ATOMIC_STATE/mktemp" ;;
esac
printf '%s\n' "$result"
EOF
  cat >"$fake_bin/cp" <<'EOF'
#!/usr/bin/env bash
set -eu
destination=${!#}
if [ "$1" = "$EXPECTED_SOURCE" ]; then
  temp=$(cat "$ATOMIC_STATE/mktemp" 2>/dev/null || true)
  [ -n "$temp" ] || { echo "driver copy did not follow same-directory mktemp" >&2; exit 91; }
  [ "$destination" = "$temp" ] \
    || { echo "driver copy targeted final path instead of temp: $destination" >&2; exit 92; }
  [ "$(dirname "$destination")" = "$EXPECTED_DRIVER_DIR" ] \
    || { echo "driver temp is not in destination directory: $destination" >&2; exit 93; }
  [ "$(cat "$EXPECTED_DESTINATION")" = "stale live shim" ] \
    || { echo "live shim changed before temp copy" >&2; exit 94; }
  printf '%s\n' "$destination" >"$ATOMIC_STATE/copied"
fi
exec "$REAL_CP" "$@"
EOF
  cat >"$fake_bin/chmod" <<'EOF'
#!/usr/bin/env bash
set -eu
target=${!#}
temp=$(cat "$ATOMIC_STATE/mktemp" 2>/dev/null || true)
if [ -n "$temp" ] && [ "$target" = "$temp" ]; then
  [ "$(cat "$EXPECTED_DESTINATION")" = "stale live shim" ] \
    || { echo "live shim changed before temp chmod" >&2; exit 95; }
  "$REAL_CHMOD" "$@"
  [ -x "$temp" ] || { echo "driver temp was not executable after chmod" >&2; exit 96; }
  printf '%s\n' "$temp" >"$ATOMIC_STATE/chmodded"
  exit 0
fi
exec "$REAL_CHMOD" "$@"
EOF
  cat >"$fake_bin/mv" <<'EOF'
#!/usr/bin/env bash
set -eu
destination=${!#}
if [ "$destination" = "$EXPECTED_DESTINATION" ]; then
  temp=$(cat "$ATOMIC_STATE/mktemp" 2>/dev/null || true)
  [ "$#" -eq 3 ] && [ "$1" = "-f" ] && [ "$2" = "$temp" ] \
    || { echo "driver replacement was not mv -f from recorded temp: $*" >&2; exit 97; }
  [ -f "$ATOMIC_STATE/copied" ] && [ -f "$ATOMIC_STATE/chmodded" ] \
    || { echo "driver temp was not copied and chmodded before rename" >&2; exit 98; }
  [ "$(cat "$EXPECTED_DESTINATION")" = "stale live shim" ] \
    || { echo "live shim changed before atomic rename" >&2; exit 99; }
  [ -x "$temp" ] || { echo "driver temp is not executable at rename" >&2; exit 100; }
  "$REAL_MV" "$@"
  cmp -s "$EXPECTED_SOURCE" "$EXPECTED_DESTINATION" \
    || { echo "renamed driver does not match source" >&2; exit 101; }
  printf 'renamed\n' >"$ATOMIC_STATE/renamed"
  exit 0
fi
exec "$REAL_MV" "$@"
EOF
  chmod +x "$fake_bin/mktemp" "$fake_bin/cp" "$fake_bin/chmod" "$fake_bin/mv"

  local metric
  local driver_file="baseline-merge-driver.sh"
  for case_entry in "${cases[@]}"; do
    IFS='|' read -r installer metric <<<"$case_entry"
    repo="$TMP_ROOT/atomic-$metric"
    state_dir="$state_root/$metric"
    mkdir -p "$repo" "$state_dir"
    git -C "$repo" init -q -b main
    ln -s "$REPO_ROOT/scripts" "$repo/scripts"
    git_common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
    case "$git_common_dir" in
      /*) installed_driver="$git_common_dir/musi/$driver_file" ;;
      *) installed_driver="$repo/$git_common_dir/musi/$driver_file" ;;
    esac
    mkdir -p "$(dirname "$installed_driver")"
    printf 'stale live shim\n' >"$installed_driver"
    chmod 755 "$installed_driver"

    output=$(cd "$repo" && \
      REAL_CP="$cp_bin" REAL_CHMOD="$chmod_bin" REAL_MKTEMP="$mktemp_bin" REAL_MV="$mv_bin" \
      EXPECTED_SOURCE="$repo/scripts/git/$driver_file" \
      EXPECTED_DESTINATION="$installed_driver" \
      EXPECTED_DRIVER_DIR="$(dirname "$installed_driver")" \
      ATOMIC_STATE="$state_dir" PATH="$fake_bin:$PATH" \
      bash "scripts/git/$installer" 2>&1)
    [ -f "$state_dir/renamed" ] \
      || fail "$installer should atomically rename an executable same-directory temp: $output"
    cmp -s "$repo/scripts/git/$driver_file" "$installed_driver" \
      || fail "$installer atomic replacement should install the current shim"

    rm -f "$state_dir"/*
    output=$(cd "$repo" && \
      REAL_CP="$cp_bin" REAL_CHMOD="$chmod_bin" REAL_MKTEMP="$mktemp_bin" REAL_MV="$mv_bin" \
      EXPECTED_SOURCE="$repo/scripts/git/$driver_file" \
      EXPECTED_DESTINATION="$installed_driver" \
      EXPECTED_DRIVER_DIR="$(dirname "$installed_driver")" \
      ATOMIC_STATE="$state_dir" PATH="$fake_bin:$PATH" \
      bash "scripts/git/$installer" 2>&1)
    [ -z "$(find "$state_dir" -mindepth 1 -print -quit)" ] \
      || fail "$installer should not replace an identical live shim on re-install: $output"
  done
}

assert_concurrent_merge_driver_installers_preserve_blocks() {
  local repo="$TMP_ROOT/concurrent-merge-driver-installers"
  local fake_bin="$TMP_ROOT/concurrent-merge-driver-bin"
  local config_claim="$TMP_ROOT/concurrent-config-write-claimed"
  local simulated_config_lock lint_pid knip_pid common_dir real_git

  mkdir -p "$repo" "$fake_bin"
  git -C "$repo" init -q -b main
  ln -s "$REPO_ROOT/scripts" "$repo/scripts"
  real_git=$(command -v git) || fail "concurrent installer smoke needs git"
  simulated_config_lock="$repo/.git/config.lock"

  # Force the first config writer to hold Git's config.lock while the sibling
  # attempts its own first-time install. If config writes are outside the
  # common installer lock, the sibling exits advisory before rendering its
  # attributes. With one transaction lock, it cannot reach config until the
  # first installer has completed config and attributes together.
  cat >"$fake_bin/git" <<'EOF'
#!/usr/bin/env bash
set -eu
if [[ "${1:-}" == "config" && "${2:-}" == "--local" && "${3:-}" != "--get" ]]; then
  if mkdir "$CONFIG_WRITE_CLAIM" 2>/dev/null; then
    : >"$SIMULATED_CONFIG_LOCK"
    sleep 1
    rm -f "$SIMULATED_CONFIG_LOCK"
  fi
fi
exec "$REAL_GIT" "$@"
EOF
  chmod +x "$fake_bin/git"

  (
    cd "$repo"
    CONFIG_WRITE_CLAIM="$config_claim" SIMULATED_CONFIG_LOCK="$simulated_config_lock" \
      REAL_GIT="$real_git" PATH="$fake_bin:$PATH" \
      bash scripts/git/install-lint-ratchet-merge-driver.sh
  ) >"$TMP_ROOT/concurrent-lint-install.out" 2>&1 &
  lint_pid=$!
  (
    cd "$repo"
    CONFIG_WRITE_CLAIM="$config_claim" SIMULATED_CONFIG_LOCK="$simulated_config_lock" \
      REAL_GIT="$real_git" PATH="$fake_bin:$PATH" \
      bash scripts/git/install-knip-unused-exports-merge-driver.sh
  ) >"$TMP_ROOT/concurrent-knip-install.out" 2>&1 &
  knip_pid=$!

  wait "$lint_pid" \
    || fail "concurrent lint installer failed: $(cat "$TMP_ROOT/concurrent-lint-install.out")"
  wait "$knip_pid" \
    || fail "concurrent knip installer failed: $(cat "$TMP_ROOT/concurrent-knip-install.out")"
  grep -qF "WARN" "$TMP_ROOT/concurrent-lint-install.out" \
    && fail "concurrent lint installer warned: $(cat "$TMP_ROOT/concurrent-lint-install.out")"
  grep -qF "WARN" "$TMP_ROOT/concurrent-knip-install.out" \
    && fail "concurrent knip installer warned: $(cat "$TMP_ROOT/concurrent-knip-install.out")"

  git -C "$repo" config --get merge.lint-ratchet-baseline.driver >/dev/null \
    || fail "concurrent first install lost lint-ratchet Git config"
  git -C "$repo" config --get merge.knip-unused-exports-baseline.driver >/dev/null \
    || fail "concurrent first install lost knip Git config"

  grep -qxF '# BEGIN musi lint-ratchet baseline driver attributes' \
    "$repo/.git/info/attributes" \
    || fail "concurrent install lost the lint-ratchet attributes block: $(cat "$repo/.git/info/attributes")"
  grep -qxF '# BEGIN musi knip unused-exports baseline driver attributes' \
    "$repo/.git/info/attributes" \
    || fail "concurrent install lost the knip attributes block: $(cat "$repo/.git/info/attributes"); lint=$(cat "$TMP_ROOT/concurrent-lint-install.out"); knip=$(cat "$TMP_ROOT/concurrent-knip-install.out")"
  grep -qxF '/lint-ratchet.baseline.json merge=lint-ratchet-baseline' \
    "$repo/.git/info/attributes" \
    || fail "concurrent install lost the lint-ratchet merge attribute"
  grep -qxF '/sensor-knip-unused-exports.baseline.json merge=knip-unused-exports-baseline' \
    "$repo/.git/info/attributes" \
    || fail "concurrent install lost the knip merge attribute"

  common_dir=$(cd "$repo" && git rev-parse --git-common-dir)
  case "$common_dir" in
    /*) ;;
    *) common_dir="$repo/$common_dir" ;;
  esac
  [ -f "$common_dir/musi/baseline-merge-driver-attributes.lock" ] \
    || fail "installer lock should live in the shared Git common directory"
}

assert_lint_ratchet_merge_driver_auto_install_wiring() {
  bun -e '
    const { readFileSync } = require("fs");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    // The shared registry scripts/git/baseline-drivers.sh is the single source
    // of the baseline driver names. The install and truth-up dispatchers source
    // it; prepare and the post-merge/post-checkout hooks delegate to the install
    // dispatcher; worktree provisioning must install exactly the same set.
    const dispatcherPath = "scripts/git/install-all-merge-drivers.sh";
    const truthUpPath = "scripts/git/run-baseline-truth-up.sh";
    const registryPath = "scripts/git/baseline-drivers.sh";

    const registrySource = readFileSync(registryPath, "utf8");
    const registryBlock = registrySource.match(/MUSI_BASELINE_DRIVERS=\(([\s\S]*?)\)/);
    if (!registryBlock) {
      console.error(`${registryPath} should define MUSI_BASELINE_DRIVERS=( … )`);
      process.exit(1);
    }
    const metrics = registryBlock[1].split(/\s+/).map((token) => token.trim()).filter(Boolean);
    if (metrics.length === 0) {
      console.error(`${registryPath} lists no baseline drivers`);
      process.exit(1);
    }
    const expected = new Set(metrics.map((metric) => `install-${metric}-merge-driver.sh`));
    const sorted = (values) => [...values].sort();
    let failed = false;

    // Both dispatchers and the post-commit merge-marker sweep must consume the
    // shared registry rather than re-listing the driver names inline.
    for (const consumer of [dispatcherPath, truthUpPath, ".husky/post-commit"]) {
      if (!readFileSync(consumer, "utf8").includes("baseline-drivers.sh")) {
        console.error(`${consumer} should source the shared registry ${registryPath}`);
        failed = true;
      }
    }

    // prepare and both hooks must delegate to the dispatcher and must not
    // re-inline any individual install-<metric>-merge-driver.sh call.
    const delegationSites = {
      "package.json prepare": packageJson.scripts?.prepare ?? "",
      ".husky/post-merge": readFileSync(".husky/post-merge", "utf8"),
      ".husky/post-checkout": readFileSync(".husky/post-checkout", "utf8"),
    };
    for (const [site, source] of Object.entries(delegationSites)) {
      if (!source.includes(dispatcherPath)) {
        console.error(`${site} should delegate merge-driver installs to ${dispatcherPath}`);
        failed = true;
      }
      const inlined = [...new Set(
        [...source.matchAll(/scripts\/git\/(install-[a-z0-9-]+-merge-driver\.sh)/g)].map((match) => match[1]),
      )];
      if (inlined.length > 0) {
        console.error(`${site} should not re-inline individual installers (${inlined.join(",")}); use ${dispatcherPath}`);
        failed = true;
      }
    }

    // Worktree provisioning installs each driver individually; its set must
    // match the dispatcher exactly.
    const worktreeSource = readFileSync("scripts/worktree-db.sh", "utf8");
    const worktreeFunctions = new Map(
      [...worktreeSource.matchAll(/^(install_[a-z0-9_]+_merge_driver)\(\) \{[\s\S]*?^\}/gm)]
        .flatMap((match) => {
          const installer = match[0].match(/scripts\/git\/(install-[a-z0-9-]+-merge-driver\.sh)/);
          return installer ? [[match[1], installer[1]]] : [];
        }),
    );
    const worktreeInstallers = new Set(
      [...worktreeSource.matchAll(/^\s+(install_[a-z0-9_]+_merge_driver) "\$wt_root"$/gm)]
        .flatMap((match) => {
          const installer = worktreeFunctions.get(match[1]);
          return installer ? [installer] : [];
        }),
    );
    {
      const missing = sorted([...expected].filter((installer) => !worktreeInstallers.has(installer)));
      const extra = sorted([...worktreeInstallers].filter((installer) => !expected.has(installer)));
      if (missing.length || extra.length) {
        console.error(`scripts/worktree-db.sh merge-driver installers differ from ${dispatcherPath}; missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`);
        failed = true;
      }
    }

    // Every dispatcher metric must pair with a package.json install script and
    // its check counterpart.
    for (const metric of metrics) {
      const installerCommand = `bash scripts/git/install-${metric}-merge-driver.sh`;
      const installEntry = Object.entries(packageJson.scripts ?? {})
        .find(([, command]) => command === installerCommand);
      if (!installEntry) {
        console.error(`no package.json script runs ${installerCommand}`);
        failed = true;
        continue;
      }
      const installScriptName = installEntry[0];
      const checkScriptName = installScriptName.replace(/:install-merge-driver$/, ":merge-driver:check");
      const expectedCheckCommand = `bash scripts/git/check-${metric}-merge-driver.sh`;
      const actualCheckCommand = packageJson.scripts?.[checkScriptName];
      if (checkScriptName === installScriptName || actualCheckCommand !== expectedCheckCommand) {
        console.error(`${installScriptName} should pair with ${checkScriptName}=${expectedCheckCommand}; actual=${actualCheckCommand ?? "missing"}`);
        failed = true;
      }
    }

    // post-merge/post-commit must delegate baseline truth-up to the dispatcher.
    // The dispatcher and this test both read the driver names from the shared
    // registry, so a per-dispatcher metric-list divergence is no longer possible.
    for (const site of [".husky/post-merge", ".husky/post-commit"]) {
      if (!readFileSync(site, "utf8").includes(truthUpPath)) {
        console.error(`${site} should delegate baseline truth-up to ${truthUpPath}`);
        failed = true;
      }
    }

    if (failed) process.exit(1);
  ' || fail "merge-driver package and auto-install wiring should be complete and consistent"
}

assert_lint_ratchet_post_merge_truth_up() {
  local repo="$TMP_ROOT/post-merge-truth-up"
  local fake_bin="$TMP_ROOT/post-merge-fake-bin"
  local nobun_bin="$TMP_ROOT/post-merge-nobun-bin"
  local hook_log="$TMP_ROOT/post-merge-bun.log"
  local git_dir linked_common_dir linked_git_dir linked_marker linked_repo marker_file output
  local shared_marker status tool
  local could_not_run failed_check running verified running_verified
  could_not_run="post-merge: lint-ratchet truth-up could not run; run bun run lint:ratchet:check-baseline manually to verify the merged baseline."
  failed_check="post-merge: lint-ratchet truth-up check failed without a staleness verdict; inspect its output (below) and run bun run lint:ratchet:check-baseline manually once the cause is fixed."
  running="post-merge: lint-ratchet truth-up running (full check-baseline, typically ~20s)…"
  verified="post-merge: merged lint-ratchet baseline verified truthful."
  running_verified="$running"$'\n'"$verified"

  mkdir -p "$repo/scripts/git" "$fake_bin"
  cp scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh "$repo/scripts/git/"
  cp scripts/git/baseline-post-merge-truth-up.sh "$repo/scripts/git/"
  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  printf '{}\n' >"$repo/lint-ratchet.baseline.json"
  git -C "$repo" add lint-ratchet.baseline.json
  git -C "$repo" commit -qm base

  cat >"$fake_bin/bun" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${POST_MERGE_BUN_LOG:?}"
if [ "$*" = "run scripts/lint-ratchet/post-merge-baseline-preflight.ts" ]; then
  exit "${POST_MERGE_PREFLIGHT_RC:-0}"
fi
if [ "$*" = "run lint:ratchet:check-baseline" ]; then
  if [ -n "${POST_MERGE_FULL_OUTPUT:-}" ]; then
    printf '%s\n' "$POST_MERGE_FULL_OUTPUT" >&2
  fi
  exit "${POST_MERGE_FULL_RC:-0}"
fi
printf 'unexpected bun invocation: %s\n' "$*" >&2
exit 99
SH
  chmod +x "$fake_bin/bun"

  : >"$hook_log"
  (cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh) \
    || fail "post-merge truth-up should exit 0 without ORIG_HEAD"
  [ ! -s "$hook_log" ] \
    || fail "post-merge truth-up should skip when ORIG_HEAD is absent: $(cat "$hook_log")"

  git -C "$repo" update-ref ORIG_HEAD HEAD
  printf 'not baseline\n' >"$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm readme
  : >"$hook_log"
  (cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh) \
    || fail "post-merge truth-up should exit 0 for unrelated merges"
  [ ! -s "$hook_log" ] \
    || fail "post-merge truth-up should skip when baseline was not touched: $(cat "$hook_log")"

  git -C "$repo" update-ref ORIG_HEAD HEAD
  printf '{"version":1,"tests":{}}\n' >"$repo/lint-ratchet.baseline.json"
  git -C "$repo" commit -qam baseline
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required" ;;
  esac
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should exit 0 when cheap preflight passes"
  [ "$output" = "" ] \
    || fail "post-merge truth-up should stay quiet when cheap preflight passes: $output"
  [ "$(cat "$hook_log")" = "run scripts/lint-ratchet/post-merge-baseline-preflight.ts" ] \
    || fail "post-merge truth-up should run only cheap preflight on clean baseline: $(cat "$hook_log")"

  mkdir -p "$(dirname "$marker_file")"
  printf 'truth-up required\npre-merge-head=%s\n' "$(git -C "$repo" rev-parse HEAD^1)" >"$marker_file"
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should exit 0 when marker full check passes"
  [ "$output" = "$running_verified" ] \
    || fail "post-merge truth-up should announce and confirm the marker full check: $output"
  [ "$(cat "$hook_log")" = $'run scripts/lint-ratchet/post-merge-baseline-preflight.ts\nrun lint:ratchet:check-baseline' ] \
    || fail "truth-up marker should escalate to the full check: $(cat "$hook_log")"
  [ ! -e "$marker_file" ] \
    || fail "post-merge truth-up should consume the semantic merge marker"

  git -C "$repo" update-ref ORIG_HEAD HEAD
  printf 'unchanged baseline merge\n' >>"$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm unchanged-baseline
  printf 'truth-up required\npre-merge-head=%s\n' "$(git -C "$repo" rev-parse HEAD^1)" >"$marker_file"
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should exit 0 when marker exists without baseline byte changes"
  [ "$output" = "$running_verified" ] \
    || fail "post-merge truth-up should announce and confirm the unchanged-baseline marker pass: $output"
  [ "$(cat "$hook_log")" = $'run scripts/lint-ratchet/post-merge-baseline-preflight.ts\nrun lint:ratchet:check-baseline' ] \
    || fail "unchanged-baseline marker should still run the full check: $(cat "$hook_log")"
  [ ! -e "$marker_file" ] \
    || fail "unchanged-baseline marker should be consumed before baseline-diff exit"

  # A stale marker must not force a full check on the next unrelated merge: its
  # pre-merge-head stamp cannot match the merge commit's first parent.
  git -C "$repo" update-ref ORIG_HEAD HEAD
  printf 'after aborted merge\n' >>"$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm after-aborted-merge
  printf 'truth-up required\npre-merge-head=%s\n' "$(printf 'a%.0s' {1..40})" >"$marker_file"
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should exit 0 for a stale stamped marker"
  [ "$output" = "post-merge: ignoring stale lint-ratchet truth-up marker" ] \
    || fail "stale stamped marker should report that it was ignored: $output"
  [ ! -s "$hook_log" ] \
    || fail "stale stamped marker must not trigger any check on an unrelated merge: $(cat "$hook_log")"
  [ ! -e "$marker_file" ] \
    || fail "stale stamped marker should still be consumed"

  # A marker stamped with the sha that IS this merge commit's first parent
  # keeps the one-shot full-check escalation.
  git -C "$repo" checkout -q -b stamp-side
  printf 'stamp side\n' >>"$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm stamp-side
  git -C "$repo" checkout -q main
  git -C "$repo" merge -q --no-ff -m stamp-merge stamp-side
  printf 'truth-up required\npre-merge-head=%s\n' "$(git -C "$repo" rev-parse HEAD^1)" >"$marker_file"
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should exit 0 for a matching stamped marker"
  [ "$output" = "$running_verified" ] \
    || fail "matching stamped marker should announce and confirm when checks pass: $output"
  [ "$(cat "$hook_log")" = $'run scripts/lint-ratchet/post-merge-baseline-preflight.ts\nrun lint:ratchet:check-baseline' ] \
    || fail "matching stamped marker should escalate to the full check: $(cat "$hook_log")"
  [ ! -e "$marker_file" ] \
    || fail "matching stamped marker should be consumed"

  git -C "$repo" update-ref ORIG_HEAD HEAD
  printf '{"version":1,"tests":{"afterMarker":{}}}\n' >"$repo/lint-ratchet.baseline.json"
  git -C "$repo" commit -qam baseline-after-marker

  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    MUSI_RATCHET_POSTMERGE=full \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should exit 0 when opt-in full check passes"
  [ "$output" = "$running_verified" ] \
    || fail "post-merge truth-up should announce and confirm the opt-in full check: $output"
  [ "$(cat "$hook_log")" = $'run scripts/lint-ratchet/post-merge-baseline-preflight.ts\nrun lint:ratchet:check-baseline' ] \
    || fail "MUSI_RATCHET_POSTMERGE=full should run cheap and full checks: $(cat "$hook_log")"

  : >"$hook_log"
  printf 'truth-up required\npre-merge-head=%s\n' "$(git -C "$repo" rev-parse HEAD^1)" >"$marker_file"
  set +e
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_PREFLIGHT_RC=1 POST_MERGE_FULL_RC=1 \
    POST_MERGE_FULL_OUTPUT='lint:ratchet: worse baseline: 1 regression(s)' \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "post-merge truth-up must stay advisory, got exit $status: $output"
  [ "$output" = "$running"$'\n'"post-merge: merge produced a stale ratchet baseline - run: bun run lint:ratchet:update, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)" ] \
    || fail "post-merge truth-up should announce the check then print exactly one stale-baseline instruction: $output"
  [ "$(cat "$hook_log")" = $'run scripts/lint-ratchet/post-merge-baseline-preflight.ts\nrun lint:ratchet:check-baseline' ] \
    || fail "cheap failure should escalate to full check: $(cat "$hook_log")"
  [ -e "$marker_file" ] \
    || fail "failed lint-ratchet truth-up should preserve the marker for a same-HEAD retry"

  # A stale-baseline verdict whose captured report exceeds the ~64 KB pipe
  # buffer must still route to the stale-baseline instruction. A `printf | grep
  # -q` classifier would take SIGPIPE on printf once grep matches the first line
  # and closes the pipe, returning 141 under pipefail and misrouting to the
  # generic failed-check advisory; the herestring classifier avoids that.
  : >"$hook_log"
  printf 'truth-up required\npre-merge-head=%s\n' "$(git -C "$repo" rev-parse HEAD^1)" >"$marker_file"
  local big_full_output
  big_full_output="lint:ratchet: worse baseline: 1 regression(s)"$'\n'"$(head -c 100000 /dev/zero | tr '\0' x)"
  set +e
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_PREFLIGHT_RC=1 POST_MERGE_FULL_RC=1 \
    POST_MERGE_FULL_OUTPUT="$big_full_output" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "large-output stale verdict must stay advisory, got exit $status"
  case "$output" in
    *"merge produced a stale ratchet baseline"*) : ;;
    *) fail "a >64 KB stale-baseline report must still route to the stale-baseline instruction" ;;
  esac
  case "$output" in
    *"$failed_check"*) fail "a >64 KB stale-baseline report must not misroute to the failed-check advisory" ;;
  esac
  [ -e "$marker_file" ] \
    || fail "large-output stale truth-up should preserve the marker for a same-HEAD retry"

  # A full-check death that is not a WorseBaselineError verdict (ConfigError
  # exit 2, an OOM/signal exit 134, or a bare exit-1 crash) must not claim the
  # merge produced a stale baseline: print the neutral failed-check instruction
  # plus the captured output, and keep the marker for a same-HEAD retry.
  : >"$hook_log"
  set +e
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_PREFLIGHT_RC=1 POST_MERGE_FULL_RC=2 \
    POST_MERGE_FULL_OUTPUT='lint:ratchet: lint-ratchet.config.json is not valid' \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "full-check exit 2 must stay advisory, got exit $status: $output"
  [ "$output" = "$running"$'\n'"$failed_check"$'\n'"lint:ratchet: lint-ratchet.config.json is not valid" ] \
    || fail "full-check exit 2 should print the neutral instruction plus captured output: $output"
  case "$output" in
    *"stale ratchet baseline"*) fail "full-check exit 2 must not print the stale-baseline instruction: $output" ;;
  esac
  [ -e "$marker_file" ] \
    || fail "full-check exit 2 must preserve the marker for a same-HEAD retry"

  : >"$hook_log"
  set +e
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_PREFLIGHT_RC=1 POST_MERGE_FULL_RC=134 \
    POST_MERGE_FULL_OUTPUT='JavaScript heap out of memory' \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "full-check exit 134 must stay advisory, got exit $status: $output"
  [ "$output" = "$running"$'\n'"$failed_check"$'\n'"JavaScript heap out of memory" ] \
    || fail "full-check exit 134 should print the neutral instruction plus captured output: $output"
  case "$output" in
    *"stale ratchet baseline"*) fail "full-check exit 134 must not print the stale-baseline instruction: $output" ;;
  esac
  [ -e "$marker_file" ] \
    || fail "full-check exit 134 must preserve the marker for a same-HEAD retry"

  # A bare exit 1 with no lint:ratchet: verdict line is a crash (Bun exits 1
  # with a stack trace on a rethrown error), not a staleness verdict.
  : >"$hook_log"
  set +e
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_PREFLIGHT_RC=1 POST_MERGE_FULL_RC=1 \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "bare full-check exit 1 must stay advisory, got exit $status: $output"
  [ "$output" = "$running"$'\n'"$failed_check" ] \
    || fail "bare full-check exit 1 should print the neutral instruction, not the stale advisory: $output"
  [ -e "$marker_file" ] \
    || fail "bare full-check exit 1 must preserve the marker for a same-HEAD retry"

  git -C "$repo" update-ref ORIG_HEAD HEAD
  printf 'repair follow-up\n' >>"$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm repair-follow-up
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should discard the kept marker after HEAD moves"
  [ "$output" = "post-merge: ignoring stale lint-ratchet truth-up marker" ] \
    || fail "follow-up commit should retire the kept marker as stale: $output"
  [ ! -e "$marker_file" ] \
    || fail "follow-up commit should consume the now-stale lint-ratchet marker"

  linked_repo="$TMP_ROOT/post-merge-truth-up-linked-worktree"
  git -C "$repo" worktree add -q "$linked_repo" HEAD
  mkdir -p "$linked_repo/scripts/git"
  cp scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh "$linked_repo/scripts/git/"
  cp scripts/git/baseline-post-merge-truth-up.sh "$linked_repo/scripts/git/"
  linked_git_dir=$(cd "$linked_repo" && git rev-parse --git-dir)
  case "$linked_git_dir" in
    /*) ;;
    *) linked_git_dir="$linked_repo/$linked_git_dir" ;;
  esac
  linked_common_dir=$(cd "$linked_repo" && git rev-parse --git-common-dir)
  case "$linked_common_dir" in
    /*) ;;
    *) linked_common_dir="$linked_repo/$linked_common_dir" ;;
  esac
  linked_marker="$linked_git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required"
  shared_marker="$linked_common_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required"
  [ "$linked_marker" != "$shared_marker" ] \
    || fail "linked post-merge fixture should have distinct git-dir and common-dir marker paths"
  git -C "$linked_repo" update-ref ORIG_HEAD HEAD
  printf 'linked worktree unrelated merge\n' >>"$linked_repo/README.md"
  git -C "$linked_repo" add README.md
  git -C "$linked_repo" commit -qm linked-worktree-readme
  rm -f "$linked_marker" "$shared_marker"
  mkdir -p "$(dirname "$shared_marker")"
  printf 'truth-up required\n' >"$shared_marker"
  : >"$hook_log"
  output=$(cd "$linked_repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "linked post-merge truth-up should exit 0 with only a shared marker"
  [ "$output" = "" ] \
    || fail "linked post-merge truth-up should stay quiet for a shared marker: $output"
  [ ! -s "$hook_log" ] \
    || fail "linked post-merge truth-up should ignore shared common-dir markers: $(cat "$hook_log")"
  [ -e "$shared_marker" ] \
    || fail "linked post-merge truth-up should not consume a shared common-dir marker"
  rm -f "$shared_marker"

  # Environment guard: a host without bun on PATH (GUI git clients, broken
  # shells) must stay silent and preserve a matching marker for a capable retry.
  printf 'truth-up required\npre-merge-head=%s\n' "$(git -C "$repo" rev-parse HEAD^1)" >"$marker_file"
  mkdir -p "$nobun_bin"
  for tool in bash git grep; do
    ln -s "$(command -v "$tool")" "$nobun_bin/$tool"
  done
  set +e
  output=$(cd "$repo" && PATH="$nobun_bin" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "post-merge truth-up must exit 0 without bun on PATH, got $status: $output"
  [ "$output" = "" ] \
    || fail "post-merge truth-up must not claim staleness without bun on PATH: $output"
  [ -e "$marker_file" ] \
    || fail "post-merge truth-up must preserve its marker without bun on PATH"

  # exit 127 from the cheap preflight means the environment cannot run it
  # (missing deps or script), not that the baseline is stale: stay quiet and
  # skip the full-check escalation.
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_PREFLIGHT_RC=127 \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should exit 0 when preflight exits 127"
  [ "$output" = "" ] \
    || fail "preflight exit 127 must not print the stale advisory: $output"
  [ "$(cat "$hook_log")" = "run scripts/lint-ratchet/post-merge-baseline-preflight.ts" ] \
    || fail "preflight exit 127 should not escalate to the full check: $(cat "$hook_log")"
  [ -e "$marker_file" ] \
    || fail "preflight exit 127 must preserve the marker for a capable retry"

  # exit 127 from the escalated full check is likewise an environment
  # failure, not staleness.
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_PREFLIGHT_RC=1 POST_MERGE_FULL_RC=127 \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should exit 0 when full check exits 127"
  [ "$output" = "$running"$'\n'"$could_not_run" ] \
    || fail "full-check exit 127 must announce the check then print a manual verification instruction: $output"
  [ "$(cat "$hook_log")" = $'run scripts/lint-ratchet/post-merge-baseline-preflight.ts\nrun lint:ratchet:check-baseline' ] \
    || fail "full-check exit 127 should still have escalated from the failing preflight: $(cat "$hook_log")"
  [ -e "$marker_file" ] \
    || fail "full-check exit 127 must preserve the marker for a capable retry"

  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "post-merge truth-up should retry a preserved marker when capable"
  [ "$output" = "$running_verified" ] \
    || fail "capable retry should verify the preserved marker: $output"
  [ ! -e "$marker_file" ] \
    || fail "capable retry should consume the verified marker"
}

assert_knip_unused_exports_post_merge_truth_up() {
  local repo="$TMP_ROOT/knip-post-merge-truth-up"
  local fake_bin="$TMP_ROOT/knip-post-merge-fake-bin"
  local nobun_bin="$TMP_ROOT/knip-post-merge-nobun-bin"
  local hook_log="$TMP_ROOT/knip-post-merge-bun.log"
  local git_dir marker_file output status tool
  local could_not_run running verified
  could_not_run="post-merge: knip unused-export truth-up could not run; run bun run sensor:knip-unused-exports manually to verify the merged baseline."
  running="post-merge: knip unused-export truth-up running (sensor check)…"
  verified="post-merge: merged knip unused-export baseline verified truthful."

  grep -qF 'scripts/git/run-baseline-truth-up.sh' .husky/post-merge \
    || fail "post-merge should run the knip unused-export baseline truth-up (via dispatcher)"
  grep -qF 'knip-unused-exports' scripts/git/baseline-drivers.sh \
    || fail "shared baseline-drivers registry should list the knip unused-export metric"

  mkdir -p "$repo/scripts/git" "$fake_bin"
  cp scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh "$repo/scripts/git/"
  cp scripts/git/baseline-post-merge-truth-up.sh "$repo/scripts/git/"
  git -C "$TMP_ROOT" init -q -b main "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name Test
  printf '{}\n' >"$repo/sensor-knip-unused-exports.baseline.json"
  git -C "$repo" add sensor-knip-unused-exports.baseline.json
  git -C "$repo" commit -qm base

  cat >"$fake_bin/bun" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"${POST_MERGE_BUN_LOG:?}"
if [ "$*" = "run sensor:knip-unused-exports" ]; then
  if [ -n "${POST_MERGE_KNIP_STDOUT:-}" ]; then
    printf '%s\n' "$POST_MERGE_KNIP_STDOUT"
  fi
  exit "${POST_MERGE_KNIP_RC:-0}"
fi
printf 'unexpected bun invocation: %s\n' "$*" >&2
exit 99
SH
  chmod +x "$fake_bin/bun"

  : >"$hook_log"
  (cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh) \
    || fail "knip post-merge truth-up should exit 0 without ORIG_HEAD"
  [ ! -s "$hook_log" ] \
    || fail "knip post-merge truth-up should skip when ORIG_HEAD is absent: $(cat "$hook_log")"

  git -C "$repo" update-ref ORIG_HEAD HEAD
  printf 'not baseline\n' >"$repo/README.md"
  git -C "$repo" add README.md
  git -C "$repo" commit -qm readme
  : >"$hook_log"
  (cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh) \
    || fail "knip post-merge truth-up should exit 0 for unrelated merges"
  [ ! -s "$hook_log" ] \
    || fail "knip post-merge truth-up should skip when baseline was not touched: $(cat "$hook_log")"

  git -C "$repo" update-ref ORIG_HEAD HEAD
  printf '{"version":1,"count":1}\n' >"$repo/sensor-knip-unused-exports.baseline.json"
  git -C "$repo" commit -qam baseline
  git_dir=$(cd "$repo" && git rev-parse --git-dir)
  case "$git_dir" in
    /*) marker_file="$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" ;;
    *) marker_file="$repo/$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" ;;
  esac
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should exit 0 when sensor passes"
  [ "$output" = "$running"$'\n'"$verified" ] \
    || fail "knip post-merge truth-up should announce and confirm when sensor passes: $output"
  [ "$(cat "$hook_log")" = "run sensor:knip-unused-exports" ] \
    || fail "knip post-merge truth-up should run the sensor once: $(cat "$hook_log")"

  : >"$hook_log"
  mkdir -p "$(dirname "$marker_file")"
  printf 'truth-up required\npre-merge-head=%s\n' "$(git -C "$repo" rev-parse HEAD^1)" >"$marker_file"
  set +e
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=1 \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "knip post-merge truth-up must stay advisory, got exit $status: $output"
  [ "$output" = "$running"$'\n'"post-merge: merge produced a stale knip unused-export baseline - run: bun scripts/sensor-knip-unused-exports.ts --update, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)" ] \
    || fail "knip post-merge truth-up should announce the check then print exactly one stale-baseline instruction: $output"
  [ "$(cat "$hook_log")" = "run sensor:knip-unused-exports" ] \
    || fail "knip post-merge truth-up should still run only the sensor on failure: $(cat "$hook_log")"
  [ -e "$marker_file" ] \
    || fail "failed knip truth-up should preserve the marker for a same-HEAD retry"

  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=1 \
    POST_MERGE_KNIP_STDOUT="WARN: baseline summary does not match the entries; entries govern enforcement" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should exit 0 when the sensor reports summary drift"
  [ "$output" = "$running"$'\n'"post-merge: merged knip unused-export baseline has a stale derived summary but entries still govern enforcement - run: bun scripts/sensor-knip-unused-exports.ts --update, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)" ] \
    || fail "knip post-merge truth-up should announce the check then print the summary-drift repair instruction: $output"
  [ "$(cat "$hook_log")" = "run sensor:knip-unused-exports" ] \
    || fail "knip post-merge truth-up should run the sensor once for the summary-drift case: $(cat "$hook_log")"

  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=1 \
    POST_MERGE_KNIP_STDOUT=$'WARN: baseline summary does not match the entries; entries govern enforcement\nFAIL: knip unused-export symbols added 1 new identity' \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should stay advisory for simultaneous entry and summary defects"
  [ "$output" = "$running"$'\n'"post-merge: merge produced a stale knip unused-export baseline - run: bun scripts/sensor-knip-unused-exports.ts --update, review the diff against HEAD^1 (and HEAD^2 for a merge commit), then commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)" ] \
    || fail "entry mismatch should win over summary-drift routing in the knip post-merge hook: $output"
  [ "$(cat "$hook_log")" = "run sensor:knip-unused-exports" ] \
    || fail "knip post-merge truth-up should run the sensor once for simultaneous defects: $(cat "$hook_log")"

  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=2 \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should exit 0 when sensor exits 2"
  [ "$output" = "$running"$'\n'"$could_not_run" ] \
    || fail "knip sensor exit 2 must announce the check then print a manual verification instruction: $output"
  [ "$(cat "$hook_log")" = "run sensor:knip-unused-exports" ] \
    || fail "knip post-merge truth-up should still run the sensor before seeing exit 2: $(cat "$hook_log")"

  # A textual merge that corrupts the v2 identity baseline makes the sensor exit
  # 2 with an `ERROR: baseline ...` integrity message; the hook must loudly warn
  # (the floor is silently off otherwise), not stay quiet like other exit-2s. The
  # real captured output is prefixed by `bun run`'s script echo and the knip
  # self-scan heartbeat, so the ERROR line is not the first line — pin that shape.
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=2 \
    POST_MERGE_KNIP_STDOUT=$'$ bun scripts/sensor-knip-unused-exports.ts\nsensor:knip-unused-exports: running knip self-scan (budget 180s)...\nsensor:knip-unused-exports\nbaseline: 189 (exports 75, types 114, enumMembers 0, namespaceMembers 0)\nERROR: baseline summary does not match the entries; regenerate with --update' \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should exit 0 when the merged baseline is corrupt"
  case "$output" in
    *"the merged knip unused-export baseline is unparseable or internally inconsistent"*) : ;;
    *) fail "knip post-merge truth-up should loudly report a corrupt/unparseable merged baseline: $output" ;;
  esac
  case "$output" in
    *"commit the repaired baseline as a follow-up commit (or git commit --amend if your workflow permits history rewriting)"*) : ;;
    *) fail "knip corrupt-baseline advisory should lead with the follow-up commit option: $output" ;;
  esac
  [ "$(cat "$hook_log")" = "run sensor:knip-unused-exports" ] \
    || fail "knip post-merge truth-up should run the sensor once for the corrupt-baseline case: $(cat "$hook_log")"

  # A transient knip-run failure also exits 2, but with an `ERROR: knip ...`
  # message; that is an environment gap, not a merge defect, so end the announced
  # run with a manual-verification instruction instead of a staleness advisory.
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=2 \
    POST_MERGE_KNIP_STDOUT=$'$ bun scripts/sensor-knip-unused-exports.ts\nsensor:knip-unused-exports: running knip self-scan (budget 180s)...\nERROR: knip executable unavailable: not found' \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should exit 0 on a transient knip-run failure"
  [ "$output" = "$running"$'\n'"$could_not_run" ] \
    || fail "knip post-merge truth-up must terminate an announced non-baseline exit-2 error: $output"

  # Classifier verdicts whose captured output exceeds the ~64 KB pipe buffer must
  # still route correctly. A `printf | grep -qE` classifier takes SIGPIPE on
  # printf once grep matches an early line and closes the pipe (141 under
  # pipefail), misrouting summary-drift to the plain stale advisory and a corrupt
  # baseline to the could-not-run advisory. The herestring classifiers avoid it.
  local knip_big_filler
  knip_big_filler=$(head -c 100000 /dev/zero | tr '\0' x)
  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=1 \
    POST_MERGE_KNIP_STDOUT="WARN: baseline summary does not match the entries; entries govern enforcement"$'\n'"$knip_big_filler" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should exit 0 for a >64 KB summary-drift report"
  case "$output" in
    *"has a stale derived summary but entries still govern enforcement"*) : ;;
    *) fail "a >64 KB summary-drift report must still route to the summary-drift instruction: $output" ;;
  esac
  case "$output" in
    *"merge produced a stale knip unused-export baseline"*) fail "a >64 KB summary-drift report must not misroute to the plain stale advisory" ;;
  esac

  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=2 \
    POST_MERGE_KNIP_STDOUT="ERROR: baseline summary does not match the entries; regenerate with --update"$'\n'"$knip_big_filler" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should exit 0 for a >64 KB corrupt-baseline report"
  case "$output" in
    *"the merged knip unused-export baseline is unparseable or internally inconsistent"*) : ;;
    *) fail "a >64 KB corrupt-baseline report must still route to the corrupt-baseline instruction: $output" ;;
  esac
  case "$output" in
    *"$could_not_run"*) fail "a >64 KB corrupt-baseline report must not misroute to the could-not-run advisory" ;;
  esac

  mkdir -p "$nobun_bin"
  for tool in bash git grep; do
    ln -s "$(command -v "$tool")" "$nobun_bin/$tool"
  done
  mkdir -p "$(dirname "$marker_file")"
  printf 'truth-up required\npre-merge-head=%s\n' "$(git -C "$repo" rev-parse HEAD^1)" >"$marker_file"
  set +e
  output=$(cd "$repo" && PATH="$nobun_bin" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1)
  status=$?
  set -e
  [ "$status" -eq 0 ] \
    || fail "knip post-merge truth-up must exit 0 without bun on PATH, got $status: $output"
  [ "$output" = "" ] \
    || fail "knip post-merge truth-up must not claim staleness without bun on PATH: $output"
  [ -e "$marker_file" ] \
    || fail "knip post-merge truth-up must preserve its marker without bun on PATH"

  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    POST_MERGE_KNIP_RC=127 \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should exit 0 when sensor exits 127"
  [ "$output" = "$running"$'\n'"$could_not_run" ] \
    || fail "knip sensor exit 127 must terminate the announced check with manual verification: $output"
  [ "$(cat "$hook_log")" = "run sensor:knip-unused-exports" ] \
    || fail "knip post-merge truth-up should have run the sensor before seeing 127: $(cat "$hook_log")"
  [ -e "$marker_file" ] \
    || fail "knip sensor exit 127 must preserve the marker for a capable retry"

  : >"$hook_log"
  output=$(cd "$repo" && PATH="$fake_bin:$PATH" POST_MERGE_BUN_LOG="$hook_log" \
    bash scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh 2>&1) \
    || fail "knip post-merge truth-up should retry a preserved marker when capable"
  [ "$output" = "$running"$'\n'"$verified" ] \
    || fail "knip capable retry should verify the preserved marker: $output"
  [ ! -e "$marker_file" ] \
    || fail "knip capable retry should consume the verified marker"
}

# --- L5: live dual-hook (post-merge + post-commit) truth-up matrix ------------
# These fixtures exercise the real merge drivers and the real truth-up scripts
# through actual git operations, with both hooks wired via core.hooksPath. They
# pin the empirical firing rules the L5 coverage relies on: git runs post-merge
# for an auto-commit or squash merge, while post-commit handles a merge completed
# by a plain `git commit` and the eventual squash commit. Squash post-merge
# intentionally defers marker handling, so exactly one hook consumes a marker. A
# fake `bun` (scoped inside the hooks only, so the merge driver still runs the
# real semantic merge) records every truth-up check so its invocation count is
# observable, and its exit code is toggled through control files.

# Sets TU_REPO, TU_FAKEBIN, TU_BUN_LOG, TU_FIRED_LOG, TU_CTL and the three
# TU_MARK_* marker paths (worktree-local).
setup_truth_up_matrix_repo() {
  local name=$1 gd
  TU_REPO="$TMP_ROOT/$name"
  TU_FAKEBIN="$TMP_ROOT/$name-fakebin"
  TU_BUN_LOG="$TMP_ROOT/$name-bun.log"
  TU_FIRED_LOG="$TMP_ROOT/$name-fired.log"
  TU_CTL="$TMP_ROOT/$name-ctl"

  git -C "$TMP_ROOT" init -q -b main "$TU_REPO"
  git -C "$TU_REPO" config user.email test@example.com
  git -C "$TU_REPO" config user.name Test
  ln -s "$REPO_ROOT/scripts" "$TU_REPO/scripts"
  cp "$REPO_ROOT/.gitattributes" "$TU_REPO/.gitattributes"
  (cd "$TU_REPO" && bash scripts/git/install-lint-ratchet-merge-driver.sh) >/dev/null \
    || fail "$name: lint-ratchet driver install failed"
  (cd "$TU_REPO" && bash scripts/git/install-knip-unused-exports-merge-driver.sh) >/dev/null \
    || fail "$name: knip driver install failed"
  (cd "$TU_REPO" && bash scripts/git/install-max-lines-exceptions-merge-driver.sh) >/dev/null \
    || fail "$name: max-lines driver install failed"

  rm -rf "$TU_CTL"
  mkdir -p "$TU_CTL" "$TU_FAKEBIN"
  cat >"$TU_FAKEBIN/bun" <<SH
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$*" >>"$TU_BUN_LOG"
case "\$*" in
  "run scripts/lint-ratchet/post-merge-baseline-preflight.ts")
    exit "\$(cat "$TU_CTL/preflight_rc" 2>/dev/null || echo 0)" ;;
  "run lint:ratchet:check-baseline")
    [ -f "$TU_CTL/full_stdout" ] && cat "$TU_CTL/full_stdout"
    exit "\$(cat "$TU_CTL/full_rc" 2>/dev/null || echo 0)" ;;
  "run sensor:knip-unused-exports")
    [ -f "$TU_CTL/knip_stdout" ] && cat "$TU_CTL/knip_stdout"
    exit "\$(cat "$TU_CTL/knip_rc" 2>/dev/null || echo 0)" ;;
esac
printf 'unexpected bun invocation: %s\n' "\$*" >&2
exit 99
SH
  chmod +x "$TU_FAKEBIN/bun"

  tu_write_hooks "$TU_REPO" "$TU_FAKEBIN"

  gd=$(cd "$TU_REPO" && git rev-parse --git-dir)
  case "$gd" in /*) ;; *) gd="$TU_REPO/$gd" ;; esac
  TU_MARK_RATCHET="$gd/musi/lint-ratchet-baseline-postmerge-truth-up-required"
  TU_MARK_KNIP="$gd/musi/knip-unused-exports-baseline-postmerge-truth-up-required"
  TU_MARK_MAXLINES="$gd/musi/max-lines-exceptions-baseline-postmerge-truth-up-required"
}

# Writes .githooks/{post-merge,post-commit} that trace which hook fired, scope a
# fake bun into PATH, and dispatch the real truth-up scripts. post-commit mirrors
# the cheap gate shipped in .husky/post-commit.
tu_write_hooks() {
  local repo=$1 fakebin=$2 hookdir="$1/.githooks"
  mkdir -p "$hookdir"
  cat >"$hookdir/post-merge" <<SH
#!/usr/bin/env bash
printf 'post-merge\n' >>"$TU_FIRED_LOG"
export PATH="$fakebin:\$PATH"
if [ "\${1:-0}" != 1 ]; then
  bash "$repo/scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh"
  bash "$repo/scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh"
  bash "$repo/scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh"
fi
SH
  cat >"$hookdir/post-commit" <<SH
#!/usr/bin/env bash
set -u
printf 'post-commit\n' >>"$TU_FIRED_LOG"
REPO_ROOT="\$(git rev-parse --show-toplevel)"
export PATH="$fakebin:\$PATH"
git_dir="\$(git rev-parse --git-dir 2>/dev/null || true)"
[ -n "\$git_dir" ] || exit 0
case "\$git_dir" in /*) ;; *) git_dir="\$REPO_ROOT/\$git_dir" ;; esac
if ! git rev-parse --verify --quiet 'HEAD^2' >/dev/null 2>&1; then
  found=0
  for marker in \\
    "\$git_dir/musi/lint-ratchet-baseline-postmerge-truth-up-required" \\
    "\$git_dir/musi/knip-unused-exports-baseline-postmerge-truth-up-required" \\
    "\$git_dir/musi/max-lines-exceptions-baseline-postmerge-truth-up-required"; do
    if [ -f "\$marker" ]; then found=1; break; fi
  done
  [ "\$found" -eq 1 ] || exit 0
fi
bash "\$REPO_ROOT/scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh" post-commit
bash "\$REPO_ROOT/scripts/git/knip-unused-exports-post-merge-baseline-truth-up.sh" post-commit
bash "\$REPO_ROOT/scripts/git/max-lines-exceptions-post-merge-baseline-truth-up.sh" post-commit
SH
  chmod +x "$hookdir/post-merge" "$hookdir/post-commit"
  git -C "$repo" config core.hooksPath .githooks
}

tu_ratchet() { write_merge_driver_semantic_baseline "$TU_REPO/lint-ratchet.baseline.json" "$1" 6; }
tu_knip() { write_knip_merge_driver_baseline "$TU_REPO/sensor-knip-unused-exports.baseline.json" "$@"; }
tu_reset_capture() { : >"$TU_FIRED_LOG"; : >"$TU_BUN_LOG"; }
tu_fired() { [ -f "$TU_FIRED_LOG" ] && sort -u "$TU_FIRED_LOG" | paste -sd, - || printf ''; }
tu_bun_lines() { [ -f "$TU_BUN_LOG" ] || { printf 0; return; }; wc -l <"$TU_BUN_LOG" | tr -d ' '; }
tu_count() { grep -c "$1" "$2" 2>/dev/null || true; }

# Count only the actionable repair advisories, not the progress/verified/ignoring
# lines, so "advisory count" in the matrix means what the leaf means by it.
tu_advisory_count() {
  grep -cE 'needs truth-up|produced a stale|has a stale derived summary|is unparseable or internally inconsistent' "$1" 2>/dev/null || true
}

# Pins the shipped .husky/post-commit wiring. The live fixtures below prove the
# dispatch logic; this proves the real hook actually invokes the truth-up scripts
# in post-commit context behind the cheap merge/marker gate.
assert_post_commit_truth_up_dispatch_wiring() {
  local hook=.husky/post-commit
  grep -qF 'scripts/git/run-baseline-truth-up.sh" post-commit' "$hook" \
    || fail "post-commit must dispatch the baseline truth-ups in post-commit context"
  local metric
  for metric in lint-ratchet knip-unused-exports max-lines-exceptions near-duplicates; do
    grep -qF "$metric" scripts/git/baseline-drivers.sh \
      || fail "shared baseline-drivers registry must list the $metric metric for post-commit context"
  done
  grep -qF "git rev-parse --verify --quiet 'HEAD^2'" "$hook" \
    || fail "post-commit must gate the truth-up dispatch on a merge second parent"
}

assert_truth_up_matrix_merge_completions() {
  local err

  # --- S1: auto-commit merge fires post-merge only -------------------------
  setup_truth_up_matrix_repo truth-up-auto-commit
  err="$TMP_ROOT/truth-up-auto-commit.err"
  tu_ratchet 5; tu_knip a b c
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json
  git -C "$TU_REPO" commit -qm "seed baseline files for truth-up matrix"
  git -C "$TU_REPO" checkout -q -b side
  tu_ratchet 3; tu_knip b c
  git -C "$TU_REPO" commit -qam "side lowers ratchet and drains knip entry"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2; tu_knip a c
  git -C "$TU_REPO" commit -qam "main lowers ratchet and drains other knip"
  tu_reset_capture
  git -C "$TU_REPO" merge --no-ff -m "auto-commit both-baseline merge" side \
    2>"$err" || fail "S1 auto-commit merge should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-merge" ] \
    || fail "S1 auto-commit merge must fire post-merge only, fired: $(tu_fired)"
  [ ! -e "$TU_MARK_RATCHET" ] && [ ! -e "$TU_MARK_KNIP" ] \
    || fail "S1 post-merge must consume both driver markers"
  [ "$(tu_bun_lines)" = "3" ] \
    || fail "S1 should run preflight + check-baseline + sensor once each: $(cat "$TU_BUN_LOG")"
  [ "$(tu_advisory_count "$err")" = "0" ] \
    || fail "S1 truthful merge must emit no repair advisory: $(cat "$err")"
  [ "$(tu_count 'verified truthful' "$err")" = "2" ] \
    || fail "S1 should print the ratchet and knip verified lines: $(cat "$err")"

  # --- S1b: squash post-merge defers markers to the eventual commit ---------
  setup_truth_up_matrix_repo truth-up-squash
  err="$TMP_ROOT/truth-up-squash.err"
  mkdir -p "$TU_REPO/eslint-config"
  tu_ratchet 5; tu_knip a b c
  MAX_LINES_EXCEPTION_CAP=500 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json \
    eslint-config/max-lines-exceptions.baseline.json
  git -C "$TU_REPO" commit -qm "seed all baselines for squash case"
  git -C "$TU_REPO" checkout -q -b side
  tu_ratchet 3; tu_knip b c
  MAX_LINES_EXCEPTION_CAP=430 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$TU_REPO" commit -qam "side changes all squash baselines"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2; tu_knip a c
  MAX_LINES_EXCEPTION_CAP=420 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$TU_REPO" commit -qam "main changes all squash baselines"
  tu_reset_capture
  git -C "$TU_REPO" merge --squash side >/dev/null 2>"$err" \
    || fail "S1b squash merge should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-merge" ] \
    || fail "S1b squash merge must fire post-merge, fired: $(tu_fired)"
  [ -e "$TU_MARK_RATCHET" ] && [ -e "$TU_MARK_KNIP" ] && [ -e "$TU_MARK_MAXLINES" ] \
    || fail "S1b squash post-merge must preserve all truth-up markers"
  [ "$(tu_bun_lines)" = "0" ] \
    || fail "S1b squash post-merge must defer all truth-up checks: $(cat "$TU_BUN_LOG")"
  [ "$(tu_count 'ignoring stale' "$err")" = "0" ] \
    || fail "S1b squash post-merge must not misclassify markers as stale: $(cat "$err")"
  tu_reset_capture
  git -C "$TU_REPO" commit -qm "commit the squashed baseline merge" 2>"$err" \
    || fail "S1b squash commit should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-commit" ] \
    || fail "S1b squash completion must fire post-commit only, fired: $(tu_fired)"
  [ ! -e "$TU_MARK_RATCHET" ] && [ ! -e "$TU_MARK_KNIP" ] && [ ! -e "$TU_MARK_MAXLINES" ] \
    || fail "S1b squash post-commit must consume all truth-up markers"
  [ "$(tu_bun_lines)" = "3" ] \
    || fail "S1b squash commit must run preflight + check-baseline + sensor: $(cat "$TU_BUN_LOG")"
  [ "$(tu_count 'post-commit: max-lines exception merge needs truth-up' "$err")" = "1" ] \
    || fail "S1b squash commit must honor the max-lines marker: $(cat "$err")"
  [ "$(tu_count 'verified truthful' "$err")" = "2" ] \
    || fail "S1b squash commit must verify ratchet and knip markers: $(cat "$err")"

  # --- S2: `git merge --no-commit` completed by `git commit` ---------------
  setup_truth_up_matrix_repo truth-up-no-commit
  err="$TMP_ROOT/truth-up-no-commit.err"
  tu_ratchet 5; tu_knip a b c
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json
  git -C "$TU_REPO" commit -qm "seed baseline files for truth-up matrix"
  git -C "$TU_REPO" checkout -q -b side
  tu_ratchet 3; tu_knip b c
  git -C "$TU_REPO" commit -qam "side lowers ratchet and drains knip entry"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2; tu_knip a c
  git -C "$TU_REPO" commit -qam "main lowers ratchet and drains other knip"
  tu_reset_capture
  git -C "$TU_REPO" merge --no-commit --no-ff side >/dev/null 2>&1 || true
  [ -e "$TU_MARK_RATCHET" ] && [ -e "$TU_MARK_KNIP" ] \
    || fail "S2 driver should stamp markers during the --no-commit merge"
  [ "$(tu_fired)" = "" ] \
    || fail "S2 `git merge --no-commit` must fire neither hook, fired: $(tu_fired)"
  tu_reset_capture
  git -C "$TU_REPO" commit -qm "complete the no-commit merge by hand" 2>"$err" \
    || fail "S2 completing commit should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-commit" ] \
    || fail "S2 merge completion must fire post-commit only, fired: $(tu_fired)"
  [ ! -e "$TU_MARK_RATCHET" ] && [ ! -e "$TU_MARK_KNIP" ] \
    || fail "S2 post-commit must consume both driver markers"
  [ "$(tu_bun_lines)" = "3" ] \
    || fail "S2 should run preflight + check-baseline + sensor once each: $(cat "$TU_BUN_LOG")"
  [ "$(tu_advisory_count "$err")" = "0" ] \
    || fail "S2 truthful completion must emit no repair advisory: $(cat "$err")"
  [ "$(tu_count 'post-commit: merged lint-ratchet baseline verified truthful' "$err")" = "1" ] \
    || fail "S2 must print the post-commit ratchet verified line: $(cat "$err")"
  [ "$(tu_count 'post-commit: merged knip unused-export baseline verified truthful' "$err")" = "1" ] \
    || fail "S2 must print the post-commit knip verified line: $(cat "$err")"

  # --- S2b: a stale baseline advisory still reaches the post-commit path ----
  setup_truth_up_matrix_repo truth-up-no-commit-stale
  err="$TMP_ROOT/truth-up-no-commit-stale.err"
  tu_ratchet 5; tu_knip a b c
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json
  git -C "$TU_REPO" commit -qm "seed baseline files for truth-up matrix"
  git -C "$TU_REPO" checkout -q -b side
  tu_ratchet 3; tu_knip b c
  git -C "$TU_REPO" commit -qam "side lowers ratchet and drains knip entry"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2; tu_knip a c
  git -C "$TU_REPO" commit -qam "main lowers ratchet and drains other knip"
  git -C "$TU_REPO" merge --no-commit --no-ff side >/dev/null 2>&1 || true
  printf '1\n' >"$TU_CTL/preflight_rc"
  printf '1\n' >"$TU_CTL/full_rc"
  printf 'lint:ratchet: worse baseline: 1 regression(s)\n' >"$TU_CTL/full_stdout"
  printf '1\n' >"$TU_CTL/knip_rc"
  printf 'FAIL: knip added a new identity\n' >"$TU_CTL/knip_stdout"
  tu_reset_capture
  git -C "$TU_REPO" commit -qm "complete the no-commit merge stale case" 2>"$err" \
    || fail "S2b completing commit should stay advisory: $(cat "$err")"
  [ "$(tu_advisory_count "$err")" = "2" ] \
    || fail "S2b should surface one ratchet and one knip repair advisory: $(cat "$err")"
  [ "$(tu_count 'post-commit: merge produced a stale ratchet baseline' "$err")" = "1" ] \
    || fail "S2b ratchet advisory should carry the post-commit prefix: $(cat "$err")"

  # --- S3: conflicted merge completed by hand ------------------------------
  setup_truth_up_matrix_repo truth-up-conflicted
  err="$TMP_ROOT/truth-up-conflicted.err"
  tu_ratchet 5; tu_knip a b c
  printf 'base\n' >"$TU_REPO/conf.txt"
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json conf.txt
  git -C "$TU_REPO" commit -qm "seed baselines and a conflict-prone file"
  git -C "$TU_REPO" checkout -q -b side
  tu_ratchet 3; tu_knip b c
  printf 'side\n' >"$TU_REPO/conf.txt"
  git -C "$TU_REPO" commit -qam "side edits baselines and the shared file"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2; tu_knip a c
  printf 'main\n' >"$TU_REPO/conf.txt"
  git -C "$TU_REPO" commit -qam "main edits baselines and the shared file"
  tu_reset_capture
  git -C "$TU_REPO" merge --no-ff -m "should-conflict-on-conf" side >/dev/null 2>&1 \
    && fail "S3 merge should conflict on conf.txt"
  [ -e "$TU_MARK_RATCHET" ] && [ -e "$TU_MARK_KNIP" ] \
    || fail "S3 baseline drivers should stamp markers even though the merge halts"
  [ "$(tu_fired)" = "" ] \
    || fail "S3 halted merge must fire neither hook, fired: $(tu_fired)"
  printf 'resolved\n' >"$TU_REPO/conf.txt"
  git -C "$TU_REPO" add conf.txt
  tu_reset_capture
  git -C "$TU_REPO" commit -qm "resolve conflict and complete the merge" 2>"$err" \
    || fail "S3 completing commit should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-commit" ] \
    || fail "S3 conflicted-merge completion must fire post-commit only, fired: $(tu_fired)"
  [ ! -e "$TU_MARK_RATCHET" ] && [ ! -e "$TU_MARK_KNIP" ] \
    || fail "S3 post-commit must consume both driver markers"
  [ "$(tu_bun_lines)" = "3" ] \
    || fail "S3 should run preflight + check-baseline + sensor once each: $(cat "$TU_BUN_LOG")"

  # --- S8: unrelated merge and unrelated plain commit are byte-silent ------
  setup_truth_up_matrix_repo truth-up-unrelated
  err="$TMP_ROOT/truth-up-unrelated.err"
  tu_ratchet 5; tu_knip a b c
  printf 'root\n' >"$TU_REPO/app.txt"
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json app.txt
  git -C "$TU_REPO" commit -qm "seed baselines and an unrelated source file"
  git -C "$TU_REPO" checkout -q -b side
  printf 'side change\n' >>"$TU_REPO/app.txt"
  git -C "$TU_REPO" commit -qam "side touches only the unrelated file"
  git -C "$TU_REPO" checkout -q main
  printf 'main line\n' >"$TU_REPO/other.txt"
  git -C "$TU_REPO" add other.txt
  git -C "$TU_REPO" commit -qm "main adds a disjoint unrelated file"
  tu_reset_capture
  git -C "$TU_REPO" merge --no-ff -m "unrelated auto-commit merge" side 2>"$err" \
    || fail "S8 unrelated merge should succeed: $(cat "$err")"
  [ ! -s "$err" ] \
    || fail "S8 unrelated merge must be byte-silent: $(cat "$err")"
  [ "$(tu_bun_lines)" = "0" ] \
    || fail "S8 unrelated merge must run no truth-up check: $(cat "$TU_BUN_LOG")"
  [ ! -e "$TU_MARK_RATCHET" ] && [ ! -e "$TU_MARK_KNIP" ] && [ ! -e "$TU_MARK_MAXLINES" ] \
    || fail "S8 unrelated merge must leave no markers"
  tu_reset_capture
  printf 'plain\n' >"$TU_REPO/plain.txt"
  git -C "$TU_REPO" add plain.txt
  git -C "$TU_REPO" commit -qm "unrelated plain commit stays silent" 2>"$err" \
    || fail "S8 unrelated plain commit should succeed: $(cat "$err")"
  [ ! -s "$err" ] \
    || fail "S8 unrelated plain commit must be byte-silent: $(cat "$err")"
  [ "$(tu_bun_lines)" = "0" ] \
    || fail "S8 unrelated plain commit must run no truth-up check: $(cat "$TU_BUN_LOG")"
}

assert_truth_up_matrix_leaked_markers() {
  local err

  # --- S4: cherry-pick markers match HEAD^1; post-commit honors all three --
  setup_truth_up_matrix_repo truth-up-cherry-pick
  err="$TMP_ROOT/truth-up-cherry-pick.err"
  mkdir -p "$TU_REPO/eslint-config"
  tu_ratchet 5; tu_knip a b c
  MAX_LINES_EXCEPTION_CAP=500 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json \
    eslint-config/max-lines-exceptions.baseline.json
  git -C "$TU_REPO" commit -qm "seed all baselines for cherry-pick case"
  git -C "$TU_REPO" checkout -q -b picked
  tu_ratchet 3; tu_knip b c
  MAX_LINES_EXCEPTION_CAP=430 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  printf 'picked\n' >"$TU_REPO/picked.txt"
  git -C "$TU_REPO" add lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json \
    eslint-config/max-lines-exceptions.baseline.json picked.txt
  git -C "$TU_REPO" commit -qm "picked changes all generated baselines"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2; tu_knip a c
  MAX_LINES_EXCEPTION_CAP=420 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$TU_REPO" commit -qam "main changes all generated baselines"
  tu_reset_capture
  git -C "$TU_REPO" cherry-pick picked >/dev/null 2>"$err" \
    || fail "S4 cherry-pick should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-commit" ] \
    || fail "S4 cherry-pick must fire post-commit only, fired: $(tu_fired)"
  [ ! -e "$TU_MARK_RATCHET" ] && [ ! -e "$TU_MARK_KNIP" ] && [ ! -e "$TU_MARK_MAXLINES" ] \
    || fail "S4 actionable cherry-pick markers must all be consumed"
  [ "$(tu_bun_lines)" = "3" ] \
    || fail "S4 must run preflight + check-baseline + sensor once each: $(cat "$TU_BUN_LOG")"
  [ "$(tu_count 'post-commit: merged lint-ratchet baseline verified truthful' "$err")" = "1" ] \
    || fail "S4 must verify the cherry-picked lint-ratchet marker: $(cat "$err")"
  [ "$(tu_count 'post-commit: merged knip unused-export baseline verified truthful' "$err")" = "1" ] \
    || fail "S4 must verify the cherry-picked knip marker: $(cat "$err")"
  [ "$(tu_count 'post-commit: max-lines exception merge needs truth-up' "$err")" = "1" ] \
    || fail "S4 must honor the cherry-picked max-lines marker: $(cat "$err")"
  [ "$(tu_count 'ignoring stale' "$err")" = "0" ] \
    || fail "S4 must not discard matching cherry-pick markers: $(cat "$err")"

  # --- S5: rebase marker matches replay parent; post-commit honors it ------
  setup_truth_up_matrix_repo truth-up-rebase
  err="$TMP_ROOT/truth-up-rebase.err"
  tu_ratchet 5
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json
  git -C "$TU_REPO" commit -qm "seed ratchet baseline for rebase case"
  git -C "$TU_REPO" checkout -q -b topic
  tu_ratchet 3
  printf 'topic\n' >"$TU_REPO/topic.txt"
  git -C "$TU_REPO" add lint-ratchet.baseline.json topic.txt
  git -C "$TU_REPO" commit -qm "topic lowers the ratchet baseline floor"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2
  git -C "$TU_REPO" commit -qam "main lowers the ratchet baseline floor"
  git -C "$TU_REPO" checkout -q topic
  tu_reset_capture
  git -C "$TU_REPO" rebase main >/dev/null 2>"$err" \
    || fail "S5 rebase should succeed: $(cat "$err")"
  case ",$(tu_fired)," in
    *,post-commit,*) : ;;
    *) fail "S5 rebase replay must fire post-commit, fired: $(tu_fired)" ;;
  esac
  case ",$(tu_fired)," in
    *,post-merge,*) fail "S5 rebase must not fire post-merge, fired: $(tu_fired)" ;;
  esac
  [ ! -e "$TU_MARK_RATCHET" ] \
    || fail "S5 leaked rebase marker must be consumed"
  [ "$(tu_bun_lines)" = "2" ] \
    || fail "S5 matching rebase marker must run preflight + check-baseline: $(cat "$TU_BUN_LOG")"
  [ "$(tu_count 'post-commit: merged lint-ratchet baseline verified truthful' "$err")" = "1" ] \
    || fail "S5 must verify the matching rebase marker: $(cat "$err")"
  [ "$(tu_count 'ignoring stale' "$err")" = "0" ] \
    || fail "S5 must not discard a matching rebase marker: $(cat "$err")"

  # --- S6: matching abort residue is conservatively honored ----------------
  setup_truth_up_matrix_repo truth-up-abort
  err="$TMP_ROOT/truth-up-abort.err"
  tu_ratchet 5
  printf 'base\n' >"$TU_REPO/conf.txt"
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json conf.txt
  git -C "$TU_REPO" commit -qm "seed ratchet baseline and conflict file"
  git -C "$TU_REPO" checkout -q -b side
  tu_ratchet 3
  printf 'side\n' >"$TU_REPO/conf.txt"
  git -C "$TU_REPO" commit -qam "side lowers ratchet and edits conf"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2
  printf 'main\n' >"$TU_REPO/conf.txt"
  git -C "$TU_REPO" commit -qam "main lowers ratchet and edits conf"
  git -C "$TU_REPO" merge --no-ff -m "should-conflict" side >/dev/null 2>&1 \
    && fail "S6 merge should conflict on conf.txt"
  [ -e "$TU_MARK_RATCHET" ] \
    || fail "S6 driver should stamp a marker before the abort"
  git -C "$TU_REPO" merge --abort
  [ -e "$TU_MARK_RATCHET" ] \
    || fail "S6 merge --abort should leave the marker as documented residual"
  tu_reset_capture
  printf 'after\n' >"$TU_REPO/after.txt"
  git -C "$TU_REPO" add after.txt
  git -C "$TU_REPO" commit -qm "plain commit after aborting the merge" 2>"$err" \
    || fail "S6 plain commit should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-commit" ] \
    || fail "S6 post-abort plain commit must fire post-commit only, fired: $(tu_fired)"
  [ ! -e "$TU_MARK_RATCHET" ] \
    || fail "S6 abort residual marker must be consumed at the next commit"
  [ "$(tu_bun_lines)" = "2" ] \
    || fail "S6 matching abort residual must run preflight + check-baseline: $(cat "$TU_BUN_LOG")"
  [ "$(tu_count 'post-commit: merged lint-ratchet baseline verified truthful' "$err")" = "1" ] \
    || fail "S6 must conservatively verify a matching abort residual: $(cat "$err")"

  # --- S6b: genuinely mismatched one-parent markers are all discarded -----
  for marker in "$TU_MARK_RATCHET" "$TU_MARK_KNIP" "$TU_MARK_MAXLINES"; do
    printf 'truth-up required\npre-merge-head=%s\n' "$(printf 'a%.0s' {1..40})" >"$marker"
  done
  tu_reset_capture
  printf 'after mismatch\n' >"$TU_REPO/after-mismatch.txt"
  git -C "$TU_REPO" add after-mismatch.txt
  git -C "$TU_REPO" commit -qm "plain commit with mismatched truth-up markers" 2>"$err" \
    || fail "S6b plain commit should succeed: $(cat "$err")"
  [ ! -e "$TU_MARK_RATCHET" ] && [ ! -e "$TU_MARK_KNIP" ] && [ ! -e "$TU_MARK_MAXLINES" ] \
    || fail "S6b mismatched markers must all be consumed"
  [ "$(tu_bun_lines)" = "0" ] \
    || fail "S6b mismatched markers must run no truth-up checks: $(cat "$TU_BUN_LOG")"
  [ "$(tu_count 'ignoring stale' "$err")" = "3" ] \
    || fail "S6b must report all three mismatched markers as stale: $(cat "$err")"
}

assert_truth_up_matrix_linked_worktree() {
  local err linked linked_gd linked_marker shared_marker linked_fakebin

  setup_truth_up_matrix_repo truth-up-linked-base
  tu_ratchet 5; tu_knip a b c
  git -C "$TU_REPO" add .gitattributes lint-ratchet.baseline.json \
    sensor-knip-unused-exports.baseline.json
  git -C "$TU_REPO" commit -qm "seed baselines for linked-worktree case"
  git -C "$TU_REPO" checkout -q -b side
  tu_ratchet 3; tu_knip b c
  git -C "$TU_REPO" commit -qam "side lowers ratchet and drains knip"
  git -C "$TU_REPO" checkout -q main
  tu_ratchet 2; tu_knip a c
  git -C "$TU_REPO" commit -qam "main lowers ratchet and drains knip"

  linked="$TMP_ROOT/truth-up-linked-wt"
  linked_fakebin="$TMP_ROOT/truth-up-linked-wt-fakebin"
  err="$TMP_ROOT/truth-up-linked.err"
  git -C "$TU_REPO" worktree add -q --detach "$linked" main
  ln -s "$REPO_ROOT/scripts" "$linked/scripts"
  # The linked worktree resolves core.hooksPath relative to its own root, so it
  # needs its own hooks and fake bin. Reuse the fake bin the base repo built.
  cp -r "$TU_FAKEBIN" "$linked_fakebin"
  tu_write_hooks "$linked" "$linked_fakebin"

  linked_gd=$(cd "$linked" && git rev-parse --git-dir)
  case "$linked_gd" in /*) ;; *) linked_gd="$linked/$linked_gd" ;; esac
  linked_marker="$linked_gd/musi/lint-ratchet-baseline-postmerge-truth-up-required"
  shared_marker="$TU_MARK_RATCHET"
  [ "$linked_marker" != "$shared_marker" ] \
    || fail "S7 linked worktree should have a distinct git-dir marker path"

  git -C "$linked" merge --no-commit --no-ff side >/dev/null 2>&1 || true
  [ -e "$linked_marker" ] \
    || fail "S7 driver should stamp the worktree-local marker during --no-commit"
  [ ! -e "$shared_marker" ] \
    || fail "S7 driver must not stamp the base repo marker for a linked-worktree merge"
  tu_reset_capture
  git -C "$linked" commit -qm "complete the linked-worktree merge by hand" 2>"$err" \
    || fail "S7 linked-worktree completion should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-commit" ] \
    || fail "S7 linked-worktree completion must fire post-commit only, fired: $(tu_fired)"
  [ ! -e "$linked_marker" ] \
    || fail "S7 post-commit must consume the worktree-local marker"
  [ ! -e "$shared_marker" ] \
    || fail "S7 post-commit must not create or touch the base repo marker"
  [ "$(tu_advisory_count "$err")" = "0" ] \
    || fail "S7 truthful linked completion must emit no repair advisory: $(cat "$err")"
  git -C "$TU_REPO" worktree remove --force "$linked" 2>/dev/null || true
}

# S9: the marker-only max-lines hook must also fire in post-commit context. A
# `--no-commit` cap-conflict merge completed by a plain commit should surface the
# max-lines advisory (with the post-commit prefix) and nothing else - no progress
# or "verified" line, because max-lines performs no verification.
assert_truth_up_matrix_max_lines_post_commit() {
  local err
  setup_truth_up_matrix_repo truth-up-max-lines
  err="$TMP_ROOT/truth-up-max-lines.err"
  mkdir -p "$TU_REPO/eslint-config"
  MAX_LINES_EXCEPTION_CAP=500 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$TU_REPO" add .gitattributes eslint-config/max-lines-exceptions.baseline.json
  git -C "$TU_REPO" commit -qm "seed max-lines cap baseline for matrix"
  git -C "$TU_REPO" checkout -q -b side
  MAX_LINES_EXCEPTION_CAP=430 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$TU_REPO" commit -qam "side lowers the max-lines cap"
  git -C "$TU_REPO" checkout -q main
  MAX_LINES_EXCEPTION_CAP=420 write_max_lines_exceptions_merge_driver_baseline \
    "$TU_REPO/eslint-config/max-lines-exceptions.baseline.json" src/a.ts
  git -C "$TU_REPO" commit -qam "main lowers the max-lines cap"
  git -C "$TU_REPO" merge --no-commit --no-ff side >/dev/null 2>&1 || true
  [ -e "$TU_MARK_MAXLINES" ] \
    || fail "S9 cap-conflict --no-commit merge should stamp the max-lines marker"
  tu_reset_capture
  git -C "$TU_REPO" commit -qm "complete the max-lines cap merge by hand" 2>"$err" \
    || fail "S9 completing commit should succeed: $(cat "$err")"
  [ "$(tu_fired)" = "post-commit" ] \
    || fail "S9 max-lines completion must fire post-commit only, fired: $(tu_fired)"
  [ ! -e "$TU_MARK_MAXLINES" ] \
    || fail "S9 post-commit must consume the max-lines marker"
  [ "$(tu_bun_lines)" = "0" ] \
    || fail "S9 marker-only max-lines hook must run no bun check: $(cat "$TU_BUN_LOG")"
  [ "$(tu_count 'post-commit: max-lines exception merge needs truth-up' "$err")" = "1" ] \
    || fail "S9 must print the post-commit max-lines advisory: $(cat "$err")"
  [ "$(tu_count 'verified truthful' "$err")" = "0" ] \
    || fail "S9 marker-only max-lines hook must never claim verification: $(cat "$err")"
}

use_fixture_node_modules_with_fake_plugin() {
  local fixture_dir=$1
  rm -rf "$fixture_dir/node_modules"
  mkdir -p "$fixture_dir/node_modules/eslint-plugin-ratchet-fixture"
  ln -s "$REPO_ROOT/node_modules/.bin" "$fixture_dir/node_modules/.bin"
  ln -s "$REPO_ROOT/node_modules/eslint" "$fixture_dir/node_modules/eslint"
  ln -s "$REPO_ROOT/node_modules/minimatch" "$fixture_dir/node_modules/minimatch"
  ln -s "$REPO_ROOT/node_modules/typescript" "$fixture_dir/node_modules/typescript"
  ln -s "$REPO_ROOT/node_modules/typescript-eslint" \
    "$fixture_dir/node_modules/typescript-eslint"
  # The portable debt-log schema resolves zod from scripts/lint-ratchet, so the
  # fixture needs zod at its own node_modules root (packages/shared's copy only
  # covers the diagnostics envelope's imports).
  ln -s "$REPO_ROOT/node_modules/zod" "$fixture_dir/node_modules/zod"
  # The copied adapter imports @musi/lint-ratchet/*; resolve it to the source-only
  # package via a scoped node_modules symlink (leaf 02 S3).
  mkdir -p "$fixture_dir/node_modules/@musi"
  ln -s "$REPO_ROOT/tools/lint-ratchet" "$fixture_dir/node_modules/@musi/lint-ratchet"

  cat >"$fixture_dir/node_modules/eslint-plugin-ratchet-fixture/package.json" <<'JSON'
{
  "name": "eslint-plugin-ratchet-fixture",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js"
}
JSON

  cat >"$fixture_dir/node_modules/eslint-plugin-ratchet-fixture/index.js" <<'JS'
const alwaysReport = {
  meta: {
    type: "problem",
    schema: [],
    messages: { found: "fixture third-party finding" },
  },
  create(context) {
    return {
      Program(node) {
        context.report({ node, messageId: "found" });
      },
    };
  },
};

const noFixtureMarker = {
  meta: {
    type: "problem",
    schema: [],
    messages: { found: "fixture marker finding" },
  },
  create(context) {
    return {
      Identifier(node) {
        if (node.name === "fixtureViolation") {
          context.report({ node, messageId: "found" });
        }
      },
    };
  },
};

export default {
  rules: {
    "always-report": alwaysReport,
    "no-fixture-marker": noFixtureMarker,
  },
};
JS
}

write_fixture_tsconfig() {
  local fixture_dir=$1
  cat >"$fixture_dir/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": ["packages/**/*.ts"]
}
JSON
}

write_third_party_config() {
  local fixture_dir=$1
  local rule_name=$2
  local parser_profile=$3
  local allowlist=${4-allowlisted}
  local rule_id=${5-"ratchet-fixture/$rule_name"}
  local plugin_module=${6-"eslint-plugin-ratchet-fixture"}
  local plugin_export=${7-}
  local rule_options=${8-"[]"}
  local rule_namespace=${9-"ratchet-fixture"}
  local plugin_export_line=""
  if [ -n "$plugin_export" ]; then
    plugin_export_line="    pluginExport: \"$plugin_export\","
  fi
  local allowlist_entries="[]"
  if [ "$allowlist" = "allowlisted" ]; then
    allowlist_entries="[
  {
    pluginModule: \"$plugin_module\",
    ruleNamespace: \"$rule_namespace\",
$plugin_export_line
  },
]"
  fi

  cat >"$fixture_dir/scripts/lint-ratchet/lint-ratchet-config.ts" <<TS
type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new";
export type LintRatchetMetric = "message-count";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";
export type LintRatchetZeroBaselineDispositionKind =
  | "intentional-ratchet-only"
  | "narrow-floor"
  | "promote-to-normal-lint"
  | "temporary-ratchet-only";

export interface LintRatchetZeroBaselineDisposition {
  readonly kind: LintRatchetZeroBaselineDispositionKind;
  readonly reason: string;
  readonly exitPath?: string;
}

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
  readonly principle: string;
  readonly zeroBaselineDisposition?: LintRatchetZeroBaselineDisposition;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  $allowlist_entries;

export const lintRatchets = [
  {
    id: "ratchet/fixture-third-party",
    ruleId: "$rule_id",
    files: ["packages/app/src/**/*.ts"],
    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],
    ruleOptions: $rule_options,
    source: {
      kind: "third-party",
      pluginModule: "$plugin_module",
    },
    parserProfile: "$parser_profile",
    mode: "no-new",
    metric: "message-count",
    repairKind: "manual",
    principle: "Synthetic fixture ratchet principle.",
  },
] as const satisfies readonly LintRatchetConfig[];
TS
}

write_core_config() {
  local fixture_dir=$1
  local rule_id=${2-"complexity"}
  local parser_profile=${3-"minimal-ts"}
  local rule_options=${4-"[{ max: 1 }]"}
  local metric=${5-"message-count"}

  cat >"$fixture_dir/scripts/lint-ratchet/lint-ratchet-config.ts" <<TS
type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new";
export type LintRatchetMetric = "message-count" | "complexity-severity";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";
export type LintRatchetZeroBaselineDispositionKind =
  | "intentional-ratchet-only"
  | "narrow-floor"
  | "promote-to-normal-lint"
  | "temporary-ratchet-only";

export interface LintRatchetZeroBaselineDisposition {
  readonly kind: LintRatchetZeroBaselineDispositionKind;
  readonly reason: string;
  readonly exitPath?: string;
}

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export interface LintRatchetCoreSource {
  readonly kind: "core";
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource
  | LintRatchetCoreSource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
  readonly principle: string;
  readonly zeroBaselineDisposition?: LintRatchetZeroBaselineDisposition;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetCoreSource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  [];

export const lintRatchets = [
  {
    id: "ratchet/fixture-core",
    ruleId: "$rule_id",
    files: ["packages/app/src/**/*.ts"],
    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],
    ruleOptions: $rule_options,
    source: { kind: "core" },
    parserProfile: "$parser_profile",
    mode: "no-new",
    metric: "$metric",
    repairKind: "manual",
    principle: "Synthetic fixture ratchet principle.",
  },
] as const satisfies readonly LintRatchetConfig[];
TS
}

write_max_lines_config() {
  local fixture_dir=$1

  cat >"$fixture_dir/scripts/lint-ratchet/lint-ratchet-config.ts" <<'TS'
type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new";
export type LintRatchetMetric = "message-count" | "effective-line-count";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";
export type LintRatchetZeroBaselineDispositionKind =
  | "intentional-ratchet-only"
  | "narrow-floor"
  | "promote-to-normal-lint"
  | "temporary-ratchet-only";

export interface LintRatchetZeroBaselineDisposition {
  readonly kind: LintRatchetZeroBaselineDispositionKind;
  readonly reason: string;
  readonly exitPath?: string;
}

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
  readonly principle: string;
  readonly zeroBaselineDisposition?: LintRatchetZeroBaselineDisposition;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  [];

export const lintRatchets = [
  {
    id: "ratchet/fixture-max-lines",
    ruleId: "local/max-lines",
    files: ["packages/app/src/**/*.ts"],
    ignores: [],
    ruleOptions: [{ max: 3, skipBlankLines: true, skipComments: true }],
    mode: "no-new",
    metric: "effective-line-count",
    repairKind: "manual",
    principle: "Synthetic fixture ratchet principle.",
  },
] as const satisfies readonly LintRatchetConfig[];
TS
}

write_type_assertion_config() {
  local fixture_dir=$1
  local files_glob=${2-"packages/app/src/**/*.ts"}

  cat >"$fixture_dir/scripts/lint-ratchet/lint-ratchet-config.ts" <<TS
type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type LintRatchetMode = "no-new";
export type LintRatchetMetric = "message-count";
type LintRatchetRepairKind = "manual";
export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";
export type LintRatchetPluginExport = "default" | "plugin";
export type LintRatchetZeroBaselineDispositionKind =
  | "intentional-ratchet-only"
  | "narrow-floor"
  | "promote-to-normal-lint"
  | "temporary-ratchet-only";

export interface LintRatchetZeroBaselineDisposition {
  readonly kind: LintRatchetZeroBaselineDispositionKind;
  readonly reason: string;
  readonly exitPath?: string;
}

export interface LintRatchetLocalSource {
  readonly kind: "local";
}

export interface LintRatchetThirdPartySource {
  readonly kind: "third-party";
  readonly pluginModule: string;
}

export type LintRatchetRuleSource =
  | LintRatchetLocalSource
  | LintRatchetThirdPartySource;

interface LintRatchetConfigBase {
  readonly id: string;
  readonly ruleId: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly ruleOptions: readonly JsonValue[];
  readonly mode: LintRatchetMode;
  readonly metric: LintRatchetMetric;
  readonly repairKind: LintRatchetRepairKind;
  readonly principle: string;
  readonly zeroBaselineDisposition?: LintRatchetZeroBaselineDisposition;
}

export type LintRatchetConfig =
  | (LintRatchetConfigBase & {
      readonly source?: LintRatchetLocalSource;
      readonly parserProfile?: "minimal-ts";
    })
  | (LintRatchetConfigBase & {
      readonly source: LintRatchetThirdPartySource;
      readonly parserProfile: LintRatchetParserProfile;
    });

export interface LintRatchetThirdPartyPluginAllowlistEntry {
  readonly pluginModule: string;
  readonly ruleNamespace: string;
  readonly pluginExport?: LintRatchetPluginExport;
}

export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] =
  [];

export const lintRatchets = [
  {
    id: "ratchet/local-type-assertion-boundary",
    ruleId: "local/type-assertion-boundary",
    files: ["$files_glob"],
    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],
    ruleOptions: [],
    mode: "no-new",
    metric: "message-count",
    repairKind: "manual",
    principle: "Synthetic fixture ratchet principle.",
    zeroBaselineDisposition: {
      kind: "temporary-ratchet-only",
      reason: "fixture keeps this clean ratchet outside normal lint to exercise checked zero-baseline success",
      exitPath: "docs/guides/lint-ratchet.md",
    },
  },
] as const satisfies readonly LintRatchetConfig[];
TS
}

write_clean_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  printf 'export const value = 1;\n' >"$fixture_dir/packages/app/src/example.ts"
}

write_max_lines_source() {
  local fixture_dir=$1
  local lines=$2
  mkdir -p "$fixture_dir/packages/app/src"
  : >"$fixture_dir/packages/app/src/example.ts"
  for line in $(seq 1 "$lines"); do
    printf 'export const value%s = %s;\n' "$line" "$line" \
      >>"$fixture_dir/packages/app/src/example.ts"
  done
}

write_complexity_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  cat >"$fixture_dir/packages/app/src/example.ts" <<'TS'
export function choose(value: number): number {
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}
TS
}

write_more_complexity_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  cat >"$fixture_dir/packages/app/src/example.ts" <<'TS'
export function choose(value: number): number {
  if (value > 10) {
    return 10;
  }
  if (value > 0) {
    return 1;
  }
  if (value < 0) {
    return -1;
  }
  return 0;
}
TS
}

write_marker_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  printf 'export const fixtureViolation = 1;\n' \
    >"$fixture_dir/packages/app/src/example.ts"
}

write_type_dependency_sources() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  cat >"$fixture_dir/packages/app/src/schema.ts" <<'TS'
export interface FixtureSchema {
  readonly name: string;
}
TS
  cat >"$fixture_dir/packages/app/src/consumer.ts" <<'TS'
import type { FixtureSchema } from "./schema";

export function hasName(value: FixtureSchema): boolean {
  if (value.name) {
    return true;
  }
  return false;
}
TS
}

make_type_dependency_schema_nullable() {
  local fixture_dir=$1
  cat >"$fixture_dir/packages/app/src/schema.ts" <<'TS'
export interface FixtureSchema {
  readonly name: string | undefined;
}
TS
}

write_violation_source() {
  local fixture_dir=$1
  mkdir -p "$fixture_dir/packages/app/src"
  cat >"$fixture_dir/packages/app/src/example.ts" <<'TS'
const raw = {};
export const value = raw as { value: number };
TS
}

run_fixture_update() {
  local fixture_dir=$1
  ensure_fixture_git_index "$fixture_dir"
  if (cd "$fixture_dir" && bun run scripts/lint-ratchet.ts --update \
      >"$TMP_ROOT/update.out" 2>"$TMP_ROOT/update.err"); then
    ensure_fixture_git_index "$fixture_dir"
    return 0
  fi
  return 1
}

ensure_fixture_git_index() {
  local fixture_dir=$1
  if ! git -C "$fixture_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$fixture_dir" init -q
  fi
  git -C "$fixture_dir" add -A
}

third_party_config_path() {
  local fixture_dir=$1
  find "$fixture_dir/node_modules/.cache/eslint-ratchet/configs" \
    -name 'ratchet-fixture-third-party-*.mjs' -type f | sort
}

third_party_cache_files() {
  local fixture_dir=$1
  local cache_root="$fixture_dir/node_modules/.cache/eslint-ratchet"
  [ -d "$cache_root" ] || return 0
  find "$cache_root" -mindepth 2 -maxdepth 2 -name ".eslintcache" -type f \
    -path "*/ratchet-fixture-third-party-*/*" | sort
}

core_config_path() {
  local fixture_dir=$1
  find "$fixture_dir/node_modules/.cache/eslint-ratchet/configs" \
    -name 'ratchet-fixture-core-*.mjs' -type f | sort
}

core_cache_files() {
  local fixture_dir=$1
  local cache_root="$fixture_dir/node_modules/.cache/eslint-ratchet"
  [ -d "$cache_root" ] || return 0
  find "$cache_root" -mindepth 2 -maxdepth 2 -name ".eslintcache" -type f \
    -path "*/ratchet-fixture-core-*/*" | sort
}

# shellcheck source=scripts/tests/lib/test-lint-ratchet-edit-check-fixtures.sh
. scripts/tests/lib/test-lint-ratchet-edit-check-fixtures.sh

# --- Real tree: committed registry shape and generated identity -------------
# Full real-tree ESLint collection is covered by the dedicated lint:ratchet
# verify lane. This smoke keeps the real-tree preflight to checks that are not
# already repeated by the fixture CLI runs below.
if ! bun run lint:ratchet:check-registry >"$TMP_ROOT/real-registry.out" 2>"$TMP_ROOT/real-registry.err"; then
  cat "$TMP_ROOT/real-registry.err"
  fail "lint:ratchet:check-registry failed on the real tree"
fi
grep -qF "lint:ratchet:check-registry OK" "$TMP_ROOT/real-registry.err" \
  || fail "lint:ratchet:check-registry OK line missing: $(cat "$TMP_ROOT/real-registry.err")"
assert_local_identity_regression
assert_baseline_merge_driver_legacy_block_migration
assert_lint_ratchet_merge_driver
assert_lint_ratchet_merge_recipe_docs_match_driver
assert_max_lines_exceptions_fallback_recipe
assert_entry_baseline_fallback_rebase_guidance
assert_policy_safe_recovery_docs
assert_generated_baseline_stage_restore
assert_lint_ratchet_merge_driver_real_semantic_merge
assert_knip_unused_exports_merge_driver_real_semantic_merge
assert_knip_unused_exports_driverless_text_merge_blocks_summary_drift
assert_max_lines_exceptions_merge_driver_real_semantic_merge
assert_max_lines_exceptions_merge_driver_real_additions_merge
assert_max_lines_exceptions_merge_driver_real_truth_up_advisory
assert_lint_ratchet_cherry_pick_marker_leak_ignored
assert_knip_unused_exports_cherry_pick_marker_leak_ignored
assert_lint_ratchet_merge_driver_hash_tool_guard
assert_lint_ratchet_merge_driver_write_guard
assert_merge_driver_installers_replace_atomically
assert_concurrent_merge_driver_installers_preserve_blocks
assert_lint_ratchet_merge_driver_auto_install_wiring
assert_lint_ratchet_post_merge_truth_up
assert_knip_unused_exports_post_merge_truth_up
assert_post_commit_truth_up_dispatch_wiring
assert_truth_up_matrix_merge_completions
assert_truth_up_matrix_leaked_markers
assert_truth_up_matrix_linked_worktree
assert_truth_up_matrix_max_lines_post_commit

# --- Usage errors return exit 2 (CLI contract for harness wrappers) ----------
# Each assertion runs against the real tree; usage errors throw before ESLint
# is invoked so there are no side effects on the live cache or baseline.
assert_usage_failure "unknown flag" "Unknown argument" --not-a-flag
assert_usage_failure "two modes at once" "choose only one mode" --update --check-baseline
assert_usage_failure "--allow-worse outside --update" "--allow-worse is only valid with --update" --allow-worse
assert_usage_failure "--reason outside --update" "--reason is only valid with --update" --reason=anything
assert_usage_failure "--reason missing value" "--reason requires a non-empty argument" --update --reason
assert_usage_failure "--allow-worse without --reason" "--allow-worse requires a non-empty --reason" --update --allow-worse
assert_usage_failure "--allow-worse with blank --reason" "--allow-worse requires a non-empty --reason" --update --allow-worse --reason=""
assert_usage_failure "--allow-worse with placeholder --reason" \
  "--allow-worse requires a real --reason, not the placeholder" \
  --update --allow-worse \
  --reason "<why accepting this baseline increase is better than forcing a low-quality fix now>"

# --- Conflict markers produce generated-baseline recovery at the CLI --------
MARKER_DIR="$TMP_ROOT/conflict-marker"
build_fixture "$MARKER_DIR"
write_type_assertion_config "$MARKER_DIR"
write_clean_source "$MARKER_DIR"
ensure_fixture_git_index "$MARKER_DIR"
printf '%s\n' \
  '<<<<<<< ours' \
  '{"version":1,"tests":{}}' \
  '=======' \
  '{"version":1,"tests":{}}' \
  '>>>>>>> theirs' \
  >"$MARKER_DIR/lint-ratchet.baseline.json"
set +e
(cd "$MARKER_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/conflict-marker.out" 2>"$TMP_ROOT/conflict-marker.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "conflict-marker baseline should make lint:ratchet exit 2, got $status"
# Backticks are literal CLI guidance.
# shellcheck disable=SC2016
expected_marker_error='lint-ratchet.baseline.json is generated; Git conflict markers mean its semantic merge driver was not installed. Run `bun run lint:ratchet:install-merge-driver`, restore a parseable side with `bun run baseline:restore-stage -- --ours lint-ratchet.baseline.json` (always use stage 2/`--ours`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), then resolve by regenerating with `bun run lint:ratchet:update`; never hand-merge this file. Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression.'
grep -qF "$expected_marker_error" "$TMP_ROOT/conflict-marker.err" \
  || fail "lint:ratchet conflict-marker recovery was missing: $(cat "$TMP_ROOT/conflict-marker.err")"
if grep -qF 'SyntaxError' "$TMP_ROOT/conflict-marker.err" \
  || grep -qF 'baseline JSON parse failed' "$TMP_ROOT/conflict-marker.err" \
  || grep -qE '^[[:space:]]*at ' "$TMP_ROOT/conflict-marker.err"; then
  fail "lint:ratchet conflict-marker recovery leaked a generic parse error or stack"
fi
[ ! -s "$TMP_ROOT/conflict-marker.out" ] \
  || fail "lint:ratchet conflict-marker failure should not write stdout"

# --- Fixture: default lint:ratchet rejects empty registry globs --------------
EMPTY_GLOB_DIR="$TMP_ROOT/empty-glob"
build_fixture "$EMPTY_GLOB_DIR"
write_type_assertion_config "$EMPTY_GLOB_DIR" "packages/app/src/missing/**/*.ts"
write_clean_source "$EMPTY_GLOB_DIR"
ensure_fixture_git_index "$EMPTY_GLOB_DIR"
set +e
(cd "$EMPTY_GLOB_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/empty-glob-update.out" 2>"$TMP_ROOT/empty-glob-update.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "empty-glob update should exit 2, got $status: $(cat "$TMP_ROOT/empty-glob-update.err")"
grep -qF "empty-glob: ratchet/local-type-assertion-boundary" \
  "$TMP_ROOT/empty-glob-update.err" \
  || fail "empty-glob update failure should name the ratchet: $(cat "$TMP_ROOT/empty-glob-update.err")"
grep -qF "files globs match zero tracked files after ignores" \
  "$TMP_ROOT/empty-glob-update.err" \
  || fail "empty-glob update failure should explain the missing tracked match: $(cat "$TMP_ROOT/empty-glob-update.err")"
set +e
(cd "$EMPTY_GLOB_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/empty-glob.out" 2>"$TMP_ROOT/empty-glob.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "empty-glob default run should exit 2, got $status: $(cat "$TMP_ROOT/empty-glob.err")"
grep -qF "empty-glob: ratchet/local-type-assertion-boundary" \
  "$TMP_ROOT/empty-glob.err" \
  || fail "empty-glob failure should name the ratchet: $(cat "$TMP_ROOT/empty-glob.err")"
grep -qF "files globs match zero tracked files after ignores" \
  "$TMP_ROOT/empty-glob.err" \
  || fail "empty-glob failure should explain the missing tracked match: $(cat "$TMP_ROOT/empty-glob.err")"

# --- Fixture clean run -------------------------------------------------------
CLEAN_DIR="$TMP_ROOT/clean"
build_fixture "$CLEAN_DIR"
write_type_assertion_config "$CLEAN_DIR"
write_clean_source "$CLEAN_DIR"
run_fixture_update "$CLEAN_DIR" || fail "fixture clean update failed: $(cat "$TMP_ROOT/update.err")"
if ! (cd "$CLEAN_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/clean.out" 2>"$TMP_ROOT/clean.err"); then
  cat "$TMP_ROOT/clean.err"
  fail "fixture clean run failed"
fi
assert_envelope "$TMP_ROOT/clean.out" 0
(cd "$CLEAN_DIR" && git init -q && git add .)
if ! (cd "$CLEAN_DIR" && bun run scripts/lint-ratchet.ts --zero-baseline \
      >"$TMP_ROOT/zero-baseline.out" 2>"$TMP_ROOT/zero-baseline.err"); then
  cat "$TMP_ROOT/zero-baseline.err"
  fail "fixture zero-baseline audit failed"
fi
grep -qF "# Lint Ratchet Zero-Baseline Audit" "$TMP_ROOT/zero-baseline.out" \
  || fail "zero-baseline audit missing heading"
grep -qF "ratchet/local-type-assertion-boundary" "$TMP_ROOT/zero-baseline.out" \
  || fail "zero-baseline audit missing fixture ratchet"
grep -qF "normal-off" "$TMP_ROOT/zero-baseline.out" \
  || fail "zero-baseline audit missing normal lint status"

# --- Fixture regression ------------------------------------------------------
REGRESSION_DIR="$TMP_ROOT/regression"
build_fixture "$REGRESSION_DIR"
write_type_assertion_config "$REGRESSION_DIR"
write_clean_source "$REGRESSION_DIR"
run_fixture_update "$REGRESSION_DIR" || fail "fixture regression update failed"
write_violation_source "$REGRESSION_DIR"

set +e
(cd "$REGRESSION_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/regression.out" 2>"$TMP_ROOT/regression.err")
status=$?
set -e
[ "$status" -eq 1 ] || fail "fixture regression should exit 1, got $status: $(cat "$TMP_ROOT/regression.err")"
assert_envelope "$TMP_ROOT/regression.out" 1
assert_regression_recovery_note "$TMP_ROOT/regression.out"
ASSERT_FILE="$TMP_ROOT/regression.out" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (finding.control !== "ratchet/local-type-assertion-boundary") assertionFailed("bad control");
  if (finding.ruleId !== "local/type-assertion-boundary") assertionFailed("bad ruleId");
  if (!finding.path) assertionFailed("missing path");
' || fail "regression envelope missing expected finding"

set +e
(cd "$REGRESSION_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/refuse-update.out" 2>"$TMP_ROOT/refuse-update.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "update should refuse worse generated baseline"
grep -qF "generated baseline is worse" "$TMP_ROOT/refuse-update.err" \
  || fail "worse update stderr missing refusal: $(cat "$TMP_ROOT/refuse-update.err")"

# --- Fixture: effective-line-count catches growth without count growth -------
MAX_LINES_DIR="$TMP_ROOT/max-lines"
build_fixture "$MAX_LINES_DIR"
write_max_lines_config "$MAX_LINES_DIR"
write_max_lines_source "$MAX_LINES_DIR" 4
run_fixture_update "$MAX_LINES_DIR" || fail "max-lines initial update failed"
grep -qF '"count": 1' "$MAX_LINES_DIR/lint-ratchet.baseline.json" \
  || fail "max-lines baseline missing finding count"
grep -qF '"lines": 4' "$MAX_LINES_DIR/lint-ratchet.baseline.json" \
  || fail "max-lines baseline missing effective line count"
write_max_lines_source "$MAX_LINES_DIR" 5
set +e
(cd "$MAX_LINES_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/max-lines.out" 2>"$TMP_ROOT/max-lines.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "max-lines default run should fail on line growth, got $status: $(cat "$TMP_ROOT/max-lines.err")"
assert_envelope "$TMP_ROOT/max-lines.out" 1
ASSERT_FILE="$TMP_ROOT/max-lines.out" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (finding.control !== "ratchet/fixture-max-lines") assertionFailed("bad control");
  if (finding.ruleId !== "local/max-lines") assertionFailed("bad ruleId");
  if (finding.reason !== "increased-lines") assertionFailed(`bad reason ${finding.reason}`);
  if (finding.baselineLines !== 4) assertionFailed(`bad baselineLines ${finding.baselineLines}`);
  if (finding.currentLines !== 5) assertionFailed(`bad currentLines ${finding.currentLines}`);
  if (!finding.howToFix.includes("Split the module")) {
    assertionFailed(`missing split fix text: ${finding.howToFix}`);
  }
  if (finding.howToFix.includes("effective line count from 5")) {
    assertionFailed(`line-count fix text kept old from-current anchor: ${finding.howToFix}`);
  }
  if (!finding.howToFix.includes("before committing your work")) {
    assertionFailed(`line-count fix text missing commit timing: ${finding.howToFix}`);
  }
  if (finding.howToFix.includes("in a cleanup PR")) {
    assertionFailed(`line-count fix text kept cleanup PR wording: ${finding.howToFix}`);
  }
  if (/Repair manually|Apply the ESLint suggestion/.test(finding.howToFix)) {
    assertionFailed(`line-count fix text leaked generic local-rule prefix: ${finding.howToFix}`);
  }
' || fail "max-lines envelope missing effective-line-count detail"
set +e
(cd "$MAX_LINES_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/max-lines-check.out" 2>"$TMP_ROOT/max-lines-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "max-lines check-baseline should fail on line growth, got $status: $(cat "$TMP_ROOT/max-lines-check.err")"
grep -qF "effective lines increased from 4 to 5" "$TMP_ROOT/max-lines-check.err" \
  || fail "max-lines check-baseline missing line growth detail: $(cat "$TMP_ROOT/max-lines-check.err")"
set +e
(cd "$MAX_LINES_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/max-lines-update.out" 2>"$TMP_ROOT/max-lines-update.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "max-lines update should refuse worse lines"
grep -qF "generated baseline is worse" "$TMP_ROOT/max-lines-update.err" \
  || fail "max-lines update stderr missing refusal: $(cat "$TMP_ROOT/max-lines-update.err")"

MAX_LINES_IMPROVE_DIR="$TMP_ROOT/max-lines-improve"
build_fixture "$MAX_LINES_IMPROVE_DIR"
write_max_lines_config "$MAX_LINES_IMPROVE_DIR"
write_max_lines_source "$MAX_LINES_IMPROVE_DIR" 5
run_fixture_update "$MAX_LINES_IMPROVE_DIR" || fail "max-lines improve update failed"
write_max_lines_source "$MAX_LINES_IMPROVE_DIR" 4
set +e
(cd "$MAX_LINES_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/max-lines-improve-check.out" 2>"$TMP_ROOT/max-lines-improve-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "max-lines check-baseline should fail when effective lines shrink, got $status: $(cat "$TMP_ROOT/max-lines-improve-check.err")"
grep -qF "effective lines decreased from 5 to 4" "$TMP_ROOT/max-lines-improve-check.err" \
  || fail "max-lines improvement detail missing: $(cat "$TMP_ROOT/max-lines-improve-check.err")"
grep -qF "run bun run lint:ratchet:update" "$TMP_ROOT/max-lines-improve-check.err" \
  || fail "max-lines improvement repair command missing: $(cat "$TMP_ROOT/max-lines-improve-check.err")"
max_lines_before=$(ASSERT_FILE="$MAX_LINES_IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const item = parsed.tests["ratchet/fixture-max-lines"].items["packages/app/src/example.ts"];
  if (item === undefined) assertionFailed("missing max-lines item");
  console.log(item.lines);
') || fail "max-lines improvement baseline read failed"
[ "$max_lines_before" -eq 5 ] \
  || fail "max-lines improvement baseline should start at 5 lines, got $max_lines_before"
run_fixture_update "$MAX_LINES_IMPROVE_DIR" \
  || fail "max-lines improvement update did not clear failure: $(cat "$TMP_ROOT/update.err")"
set +e
(cd "$MAX_LINES_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/max-lines-improve-clean-check.out" \
  2>"$TMP_ROOT/max-lines-improve-clean-check.err")
status=$?
set -e
[ "$status" -eq 0 ] \
  || fail "max-lines check-baseline should pass after update, got $status: $(cat "$TMP_ROOT/max-lines-improve-clean-check.err")"
grep -qF "lint:ratchet:check-baseline OK — 1 current finding(s)." \
  "$TMP_ROOT/max-lines-improve-clean-check.err" \
  || fail "max-lines check-baseline OK line missing after update: $(cat "$TMP_ROOT/max-lines-improve-clean-check.err")"
if grep -qF "current findings are better" "$TMP_ROOT/max-lines-improve-clean-check.err"; then
  fail "max-lines check-baseline still reported an improvement after update: $(cat "$TMP_ROOT/max-lines-improve-clean-check.err")"
fi
if ! (cd "$MAX_LINES_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/max-lines-improve-clean.out" \
      2>"$TMP_ROOT/max-lines-improve-clean.err"); then
  cat "$TMP_ROOT/max-lines-improve-clean.err"
  fail "max-lines default run should pass after improvement update"
fi
assert_envelope "$TMP_ROOT/max-lines-improve-clean.out" 0
max_lines_after=$(ASSERT_FILE="$MAX_LINES_IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const item = parsed.tests["ratchet/fixture-max-lines"].items["packages/app/src/example.ts"];
  if (item === undefined) assertionFailed("missing max-lines item");
  console.log(item.lines);
') || fail "max-lines improvement baseline reread failed"
[ "$max_lines_after" -eq 4 ] \
  || fail "max-lines improvement baseline should update to 4 lines, got $max_lines_after"
[ "$max_lines_before" -gt "$max_lines_after" ] \
  || fail "max-lines improvement baseline did not shrink: $max_lines_before -> $max_lines_after"

# --- Fixture check-baseline validation is non-mutating -----------------------
# Mutate the baseline JSON structurally (drop ruleOptions) so the smoke does
# not depend on the exact textual layout `formatLintRatchetBaseline` emits.
MUTATE_DIR="$TMP_ROOT/mutate"
build_fixture "$MUTATE_DIR"
write_type_assertion_config "$MUTATE_DIR"
write_clean_source "$MUTATE_DIR"
run_fixture_update "$MUTATE_DIR" || fail "fixture mutate update failed"
ASSERT_FILE="$MUTATE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const file = process.env.ASSERT_FILE;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const test of Object.values(parsed.tests)) {
    delete test.ruleOptions;
  }
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
' || fail "structural mutate failed"
before=$(cat "$MUTATE_DIR/lint-ratchet.baseline.json")
set +e
(cd "$MUTATE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/mutate-check.out" 2>"$TMP_ROOT/mutate-check.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "check-baseline should reject mutated baseline"
after=$(cat "$MUTATE_DIR/lint-ratchet.baseline.json")
[ "$before" = "$after" ] || fail "check-baseline rewrote the mutated baseline"

# --- Fixture: update recovers from stale registry metadata -------------------
# The committed baseline has a stale configHash; update should rewrite it
# instead of failing on the strict registry-identity check. The stale value
# must stay format-valid (sha256:<64 hex>) so strict parse-level hash
# validation still accepts the file and staleness is detected downstream.
STALE_DIR="$TMP_ROOT/stale-recover"
build_fixture "$STALE_DIR"
write_type_assertion_config "$STALE_DIR"
write_clean_source "$STALE_DIR"
run_fixture_update "$STALE_DIR" || fail "stale-recover initial update failed"
ASSERT_FILE="$STALE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const file = process.env.ASSERT_FILE;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const test of Object.values(parsed.tests)) {
    test.configHash = "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  }
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
' || fail "stale-recover mutate failed"

set +e
(cd "$STALE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/stale-check.out" 2>"$TMP_ROOT/stale-check.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "check-baseline should still reject stale registry metadata"
grep -qF "configHash is stale" "$TMP_ROOT/stale-check.err" \
  || fail "stale check missing expected message: $(cat "$TMP_ROOT/stale-check.err")"

if ! (cd "$STALE_DIR" && bun run scripts/lint-ratchet.ts --update \
      >"$TMP_ROOT/stale-update.out" 2>"$TMP_ROOT/stale-update.err"); then
  cat "$TMP_ROOT/stale-update.err"
  fail "update should rewrite a baseline with stale registry metadata"
fi
grep -qF "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$STALE_DIR/lint-ratchet.baseline.json" \
  && fail "update did not refresh the stale configHash"

# --- Fixture: update refuses a baseline with an orphan registry id without
#     --allow-worse --reason; accepts with the flag (Leaf 26) -----------------
# A committed entry whose id is no longer in the registry looks identical to
# a renamed ratchet (the new id has no committed floor, so count protection
# is bypassed). update must require explicit operator acknowledgement, even
# though the structural parse can still rebuild the file.
ORPHAN_DIR="$TMP_ROOT/orphan"
build_fixture "$ORPHAN_DIR"
write_type_assertion_config "$ORPHAN_DIR"
write_clean_source "$ORPHAN_DIR"
run_fixture_update "$ORPHAN_DIR" || fail "orphan initial update failed"
ASSERT_FILE="$ORPHAN_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const file = process.env.ASSERT_FILE;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const renamed = {};
  for (const [id, test] of Object.entries(parsed.tests)) {
    renamed[id + "-removed"] = test;
  }
  parsed.tests = renamed;
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
' || fail "orphan mutate failed"
# Plain --update must refuse with the rename-or-removal diagnostic.
set +e
(cd "$ORPHAN_DIR" && bun run scripts/lint-ratchet.ts --update \
   >"$TMP_ROOT/orphan-refuse.out" 2>"$TMP_ROOT/orphan-refuse.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "orphan --update should refuse without --allow-worse"
grep -qF "rename or removal" "$TMP_ROOT/orphan-refuse.err" \
  || fail "orphan refuse stderr missing rename-or-removal hint: $(cat "$TMP_ROOT/orphan-refuse.err")"
grep -qF "-removed" "$TMP_ROOT/orphan-refuse.err" \
  || fail "orphan refuse stderr should name the orphan id: $(cat "$TMP_ROOT/orphan-refuse.err")"
grep -qF "-removed" "$ORPHAN_DIR/lint-ratchet.baseline.json" \
  || fail "orphan refuse should not rewrite the baseline"
# With --allow-worse --reason, update proceeds and drops the orphan id.
if ! (cd "$ORPHAN_DIR" && bun run scripts/lint-ratchet.ts --update \
      --allow-worse --reason="renamed local rule" \
      >"$TMP_ROOT/orphan-accept.out" 2>"$TMP_ROOT/orphan-accept.err"); then
  cat "$TMP_ROOT/orphan-accept.err"
  fail "update --allow-worse --reason should rewrite a baseline whose registry id no longer exists"
fi
grep -qF "-removed" "$ORPHAN_DIR/lint-ratchet.baseline.json" \
  && fail "update --allow-worse did not drop the orphan registry id"

# --- Fixture: rule source change invalidates cached findings -----------------
# Establish a baseline with a violation under the real rule, then replace the
# rule file with a no-op that emits no findings. Without rule-source hashing,
# ESLint's cache (keyed off the generated config path) would happily reuse the
# previous findings. With Leaf 01 in place, both the cache path AND the
# strict-parse ruleSourceHash check force a re-run.
RULESRC_DIR="$TMP_ROOT/rule-source"
build_fixture "$RULESRC_DIR"
write_type_assertion_config "$RULESRC_DIR"
write_violation_source "$RULESRC_DIR"
run_fixture_update "$RULESRC_DIR" || fail "rule-source initial update failed"
# Baseline now expects 1 finding under the real rule.
grep -qF '"count": 1' "$RULESRC_DIR/lint-ratchet.baseline.json" \
  || fail "rule-source baseline missing the seeded violation count"

# Replace the local rule with a no-op so it no longer fires. Keep the docs
# metadata the rule-docs validator requires so the smoke isolates rule-source
# invalidation rather than metadata regressions.
cat >"$RULESRC_DIR/eslint-rules/type-assertion-boundary.js" <<'JS'
export default {
  meta: {
    type: "problem",
    schema: [],
    docs: {
      description: "No-op fixture replacement for type-assertion-boundary.",
      principle: "Cache invalidation smoke fixture.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "manual",
    },
  },
  create() { return {}; },
};
JS

# check-baseline must reject the now-stale ruleSourceHash binding (strict
# parse). Without Leaf 01 this would silently pass because nothing tied the
# baseline to the rule implementation.
set +e
(cd "$RULESRC_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/rule-source-check.out" 2>"$TMP_ROOT/rule-source-check.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "check-baseline should reject a baseline bound to a stale rule source"
grep -qF "ruleSourceHash is stale" "$TMP_ROOT/rule-source-check.err" \
  || fail "rule-source check missing expected stale-hash message: $(cat "$TMP_ROOT/rule-source-check.err")"

# Update re-baselines under the no-op rule and proves the cache invalidates:
# the previous run's cached "1 violation" finding under the old rule must not
# leak into the rebaselined type-assertion ratchet. The fixture copies the live
# registry, so other ratchets may still have current findings in this temp tree.
if ! (cd "$RULESRC_DIR" && bun run scripts/lint-ratchet.ts --update \
      >"$TMP_ROOT/rule-source-update.out" 2>"$TMP_ROOT/rule-source-update.err"); then
  cat "$TMP_ROOT/rule-source-update.err"
  fail "update should re-baseline under the no-op rule"
fi
ASSERT_FILE="$RULESRC_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const test = parsed.tests["ratchet/local-type-assertion-boundary"];
  if (!test) assertionFailed("missing type-assertion ratchet baseline");
  if (Object.keys(test.items).length !== 0) {
    assertionFailed(`type-assertion items not empty: ${JSON.stringify(test.items)}`);
  }
' || fail "rebaselined type-assertion items not empty after rule replacement"

# --- Fixture: unsupported third-party plugin namespace fails loudly ----------
UNSUPPORTED_PLUGIN_DIR="$TMP_ROOT/unsupported-plugin"
build_fixture "$UNSUPPORTED_PLUGIN_DIR"
write_clean_source "$UNSUPPORTED_PLUGIN_DIR"
write_third_party_config "$UNSUPPORTED_PLUGIN_DIR" "always-report" "minimal-ts" "not-allowlisted"
ensure_fixture_git_index "$UNSUPPORTED_PLUGIN_DIR"
set +e
(cd "$UNSUPPORTED_PLUGIN_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/unsupported-plugin.out" 2>"$TMP_ROOT/unsupported-plugin.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "unsupported plugin should exit 2, got $status: $(cat "$TMP_ROOT/unsupported-plugin.err")"
grep -qF "is not allowlisted" "$TMP_ROOT/unsupported-plugin.err" \
  || fail "unsupported plugin stderr missing allowlist failure: $(cat "$TMP_ROOT/unsupported-plugin.err")"

# --- Fixture: malformed third-party rule ids fail before allowlist lookup ----
MALFORMED_RULE_ID_DIR="$TMP_ROOT/malformed-rule-id"
build_fixture "$MALFORMED_RULE_ID_DIR"
write_clean_source "$MALFORMED_RULE_ID_DIR"
write_third_party_config "$MALFORMED_RULE_ID_DIR" "unused" "minimal-ts" \
  "allowlisted" "@badly"
ensure_fixture_git_index "$MALFORMED_RULE_ID_DIR"
set +e
(cd "$MALFORMED_RULE_ID_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/malformed-rule-id.out" 2>"$TMP_ROOT/malformed-rule-id.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "malformed ruleId should exit 2, got $status: $(cat "$TMP_ROOT/malformed-rule-id.err")"
grep -qF "ruleId is not a valid lint rule identifier" "$TMP_ROOT/malformed-rule-id.err" \
  || fail "malformed ruleId stderr missing validation failure: $(cat "$TMP_ROOT/malformed-rule-id.err")"
! grep -qF "is not allowlisted" "$TMP_ROOT/malformed-rule-id.err" \
  || fail "malformed ruleId should not report allowlist failure: $(cat "$TMP_ROOT/malformed-rule-id.err")"

# --- Fixture: malformed core rule ids fail before ESLint runs ---------------
MALFORMED_CORE_RULE_ID_DIR="$TMP_ROOT/malformed-core-rule-id"
build_fixture "$MALFORMED_CORE_RULE_ID_DIR"
write_clean_source "$MALFORMED_CORE_RULE_ID_DIR"
write_core_config "$MALFORMED_CORE_RULE_ID_DIR" "foo/bar"
ensure_fixture_git_index "$MALFORMED_CORE_RULE_ID_DIR"
set +e
(cd "$MALFORMED_CORE_RULE_ID_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/malformed-core-rule-id.out" 2>"$TMP_ROOT/malformed-core-rule-id.err")
status=$?
set -e
[ "$status" -eq 2 ] \
  || fail "malformed core ruleId should exit 2, got $status: $(cat "$TMP_ROOT/malformed-core-rule-id.err")"
grep -qF "core ruleId must be a bare ESLint built-in id" \
  "$TMP_ROOT/malformed-core-rule-id.err" \
  || fail "malformed core ruleId stderr missing validation failure: $(cat "$TMP_ROOT/malformed-core-rule-id.err")"

# --- Fixture: supported core rule executes and baselines findings -----------
CORE_DIR="$TMP_ROOT/core"
build_fixture "$CORE_DIR"
write_complexity_source "$CORE_DIR"
write_core_config "$CORE_DIR" "complexity" "minimal-ts" "[{ max: 1 }]"
run_fixture_update "$CORE_DIR" \
  || fail "core update failed: $(cat "$TMP_ROOT/update.err")"
grep -qF '"ratchet/fixture-core"' "$CORE_DIR/lint-ratchet.baseline.json" \
  || fail "core baseline missing fixture ratchet"
grep -qF '"count": 1' "$CORE_DIR/lint-ratchet.baseline.json" \
  || fail "core baseline missing expected finding count"
if ! (cd "$CORE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/core.out" 2>"$TMP_ROOT/core.err"); then
  cat "$TMP_ROOT/core.err"
  fail "core default run failed after update"
fi
assert_envelope "$TMP_ROOT/core.out" 0
CORE_CONFIG=$(core_config_path "$CORE_DIR")
[ -n "$CORE_CONFIG" ] || fail "core generated config missing"
grep -qF 'rules: { "complexity": ["error",{"max":1}] }' "$CORE_CONFIG" \
  || fail "core generated config missing bare rule id"
! grep -qF "plugins:" "$CORE_CONFIG" \
  || fail "core generated config should not declare plugins"
CORE_CACHE=$(core_cache_files "$CORE_DIR")
[ -n "$CORE_CACHE" ] \
  || fail "minimal-ts core ratchet did not create an eslint cache file"

# --- Fixture: complexity-severity catches growth without count growth -------
COMPLEXITY_DIR="$TMP_ROOT/complexity-severity"
build_fixture "$COMPLEXITY_DIR"
write_complexity_source "$COMPLEXITY_DIR"
write_core_config "$COMPLEXITY_DIR" "complexity" "minimal-ts" "[{ max: 1 }]" "complexity-severity"
run_fixture_update "$COMPLEXITY_DIR" \
  || fail "complexity-severity initial update failed: $(cat "$TMP_ROOT/update.err")"
grep -qF '"count": 1' "$COMPLEXITY_DIR/lint-ratchet.baseline.json" \
  || fail "complexity-severity baseline missing finding count"
grep -qF '"maxComplexity": 3' "$COMPLEXITY_DIR/lint-ratchet.baseline.json" \
  || fail "complexity-severity baseline missing max complexity"
write_more_complexity_source "$COMPLEXITY_DIR"
set +e
(cd "$COMPLEXITY_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/complexity.out" 2>"$TMP_ROOT/complexity.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "complexity-severity default run should fail on complexity growth, got $status: $(cat "$TMP_ROOT/complexity.err")"
assert_envelope "$TMP_ROOT/complexity.out" 1
ASSERT_FILE="$TMP_ROOT/complexity.out" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (finding.control !== "ratchet/fixture-core") assertionFailed("bad control");
  if (finding.ruleId !== "complexity") assertionFailed("bad ruleId");
  if (finding.reason !== "increased-complexity") assertionFailed(`bad reason ${finding.reason}`);
  if (finding.baselineComplexity !== 3) assertionFailed(`bad baselineComplexity ${finding.baselineComplexity}`);
  if (finding.currentComplexity !== 4) assertionFailed(`bad currentComplexity ${finding.currentComplexity}`);
  if (!finding.howToFix.includes("Split complex logic")) {
    assertionFailed(`missing split-complexity fix text: ${finding.howToFix}`);
  }
  if (finding.howToFix.includes("complexity from 4")) {
    assertionFailed(`complexity fix text kept old from-current anchor: ${finding.howToFix}`);
  }
  if (finding.howToFix.includes("complexity complexity")) {
    assertionFailed(`complexity fix text duplicated complexity: ${finding.howToFix}`);
  }
  if (!finding.howToFix.includes("before committing your work")) {
    assertionFailed(`complexity fix text missing commit timing: ${finding.howToFix}`);
  }
  if (finding.howToFix.includes("in a cleanup PR")) {
    assertionFailed(`complexity fix text kept cleanup PR wording: ${finding.howToFix}`);
  }
' || fail "complexity envelope missing severity detail"
set +e
(cd "$COMPLEXITY_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/complexity-check.out" 2>"$TMP_ROOT/complexity-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "complexity check-baseline should fail on complexity growth, got $status: $(cat "$TMP_ROOT/complexity-check.err")"
grep -qF "complexity increased from 3 to 4" "$TMP_ROOT/complexity-check.err" \
  || fail "complexity check-baseline missing growth detail: $(cat "$TMP_ROOT/complexity-check.err")"
set +e
(cd "$COMPLEXITY_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/complexity-update.out" 2>"$TMP_ROOT/complexity-update.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "complexity update should refuse worse severity"
grep -qF "generated baseline is worse" "$TMP_ROOT/complexity-update.err" \
  || fail "complexity update stderr missing refusal: $(cat "$TMP_ROOT/complexity-update.err")"

COMPLEXITY_IMPROVE_DIR="$TMP_ROOT/complexity-severity-improve"
build_fixture "$COMPLEXITY_IMPROVE_DIR"
write_more_complexity_source "$COMPLEXITY_IMPROVE_DIR"
write_core_config "$COMPLEXITY_IMPROVE_DIR" "complexity" "minimal-ts" "[{ max: 1 }]" "complexity-severity"
run_fixture_update "$COMPLEXITY_IMPROVE_DIR" \
  || fail "complexity improvement update failed: $(cat "$TMP_ROOT/update.err")"
write_complexity_source "$COMPLEXITY_IMPROVE_DIR"
set +e
(cd "$COMPLEXITY_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/complexity-improve-check.out" 2>"$TMP_ROOT/complexity-improve-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "complexity check-baseline should fail when complexity shrinks, got $status: $(cat "$TMP_ROOT/complexity-improve-check.err")"
grep -qF "complexity decreased from 4 to 3" "$TMP_ROOT/complexity-improve-check.err" \
  || fail "complexity improvement detail missing: $(cat "$TMP_ROOT/complexity-improve-check.err")"
grep -qF "run bun run lint:ratchet:update" "$TMP_ROOT/complexity-improve-check.err" \
  || fail "complexity improvement repair command missing: $(cat "$TMP_ROOT/complexity-improve-check.err")"
complexity_before=$(ASSERT_FILE="$COMPLEXITY_IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const item = parsed.tests["ratchet/fixture-core"].items["packages/app/src/example.ts"];
  if (item === undefined) assertionFailed("missing complexity item");
  console.log(item.maxComplexity);
') || fail "complexity improvement baseline read failed"
[ "$complexity_before" -eq 4 ] \
  || fail "complexity improvement baseline should start at 4, got $complexity_before"
run_fixture_update "$COMPLEXITY_IMPROVE_DIR" \
  || fail "complexity improvement update did not clear failure: $(cat "$TMP_ROOT/update.err")"
set +e
(cd "$COMPLEXITY_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/complexity-improve-clean-check.out" \
  2>"$TMP_ROOT/complexity-improve-clean-check.err")
status=$?
set -e
[ "$status" -eq 0 ] \
  || fail "complexity check-baseline should pass after update, got $status: $(cat "$TMP_ROOT/complexity-improve-clean-check.err")"
grep -qF "lint:ratchet:check-baseline OK — 1 current finding(s)." \
  "$TMP_ROOT/complexity-improve-clean-check.err" \
  || fail "complexity check-baseline OK line missing after update: $(cat "$TMP_ROOT/complexity-improve-clean-check.err")"
if grep -qF "current findings are better" "$TMP_ROOT/complexity-improve-clean-check.err"; then
  fail "complexity check-baseline still reported an improvement after update: $(cat "$TMP_ROOT/complexity-improve-clean-check.err")"
fi
if ! (cd "$COMPLEXITY_IMPROVE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/complexity-improve-clean.out" \
      2>"$TMP_ROOT/complexity-improve-clean.err"); then
  cat "$TMP_ROOT/complexity-improve-clean.err"
  fail "complexity default run should pass after improvement update"
fi
assert_envelope "$TMP_ROOT/complexity-improve-clean.out" 0
complexity_after=$(ASSERT_FILE="$COMPLEXITY_IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const item = parsed.tests["ratchet/fixture-core"].items["packages/app/src/example.ts"];
  if (item === undefined) assertionFailed("missing complexity item");
  console.log(item.maxComplexity);
') || fail "complexity improvement baseline reread failed"
[ "$complexity_after" -eq 3 ] \
  || fail "complexity improvement baseline should update to 3, got $complexity_after"
[ "$complexity_before" -gt "$complexity_after" ] \
  || fail "complexity improvement baseline did not shrink: $complexity_before -> $complexity_after"

# --- Fixture: supported third-party rule executes and baselines findings -----
THIRD_PARTY_DIR="$TMP_ROOT/third-party"
build_fixture "$THIRD_PARTY_DIR"
use_fixture_node_modules_with_fake_plugin "$THIRD_PARTY_DIR"
write_clean_source "$THIRD_PARTY_DIR"
write_third_party_config "$THIRD_PARTY_DIR" "always-report" "minimal-ts"
run_fixture_update "$THIRD_PARTY_DIR" \
  || fail "third-party update failed: $(cat "$TMP_ROOT/update.err")"
grep -qF '"ratchet/fixture-third-party"' "$THIRD_PARTY_DIR/lint-ratchet.baseline.json" \
  || fail "third-party baseline missing fixture ratchet"
grep -qF '"count": 1' "$THIRD_PARTY_DIR/lint-ratchet.baseline.json" \
  || fail "third-party baseline missing expected finding count"
if ! (cd "$THIRD_PARTY_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/third-party.out" 2>"$TMP_ROOT/third-party.err"); then
  cat "$TMP_ROOT/third-party.err"
  fail "third-party default run failed after update"
fi
assert_envelope "$TMP_ROOT/third-party.out" 0
THIRD_PARTY_CACHE=$(third_party_cache_files "$THIRD_PARTY_DIR")
[ -n "$THIRD_PARTY_CACHE" ] \
  || fail "minimal-ts third-party ratchet did not create an eslint cache file"

# --- Fixture: type-aware parser profile renders the project-service shape ----
TYPE_AWARE_DIR="$TMP_ROOT/type-aware"
build_fixture "$TYPE_AWARE_DIR"
use_fixture_node_modules_with_fake_plugin "$TYPE_AWARE_DIR"
write_fixture_tsconfig "$TYPE_AWARE_DIR"
write_clean_source "$TYPE_AWARE_DIR"
write_third_party_config "$TYPE_AWARE_DIR" "no-fixture-marker" "type-aware-ts"
run_fixture_update "$TYPE_AWARE_DIR" \
  || fail "type-aware third-party update failed: $(cat "$TMP_ROOT/update.err")"
TYPE_AWARE_CONFIG=$(third_party_config_path "$TYPE_AWARE_DIR")
[ -n "$TYPE_AWARE_CONFIG" ] || fail "type-aware generated config missing"
grep -qF "projectService: true" "$TYPE_AWARE_CONFIG" \
  || fail "type-aware generated config missing projectService"
grep -qF "tsconfigRootDir: \"$TYPE_AWARE_DIR\"" "$TYPE_AWARE_CONFIG" \
  || fail "type-aware generated config missing tsconfigRootDir"
grep -qF '"ratchet/fixture-third-party"' "$TYPE_AWARE_DIR/lint-ratchet.baseline.json" \
  || fail "type-aware baseline missing fixture ratchet"
TYPE_AWARE_CACHE=$(third_party_cache_files "$TYPE_AWARE_DIR")
[ -z "$TYPE_AWARE_CACHE" ] \
  || fail "type-aware ratchet should not create eslint cache files: $TYPE_AWARE_CACHE"
TYPE_AWARE_STALE_CACHE="$TYPE_AWARE_DIR/node_modules/.cache/eslint-ratchet/$(basename "$TYPE_AWARE_CONFIG" .mjs)"
mkdir -p "$TYPE_AWARE_STALE_CACHE"
echo "stale" > "$TYPE_AWARE_STALE_CACHE/.eslintcache"
if ! (cd "$TYPE_AWARE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/type-aware.out" 2>"$TMP_ROOT/type-aware.err"); then
  cat "$TMP_ROOT/type-aware.err"
  fail "type-aware default run failed after update"
fi
assert_envelope "$TMP_ROOT/type-aware.out" 0
[ ! -e "$TYPE_AWARE_STALE_CACHE" ] \
  || fail "type-aware run did not sweep its now-unused eslint cache dir"

# --- Fixture: type-aware cache does not mask imported type changes ----------
TYPE_DEP_DIR="$TMP_ROOT/type-aware-type-dependency"
build_fixture "$TYPE_DEP_DIR"
write_fixture_tsconfig "$TYPE_DEP_DIR"
write_type_dependency_sources "$TYPE_DEP_DIR"
STRICT_BOOLEAN_OPTIONS='[{ allowAny: false, allowNullableBoolean: false, allowNullableEnum: false, allowNullableNumber: false, allowNullableObject: true, allowNullableString: false, allowNumber: true, allowString: true }]'
write_third_party_config "$TYPE_DEP_DIR" "strict-boolean-expressions" "type-aware-ts" \
  "allowlisted" "@typescript-eslint/strict-boolean-expressions" \
  "typescript-eslint" "plugin" "$STRICT_BOOLEAN_OPTIONS" "@typescript-eslint"
run_fixture_update "$TYPE_DEP_DIR" \
  || fail "type-dependency initial update failed: $(cat "$TMP_ROOT/update.err")"
grep -qF '"items": {}' "$TYPE_DEP_DIR/lint-ratchet.baseline.json" \
  || fail "type-dependency baseline should start clean"
cp "$TYPE_DEP_DIR/packages/app/src/consumer.ts" "$TMP_ROOT/type-dependency-consumer.before"
make_type_dependency_schema_nullable "$TYPE_DEP_DIR"
cmp -s "$TMP_ROOT/type-dependency-consumer.before" \
  "$TYPE_DEP_DIR/packages/app/src/consumer.ts" \
  || fail "type-dependency test unexpectedly modified the consumer file"
set +e
(cd "$TYPE_DEP_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/type-dependency.out" 2>"$TMP_ROOT/type-dependency.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "type-dependency default run should catch the unchanged consumer finding, got $status: $(cat "$TMP_ROOT/type-dependency.err")"
assert_envelope "$TMP_ROOT/type-dependency.out" 1
ASSERT_FILE="$TMP_ROOT/type-dependency.out" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const env = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const finding = env.findings[0];
  if (finding.path !== "packages/app/src/consumer.ts") {
    assertionFailed(`expected consumer finding, got ${finding.path}`);
  }
' || fail "type-dependency envelope missing unchanged consumer finding"

# --- Fixture: third-party check/update follows local ratchet semantics -------
THIRD_BASELINE_DIR="$TMP_ROOT/third-party-baseline"
build_fixture "$THIRD_BASELINE_DIR"
use_fixture_node_modules_with_fake_plugin "$THIRD_BASELINE_DIR"
write_clean_source "$THIRD_BASELINE_DIR"
write_third_party_config "$THIRD_BASELINE_DIR" "no-fixture-marker" "minimal-ts"
run_fixture_update "$THIRD_BASELINE_DIR" \
  || fail "third-party baseline initial update failed: $(cat "$TMP_ROOT/update.err")"
write_marker_source "$THIRD_BASELINE_DIR"
set +e
(cd "$THIRD_BASELINE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/third-baseline-check.out" 2>"$TMP_ROOT/third-baseline-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "third-party check-baseline should exit 1, got $status: $(cat "$TMP_ROOT/third-baseline-check.err")"
grep -qF "current findings are worse" "$TMP_ROOT/third-baseline-check.err" \
  || fail "third-party check-baseline stderr missing worse finding note: $(cat "$TMP_ROOT/third-baseline-check.err")"
set +e
(cd "$THIRD_BASELINE_DIR" && bun run scripts/lint-ratchet.ts \
  >"$TMP_ROOT/third-baseline-default.out" 2>"$TMP_ROOT/third-baseline-default.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "third-party default regression should exit 1, got $status: $(cat "$TMP_ROOT/third-baseline-default.err")"
assert_envelope "$TMP_ROOT/third-baseline-default.out" 1
set +e
(cd "$THIRD_BASELINE_DIR" && bun run scripts/lint-ratchet.ts --update \
  >"$TMP_ROOT/third-baseline-refuse.out" 2>"$TMP_ROOT/third-baseline-refuse.err")
status=$?
set -e
[ "$status" -ne 0 ] || fail "third-party update should refuse worse baseline"
if ! (cd "$THIRD_BASELINE_DIR" && bun run scripts/lint-ratchet.ts --update \
      --allow-worse --reason "fixture accepts third-party debt" \
      >"$TMP_ROOT/third-baseline-update.out" 2>"$TMP_ROOT/third-baseline-update.err"); then
  cat "$TMP_ROOT/third-baseline-update.err"
  fail "third-party allow-worse update should write baseline"
fi
grep -qF '"count": 1' "$THIRD_BASELINE_DIR/lint-ratchet.baseline.json" \
  || fail "third-party allow-worse update did not write finding count"

# --- Fixture: third-party generated config and cache path are deterministic --
DETERMINISTIC_CONFIG=$(third_party_config_path "$THIRD_PARTY_DIR")
[ -n "$DETERMINISTIC_CONFIG" ] || fail "third-party deterministic config missing"
cp "$DETERMINISTIC_CONFIG" "$TMP_ROOT/third-party.config.before"
DETERMINISTIC_PATH_BEFORE="$DETERMINISTIC_CONFIG"
if ! (cd "$THIRD_PARTY_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/third-party-deterministic.out" \
      2>"$TMP_ROOT/third-party-deterministic.err"); then
  cat "$TMP_ROOT/third-party-deterministic.err"
  fail "third-party deterministic rerun failed"
fi
DETERMINISTIC_PATH_AFTER=$(third_party_config_path "$THIRD_PARTY_DIR")
[ "$DETERMINISTIC_PATH_BEFORE" = "$DETERMINISTIC_PATH_AFTER" ] \
  || fail "third-party cache key changed between identical runs"
cmp -s "$TMP_ROOT/third-party.config.before" "$DETERMINISTIC_PATH_AFTER" \
  || fail "third-party generated config bytes changed between identical runs"

# --- Fixture: third-party package version participates in cache identity -----
VERSION_PATH_BEFORE="$DETERMINISTIC_PATH_AFTER"
ASSERT_FILE="$THIRD_PARTY_DIR/node_modules/eslint-plugin-ratchet-fixture/package.json" bun -e '
  const fs = require("fs");
  const file = process.env.ASSERT_FILE;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  parsed.version = "1.0.1";
  fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
' || fail "third-party package version mutate failed"
if ! (cd "$THIRD_PARTY_DIR" && bun run scripts/lint-ratchet.ts --update \
      >"$TMP_ROOT/third-party-version.out" \
      2>"$TMP_ROOT/third-party-version.err"); then
  cat "$TMP_ROOT/third-party-version.err"
  fail "third-party package version update failed"
fi
VERSION_PATH_AFTER=$(third_party_config_path "$THIRD_PARTY_DIR")
[ "$VERSION_PATH_BEFORE" != "$VERSION_PATH_AFTER" ] \
  || fail "third-party package version did not change the cache/config path"

# --- Fixture: stale cache siblings get swept on next run --------------------
# Inject fake stale cache + config siblings under the fixture cache layout.
# Sweep must remove the matching stale entries (`<safe-id>-<12hex>`) and leave:
#   - the live entry created by this run (`<safe-id>-<currentHash>`),
#   - an entry for an unrelated ratchet (different safe-id prefix),
#   - an entry whose safe-id is a hyphen-extension of this ratchet's safe-id
#     (`<safe-id>-extended-<12hex>`) — the prefix-collision case.
# Stale entries follow the production naming so the sweeper sees them; the
# prefix-collision and unrelated decoys deliberately use a 12-hex hash so they
# look like real live caches of those (hypothetical) sibling ratchets.
SWEEP_DIR="$TMP_ROOT/sweep"
build_fixture "$SWEEP_DIR"
CACHE_ROOT="$SWEEP_DIR/node_modules/.cache/eslint-ratchet"
CONFIG_ROOT="$CACHE_ROOT/configs"
SAFE_ID="ratchet-local-type-assertion-boundary"
mkdir -p "$CACHE_ROOT" "$CONFIG_ROOT"
# Stale hash for the live ratchet (must look like a 12-hex cache key so the
# sweeper recognizes it as one of its own and removes it).
STALE_HASH="deadbeef1234"
STALE_CACHE="$CACHE_ROOT/$SAFE_ID-$STALE_HASH"
STALE_CONFIG="$CONFIG_ROOT/$SAFE_ID-$STALE_HASH.mjs"
# Hypothetical sibling whose safe-id is a hyphen-extension of the live ratchet.
# Must survive the sweep.
PREFIX_HASH="cafef00d5678"
PREFIX_CACHE="$CACHE_ROOT/$SAFE_ID-extended-$PREFIX_HASH"
PREFIX_CONFIG="$CONFIG_ROOT/$SAFE_ID-extended-$PREFIX_HASH.mjs"
# Unrelated ratchet whose safe-id is a non-prefix. Must survive the sweep.
UNRELATED_HASH="abcdef012345"
UNRELATED_CACHE="$CACHE_ROOT/ratchet-other-rule-$UNRELATED_HASH"
# Register a dedicated trap (additive to the existing TMP_ROOT cleanup) so a
# failed assertion still scrubs the surviving decoys before the root cleanup.
cleanup_sweep_decoys() {
  rm -rf "$STALE_CACHE" "$STALE_CONFIG" "$PREFIX_CACHE" "$PREFIX_CONFIG" "$UNRELATED_CACHE"
}
trap 'cleanup_sweep_decoys; cleanup' EXIT
mkdir -p "$STALE_CACHE" "$PREFIX_CACHE" "$UNRELATED_CACHE"
echo "stale" > "$STALE_CACHE/.eslintcache"
echo "// stale" > "$STALE_CONFIG"
echo "prefix" > "$PREFIX_CACHE/.eslintcache"
echo "// prefix" > "$PREFIX_CONFIG"
echo "unrelated" > "$UNRELATED_CACHE/.eslintcache"
write_type_assertion_config "$SWEEP_DIR"
write_clean_source "$SWEEP_DIR"
run_fixture_update "$SWEEP_DIR" || fail "sweep fixture initial update failed"
[ ! -e "$STALE_CACHE" ] || fail "sweep did not remove stale cache sibling: $STALE_CACHE"
[ ! -e "$STALE_CONFIG" ] || fail "sweep did not remove stale config sibling: $STALE_CONFIG"
[ -d "$PREFIX_CACHE" ] \
  || fail "sweep removed a hyphen-extension sibling's cache: $PREFIX_CACHE"
[ -f "$PREFIX_CONFIG" ] \
  || fail "sweep removed a hyphen-extension sibling's config: $PREFIX_CONFIG"
[ -d "$UNRELATED_CACHE" ] || fail "sweep removed an unrelated ratchet's cache: $UNRELATED_CACHE"
cleanup_sweep_decoys
trap cleanup EXIT

# --- Fixture improvements fail check-baseline with update guidance -----------
IMPROVE_DIR="$TMP_ROOT/improve"
build_fixture "$IMPROVE_DIR"
write_type_assertion_config "$IMPROVE_DIR"
write_violation_source "$IMPROVE_DIR"
run_fixture_update "$IMPROVE_DIR" || fail "fixture improve update failed"
write_clean_source "$IMPROVE_DIR"
set +e
(cd "$IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/improve-check.out" 2>"$TMP_ROOT/improve-check.err")
status=$?
set -e
[ "$status" -eq 1 ] \
  || fail "check-baseline should fail when current findings improve, got $status: $(cat "$TMP_ROOT/improve-check.err")"
grep -qF "finding count decreased from 1 to 0" "$TMP_ROOT/improve-check.err" \
  || fail "improvement detail missing: $(cat "$TMP_ROOT/improve-check.err")"
grep -qF "run bun run lint:ratchet:update" "$TMP_ROOT/improve-check.err" \
  || fail "improvement repair command missing: $(cat "$TMP_ROOT/improve-check.err")"
improve_before=$(ASSERT_FILE="$IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const test = parsed.tests["ratchet/local-type-assertion-boundary"];
  if (test === undefined) assertionFailed("missing type-assertion ratchet");
  const count = Object.values(test.items).reduce((sum, item) => sum + item.count, 0);
  console.log(count);
') || fail "improvement baseline read failed"
[ "$improve_before" -eq 1 ] \
  || fail "improvement baseline should start at 1 finding, got $improve_before"
run_fixture_update "$IMPROVE_DIR" \
  || fail "improvement update did not clear failure: $(cat "$TMP_ROOT/update.err")"
improve_total_after_update=$(ASSERT_FILE="$IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const total = Object.values(parsed.tests).reduce(
    (sum, test) => sum + Object.values(test.items).reduce(
      (itemSum, item) => itemSum + item.count,
      0,
    ),
    0,
  );
  console.log(total);
') || fail "improvement total baseline count read failed"
set +e
(cd "$IMPROVE_DIR" && bun run scripts/lint-ratchet.ts --check-baseline \
  >"$TMP_ROOT/improve-clean-check.out" 2>"$TMP_ROOT/improve-clean-check.err")
status=$?
set -e
[ "$status" -eq 0 ] \
  || fail "check-baseline should pass after improvement update, got $status: $(cat "$TMP_ROOT/improve-clean-check.err")"
grep -qF "lint:ratchet:check-baseline OK — $improve_total_after_update current finding(s)." \
  "$TMP_ROOT/improve-clean-check.err" \
  || fail "check-baseline OK line missing after improvement update: $(cat "$TMP_ROOT/improve-clean-check.err")"
if grep -qF "current findings are better" "$TMP_ROOT/improve-clean-check.err"; then
  fail "check-baseline still reported an improvement after update: $(cat "$TMP_ROOT/improve-clean-check.err")"
fi
if ! (cd "$IMPROVE_DIR" && bun run scripts/lint-ratchet.ts \
      >"$TMP_ROOT/improve-clean.out" 2>"$TMP_ROOT/improve-clean.err"); then
  cat "$TMP_ROOT/improve-clean.err"
  fail "default run should pass after improvement update"
fi
assert_envelope "$TMP_ROOT/improve-clean.out" 0
improve_after=$(ASSERT_FILE="$IMPROVE_DIR/lint-ratchet.baseline.json" bun -e '
  const fs = require("fs");
  const assertionFailed = (message) => { console.error(message); process.exit(1); };
  const parsed = JSON.parse(fs.readFileSync(process.env.ASSERT_FILE, "utf8"));
  const test = parsed.tests["ratchet/local-type-assertion-boundary"];
  if (test === undefined) assertionFailed("missing type-assertion ratchet");
  const count = Object.values(test.items).reduce((sum, item) => sum + item.count, 0);
  console.log(count);
') || fail "improvement baseline reread failed"
[ "$improve_after" -eq 0 ] \
  || fail "improvement baseline should update to 0 findings, got $improve_after"
[ "$improve_before" -gt "$improve_after" ] \
  || fail "improvement baseline did not shrink: $improve_before -> $improve_after"

run_lint_ratchet_edit_check_fixtures

# --- Fixture: ratchet coverage query (--edit-ratchet-coverage) ---------------
# The lint-coverage advisory hook asks this no-ESLint mode which committed
# baseline ratchets track an edited path. It reuses the canonical ratchet glob
# matcher (tools/lint-ratchet/src/kernel/ratchet-globs.ts) instead of the hook embedding
# its own copy: a path matched by a ratchet's files (and not its ignores) returns
# the sorted rule id(s); ignored / unmatched paths and a missing or malformed
# baseline return nothing so the hook degrades to its uncovered behavior.
run_edit_ratchet_coverage() {
  local dir=$1
  shift
  (cd "$dir" && bun run scripts/lint-ratchet.ts --edit-ratchet-coverage "$@" \
    >"$TMP_ROOT/edit-coverage.txt" 2>"$TMP_ROOT/edit-coverage.err") \
    || fail "edit-ratchet-coverage failed: $(cat "$TMP_ROOT/edit-coverage.err")"
}

EDIT_COVERAGE_DIR="$TMP_ROOT/edit-ratchet-coverage"
build_fixture "$EDIT_COVERAGE_DIR"
write_type_assertion_config "$EDIT_COVERAGE_DIR"
write_violation_source "$EDIT_COVERAGE_DIR"
run_fixture_update "$EDIT_COVERAGE_DIR" \
  || fail "edit-ratchet-coverage fixture update failed: $(cat "$TMP_ROOT/update.err")"

# (1) A path matched by the ratchet's files (and not its ignores) returns the
# tracked rule id on a ratchet-covered row.
run_edit_ratchet_coverage "$EDIT_COVERAGE_DIR" "packages/app/src/example.ts"
grep -qF $'ratchet-covered\tpackages/app/src/example.ts\tlocal/type-assertion-boundary' \
  "$TMP_ROOT/edit-coverage.txt" \
  || fail "edit-ratchet-coverage missing covered row: $(cat "$TMP_ROOT/edit-coverage.txt")"

# (2) A path that matches the ratchet's files but also an ignores glob
# (**/generated/**) returns no row.
run_edit_ratchet_coverage "$EDIT_COVERAGE_DIR" "packages/app/src/generated/example.ts"
[ ! -s "$TMP_ROOT/edit-coverage.txt" ] \
  || fail "edit-ratchet-coverage should skip an ignored path: $(cat "$TMP_ROOT/edit-coverage.txt")"

# (3) A path matched by no ratchet returns no row.
run_edit_ratchet_coverage "$EDIT_COVERAGE_DIR" "README.md"
[ ! -s "$TMP_ROOT/edit-coverage.txt" ] \
  || fail "edit-ratchet-coverage should skip an unmatched path: $(cat "$TMP_ROOT/edit-coverage.txt")"

# (4) A multi-path query emits one row per covered path and skips the rest.
run_edit_ratchet_coverage "$EDIT_COVERAGE_DIR" \
  "packages/app/src/example.ts" "packages/app/src/generated/example.ts" "README.md"
[ "$(grep -c '^ratchet-covered' "$TMP_ROOT/edit-coverage.txt")" -eq 1 ] \
  || fail "edit-ratchet-coverage multi-path should emit exactly one covered row: $(cat "$TMP_ROOT/edit-coverage.txt")"

# (5) A malformed baseline degrades to no rows (the advisory stays quiet rather
# than guessing) and the mode still exits 0.
cp "$EDIT_COVERAGE_DIR/lint-ratchet.baseline.json" "$TMP_ROOT/coverage-baseline.bak"
printf '{ not valid json' > "$EDIT_COVERAGE_DIR/lint-ratchet.baseline.json"
run_edit_ratchet_coverage "$EDIT_COVERAGE_DIR" "packages/app/src/example.ts"
[ ! -s "$TMP_ROOT/edit-coverage.txt" ] \
  || fail "edit-ratchet-coverage should emit nothing for a malformed baseline: $(cat "$TMP_ROOT/edit-coverage.txt")"
cp "$TMP_ROOT/coverage-baseline.bak" "$EDIT_COVERAGE_DIR/lint-ratchet.baseline.json"

# (6) A missing baseline also degrades to no rows.
rm -f "$EDIT_COVERAGE_DIR/lint-ratchet.baseline.json"
run_edit_ratchet_coverage "$EDIT_COVERAGE_DIR" "packages/app/src/example.ts"
[ ! -s "$TMP_ROOT/edit-coverage.txt" ] \
  || fail "edit-ratchet-coverage should emit nothing for a missing baseline: $(cat "$TMP_ROOT/edit-coverage.txt")"

echo "PASS: lint-ratchet smoke"
