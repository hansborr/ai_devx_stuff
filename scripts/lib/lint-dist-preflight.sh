# shellcheck shell=bash
# Shared preflight for lint wrappers that run type-aware ESLint. The client and
# server lint surfaces resolve workspace package exports from TypeScript build
# outputs, so a fresh checkout needs those ignored outputs before ESLint.

MUSI_LINT_DIST_REQUIRED_OUTPUTS=(
  "packages/shared/dist/constants.d.ts"
  "packages/shared/dist/logging-policy.d.ts"
  "packages/shared/dist/dice/dice-roller.d.ts"
  "packages/shared/dist/map/drawing.d.ts"
  "packages/shared/dist/rules/attack-damage.d.ts"
  "packages/shared/dist/schemas/auth.d.ts"
  "packages/shared/dist/test/parse-helpers.d.ts"
  "packages/server/dist/routers/app-router.d.ts"
)

musi_lint_dist_repo_root() {
  local repo_root="${1:-}"
  if [ -z "$repo_root" ]; then
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  fi
  printf '%s\n' "$repo_root"
}

musi_lint_dist_collect_missing() {
  local repo_root output
  repo_root="$(musi_lint_dist_repo_root "${1:-}")"
  MUSI_LINT_DIST_MISSING_OUTPUTS=()

  for output in "${MUSI_LINT_DIST_REQUIRED_OUTPUTS[@]}"; do
    [ -f "$repo_root/$output" ] || MUSI_LINT_DIST_MISSING_OUTPUTS+=("$output")
  done

  [ "${#MUSI_LINT_DIST_MISSING_OUTPUTS[@]}" -eq 0 ]
}

musi_lint_dist_outputs_present() {
  musi_lint_dist_collect_missing "${1:-}"
}

musi_lint_dist_print_missing() {
  local output
  for output in "${MUSI_LINT_DIST_MISSING_OUTPUTS[@]}"; do
    printf '  - %s\n' "$output"
  done
}

musi_lint_dist_print_missing_outputs_detail() {
  {
    printf 'lint: ESLint projectService resolves workspace package exports from packages/{shared,server}/dist.\n'
    printf 'lint: missing required output(s):\n'
    musi_lint_dist_print_missing
  } >&2
}

musi_lint_dist_print_preflight_diagnostic() {
  printf 'lint: TypeScript build output is missing; running `bun run typecheck` before ESLint.\n' >&2
  musi_lint_dist_print_missing_outputs_detail
}

musi_lint_dist_print_require_outputs_diagnostic() {
  printf 'lint: TypeScript build output is missing.\n' >&2
  musi_lint_dist_print_missing_outputs_detail
}

musi_lint_dist_print_post_typecheck_remedy() {
  printf 'lint: compare each missing path with the owning package tsconfig `outDir`, `declaration`, `composite`, and project references; update the tsconfig or this preflight list if build outputs moved.\n' >&2
}

musi_lint_dist_require_outputs() {
  local repo_root consumer
  repo_root="$(musi_lint_dist_repo_root "${1:-}")"
  consumer="${2:-lint}"

  if musi_lint_dist_outputs_present "$repo_root"; then
    return 0
  fi

  # Reporting-only path for lint:fix: ESLint --fix mutates files, so keep it
  # from silently running a build first. Parity decision recorded in the
  # closed lint-fix-dist-preflight-parity backlog note (removed 2026-07-19;
  # git history).
  musi_lint_dist_print_require_outputs_diagnostic
  printf 'lint: run `bun run typecheck` before %s.\n' "$consumer" >&2
  return 1
}

musi_lint_dist_preflight() {
  local repo_root typecheck_rc
  repo_root="$(musi_lint_dist_repo_root "${1:-}")"

  if musi_lint_dist_outputs_present "$repo_root"; then
    return 0
  fi

  musi_lint_dist_print_preflight_diagnostic

  typecheck_rc=0
  ( cd "$repo_root" && bun run typecheck ) || typecheck_rc=$?
  if [ "$typecheck_rc" -ne 0 ]; then
    printf 'lint: `bun run typecheck` failed; fix typecheck before lint.\n' >&2
    return "$typecheck_rc"
  fi

  if musi_lint_dist_outputs_present "$repo_root"; then
    return 0
  fi

  {
    printf 'lint: `bun run typecheck` completed, but required build output is still missing.\n'
    printf 'lint: missing required output(s):\n'
    musi_lint_dist_print_missing
  } >&2
  musi_lint_dist_print_post_typecheck_remedy
  return 1
}
