#!/usr/bin/env bash
# doctor: aggregated developer diagnostic. Streams `worktree:status` and
# `db:status` output as-is (do not reimplement their checks; DX1.3),
# then layers cross-cutting checks those commands cannot answer:
# env-file sanity, port binding, dependency freshness, lint-suppression drift.
# Read-only —
# never mutates state. Emits PASS/WARN/FAIL lines with exact follow-up
# commands and a final summary; exits 1 only when at least one FAIL
# was tallied.
#
# With --json, suppresses the prose stream and emits a harness-diagnostics
# envelope on stdout. One finding per WARN/FAIL/BLOCK line, tagged with the
# section's harness.controls.json id. PASS lines emit no finding. Exit code
# semantics are unchanged (1 iff any FAIL was tallied).
set -uo pipefail

JSON_MODE=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      cat <<'EOF'
usage: doctor.sh [--json]

Default: human-readable PASS/WARN/FAIL report streaming each sub-check.
--json:  emit a harness-diagnostics envelope on stdout; one finding per
         WARN/FAIL/BLOCK line tagged with the section's harness.controls.json
         id. Suppresses prose output. Exit code semantics are unchanged.
EOF
      exit 0
      ;;
    --json)
      JSON_MODE=1
      ;;
    *)
      printf 'doctor: unknown argument: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'FAIL: not inside a git repository\n' >&2
  exit 1
}
PRIMARY_ROOT="$(cd "$(git rev-parse --git-common-dir)/.." && pwd -P)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
. "$SCRIPT_DIR/dependency-freshness.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/prisma-client-freshness.sh"
# shellcheck source=/dev/null
. "$SCRIPT_DIR/lib/test-dist-preflight.sh"

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

# --- JSON-mode plumbing -------------------------------------------------------
# CURRENT_CONTROL is the harness.controls.json id that a section's findings
# should be tagged with. CURRENT_HINT is the default howToFix string. Both are
# only consulted when JSON_MODE=1; the prose path ignores them. Sections set
# them at entry and clear at exit so a downstream note_* call cannot leak
# findings into a neighbouring section's control id.
CURRENT_CONTROL=""
CURRENT_HINT=""
DOCTOR_FINDINGS_NDJSON=""
DOCTOR_HARNESS_CHECK_FAILED=0

if (( JSON_MODE )); then
  if ! command -v jq >/dev/null 2>&1; then
    printf 'FAIL: jq is required for --json mode but is not installed\n' >&2
    exit 1
  fi
  DOCTOR_FINDINGS_NDJSON="$(mktemp)"
  # shellcheck disable=SC2064  # expand DOCTOR_FINDINGS_NDJSON at trap-install time, not on signal.
  trap "rm -f '$DOCTOR_FINDINGS_NDJSON'" EXIT
fi

# Append a single harness-diagnostics finding to DOCTOR_FINDINGS_NDJSON.
# args: control severity messageId why howToFix [path] [line]
emit_finding() {
  [[ "$JSON_MODE" -eq 1 ]] || return 0
  local control="$1" severity="$2" messageId="$3" why="$4" howToFix="$5"
  local path="${6:-}" line="${7:-}"
  if [[ -n "$line" ]] && ! [[ "$line" =~ ^[0-9]+$ ]]; then
    printf 'doctor: emit_finding non-numeric line %q\n' "$line" >&2
    return 1
  fi
  local jq_rc=0
  if [[ -n "$path" && -n "$line" ]]; then
    jq -nc \
      --arg control "$control" --arg severity "$severity" \
      --arg messageId "$messageId" --arg why "$why" --arg howToFix "$howToFix" \
      --arg path "$path" --argjson line "$line" \
      '{control:$control,severity:$severity,path:$path,line:$line,messageId:$messageId,why:$why,howToFix:$howToFix,repairKind:"manual"}' \
      >> "$DOCTOR_FINDINGS_NDJSON" || jq_rc=$?
  elif [[ -n "$path" ]]; then
    jq -nc \
      --arg control "$control" --arg severity "$severity" \
      --arg messageId "$messageId" --arg why "$why" --arg howToFix "$howToFix" \
      --arg path "$path" \
      '{control:$control,severity:$severity,path:$path,messageId:$messageId,why:$why,howToFix:$howToFix,repairKind:"manual"}' \
      >> "$DOCTOR_FINDINGS_NDJSON" || jq_rc=$?
  else
    jq -nc \
      --arg control "$control" --arg severity "$severity" \
      --arg messageId "$messageId" --arg why "$why" --arg howToFix "$howToFix" \
      '{control:$control,severity:$severity,messageId:$messageId,why:$why,howToFix:$howToFix,repairKind:"manual"}' \
      >> "$DOCTOR_FINDINGS_NDJSON" || jq_rc=$?
  fi
  if (( jq_rc != 0 )); then
    printf 'doctor: emit_finding jq failed (rc=%d) for control=%q severity=%q messageId=%q\n' \
      "$jq_rc" "$control" "$severity" "$messageId" >&2
    return "$jq_rc"
  fi
}

# Slugify a section title for use in messageId fields. Lowercases, replaces
# any run of non-[a-z0-9] with a single '-', and trims surrounding '-'.
slugify_title() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'
}

prose_print() { (( JSON_MODE )) && return 0; printf '%s\n' "$*"; }
prose_print_err() { (( JSON_MODE )) && return 0; printf '%s\n' "$*" >&2; }

note_pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  prose_print "PASS: $*"
}
note_warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  prose_print_err "WARN: $*"
  if (( JSON_MODE )) && [[ -n "$CURRENT_CONTROL" ]]; then
    emit_finding "$CURRENT_CONTROL" warn "${CURRENT_CONTROL##*/}-warn-$WARN_COUNT" \
      "$*" "${CURRENT_HINT:-See doctor output for context.}"
  fi
}
note_fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  prose_print_err "FAIL: $*"
  if (( JSON_MODE )) && [[ -n "$CURRENT_CONTROL" ]]; then
    emit_finding "$CURRENT_CONTROL" block "${CURRENT_CONTROL##*/}-fail-$FAIL_COUNT" \
      "$*" "${CURRENT_HINT:-See doctor output for context.}"
  fi
}

# Maps a `status<TAB>message` freshness result (the shared contract of the
# musi_*_freshness helpers) to the matching note_* call: fresh -> pass,
# missing -> fail, stale/warn -> warn, anything else -> warn as an unknown
# state. $1 is the raw result; $2 is a short noun for the unknown-state
# diagnostic (e.g. "dependency", "shared dist", "Prisma client").
note_freshness_result() {
  local result="$1" noun="$2" status message
  status="${result%%$'\t'*}"
  message="${result#*$'\t'}"
  case "$status" in
    fresh) note_pass "$message" ;;
    missing) note_fail "$message" ;;
    stale | warn) note_warn "$message" ;;
    *) note_warn "unknown $noun freshness state: $message" ;;
  esac
}

# Emit one harness-diagnostics finding per WARN/FAIL/BLOCK line in $tmp,
# tagged with CURRENT_CONTROL. Used by the run_*_subcommand helpers in
# JSON mode so each tally line also becomes a structured finding. PASS
# lines produce no findings (the envelope is an actionable surface; clean
# sub-checks contribute zero findings).
# BLOCK is report-only and surfaces as warn; FAIL is the only gating/block
# severity because only FAIL_COUNT controls doctor's exit status.
#
# messageId scheme: `<slug>-<severity>-<n>` where slug is the section title
# (per-section unique) and n resets per section. This differs from
# note_warn/note_fail above which use the global $WARN_COUNT/$FAIL_COUNT
# counter — both schemes are safe because section slugs do not collide and
# severity is part of the key. Do NOT unify them without re-checking that
# the merged scheme remains collision-free across all call sites.
emit_findings_from_capture() {
  local tmp="$1" control="$2" hint="$3" slug="$4"
  local n=0 line msg severity
  while IFS= read -r line; do
    case "$line" in
      WARN:*) msg="${line#WARN: }"; severity=warn ;;
      BLOCK:*) msg="${line#BLOCK: }"; severity=warn ;;
      FAIL:*) msg="${line#FAIL: }"; severity=block ;;
      *) continue ;;
    esac
    n=$((n + 1))
    emit_finding "$control" "$severity" "$slug-$severity-$n" "$msg" "$hint"
  done < <(grep -E '^(WARN|BLOCK|FAIL):' "$tmp" 2>/dev/null || true)
}

# Stream a subcommand's output, then tally PASS/OK/WARN/BLOCK/FAIL lines.
# In default mode the subcommand's output is tee'd live to the terminal; in
# JSON mode it is captured silently. If the subcommand exits non-zero without
# printing FAIL, synthesise one so a silent failure doesn't slip through.
# args: title hint control_id cmd...
run_subcommand() {
  local title="$1" hint="$2" control="$3"
  shift 3
  CURRENT_CONTROL="$control"
  CURRENT_HINT="$hint"
  prose_print ""
  prose_print "=== $title ==="
  local tmp
  tmp="$(mktemp)"
  local rc
  if (( JSON_MODE )); then
    "$@" >"$tmp" 2>&1
    rc=$?
  else
    "$@" 2>&1 | tee "$tmp"
    rc=${PIPESTATUS[0]}
  fi
  local pa wa fa
  pa=$(grep -cE '^(PASS:|OK[[:space:]]*:)' "$tmp" 2>/dev/null) || true
  # `BLOCK:` is the sensor-blob-size report-only prefix. Count it alongside
  # WARN so doctor's summary reflects the finding while still exiting 0.
  wa=$(grep -cE '^(WARN|BLOCK):'            "$tmp" 2>/dev/null) || true
  fa=$(grep -cE '^FAIL:'                    "$tmp" 2>/dev/null) || true
  PASS_COUNT=$((PASS_COUNT + ${pa:-0}))
  WARN_COUNT=$((WARN_COUNT + ${wa:-0}))
  FAIL_COUNT=$((FAIL_COUNT + ${fa:-0}))
  if (( JSON_MODE )); then
    emit_findings_from_capture "$tmp" "$control" "$hint" "$(slugify_title "$title")"
  fi
  rm -f "$tmp"
  if [[ $rc -ne 0 && ${fa:-0} -eq 0 ]]; then
    note_fail "$title exited $rc — $hint"
  fi
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

# args: title hint control_id cmd...
run_report_subcommand() {
  local title="$1" hint="$2" control="$3"
  shift 3
  CURRENT_CONTROL="$control"
  CURRENT_HINT="$hint"
  prose_print ""
  prose_print "=== $title ==="
  local rc
  if (( JSON_MODE )); then
    (cd "$REPO_ROOT" && "$@") >/dev/null 2>&1
    rc=$?
  else
    (cd "$REPO_ROOT" && "$@") 2>&1
    rc=$?
  fi
  if [[ $rc -eq 0 ]]; then
    note_pass "$title completed without reported findings"
  else
    note_warn "$title exited $rc (report-only) — $hint"
  fi
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

# args: title hint control_id cmd...
run_drift_report_subcommand() {
  local title="$1" hint="$2" control="$3"
  shift 3
  CURRENT_CONTROL="$control"
  CURRENT_HINT="$hint"
  prose_print ""
  prose_print "=== $title ==="
  local tmp
  tmp="$(mktemp)"
  local rc
  if (( JSON_MODE )); then
    (cd "$REPO_ROOT" && "$@") >"$tmp" 2>&1
    rc=$?
  else
    (cd "$REPO_ROOT" && "$@") 2>&1 | tee "$tmp"
    rc=${PIPESTATUS[0]}
  fi
  local drift_warns
  drift_warns=$(grep -cE '^WARN [^:]+:' "$tmp" 2>/dev/null) || true
  if (( JSON_MODE )); then
    if [[ $rc -eq 0 ]] && [[ ${drift_warns:-0} -gt 0 ]]; then
      # Drift output uses `WARN <name>:` (no colon after WARN) — capture each
      # as its own finding under this section's control so a consumer can act
      # on individual entries rather than a single aggregated count.
      local n=0 line
      while IFS= read -r line; do
        n=$((n + 1))
        emit_finding "$control" warn "$(slugify_title "$title")-warn-$n" \
          "${line#WARN }" "$hint"
      done < <(grep -E '^WARN [^:]+:' "$tmp" 2>/dev/null || true)
    fi
  fi
  rm -f "$tmp"
  if [[ $rc -ne 0 ]]; then
    note_warn "$title exited $rc (report-only) — $hint"
  elif [[ ${drift_warns:-0} -gt 0 ]]; then
    # In JSON mode the per-finding emit_finding calls above already covered
    # each drift line; the bookkeeping note_warn would double-count. Increment
    # the tally directly so PASS_COUNT/WARN_COUNT match the live state.
    if (( JSON_MODE )); then
      WARN_COUNT=$((WARN_COUNT + drift_warns))
    else
      note_warn "$title reported ${drift_warns:-0} finding(s) — $hint"
    fi
  else
    note_pass "$title completed without reported findings"
  fi
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

# Special case for migration safety in JSON mode: invoke the scanner with its
# own --json contract and merge each emitted finding into our NDJSON. This
# preserves path/line precision that prose-line parsing would lose. In default
# mode falls back to run_subcommand for the streamed prose view.
run_migration_safety() {
  local title="$1" hint="$2" control="$3"
  if (( JSON_MODE )); then
    CURRENT_CONTROL="$control"
    CURRENT_HINT="$hint"
    local tmp; tmp="$(mktemp)"
    bash "$REPO_ROOT/scripts/migration-safety-scan.sh" --json >"$tmp" 2>/dev/null
    local rc=$?
    if [[ $rc -ne 0 ]]; then
      rm -f "$tmp"
      note_fail "$title exited $rc — $hint"
      CURRENT_CONTROL=""; CURRENT_HINT=""
      return
    fi
    # Pull each finding out of the envelope and append it as a single NDJSON
    # line. jq's `-c` produces one JSON value per line; redirection appends.
    if ! jq -c '.findings[]' <"$tmp" >>"$DOCTOR_FINDINGS_NDJSON" 2>/dev/null; then
      rm -f "$tmp"
      note_fail "$title --json output could not be parsed — $hint"
      CURRENT_CONTROL=""; CURRENT_HINT=""
      return
    fi
    # Update the tally to reflect the merged findings. Route block-severity
    # findings to FAIL_COUNT so they gate doctor's exit code (otherwise a
    # destructive migration with `severity:block` would not flip exit 1).
    # Warn-severity → WARN_COUNT; info-severity is informational only, so it
    # does not contribute to either tally (matches default-mode `run_subcommand`,
    # which never counted scanner `INFO:` lines).
    local blocks warns
    blocks=$(jq '.summary.blocking // 0' <"$tmp")
    warns=$(jq '.summary.warning  // 0' <"$tmp")
    FAIL_COUNT=$((FAIL_COUNT + blocks))
    WARN_COUNT=$((WARN_COUNT + warns))
    rm -f "$tmp"
    CURRENT_CONTROL=""; CURRENT_HINT=""
    return
  fi
  run_subcommand "$title" "$hint" "$control" \
    bash "$REPO_ROOT/scripts/migration-safety-scan.sh"
}

# harness:check has no dedicated registered control (the manifest IS the
# inventory it verifies). In JSON mode, surface failures under doctor's own
# registered wrapper control so consumers see the blocking signal in the
# envelope, while the captured harness output still explains the underlying
# manifest drift.
#
# Invoke the validator by its absolute module path (anchored at $SCRIPT_DIR)
# rather than `bun run harness:check`: `bun run <name>` resolves the script
# against the nearest package.json walking up, so a nested-cwd launch (e.g. from
# a `@musi/*` package subdir like packages/client/src) errors `Script not found
# "harness:check"`. The module-path form resolves from any cwd; the script body
# self-locates the repo root once started. Mirrors the $SCRIPT_DIR-anchored
# emitter call below.
HARNESS_CHECK_MODULE="$SCRIPT_DIR/harness-check.ts"
run_harness_check() {
  local title="$1" hint="$2" control="$3"
  if (( JSON_MODE )); then
    local tmp finding_control output
    tmp="$(mktemp)"
    if ! bun run "$HARNESS_CHECK_MODULE" >"$tmp" 2>&1; then
      DOCTOR_HARNESS_CHECK_FAILED=1
      FAIL_COUNT=$((FAIL_COUNT + 1))
      finding_control="${control:-verify-wrapper/doctor}"
      output="$(cat "$tmp")"
      if [[ -z "$output" ]]; then
        output="harness:check exited non-zero without output."
      fi
      emit_finding "$finding_control" block "harness-check-failed" \
        "harness:check failed during doctor --json: $output" \
        "$hint"
    fi
    rm -f "$tmp"
    return
  fi
  run_subcommand "$title" "$hint" "$control" bun run "$HARNESS_CHECK_MODULE"
}

# --- Aggregated existing diagnostics (DX1.1, DX1.2) ---------------------------

run_subcommand "worktree:status" \
  "review output above; common fixes: 'bun run worktree:init' (provision per-worktree DBs/ports/env) or check Postgres connectivity" \
  "sensor/worktree-status" \
  bash "$REPO_ROOT/scripts/worktree-db.sh" status

run_subcommand "db:status" \
  "review output above; common fixes: 'bun run --filter @musi/server db:migrate' (apply migrations) or check Postgres connectivity" \
  "sensor/db-status" \
  bash "$REPO_ROOT/scripts/db-status.sh"

# --- env-file sanity ----------------------------------------------------------
# `.devcontainer/.env` lives in the primary worktree only. Per-worktree
# `.env` and `packages/client/.env` are written by `worktree:init` for
# secondaries; primaries normally rely on devcontainer creds.

env_get() {
  # Read KEY=VALUE from a file without sourcing it (avoids running shell
  # in env files we don't control). Picks the first match; trims wrapping
  # quotes. Empty stdout = key absent.
  local key="$1" file="$2"
  [[ -f "$file" ]] || return 0
  awk -v k="$key" '
    BEGIN { FS = "=" }
    $1 == k {
      sub("^" k "=", "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
      exit
    }
  ' "$file"
}

check_env_files() {
  CURRENT_CONTROL="doctor-check/env-files"
  CURRENT_HINT="Restore the missing env file with 'bun run worktree:init' (secondaries) or copy/regenerate it under .devcontainer/.env (primary)."
  prose_print ""
  prose_print "=== env-file sanity ==="
  local primary_env="$PRIMARY_ROOT/.devcontainer/.env"
  if [[ -f "$primary_env" ]]; then
    note_pass "found $primary_env (admin DB credentials)"
  else
    note_warn "missing $primary_env — admin DB ops (worktree provisioning) will fail"
  fi

  local is_secondary=0
  [[ "$REPO_ROOT" != "$PRIMARY_ROOT" ]] && is_secondary=1

  local root_env="$REPO_ROOT/.env"
  # Secondaries require a populated .env (worktree:init writes it). Primary
  # may legitimately have no .env or a partial one — DB/port keys fall back
  # to .devcontainer/.env and code defaults — so we only validate keys when
  # the secondary is supposed to own them.
  if (( is_secondary )); then
    if [[ -f "$root_env" ]]; then
      note_pass "found $root_env"
      local missing=() key
      for key in DATABASE_URL REDIS_URL SERVER_PORT CORS_ORIGIN; do
        if [[ -z "$(env_get "$key" "$root_env")" ]]; then
          missing+=("$key")
        fi
      done
      if (( ${#missing[@]} > 0 )); then
        note_warn "$root_env missing keys: ${missing[*]} — run 'bun run worktree:init' to regenerate"
      fi
    else
      note_fail "missing $root_env — run 'bun run worktree:init' to provision this worktree"
    fi
  else
    if [[ -f "$root_env" ]]; then
      note_pass "found $root_env (primary worktree)"
    else
      note_pass "no $root_env (primary worktree falls back to .devcontainer/.env)"
    fi
  fi

  # Live env (set by docker-compose `env_file` in the devcontainer) is the
  # authoritative source for the running server. `worktree:init` does not
  # propagate JWT_SECRET into the per-worktree `.env`, so on a secondary the
  # only places it can come from are the live env or the primary devcontainer
  # `.env`.
  if [[ -n "${JWT_SECRET:-}" ]]; then
    note_pass "JWT_SECRET configured (live env)"
  elif [[ -n "$(env_get JWT_SECRET "$root_env")" \
       || -n "$(env_get JWT_SECRET "$primary_env")" ]]; then
    note_pass "JWT_SECRET configured (env file)"
  else
    note_warn "JWT_SECRET not set in env or $root_env or $primary_env — generate with 'openssl rand -base64 48' and add to .devcontainer/.env (then restart the devcontainer)"
  fi

  local client_env="$REPO_ROOT/packages/client/.env"
  if [[ -f "$client_env" ]]; then
    note_pass "found $client_env"
  elif (( is_secondary )); then
    note_warn "missing $client_env — run 'bun run worktree:init' to regenerate"
  fi
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

# --- port binding -------------------------------------------------------------
# Best-effort check: parse SERVER_PORT and the client port (from
# CORS_ORIGIN) out of the worktree's .env, then ask `ss` whether they
# are bound. A port being bound is most often the contributor's own
# `bun run dev` already running — that's the common workflow when
# someone runs doctor — so a bound port is reported as PASS with a
# disambiguation hint, not a WARN that pollutes the summary.

port_in_use() {
  local port="$1"
  ss -tlnH "sport = :$port" 2>/dev/null | grep -q LISTEN
}

check_port_binding() {
  CURRENT_CONTROL="doctor-check/port-binding"
  CURRENT_HINT="If a port is bound and it isn't your own dev server, run 'ss -tlnp sport = :<port>' to identify the process."
  prose_print ""
  prose_print "=== port binding ==="
  if ! command -v ss >/dev/null 2>&1; then
    note_warn "ss not available — skipping port-binding check"
    CURRENT_CONTROL=""; CURRENT_HINT=""
    return 0
  fi
  local root_env="$REPO_ROOT/.env"
  local server_port="" cors_origin="" client_port=""
  if [[ -f "$root_env" ]]; then
    server_port="$(env_get SERVER_PORT "$root_env")"
    cors_origin="$(env_get CORS_ORIGIN "$root_env")"
    if [[ -n "$cors_origin" ]]; then
      # Pull the trailing :PORT out of the URL; tolerate no port present.
      client_port="$(printf '%s' "$cors_origin" | sed -nE 's|.*://[^/]*:([0-9]+).*|\1|p')"
    fi
  fi

  if [[ -z "$server_port" && -z "$client_port" ]]; then
    # No worktree-specific port assignment: primary worktrees rely on code
    # defaults (server 8001, client 8000) and binding behavior is
    # uninteresting until they're explicitly configured.
    note_pass "no worktree-specific ports configured (primary defaults apply)"
    CURRENT_CONTROL=""; CURRENT_HINT=""
    return 0
  fi

  local entry label port
  for entry in "server:$server_port" "client:$client_port"; do
    label="${entry%%:*}"
    port="${entry#*:}"
    if [[ -z "$port" || ! "$port" =~ ^[0-9]+$ ]]; then
      continue
    fi
    if port_in_use "$port"; then
      note_pass "$label port $port is bound — most likely your own dev server; if not, run 'ss -tlnp sport = :$port' to investigate"
    else
      note_pass "$label port $port is free"
    fi
  done
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

# --- dependency freshness -----------------------------------------------------
# `bun install` rewrites symlinks under node_modules/.bin. Compare that
# install marker's mtime to bun.lock as a cheap "do I need to reinstall?"
# signal.

check_dependency_freshness() {
  CURRENT_CONTROL="doctor-check/dependency-freshness"
  CURRENT_HINT="Run 'bun install' to refresh node_modules so it matches bun.lock."
  prose_print ""
  prose_print "=== dependency freshness ==="
  note_freshness_result "$(musi_dependency_freshness "$REPO_ROOT")" "dependency"
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

check_shared_dist_freshness() {
  # Skip entirely on a tree with no @musi/shared workspace (sandbox/fixture
  # repos) so a non-monorepo never reports a phantom build failure.
  [ -d "$REPO_ROOT/packages/shared/src" ] || return 0
  CURRENT_CONTROL="doctor-check/shared-dist-freshness"
  CURRENT_HINT="Run 'bun run --filter @musi/shared build' so the dist tests import matches packages/shared/src."
  prose_print ""
  prose_print "=== @musi/shared dist freshness ==="
  # The skip-guard above already returned for a tree with no @musi/shared
  # workspace — the only state musi_shared_dist_freshness reports as `n/a` — so
  # `n/a` is unreachable here and note_freshness_result never sees it.
  note_freshness_result "$(musi_shared_dist_freshness "$REPO_ROOT")" "shared dist"
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

check_prisma_client_freshness() {
  # Skip entirely on a tree with no Prisma schema (sandbox/fixture repos).
  [ -f "$REPO_ROOT/packages/server/prisma/schema.prisma" ] || return 0
  CURRENT_CONTROL="doctor-check/prisma-client-freshness"
  CURRENT_HINT="Run 'bun run --filter @musi/server prisma:generate' so the generated client matches schema.prisma."
  prose_print ""
  prose_print "=== Prisma client freshness ==="
  note_freshness_result "$(musi_prisma_client_freshness "$REPO_ROOT")" "Prisma client"
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

check_yamllint_system_tool() {
  CURRENT_CONTROL="doctor-check/yamllint-system-tool"
  CURRENT_HINT="Install yamllint with 'apt install yamllint' (version >=1.29.0)."
  prose_print ""
  prose_print "=== yamllint system tool ==="
  local bin version
  if ! command -v yamllint >/dev/null 2>&1; then
    note_warn "yamllint not found on PATH - install with 'apt install yamllint' (version >=1.29.0)"
    CURRENT_CONTROL=""; CURRENT_HINT=""
    return 0
  fi
  bin="$(command -v yamllint)"
  version="$("$bin" --version 2>/dev/null || true)"
  if [[ -n "$version" ]]; then
    note_pass "yamllint available at $bin ($version)"
  else
    note_pass "yamllint available at $bin"
  fi
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

check_shellcheck_system_tool() {
  CURRENT_CONTROL="doctor-check/shellcheck-system-tool"
  CURRENT_HINT="Install shellcheck with 'apt install shellcheck'."
  prose_print ""
  prose_print "=== shellcheck system tool ==="
  local bin version
  if ! command -v shellcheck >/dev/null 2>&1; then
    note_warn "shellcheck not found on PATH - install with 'apt install shellcheck'"
    CURRENT_CONTROL=""; CURRENT_HINT=""
    return 0
  fi
  bin="$(command -v shellcheck)"
  version="$("$bin" --version 2>/dev/null | awk -F': ' '/^version:/ {print $2; exit}' || true)"
  if [[ -n "$version" ]]; then
    note_pass "shellcheck available at $bin (version $version)"
  else
    note_pass "shellcheck available at $bin"
  fi
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

# --- lint host-tool inventory -------------------------------------------------
# Report presence, resolved path, installed version, and known-good version for
# the host/system tools the lint surface invokes that the yamllint/shellcheck
# checks above do not already cover. Report-first: doctor never installs.
# Binary resolution mirrors scripts/lint-config-sensors.sh so the inventory matches
# what the lint lane would actually run, including the MUSI_TAPLO_BIN /
# MUSI_ACTIONLINT_BIN / MUSI_HADOLINT_BIN overrides (see resolve_lint_bin).
# Known-good versions are single-sourced (read here, never re-pinned):
#   - npm-managed tools (eslint, prettier, taplo, node-actionlint): package.json
#   - hadolint's binary pin: scripts/lint-config-sensors.sh (HADOLINT_VERSION)
#   - Bun: package.json's packageManager field
# For npm-managed tools the reported "installed" version is the installed npm
# package version (node_modules/<pkg>/package.json), which shares a namespace
# with the package.json pin so the comparison is meaningful; some wrappers
# (node-actionlint) expose no usable --version and others (taplo) version the
# bundled binary independently of the npm package. hadolint and bun are genuine
# binaries whose --version is authoritative.
pkg_dep_version() {
  # Print the package.json pin (known-good) for dependency $1, or empty on error.
  bun -e 'const p=require(process.argv[1]);const n=process.argv[2];const d=p.dependencies||{};const v=p.devDependencies||{};process.stdout.write(String(d[n]||v[n]||""))' \
    "$REPO_ROOT/package.json" "$1" 2>/dev/null || true
}

installed_pkg_version() {
  # Print the installed version of npm package $1, or empty on error.
  bun -e 'process.stdout.write(String(require(process.argv[1]).version||""))' \
    "$REPO_ROOT/node_modules/$1/package.json" 2>/dev/null || true
}

resolve_lint_bin() {
  # Resolve a tool the way the lint scripts do (scripts/lint-config-sensors.sh's
  # command_from_env_or_path): an explicit MUSI_*_BIN override wins verbatim — like
  # the lint lane, doctor does not stat the override, so an override the lane would
  # use is reported even if the path is bogus — then node_modules/.bin, then PATH.
  # Pass the override env-var name as $2 for the tools that support one (taplo,
  # node-actionlint, hadolint); omit it for tools the lint scripts resolve without
  # an override (eslint, prettier, bun). Print the resolved path, or nothing when
  # unresolved.
  local bin_name="$1" override_var="${2:-}"
  if [[ -n "$override_var" && -n "${!override_var:-}" ]]; then
    printf '%s\n' "${!override_var}"
    return 0
  fi
  if [[ -x "$REPO_ROOT/node_modules/.bin/$bin_name" ]]; then
    printf '%s\n' "$REPO_ROOT/node_modules/.bin/$bin_name"
  elif command -v "$bin_name" >/dev/null 2>&1; then
    command -v "$bin_name"
  fi
}

# A missing tool is a warn, not a fail, so doctor stays report-first and
# exit-0-friendly like the yamllint/shellcheck checks; the requirement text says
# whether the lint surface hard-requires the tool (always, or only when matching
# files exist — the config sensors short-circuit per file type).
warn_missing_lint_tool() {
  note_warn "$1 not found in node_modules/.bin or on PATH - run 'bun install' to provision it ($2$3)"
}

# report_npm_lint_tool <label> <bin-basename> <pkg-name> <requirement> [override-env-name]
report_npm_lint_tool() {
  local label="$1" bin_name="$2" pkg="$3" requirement="$4" override_var="${5:-}"
  local bin known_good installed kg=""
  known_good="$(pkg_dep_version "$pkg")"
  [[ -n "$known_good" ]] && kg=", known-good $known_good"
  bin="$(resolve_lint_bin "$bin_name" "$override_var")"
  if [[ -z "$bin" ]]; then
    warn_missing_lint_tool "$label" "$requirement" "$kg"
    return 0
  fi
  installed="$(installed_pkg_version "$pkg")"
  if [[ -n "$installed" ]]; then
    note_pass "$label available at $bin (installed $installed$kg; $requirement)"
  else
    note_pass "$label available at $bin (installed version unknown$kg; $requirement)"
  fi
}

# report_binary_lint_tool <label> <bin-basename> <known-good> <requirement> [override-env-name]
report_binary_lint_tool() {
  local label="$1" bin_name="$2" known_good="$3" requirement="$4" override_var="${5:-}"
  local bin version kg=""
  [[ -n "$known_good" ]] && kg=", known-good $known_good"
  bin="$(resolve_lint_bin "$bin_name" "$override_var")"
  if [[ -z "$bin" ]]; then
    warn_missing_lint_tool "$label" "$requirement" "$kg"
    return 0
  fi
  version="$("$bin" --version 2>/dev/null | head -n1 || true)"
  if [[ -n "$version" ]]; then
    note_pass "$label available at $bin ($version$kg; $requirement)"
  else
    note_pass "$label available at $bin (version unknown$kg; $requirement)"
  fi
}

check_lint_tools() {
  CURRENT_CONTROL="doctor-check/lint-tools"
  CURRENT_HINT="Run 'bun install' to provision the npm-managed lint tools; doctor reports versions but never installs."
  prose_print ""
  prose_print "=== lint tools ==="
  local hadolint_kg bun_kg
  hadolint_kg="$(grep -E '^HADOLINT_VERSION=' "$SCRIPT_DIR/lint-config-sensors.sh" 2>/dev/null | head -n1 | cut -d= -f2 || true)"
  bun_kg="$(bun -e 'const p=require(process.argv[1]);process.stdout.write(String(p.packageManager||""))' "$REPO_ROOT/package.json" 2>/dev/null || true)"
  bun_kg="${bun_kg#bun@}"
  # The override env-var args (taplo, node-actionlint, hadolint) mirror the
  # MUSI_*_BIN precedence in scripts/lint-config-sensors.sh; eslint, prettier, and
  # bun have no override there, so they pass none here.
  report_npm_lint_tool "eslint" "eslint" "eslint" "required: core ESLint lane"
  report_npm_lint_tool "prettier" "prettier" "prettier" "required: format:check lane"
  report_npm_lint_tool "taplo" "taplo" "@taplo/cli" "required when TOML files are present" \
    "MUSI_TAPLO_BIN"
  report_npm_lint_tool "node-actionlint" "node-actionlint" "@tktco/node-actionlint" \
    "required when workflow YAML is present" "MUSI_ACTIONLINT_BIN"
  report_binary_lint_tool "hadolint" "hadolint" "$hadolint_kg" "required when Dockerfiles are present" \
    "MUSI_HADOLINT_BIN"
  report_binary_lint_tool "bun" "bun" "$bun_kg" "required: runtime and package manager"
  CURRENT_CONTROL=""
  CURRENT_HINT=""
}

check_env_files
check_port_binding
check_dependency_freshness
check_shared_dist_freshness
check_prisma_client_freshness
check_yamllint_system_tool
check_shellcheck_system_tool
check_lint_tools

run_subcommand "lint-ratchet merge-driver health" \
  "run 'bun run lint:ratchet:install-merge-driver' to refresh local Git merge-driver config, installed driver copy, and info attributes" \
  "doctor-check/lint-ratchet-merge-driver" \
  bash "$REPO_ROOT/scripts/git/check-lint-ratchet-merge-driver.sh"

run_subcommand "eslint-disable register" \
  "add '-- reason', prefer eslint-disable-next-line, or add a targeted broad-disable allowlist entry when the suppression is intentionally scoped" \
  "doctor-check/eslint-disable-register" \
  bash "$REPO_ROOT/scripts/eslint-disable-register.sh" "$REPO_ROOT"

run_subcommand "suppression register" \
  "add '-- reason' to each suppression, migrate @ts-ignore to @ts-expect-error, restrict @ts-nocheck to scripts/drift-ai/suppressions.{ts,test.ts}, or prefer Stryker disable next-line over broad disable" \
  "doctor-check/suppression-register" \
  bash "$REPO_ROOT/scripts/suppression-register.sh" "$REPO_ROOT"

run_migration_safety "migration safety" \
  "review the WARN findings above; for an intentional destructive migration, confirm backfill/dependent reads are handled and add an entry to packages/server/prisma/migrations/.safety-acknowledged" \
  "sensor/db-migration-safety"

run_drift_report_subcommand "drift:ai harness freshness" \
  "review inventory above; run 'bun run drift:ai harness-freshness' for the raw report" \
  "drift-scope/harness-freshness" \
  bun run drift:ai harness-freshness

run_report_subcommand "knip unused-code sensor" \
  "review inventory above; run 'bun run sensor:knip' for the raw report" \
  "sensor/knip" \
  bun run sensor:knip

run_subcommand "staged blob-size sensor" \
  "allowlist intentional blobs in .blob-size-allowlist or remove generated artifacts from the index" \
  "sensor/blob-size" \
  bun run sensor:blob-size

run_harness_check "harness manifest parity" \
  "reconcile harness.controls.json with the rule/script set — see the per-control diagnostics above" \
  "verify-wrapper/doctor"

if (( JSON_MODE )); then
  if (( DOCTOR_HARNESS_CHECK_FAILED )); then
    # No registered control id for the manifest-parity step (the manifest IS
    # its inventory); the envelope cannot tag a finding under a foreign
    # control. Surface the failure via stderr + non-zero exit so consumers
    # know to re-run doctor without --json for the per-control diagnostics.
    printf 'doctor: harness:check reported manifest drift; run `bun run doctor` for details\n' >&2
  fi
  bun run "$SCRIPT_DIR/harness-emit-envelope.ts" --tool doctor \
    <"$DOCTOR_FINDINGS_NDJSON" || exit "$?"
else
  printf '\n=== summary ===\n'
  printf 'PASS=%d  WARN=%d  FAIL=%d\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"
fi

if (( FAIL_COUNT > 0 )); then
  exit 1
fi
exit 0
