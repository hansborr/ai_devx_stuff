#!/usr/bin/env bash
# Claude Code status line — two-line, status-first.
#
#   Row 1:  <model> · <effort/session/agent>      <repo/subpath[@worktree]>      <branch> <ahead/behind> <staged !unstaged ?untracked ~conflict *stash> <PR>
#   Row 2:  <tokens>/<limit> · <pct>%   +added/-removed $cost   cache R/W   ⧗ <cache-expiry>   5h <n>% →<reset>  7d <n>% →<reset>
#
# Reproduces a Powerlevel10k-style vcs segment (green=clean, yellow=dirty) and
# shows absolute context tokens against the live context-window size. Rate-limit
# windows appear only for Claude.ai (Pro/Max) sessions and auto-hide otherwise.
#
# Generated via /statusline. Everything is easy to tweak: glyphs and colors are
# variables at the top.

set -o pipefail
input=$(cat)
now=$(date +%s)

mtime_of() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

cache_tmp() {
  printf '%s.%s.%s.tmp' "$1" "$$" "$RANDOM"
}

replace_with() {
  local file=$1 tmp=$2
  if mv -f "$tmp" "$file"; then
    return 0
  fi
  rm -f "$tmp"
  return 1
}

touch_atomic() {
  local file=$1 tmp
  tmp=$(cache_tmp "$file")
  if : > "$tmp"; then
    replace_with "$file" "$tmp"
  else
    rm -f "$tmp"
    return 1
  fi
}

write_git_cache() {
  local file=$1 tmp
  tmp=$(cache_tmp "$file")
  shift
  if printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$@" > "$tmp"; then
    replace_with "$file" "$tmp"
  else
    rm -f "$tmp"
    return 1
  fi
}

write_cache_state() {
  local file=$1 fp=$2 ts=$3 primed_value=$4 tmp
  tmp=$(cache_tmp "$file")
  if printf '%s %s %s\n' "$fp" "$ts" "$primed_value" > "$tmp"; then
    replace_with "$file" "$tmp"
  else
    rm -f "$tmp"
    return 1
  fi
}

# ---------- reap stale state files ----------
# State files are session-keyed (see the git-cache and cache-state blocks below) and
# never removed on session exit, so /tmp accumulates one pair per session forever.
# Prune anything untouched for a day. Keep the directory scan itself to once a day
# so a 10s refreshInterval does not keep walking /tmp forever.
PRUNE_STATE="/tmp/.cc-statusline-pruned"
prune_mtime=$(mtime_of "$PRUNE_STATE")
if [ ! -f "$PRUNE_STATE" ] || [ $(( now - prune_mtime )) -ge 86400 ]; then
  find /tmp -maxdepth 1 -name 'cc-statusline-*' -mtime +1 -delete 2>/dev/null
  touch_atomic "$PRUNE_STATE" 2>/dev/null || true
fi

# ---------- glyphs (standard Unicode — no Nerd Font required) ----------
G_BRANCH='⎇'     # branch (U+2387, portable BMP glyph — was nf U+E0A0)
G_AHEAD='⇡'
G_BEHIND='⇣'
G_STAGED='✚'
G_UNSTAGED='!'
G_UNTRACKED='?'
G_CONFLICT='~'
G_STASH='*'
G_DIR='▸'            # path marker (U+25B8, portable BMP glyph — was nf U+F115); swap to taste
G_CACHE='⧗'          # prompt-cache timer (U+29D7); swap for a clock glyph if you prefer
G_RESET='→'          # rate-limit window reset marker (precedes the reset clock time)

# Prompt-cache TTL is auto-detected after the jq pass (see the CACHE_TTL_SECONDS
# block below), mirroring Claude Code's own rule: a Claude subscription requests
# the 1-hour TTL automatically, per-token billing (API key / Bedrock / Vertex)
# defaults to 5 min. 1h is the ceiling for every tier, Enterprise included.
# Confirmed against the official docs: code.claude.com/docs/en/prompt-caching.

# ---------- colors ----------
RST=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'
CYN=$'\033[36m'; MAG=$'\033[35m'; BLU=$'\033[34m'

# ---------- pull fields from stdin JSON in one jq pass ----------
# One value per line into an array. mapfile preserves empty fields by position;
# `read` with a tab IFS would collapse empties (tab is IFS-whitespace) and shift
# every later field left.
mapfile -t F < <(
  printf '%s' "$input" | jq -r '
    (.model.display_name // "?"),
    (.effort.level // ""),
    (.thinking.enabled // false),
    (.workspace.current_dir // .cwd // "."),
    (.session_id // "nosession"),
    (.context_window.total_input_tokens // 0),
    (.context_window.context_window_size // 200000),
    ((.context_window.used_percentage // 0) | floor),
    (.rate_limits.five_hour.used_percentage // ""),
    (.rate_limits.seven_day.used_percentage // ""),
    (.context_window.total_output_tokens // 0),
    (.rate_limits.five_hour.resets_at // "" | if type=="number" then floor else . end),
    (.rate_limits.seven_day.resets_at // "" | if type=="number" then floor else . end),
    (.cost.total_lines_added // 0),
    (.cost.total_lines_removed // 0),
    (.cost.total_cost_usd // 0),
    (.context_window.current_usage.cache_read_input_tokens // 0),
    (.context_window.current_usage.cache_creation_input_tokens // 0),
    (.session_name // ""),
    (.agent.name // ""),
    (.pr.number // ""),
    (.pr.review_state // ""),
    (.workspace.git_worktree // .worktree.name // ""),
    (.worktree.branch // "")'
)
MODEL=${F[0]}  EFFORT=${F[1]}  THINKING=${F[2]}  DIR=${F[3]}    SESSION=${F[4]}
TOKENS=${F[5]} LIMIT=${F[6]}   PCT=${F[7]}        FIVEH=${F[8]} SEVEND=${F[9]}
OUT_TOKENS=${F[10]} FIVEH_RST=${F[11]} SEVEND_RST=${F[12]}
ADDED=${F[13]} REMOVED=${F[14]} COSTUSD=${F[15]}
CACHE_READ=${F[16]} CACHE_WRITE=${F[17]} SESSION_NAME=${F[18]} AGENT_NAME=${F[19]}
PR_NUM=${F[20]} PR_STATE=${F[21]} WORKTREE_NAME=${F[22]} WORKTREE_BRANCH=${F[23]}

# ---------- terminal-width budgets ----------
# Claude Code sets COLUMNS before invoking statusLine commands. Use conservative
# caps so long repo paths, worktree names, or branch names do not wrap the row.
case "${COLUMNS:-}" in
  ''|*[!0-9]*) COLS=120 ;;
  *)           COLS=$COLUMNS ;;
esac
if [ "$COLS" -lt 90 ]; then
  PATH_MAX=22; BRANCH_MAX=14; NAME_MAX=12
elif [ "$COLS" -lt 180 ]; then
  PATH_MAX=34; BRANCH_MAX=22; NAME_MAX=18
else
  PATH_MAX=48; BRANCH_MAX=32; NAME_MAX=24
fi
SHOW_META_DETAILS=1
SHOW_PR_STATE=1
SHOW_BURN=1
SHOW_7D_LIMIT=1
[ "$COLS" -lt 160 ] && SHOW_META_DETAILS=0
[ "$COLS" -lt 100 ] && SHOW_PR_STATE=0
[ "$COLS" -lt 100 ] && SHOW_BURN=0
[ "$COLS" -lt 90 ] && SHOW_7D_LIMIT=0

TRUNC='…'
shorten_middle() {
  local s=$1 max=$2 keep head tail
  if [ "${#s}" -le "$max" ]; then
    printf '%s' "$s"
    return 0
  fi
  if [ "$max" -le 1 ]; then
    printf '%s' "${s:0:max}"
    return 0
  fi
  keep=$(( max - 1 ))
  head=$(( keep / 2 ))
  tail=$(( keep - head ))
  printf '%s%s%s' "${s:0:head}" "$TRUNC" "${s: -tail}"
}

# ---------- prompt-cache TTL (mirror Claude Code's auth-based selection) ----------
# 5-min and 1-hour are the only TTLs the API offers. Claude Code requests 1h on a
# Claude subscription (free under the plan) and 5m on per-token billing. We detect
# a subscription session by the presence of the 5h/7d rate-limit windows, which only
# Claude.ai sessions report. Explicit env overrides win, exactly as in Claude Code.
# Erring short is the safe direction (harmless early keep-alive), so unknown -> 300.
if [ "${FORCE_PROMPT_CACHING_5M:-0}" = "1" ]; then
  CACHE_TTL_SECONDS=300
elif [ "${ENABLE_PROMPT_CACHING_1H:-0}" = "1" ]; then
  CACHE_TTL_SECONDS=3600
elif [ -n "$FIVEH" ] || [ -n "$SEVEND" ]; then
  # Subscription session -> CC uses 1h, UNLESS you're over plan limit and drawing on
  # usage credits, where CC drops back to 5m. Approximate that with a maxed window.
  over=$(awk -v a="${FIVEH:-0}" -v b="${SEVEND:-0}" 'BEGIN{print (a>=100||b>=100)?1:0}')
  if [ "$over" = "1" ]; then CACHE_TTL_SECONDS=300; else CACHE_TTL_SECONDS=3600; fi
else
  CACHE_TTL_SECONDS=300           # API key / Bedrock / Vertex / Foundry default
fi

# ---------- git segment (cached per session, short TTL — git can be slow) ----------
CACHE="/tmp/cc-statusline-git-${SESSION}"
GIT_TTL=3
mtime=$(mtime_of "$CACHE")
if [ ! -f "$CACHE" ] || [ $(( now - mtime )) -ge "$GIT_TTL" ]; then
  if git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    porc=$(git -C "$DIR" status --porcelain=v2 --branch 2>/dev/null)
    branch=$(printf '%s\n' "$porc" | awk '/^# branch.head/ {print $3}')
    ab=$(printf '%s\n'   "$porc" | awk '/^# branch.ab/ {print $3, $4}')
    ahead=${ab%% *}; ahead=${ahead#+}; [ "$ahead" = "$ab" ] && ahead=0
    behind=${ab##* }; behind=${behind#-}
    [ -z "$ab" ] && { ahead=0; behind=0; }
    staged=$(printf '%s\n'    "$porc" | awk '/^[12] / { if (substr($2,1,1) != ".") c++ } END { print c+0 }')
    unstaged=$(printf '%s\n'  "$porc" | awk '/^[12] / { if (substr($2,2,1) != ".") c++ } END { print c+0 }')
    untracked=$(printf '%s\n' "$porc" | awk '/^\? /  { c++ } END { print c+0 }')
    conflict=$(printf '%s\n'  "$porc" | awk '/^u /   { c++ } END { print c+0 }')
    stash=$(git -C "$DIR" stash list 2>/dev/null | wc -l | tr -d ' ')
    toplevel=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null)
    write_git_cache "$CACHE" \
      "$branch" "$ahead" "$behind" "$staged" "$unstaged" "$untracked" "$conflict" "$stash" "$toplevel"
  else
    write_git_cache "$CACHE" "" "" "" "" "" "" "" ""
  fi
fi
IFS=$'\t' read -r branch ahead behind staged unstaged untracked conflict stash toplevel < "$CACHE"

# ---------- prompt-cache expiry estimate ----------
# The cache lives ~CACHE_TTL_SECONDS from the LAST main-session API call and resets
# on every call. The JSON has no "last call" timestamp, so detect a fresh main-session
# response by watching the token fingerprint change, and stamp the time. We use the
# context-window token counts (main-session only), NOT cost.total_api_duration_ms,
# which can include background-subagent time and would falsely reset the timer during
# exactly the idle waits this is meant to track. Needs refreshInterval in settings.json
# so it keeps counting down while the main session is idle.
CACHE_STATE="/tmp/cc-statusline-cache-${SESSION}"
FP="${TOKENS:-0}:${OUT_TOKENS:-0}"
CACHE_SEG=""
if [ "${TOKENS:-0}" -gt 0 ]; then          # 0 tokens => no API response yet => no cache
  prev_fp=""; last_ts=0; primed=0
  [ -f "$CACHE_STATE" ] && IFS=' ' read -r prev_fp last_ts primed < "$CACHE_STATE"
  : "${primed:=0}"                          # tolerate pre-existing 2-field state files
  if [ ! -f "$CACHE_STATE" ]; then
    # Cold start / resumed session: tokens already exist but we never witnessed the
    # call that warmed the cache, and the JSON carries no last-call timestamp, so the
    # cache's true age is unknown. Don't fake a fresh countdown (that lies on resume —
    # the cache may be long dead). Record the fingerprint UNPRIMED and wait until we
    # observe a real call to begin timing.
    last_ts=$now; primed=0
    write_cache_state "$CACHE_STATE" "$FP" "$now" 0
  elif [ "$FP" != "$prev_fp" ]; then
    # Fingerprint moved => an API call we actually saw => the timer is now trustworthy.
    last_ts=$now; primed=1
    write_cache_state "$CACHE_STATE" "$FP" "$now" 1
  fi                                        # else: idle refresh => keep last_ts/primed
  if [ "$primed" = "1" ]; then
    left=$(( CACHE_TTL_SECONDS - (now - last_ts) ))
    if [ "$left" -gt 0 ]; then
      if   [ "$left" -le 30  ]; then CCOL=$RED
      elif [ "$left" -le 120 ]; then CCOL=$YEL
      else CCOL=$GRN; fi
      CACHE_SEG="${CCOL}${G_CACHE} $(printf '%d:%02d' $(( left / 60 )) $(( left % 60 )))${RST}"
    else
      CACHE_SEG="${DIM}${G_CACHE} expired${RST}"
    fi
  else
    CACHE_SEG="${DIM}${G_CACHE} ?${RST}"    # age unknown until the first observed call
  fi
fi

# ---------- render: model · effort ----------
META="${BOLD}${CYN}${MODEL}${RST}"
if [ -n "$EFFORT" ]; then
  META="${META} ${DIM}· ${EFFORT}${RST}"
elif [ "$THINKING" = "true" ]; then
  META="${META} ${DIM}· think${RST}"
fi
if [ "$SHOW_META_DETAILS" = "1" ]; then
  [ -n "$SESSION_NAME" ] && META="${META} ${DIM}· $(shorten_middle "$SESSION_NAME" "$NAME_MAX")${RST}"
  [ -n "$AGENT_NAME" ]   && META="${META} ${DIM}· @$(shorten_middle "$AGENT_NAME" "$NAME_MAX")${RST}"
fi

# ---------- render: directory / worktree ----------
# Worktree-friendly: <repo-root-basename>/<path-within-repo>. The toplevel basename
# (captured in the git block) is what distinguishes one worktree from another, so it
# pairs with the branch on row 1. Outside a repo, fall back to a ~-abbreviated path.
DIRSEG=""
if [ -n "$toplevel" ]; then
  root=$(basename "$toplevel")
  if [ "$DIR" = "$toplevel" ]; then
    path="$root"
  else
    path="$root/${DIR#"$toplevel"/}"
  fi
else
  case "$DIR" in
    "$HOME")   path='~' ;;
    "$HOME"/*) path="~${DIR#"$HOME"}" ;;
    *)         path="$DIR" ;;
  esac
fi
if [ -n "$WORKTREE_NAME" ]; then
  wt=$(shorten_middle "$WORKTREE_NAME" "$NAME_MAX")
  path="${path}@${wt}"
elif [ -n "$WORKTREE_BRANCH" ]; then
  wt=$(shorten_middle "$WORKTREE_BRANCH" "$NAME_MAX")
  path="${path}@${wt}"
fi
path=$(shorten_middle "$path" "$PATH_MAX")
DIRSEG="${BLU}${G_DIR} ${path}${RST}"

# ---------- render: git ----------
GIT=""
if [ -n "$branch" ]; then
  : "${ahead:=0}" "${behind:=0}" "${staged:=0}" "${unstaged:=0}" "${untracked:=0}" "${conflict:=0}" "${stash:=0}"
  dirty=$(( staged + unstaged + untracked + conflict ))
  if [ "$dirty" -gt 0 ]; then BCOL=$YEL; else BCOL=$GRN; fi
  display_branch=$(shorten_middle "$branch" "$BRANCH_MAX")
  GIT="${BCOL}${G_BRANCH} ${display_branch}${RST}"
  [ "$ahead"     -gt 0 ] && GIT="${GIT} ${CYN}${G_AHEAD}${ahead}${RST}"
  [ "$behind"    -gt 0 ] && GIT="${GIT} ${CYN}${G_BEHIND}${behind}${RST}"
  [ "$staged"    -gt 0 ] && GIT="${GIT} ${GRN}${G_STAGED}${staged}${RST}"
  [ "$unstaged"  -gt 0 ] && GIT="${GIT} ${YEL}${G_UNSTAGED}${unstaged}${RST}"
  [ "$untracked" -gt 0 ] && GIT="${GIT} ${BLU}${G_UNTRACKED}${untracked}${RST}"
  [ "$conflict"  -gt 0 ] && GIT="${GIT} ${RED}${G_CONFLICT}${conflict}${RST}"
  [ "$stash"     -gt 0 ] && GIT="${GIT} ${MAG}${G_STASH}${stash}${RST}"
fi

# ---------- render: native PR badge (auto-hide when Claude has no PR field) ----------
PRSEG=""
if [ -n "$PR_NUM" ]; then
  case "$PR_STATE" in
    approved)          PRCOL=$GRN; state="ok" ;;
    changes_requested) PRCOL=$RED; state="changes" ;;
    draft)             PRCOL=$YEL; state="draft" ;;
    pending)           PRCOL=$YEL; state="pending" ;;
    *)                 PRCOL=$CYN; state="" ;;
  esac
  [ "$SHOW_PR_STATE" = "0" ] && state=""
  PRSEG="${PRCOL}PR#${PR_NUM}${state:+ ${state}}${RST}"
fi

# ---------- render: context tokens (bar removed — color of the count carries state) ----------
PCT=${PCT:-0}
if   [ "$PCT" -ge 90 ]; then CTXCOL=$RED
elif [ "$PCT" -ge 70 ]; then CTXCOL=$YEL
else CTXCOL=$GRN; fi

# human-readable token formatter: 78400 -> 78.4k, 131000 -> 131k, 1000000 -> 1.0M
human() {
  awk -v n="$1" 'BEGIN {
    if      (n >= 1000000) printf "%.1fM", n/1000000;
    else if (n >= 100000)  printf "%dk",  (n/1000)+0.5;
    else if (n >= 1000)    printf "%.1fk", n/1000;
    else                   printf "%d", n
  }'
}
TOK=$(human "${TOKENS:-0}")
LIM=$(human "${LIMIT:-200000}")
CTX="${CTXCOL}${TOK}/${LIM}${RST} ${DIM}· ${PCT}%${RST}"

# ---------- render: last-turn cache read/write tokens ----------
CACHE_IO=""
if [ "${CACHE_READ:-0}" -gt 0 ] || [ "${CACHE_WRITE:-0}" -gt 0 ]; then
  CR=$(human "${CACHE_READ:-0}")
  CW=$(human "${CACHE_WRITE:-0}")
  CACHE_IO="${DIM}cache ${RST}${GRN}R${CR}${RST}${DIM}/${RST}${YEL}W${CW}${RST}"
fi

# ---------- render: session burn (lines changed + cost; auto-hide when zero) ----------
BURN=""
if [ "$SHOW_BURN" = "1" ]; then
  if [ "${ADDED:-0}" -gt 0 ] || [ "${REMOVED:-0}" -gt 0 ]; then
    BURN="${GRN}+${ADDED:-0}${RST}${DIM}/${RST}${RED}-${REMOVED:-0}${RST}"
  fi
  COST=$(awk -v c="${COSTUSD:-0}" 'BEGIN { if (c+0 > 0) printf "$%.2f", c }')
  [ -n "$COST" ] && BURN="${BURN:+${BURN} }${DIM}${COST}${RST}"
fi

# ---------- render: rate-limit windows (Claude.ai only; auto-hide) ----------
clock() {                                   # epoch seconds -> HH:MM local; empty if unset/bad
  # When the reset is NOT today (e.g. the 7d window, or a 5h window crossing
  # midnight), a bare HH:MM looks like a past time. Prefix the weekday so a
  # multi-day-out reset reads correctly, e.g. "Tue 03:00".
  [ -n "$1" ] || return 0
  local hm rd td wd
  hm=$(date -d "@$1" +%H:%M 2>/dev/null || date -r "$1" +%H:%M 2>/dev/null) || return 0
  [ -n "$hm" ] || return 0
  rd=$(date -d "@$1" +%Y%m%d 2>/dev/null || date -r "$1" +%Y%m%d 2>/dev/null)
  td=$(date +%Y%m%d)
  if [ "$rd" = "$td" ]; then
    printf '%s' "$hm"
  else
    wd=$(date -d "@$1" +%a 2>/dev/null || date -r "$1" +%a 2>/dev/null)
    printf '%s %s' "$wd" "$hm"
  fi
}
LIMITS=""
if [ -n "$FIVEH" ]; then
  r=$(clock "$FIVEH_RST")
  LIMITS="${DIM}5h $(printf '%.0f' "$FIVEH")%${r:+ ${G_RESET}${r}}${RST}"
fi
if [ -n "$SEVEND" ] && [ "$SHOW_7D_LIMIT" = "1" ]; then
  r=$(clock "$SEVEND_RST")
  LIMITS="${LIMITS:+${LIMITS}  }${DIM}7d $(printf '%.0f' "$SEVEND")%${r:+ ${G_RESET}${r}}${RST}"
fi

# ---------- emit two rows ----------
ROW1="$META"
[ -n "$DIRSEG" ] && ROW1="${ROW1}    ${DIRSEG}"
[ -n "$GIT" ]    && ROW1="${ROW1}    ${GIT}"
[ -n "$PRSEG" ]  && ROW1="${ROW1}    ${PRSEG}"
ROW2="$CTX"
[ -n "$BURN" ]      && ROW2="${ROW2}    ${BURN}"
[ -n "$CACHE_IO" ]  && ROW2="${ROW2}    ${CACHE_IO}"
[ -n "$CACHE_SEG" ] && ROW2="${ROW2}    ${CACHE_SEG}"
[ -n "$LIMITS" ]    && ROW2="${ROW2}    ${LIMITS}"
printf '%s\n' "$ROW1"
printf '%s\n' "$ROW2"
