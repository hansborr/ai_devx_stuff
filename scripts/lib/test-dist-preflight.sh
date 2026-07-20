# shellcheck shell=bash
# Fail-fast staleness preflight for the TEST path.
#
# `@musi/shared`'s exports map resolves every subpath to compiled `./dist/**`
# output, so the projects that import `@musi/shared` (client and server) load the
# BUILT dist, not source.
# A missing-or-stale shared dist (or a generated Prisma client older than
# schema.prisma) presents as dozens of phantom "<X> is not a function" /
# undefined-import failures with no hint that the real cause is an unbuilt
# workspace dep. This preflight mirrors scripts/lib/lint-dist-preflight.sh but
# upgrades the existence-only check to an mtime-based one, and REUSES
# musi_prisma_client_freshness (scripts/prisma-client-freshness.sh) so the
# Prisma staleness rule stays in one place.
#
# It FAILS FAST with an actionable remediation message rather than rebuilding;
# the auto-build variant is an explicit follow-up. The check is gated strictly
# on real mtime-staleness, so the already-built common path is a handful of
# stat calls plus one short-circuiting `find` and adds no measurable time.

# The .js runtime sentinels tests actually import through @musi/shared's
# exports map (one per dist subpath), not the .d.ts files the lint path uses.
MUSI_TEST_DIST_REQUIRED_OUTPUTS=(
  "packages/shared/dist/constants.js"
  "packages/shared/dist/dice/dice-roller.js"
  "packages/shared/dist/map/drawing.js"
  "packages/shared/dist/rules/attack-damage.js"
  "packages/shared/dist/schemas/auth.js"
  "packages/shared/dist/test/parse-helpers.js"
)

musi_test_dist_repo_root() {
  local repo_root="${1:-}"
  if [ -z "$repo_root" ]; then
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  fi
  printf '%s\n' "$repo_root"
}

# Echoes the first required dist sentinel that is missing, else nothing.
musi_test_dist_first_missing() {
  local repo_root output
  repo_root="$(musi_test_dist_repo_root "${1:-}")"
  for output in "${MUSI_TEST_DIST_REQUIRED_OUTPUTS[@]}"; do
    if [ ! -f "$repo_root/$output" ]; then
      printf '%s\n' "$output"
      return 0
    fi
  done
  return 1
}

# `tsc -b`'s incremental build marker. It is rewritten on EVERY build — full or
# incremental — so its mtime is the true "@musi/shared last built at" time. We
# compare src against THIS rather than against a dist .js sentinel: an
# incremental rebuild only rewrites the outputs affected by the edited file, so
# unrelated sentinels keep older mtimes and a src-vs-sentinel comparison would
# keep reporting stale even after a successful rebuild. tsconfig.tsbuildinfo
# advancing on every build clears that false-stale signal.
MUSI_TEST_DIST_TSBUILDINFO="packages/shared/tsconfig.tsbuildinfo"

# Echoes the first compiled shared/src TypeScript file newer than the build
# marker (tsconfig.tsbuildinfo), else nothing. Uses a short-circuiting
# `find -newer ... -quit` so the already-fresh common path stops at the first
# comparison.
musi_test_dist_first_stale_src() {
  local repo_root src_dir tsbuildinfo hit
  repo_root="$(musi_test_dist_repo_root "${1:-}")"
  src_dir="$repo_root/packages/shared/src"
  [ -d "$src_dir" ] || return 1

  # The build marker `tsc -b` rewrites on every build is the authoritative
  # "built at" mark. If it is absent the dist has never been built (or the
  # marker was wiped), so there is no trustworthy timestamp to compare against;
  # treat that as not-stale here and let musi_test_dist_first_missing (which
  # checks the dist .js sentinels) own the "needs build" signal instead. That
  # keeps a marker-less tree out of a confusing stale loop while still failing
  # on a genuinely missing dist.
  tsbuildinfo="$repo_root/$MUSI_TEST_DIST_TSBUILDINFO"
  [ -f "$tsbuildinfo" ] || return 1

  # Only count files `tsc -b` actually compiles as build inputs. @musi/shared's
  # tsconfig uses `include: ["src"]` with no `exclude`, so every TypeScript file
  # under src (regular AND `*.test.ts` — they are emitted to dist and DO bump
  # tsconfig.tsbuildinfo on rebuild) is a real input, while non-TS files
  # (MODULE.md, etc.) are not. A Markdown-only edit never refreshes tsbuildinfo,
  # so without the extension filter an untouched-by-the-build doc would read as
  # stale forever and trap the user in a build-remediation loop. We match the
  # full set tsc compiles and emits — `*.ts`/`*.tsx`/`*.mts`/`*.cts` — not just
  # `*.ts`: src is all `*.ts` today, but a later `*.tsx`/`*.mts`/`*.cts` is a
  # genuine build input the staleness scan must not silently skip (which would
  # let an edited-but-unrebuilt file evade the preflight). An imported `*.json`
  # under resolveJsonModule is also an input, but none exist under src today, so
  # it is left out to avoid flagging non-imported JSON config as stale.
  hit="$(find "$src_dir" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \) -newer "$tsbuildinfo" -print -quit 2>/dev/null)"
  if [ -n "$hit" ]; then
    printf '%s\n' "${hit#"$repo_root/"}"
    return 0
  fi
  return 1
}

# n/a / missing / stale / fresh + TAB + message, mirroring
# musi_prisma_client_freshness. `n/a` is returned for a tree that has no
# @musi/shared workspace at all (sandbox/fixture repos), so callers skip rather
# than treat a non-monorepo as a build failure.
musi_shared_dist_freshness() {
  local repo_root missing stale
  repo_root="$(musi_test_dist_repo_root "${1:-}")"

  if [ ! -d "$repo_root/packages/shared/src" ]; then
    printf "n/a\tno @musi/shared workspace at this root"
    return 0
  fi

  missing="$(musi_test_dist_first_missing "$repo_root")"
  if [ -n "$missing" ]; then
    printf "missing\t@musi/shared dist not built (%s) - run 'bun run --filter @musi/shared build'" "$missing"
    return 0
  fi

  stale="$(musi_test_dist_first_stale_src "$repo_root")"
  if [ -n "$stale" ]; then
    printf "stale\t@musi/shared src newer than dist (%s) - run 'bun run --filter @musi/shared build'" "$stale"
    return 0
  fi

  printf "fresh\t@musi/shared dist up to date"
}

# FAIL-FAST preflight: if either the shared dist or the generated Prisma client
# is missing-or-stale, print an actionable remediation to stderr and return 1
# so the test run aborts before the confusing import-time failures land. A
# fully-fresh tree returns 0 silently (no notice on the common path).
#
# Args:
#   $1  repo root (optional; resolved from git/pwd when empty).
#   $2  includes_server: 1 if the Vitest run includes the @musi/server project
#       (full suite or --project=server), else 0. Only server tests import the
#       generated Prisma client, so the Prisma-client freshness check is gated on
#       this — a stale client cannot abort a focused client/shared/scripts run.
#   $3  includes_shared_consumer: 1 if the run includes a project that imports the
#       BUILT @musi/shared dist (client or server), else 0. Only client and server
#       import `@musi/shared` through its exports map; scripts/eslint-rules tests
#       never do, and @musi/shared's OWN tests import ./src directly (not the
#       dist), so a focused --project=scripts/eslint-rules/shared run must NOT be
#       aborted by a stale dist it never loads.
#   Both $2 and $3 default to 1 so callers that don't pass project context keep
#   the conservative full-coverage behavior.
musi_test_dist_preflight() {
  local repo_root includes_server includes_shared_consumer rc=0 result status message

  repo_root="$(musi_test_dist_repo_root "${1:-}")"
  includes_server="${2:-1}"
  includes_shared_consumer="${3:-1}"

  # Opt-out and not-a-monorepo guards: this preflight only applies to the real
  # @musi/shared workspace (whose dist the tests import). A tree without
  # packages/shared/src is a sandbox/fixture repo, so no-op silently.
  [ "${MUSI_SKIP_TEST_DIST_PREFLIGHT:-0}" != 1 ] || return 0
  [ -d "$repo_root/packages/shared/src" ] || return 0

  # The @musi/shared dist check only matters when the run includes a project that
  # imports the BUILT shared dist (client or server). A focused scripts/eslint-
  # rules/shared run never loads the dist, so skip it there rather than abort on a
  # stale dist it never imports.
  if [ "$includes_shared_consumer" = 1 ]; then
    result="$(musi_shared_dist_freshness "$repo_root")"
    status="${result%%$'\t'*}"
    message="${result#*$'\t'}"
    case "$status" in
      missing | stale)
        printf 'test: %s\n' "$message" >&2
        rc=1
        ;;
    esac
  fi

  # Only server tests import the generated Prisma client; skip its freshness
  # check for client/shared/scripts/eslint-rules-only runs so a stale client
  # there does not abort a project that never touches it.
  if [ "$includes_server" = 1 ]; then
    result="$(musi_prisma_client_freshness "$repo_root")"
    status="${result%%$'\t'*}"
    message="${result#*$'\t'}"
    case "$status" in
      missing | stale)
        printf 'test: %s\n' "$message" >&2
        rc=1
        ;;
    esac
  fi

  if [ "$rc" -ne 0 ]; then
    printf 'test: a stale or unbuilt workspace dep would surface as phantom "<X> is not a function" failures; build it (above) before re-running tests.\n' >&2
  fi
  return "$rc"
}

# Classifies a single --project filter VALUE: echoes the project name when it
# is one of the known projects, "ALL" when it is a wildcard/negation pattern we
# cannot resolve here (so the caller stays conservative and keeps every gate
# on), or nothing for an unrecognized exact name (matches no gate).
musi_test_dist_classify_project_name() {
  case "$1" in
    *'*'* | '!'*) printf 'ALL\n' ;;
    server | server-unit | client | shared | scripts | eslint-rules) printf "%s\n" "$1" ;;
  esac
}

# Classifies a positional file-path filter: echoes the project whose directory
# contains the path, or "ALL" when the path is not under a recognized project
# root (a bare name filter or an unknown path -- cannot infer, stay
# conservative).
musi_test_dist_classify_path() {
  case "$1" in
    # src/seed/** tests run in the DB-free `server-unit` project (the `server`
    # project excludes them), so they must not force the Prisma-freshness gate.
    packages/server/src/seed/*) printf 'server-unit\n' ;;
    packages/server/* | packages/server) printf 'server\n' ;;
    packages/client/* | packages/client) printf 'client\n' ;;
    packages/shared/* | packages/shared) printf 'shared\n' ;;
    scripts/* | scripts) printf 'scripts\n' ;;
    eslint-rules/* | eslint-rules) printf 'eslint-rules\n' ;;
    *) printf 'ALL\n' ;;
  esac
}

# Resolves a Vitest argv to the set of projects it will run, echoing the
# sentinel "ALL" when the run is full-suite or its scope cannot be determined
# exactly (no filter at all, an unrecognized positional path, or a
# wildcard/negation --project pattern) so callers conservatively keep every
# freshness gate active. Scope comes from --project flags when ANY is present;
# positional file-path filters are consulted ONLY when no --project flag is
# given -- mirroring Vitest, where with --project the positionals are filename
# filters WITHIN the chosen projects, not additional project selectors.
musi_test_dist_project_scope() {
  local arg mapped expect_value=0
  local saw_project=0 project_scope="" project_conservative=0
  local saw_positional=0 path_scope="" path_conservative=0
  for arg in "$@"; do
    if [ "$expect_value" = 1 ]; then
      expect_value=0
      saw_project=1
      mapped="$(musi_test_dist_classify_project_name "$arg")"
      if [ "$mapped" = ALL ]; then
        project_conservative=1
      elif [ -n "$mapped" ]; then
        project_scope="$project_scope $mapped"
      fi
      continue
    fi
    case "$arg" in
      --project=*)
        saw_project=1
        mapped="$(musi_test_dist_classify_project_name "${arg#--project=}")"
        if [ "$mapped" = ALL ]; then
          project_conservative=1
        elif [ -n "$mapped" ]; then
          project_scope="$project_scope $mapped"
        fi
        ;;
      --project)
        expect_value=1
        ;;
      run | -*)
        : # subcommand or unrelated flag -- never a project/path filter
        ;;
      *)
        saw_positional=1
        mapped="$(musi_test_dist_classify_path "$arg")"
        if [ "$mapped" = ALL ]; then
          path_conservative=1
        elif [ -n "$mapped" ]; then
          path_scope="$path_scope $mapped"
        fi
        ;;
    esac
  done

  # --project present: scope is exactly the --project set (positionals are
  # intra-project filters). Any wildcard/negation pattern forces conservative
  # ALL.
  if [ "$saw_project" = 1 ]; then
    if [ "$project_conservative" = 1 ]; then
      printf 'ALL\n'
    else
      printf "%s\n" "$project_scope"
    fi
    return 0
  fi

  # No --project: infer scope from positional paths. No positionals => full
  # suite. An unrecognized positional path forces conservative ALL.
  if [ "$saw_positional" = 0 ] || [ "$path_conservative" = 1 ]; then
    printf 'ALL\n'
  else
    printf "%s\n" "$path_scope"
  fi
}

# Echoes 1 if a Vitest argv runs any project in the space-separated <projects>
# target set, OR runs a scope we keep conservatively (the "ALL" sentinel from
# musi_test_dist_project_scope: full suite, unknown positional, or wildcard
# --project), else 0. Shared engine for the two public gates below.
musi_test_dist_run_includes() {
  local targets="$1"
  shift
  local scope project
  scope="$(musi_test_dist_project_scope "$@")"
  if [ "$scope" = ALL ]; then
    printf '1\n'
    return 0
  fi
  for project in $scope; do
    case " $targets " in
      *" $project "*)
        printf '1\n'
        return 0
        ;;
    esac
  done
  printf '0\n'
}

# Echoes 1 if a Vitest argv includes the @musi/server project, else 0. Server is
# included when NO project filter is present (full suite runs every project,
# server among them) OR when an explicit --project=server (or --project server)
# is passed. When no --project is present, scope is inferred from any positional
# file paths, so a positional under packages/server also counts. A run that
# filters to other projects only (client/shared/scripts/eslint-rules) returns 0.
musi_test_dist_run_includes_server() {
  musi_test_dist_run_includes "server" "$@"
}

# Echoes 1 if a Vitest argv includes a project that imports the BUILT @musi/shared
# dist (client or server), else 0. Mirrors musi_test_dist_run_includes_server: a
# shared-dist consumer is in the run when NO project filter is present (full
# suite) OR an explicit --project=client/server is passed. When no --project is
# present, scope is inferred from any positional file paths, so a positional
# under packages/client or packages/server also counts. A run filtered to only
# non-consumers (scripts/eslint-rules/shared — the shared project's own tests
# import ./src directly, not the dist) returns 0. The DB-free server-unit
# project's seed tests also import the built shared dist, so it is a consumer;
# it is NOT in the server (Prisma freshness) target set because its only
# generated-client imports are type-only and erased at runtime.
musi_test_dist_run_includes_shared_consumer() {
  musi_test_dist_run_includes "client server server-unit" "$@"
}
