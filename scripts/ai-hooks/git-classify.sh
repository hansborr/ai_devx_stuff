#!/bin/bash

# Git command classification for the shared hook layer: the commit lexer, the
# routing and verdict classifiers, checkout target resolution, and the git deny
# predicates the command policy names.
#
# COPIED VERBATIM out of common.sh and policy.sh. The two `git commit`
# classifiers deliberately live together here: ai_is_real_git_commit_cmd
# (verdict, under-matches) and ai_is_git_commit_cmd (routing, over-matches) are
# NOT interchangeable, and the comment above ai_is_real_git_commit_cmd below is
# the record of why. Their specification is these header comments plus the
# shell corpus (scripts/ai-hooks/test.sh and its test-*.sh siblings); do not
# reimplement or unify them.
#
# Sourced by policy.sh, which also supplies the AI_POLICY_* pattern constants
# and ai_policy_has_command that the predicates below read at call time.

# Strip one layer of surrounding single or double quotes from a token.
ai_unquote_token() {
  local token="$1"
  case "$token" in
    \'*\') token="${token#\'}"; token="${token%\'}" ;;
    \"*\") token="${token#\"}"; token="${token%\"}" ;;
  esac
  printf '%s' "$token"
}

# Find the first unquoted `commit` token in a simple command whose first token
# is `git`. This is deliberately only a lexer, not a shell parser: it recognizes
# quotes, backslash escapes, and command separators so a path such as
# `/tmp/commit-lane` cannot be mistaken for the commit subcommand. The two output
# variables receive all text before the token and the owning command segment.
ai_git_commit_prefixes() {
  local cmd="$1"
  local prefix_var="$2"
  local segment_var="$3"
  local char token="" quote=""
  local token_start=-1 segment_start=0 segment_first=1 segment_is_git=0
  local git_option_value=0 i length

  length=${#cmd}
  for ((i = 0; i <= length; i++)); do
    if [ "$i" -eq "$length" ]; then
      char=';'
    else
      char="${cmd:i:1}"
    fi

    if [ -n "$quote" ]; then
      if [ "$char" = "$quote" ]; then
        quote=""
      elif [[ "$quote" = '"' && "$char" = \\ && "$i" -lt $((length - 1)) ]]; then
        i=$((i + 1))
        token+="${cmd:i:1}"
      else
        token+="$char"
      fi
      continue
    fi

    case "$char" in
      \'|\")
        [ "$token_start" -ge 0 ] || token_start="$i"
        quote="$char"
        ;;
      \\)
        [ "$token_start" -ge 0 ] || token_start="$i"
        if [ "$i" -lt $((length - 1)) ]; then
          i=$((i + 1))
          token+="${cmd:i:1}"
        fi
        ;;
      [[:space:]]|';'|'|'|'&')
        if [ "$token_start" -ge 0 ]; then
          if [ "$segment_first" -eq 1 ]; then
            # Cheap wrappers and env assignments do not change WHICH program
            # runs, so stay in the "still looking for the command word" state
            # rather than concluding the segment is not git. This is exactly the
            # set ai_target_dir_from_cmd already normalizes below; without it,
            # `env git -C <dir> commit` yields no commit prefix, the
            # substitution scan then covers the whole command instead of the
            # text before the verb, and the named target is lost — which let a
            # commit aimed at a protected checkout be judged against the
            # session's branch.
            case "$token" in
              command|builtin|env) : ;;
              [A-Za-z_]*=*) : ;;
              *)
                [ "$token" = git ] && segment_is_git=1
                segment_first=0
                ;;
            esac
          elif [ "$segment_is_git" -eq 1 ]; then
            if [ "$git_option_value" -eq 1 ]; then
              git_option_value=0
            elif [ "$token" = -C ] || [ "$token" = -c ]; then
              git_option_value=1
            elif [ "$token" = commit ]; then
              printf -v "$prefix_var" '%s' "${cmd:0:token_start}"
              printf -v "$segment_var" '%s' \
                "${cmd:segment_start:token_start-segment_start}"
              return 0
            fi
          fi
          token=""
          token_start=-1
        fi
        case "$char" in
          ';'|'|'|'&')
            segment_start=$((i + 1))
            segment_first=1
            segment_is_git=0
            git_option_value=0
            ;;
        esac
        ;;
      *)
        [ "$token_start" -ge 0 ] || token_start="$i"
        token+="$char"
        ;;
    esac
  done

  return 1
}

# True only for a genuine `git commit` INVOCATION: the lexer above found a
# `commit` subcommand whose owning command segment starts with `git`. Text that
# merely contains the words — a grep pattern, a printf'd log line, a heredoc
# body, a quoted example inside a message — never matches.
#
# Deliberately narrower than policy.sh's ai_is_git_commit_cmd, and the two are
# NOT interchangeable, because the asymmetries run opposite ways:
#   * routing must over-match. Anything that might commit has to reach the
#     wrapper's worktree lock, commit queue, and branch policy; an extra wrap
#     costs a little latency, a missed commit forfeits every guard.
#   * a verdict must under-match. "No commit landed" is a claim about the
#     agent's own work, and a confident wrong one makes an agent in a parallel
#     lane redo or undo work that did land. Where this cannot prove a commit
#     was invoked, the caller says nothing instead.
ai_is_real_git_commit_cmd() {
  local cmd="$1"
  # Same heredoc-safe view the routing classifier uses: a heredoc body is data,
  # not a command position. Called unguarded like every other stripper site in
  # this file (ai_is_git_commit_cmd, ai_policy_has_git_commit_on_main), not
  # because the stripper cannot be missing but because `|| cmd="$1"` is already
  # the answer when it is. policy.sh sources command-normalize.sh with `|| :`
  # and sources this file regardless, so a truncated module really can leave the
  # stripper undefined here; the call then substitutes empty and returns 127,
  # and the fallback restores the raw text — the same view a `declare -F` guard
  # would have skipped to, with the same verdict on every case the corpus pins.
  # The same fallback answers the stripper's own refusals. Text it cannot model
  # confidently it leaves in place rather than stripping, and a shape it cannot
  # parse at all — an unterminated heredoc, a delimiter spelling it does not
  # model — makes it exit nonzero, possibly after emitting partial filtered
  # text; `|| cmd="$1"` is what discards that and restores the raw text. So one
  # answer covers "no heredoc-aware view available" however it arises.
  cmd=$(ai_strip_noncommand_text "$cmd") || cmd="$1"
  # The lexer treats a newline as ordinary whitespace, which its target-resolution
  # callers want (a newline cannot introduce a `cd` chain they model). For a
  # yes/no verdict a newline IS a command separator, so normalize before lexing
  # or `cd /lane\ngit commit -m x` would not read as an invocation.
  # shellcheck disable=SC2034 # both are set by name via printf -v in the lexer
  local prefix segment
  ai_git_commit_prefixes "${cmd//$'\n'/; }" prefix segment
}

# The slice of CMD that target resolution actually reads: for a commit-bearing
# command everything before the `commit` verb (its leading cd chain and git
# global options), else the whole command. Mirrors ai_target_dir_from_cmd's own
# split so the ambiguity test below cannot drift from what the resolver parses.
ai_target_resolution_region() {
  # shellcheck disable=SC2034 # segment is set by name via printf -v in the lexer
  local prefix segment
  if ai_git_commit_prefixes "$1" prefix segment; then
    printf '%s' "$prefix"
  else
    printf '%s' "$1"
  fi
}

# True when the checkout a git command acts on CANNOT be read from its text: a
# command substitution, backtick, or process substitution sits inside the region
# the resolver parses, so a `cd`/`git -C` could be hiding in there and the
# payload-cwd fallback may name a different repository than the command touched.
# Callers that would otherwise state a before/after HEAD result must decline.
ai_target_dir_is_ambiguous() {
  # These are literal shell-syntax markers, not strings intended to expand.
  # shellcheck disable=SC2016
  case "$(ai_target_resolution_region "$1")" in
    *'$('*|*'`'*|*'<('*) return 0 ;;
  esac
  return 1
}

# True when a git command NAMES a target checkout — a leading cd chain or a
# global `git -C` — that does not resolve to a real checkout. The name is then
# unverifiable: `git -C "$LANE"` (this layer is a lexer, it cannot expand shell
# parameters), a `~` git will not expand, or a stale path.
#
# This is a guard hole, not just a reporting one. Callers resolve a work root as
# `git -C <target> rev-parse --show-toplevel || <their own checkout>`, so an
# unresolvable name silently substitutes the hook's own checkout: the HEAD
# comparison is then fabricated against the wrong repository, AND branch policy
# reads the wrong branch, so `LANE=/main-checkout; git -C "$LANE" commit` is
# judged against the session's feature branch and let through. Callers must fail
# closed rather than vouch for a checkout that was never identified.
ai_named_target_is_unresolvable() {
  local cmd="$1"
  local payload_cwd="$2"
  local fallback="$3"
  local candidate

  candidate=$(ai_target_dir_from_cmd "$cmd") || return 1
  [ -n "$candidate" ] || return 1
  case "$candidate" in
    /*) : ;;
    *) candidate="${payload_cwd:-$fallback}/$candidate" ;;
  esac
  git -C "$candidate" rev-parse --show-toplevel >/dev/null 2>&1 && return 1
  return 0
}

# The umbrella the verdict paths use: the checkout a command acts on cannot be
# pinned down at all, either because a substitution hides the leading forms or
# because the name they carry is unverifiable. Either way the observed root may
# be a different repository than the one the command touched, so no before/after
# HEAD claim — success OR failure — may be stated.
ai_target_is_unattributable() {
  ai_target_dir_is_ambiguous "$1" && return 0
  ai_named_target_is_unresolvable "$1" "$2" "$3"
}

# Extract the directory a git command targets from its *leading forms only* —
# not a general shell parser. Two shapes are recognized:
#   * a `git -C <dir>` global option (matched only in the segment before the
#     `commit` subcommand, so `git commit -C <commit-ish>` — reuse-message, a
#     commit not a directory — is never captured);
#   * a contiguous leading chain of `cd <dir> &&` / `cd <dir>;` commands. The
#     targets are applied in order, so the last absolute cd wins while relative
#     cds remain relative to the directory established before them.
# Returns non-zero for everything else — command substitution, subshells,
# process substitution, or compounds with non-cd commands in the leading chain
# — so the caller falls back to the payload cwd. Passing such compounds through
# unwrapped would forfeit the queue and policy layer, so they resolve to the cwd
# instead.
ai_target_dir_from_cmd() {
  local cmd="$1"
  local prefix commit_segment git_segment path_token_pattern env_assignment_pattern
  local remaining cd_target git_target
  local normalized_commit_segment
  local commit_bearing=0 resolved_cd=""

  path_token_pattern="('[^']*'|\"[^\"]*\"|[^[:space:];|&]+)"
  env_assignment_pattern='^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:];|&]+[[:space:]]+(.*)$'

  # Commit-bearing commands keep their stricter token-aware boundary: only the
  # owning segment BEFORE the commit subcommand may provide global `git -C`.
  # For other git commands, the full leading form remains available for the
  # generic cd / git-C resolution below.
  if ai_git_commit_prefixes "$cmd" prefix commit_segment; then
    commit_bearing=1
  else
    prefix="$cmd"
  fi

  # Decline when a substitution sits in the text this resolver actually reads,
  # because its expansion could be (or hide) the target directory. The check is
  # scoped to `prefix` — everything before the `commit` verb — so a substituted
  # MESSAGE body such as `-m "$(cat file)"`, which cannot change the checkout
  # git acts on, no longer forfeits resolution. Scanning the whole command
  # instead made `git -C <lane> commit -m "$(...)"` fall back to the payload
  # cwd: HEAD was then compared against the SESSION's checkout, producing a
  # confident, wrong "No commit landed" for a commit that had landed in the
  # lane, and letting a commit aimed at a protected lane read the session's
  # branch. Non-commit commands keep the whole-command scope (prefix == cmd).
  # These are literal shell-syntax markers, not strings intended to expand.
  # shellcheck disable=SC2016
  case "$prefix" in
    *'$('*|*'`'*|*'<('*) return 1 ;;
  esac

  # Only a contiguous leading cd chain is resolved. If another command appears
  # between cd and git, declining the shape is deliberate: inferring across an
  # arbitrary compound could key policy and locks to a checkout the shell never
  # reaches. Simple relative targets are composed in execution order.
  remaining="$prefix"
  while [[ "$remaining" =~ ^[[:space:]]*cd[[:space:]]+${path_token_pattern}[[:space:]]*(\&\&|\;)[[:space:]]*(.*)$ ]]; do
    cd_target=$(ai_unquote_token "${BASH_REMATCH[1]}")
    case "$cd_target" in
      /*) resolved_cd="$cd_target" ;;
      *)
        if [ -n "$resolved_cd" ]; then
          resolved_cd="${resolved_cd%/}/$cd_target"
        else
          resolved_cd="$cd_target"
        fi
        ;;
    esac
    remaining="${BASH_REMATCH[3]}"
  done

  git_segment="$remaining"
  [ "$commit_bearing" -eq 0 ] || git_segment="$commit_segment"

  # Recognize cheap wrappers that do not change Git's working directory. Keep
  # this intentionally narrow: it is target selection for the safety policy,
  # not a general shell parser. `env` support consumes only ordinary VAR=value
  # assignments; unfamiliar option shapes keep the safer resolved-cd fallback.
  while :; do
    if [[ "$git_segment" =~ ^[[:space:]]*(command|builtin)[[:space:]]+(.*)$ ]]; then
      git_segment="${BASH_REMATCH[2]}"
      continue
    fi
    if [[ "$git_segment" =~ ^[[:space:]]*env[[:space:]]+(.*)$ ]]; then
      git_segment="${BASH_REMATCH[1]}"
      while [[ "$git_segment" =~ $env_assignment_pattern ]]; do
        git_segment="${BASH_REMATCH[1]}"
      done
      continue
    fi
    # A leading `VAR=value` with no `env` in front runs the same program. The
    # commit lexer looks through these, so this must too: otherwise
    # `FOO=1 git -C <dir> commit` keeps its verb but loses its target, falls back
    # to the payload cwd, and the branch guard reads the wrong checkout.
    if [[ "$git_segment" =~ $env_assignment_pattern ]]; then
      git_segment="${BASH_REMATCH[1]}"
      continue
    fi
    break
  done

  # Prefix normalization can reveal a commit command that the original lexer
  # deliberately ignored because its first token was a wrapper. Reapply the
  # lexer so commit's `-C <commit-ish>` is never treated as a directory.
  if ai_git_commit_prefixes "$git_segment" prefix normalized_commit_segment; then
    git_segment="$normalized_commit_segment"
  fi

  # A global `git -C` wins over any preceding cd. Commit-bearing commands scan
  # only their protected pre-subcommand segment, so `git commit -C <commit-ish>`
  # can never be reinterpreted as a directory. Non-commit commands scan their
  # leading git command, which covers `git -C <dir> push` and similar forms.
  if [[ "$git_segment" =~ ^[[:space:]]*git[[:space:]] ]] \
    && [[ "$git_segment" =~ (^|[[:space:]])-C[[:space:]]+${path_token_pattern} ]]; then
    git_target=$(ai_unquote_token "${BASH_REMATCH[2]}")
    case "$git_target" in
      /*) printf '%s' "$git_target" ;;
      *)
        if [ -n "$resolved_cd" ]; then
          printf '%s/%s' "${resolved_cd%/}" "$git_target"
        else
          printf '%s' "$git_target"
        fi
        ;;
    esac
    return 0
  fi

  if [ -n "$resolved_cd" ] && [[ "$git_segment" =~ ^[[:space:]]*git[[:space:]] ]]; then
    printf '%s' "$resolved_cd"
    return 0
  fi

  # A known cd chain is the conservative target when a trivial wrapper was
  # present but its remaining shape was not understood well enough to prove a
  # bare Git invocation.
  if [ -n "$resolved_cd" ] \
    && [[ "$remaining" =~ ^[[:space:]]*(command|builtin|env)[[:space:]] ]]; then
    printf '%s' "$resolved_cd"
    return 0
  fi

  return 1
}

# Resolve the directory a git command will actually run in, for HEAD tracking,
# lock keying, and branch policy. Order: (a) a leading cd/`git -C` target read
# from the command, else (b) the payload cwd, else (c) the caller's fallback
# root (the hook-file-derived repo root). Emits a directory path; the caller is
# responsible for `git -C … rev-parse --show-toplevel` to get the work root and
# for falling back if that fails.
ai_resolve_target_dir() {
  local cmd="$1"
  local payload_cwd="$2"
  local fallback="$3"
  local candidate

  if candidate=$(ai_target_dir_from_cmd "$cmd") && [ -n "$candidate" ]; then
    case "$candidate" in
      /*) printf '%s' "$candidate" ;;
      *) printf '%s/%s' "${payload_cwd:-$fallback}" "$candidate" ;;
    esac
    return 0
  fi
  if [ -n "$payload_cwd" ]; then
    printf '%s' "$payload_cwd"
    return 0
  fi
  printf '%s' "$fallback"
}

# The reason ai_unverifiable_commit_target_reason emits below. Lives with its
# only consumer; the shell corpus asserts this text.
AI_POLICY_GIT_UNVERIFIABLE_TARGET="This commit names a target checkout the hook cannot verify (for example 'git -C \"\$SOME_VAR\"', a '~' path, or a directory that is not a Git checkout), so the protected-branch guard cannot be judged against the checkout the commit would actually land in. Re-issue it with a literal path to the target checkout."

# True for a real `git commit` invocation the wrapper should handle, including
# the global-option forms `git -c <cfg> commit` and `git -C <dir> commit` — the
# latter targets another checkout and must be wrapped (HEAD tracking, locks,
# branch policy on that checkout), not passed through unguarded. Mirrors the
# global-option handling the policy layer already uses; read-only subcommands
# that merely name `commit` stay excluded because only dash-led global options
# may precede the verb.
ai_is_git_commit_cmd() {
  local cmd

  # When stripping fails (unterminated or unmodeled heredoc), fall back to
  # the raw text exactly like the policy scanners: a real commit behind a
  # malformed heredoc must still route through the wrapper (worktree lock,
  # commit queue, branch policy) instead of running unguarded. Prose in such
  # a body can over-match; the wrapper preflight applies policy either way.
  cmd=$(ai_strip_noncommand_text "$1") || cmd="$1"
  [[ "$cmd" =~ (^|[[:space:];|&])git[[:space:]]+${AI_POLICY_GIT_GLOBAL_OPTS}commit($|[[:space:]]) ]]
}

# Raw text test: it says nothing about whether the command is a commit at all.
# Callers MUST gate it on ai_is_real_git_commit_cmd first, or a grep/printf whose
# text merely contains `git commit --dry-run` is handed a commit verdict.
ai_is_git_commit_dry_run() {
  [[ "$1" =~ (^|[[:space:]])--dry-run($|[[:space:]]) ]]
}

# Fail-closed companion to the branch guards. A commit that names a checkout the
# hook cannot resolve must not be judged against the fallback root, because that
# root is the hook's own checkout and is usually on a feature branch — which is
# exactly how `LANE=/main-checkout; git -C "$LANE" commit` slipped past the
# protected-branch guard. Deliberately keyed on the WIDE routing classifier:
# refusing an unverifiable target is cheap, and missing one forfeits the guard.
# Call this AFTER ai_policy_decision at every site so genuine hard policy
# (amend, hook bypass, protected files) keeps its own specific reason.
ai_unverifiable_commit_target_reason() {
  local cmd="$1"
  local payload_cwd="$2"
  local fallback="$3"

  # Cheapest discriminator first: ai_named_target_is_unresolvable is pure string
  # work that returns immediately when the command names no target at all, which
  # is the common case. Only then pay for the classifier's heredoc strip (awk)
  # and, at most once, a `git rev-parse`. This runs before the wrapper takes its
  # locks, so keeping it cheap matters.
  ai_named_target_is_unresolvable "$cmd" "$payload_cwd" "$fallback" || return 1
  ai_is_git_commit_cmd "$cmd" || return 1
  printf '%s' "$AI_POLICY_GIT_UNVERIFIABLE_TARGET"
}

# Current branch of WORK_ROOT when given, else the process cwd. Executing hooks
# (git-commit-quiet) must pass the resolved work root: without `-C` this reads
# the hook process's cwd, not the checkout the commit lands in. The no-arg form
# stays cwd-based for the git-level husky guard, which git runs inside the
# target repo already.
ai_current_branch() {
  local work_root="${1:-}"
  if [ -n "$work_root" ]; then
    git -C "$work_root" symbolic-ref --quiet --short HEAD 2>/dev/null || true
  else
    git symbolic-ref --quiet --short HEAD 2>/dev/null || true
  fi
}

# True when direct commits/pushes to BRANCH are disallowed (the protected
# integration branch). Reviewers land work here via merge, not direct commits.
ai_branch_is_protected() {
  case "$1" in
    main|master) return 0 ;;
    *) return 1 ;;
  esac
}

# Hard guard for git-level hooks (.husky/pre-commit): refuse a direct commit on
# the protected branch and point at the merge-based integration path. Because
# git runs the hook inside the target repo, this is cwd-correct and also covers
# the `git -C <path>` / `cd <path> && git commit` forms that the PreToolUse
# string matcher (ai_policy_has_git_commit_on_main) cannot resolve. Prints to
# stderr and returns 1 when blocked, 0 otherwise; the caller decides to exit.
ai_guard_commit_branch_or_die() {
  local branch
  branch=$(ai_current_branch)
  ai_branch_is_protected "$branch" || return 0
  cat >&2 <<EOF
=== COMMIT BLOCKED: protected branch '$branch' ===
Direct commits on '$branch' are not allowed. Land work on a feature branch:
  git switch -c feat/your-change && git commit ...
then integrate with a merge (git merge --no-ff), which skips this hook. A
genuine one-off exception needs --no-verify, which skips ALL pre-commit checks.
EOF
  return 1
}

ai_policy_strip_allowed_rebase_controls() {
  sed -E "s/${AI_POLICY_GIT_CMD}rebase[[:space:]]+--(continue|abort|skip|quit)//g" <<< "$1"
}

# Remove `git [opts] commit ... --dry-run ...` invocations so the live-commit
# matcher cannot be exempted by a `--dry-run` token that belongs to a *different*
# command later on the same line. The pattern is bounded by [^;&|], so it only
# ever strips within a single command segment (a genuine dry-run commit), never
# across a `;`/`&&`/`||`/pipe. Mirrors ai_policy_strip_allowed_rebase_controls.
ai_policy_strip_dry_run_commits() {
  sed -E "s/git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit[^;&|]*--dry-run[^;&|]*//g" <<< "$1"
}

ai_policy_has_dangerous_git_reset() {
  local cmd="$1"

  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}reset[^;&|]*[[:space:]]--(hard|soft|merge|keep)$AI_POLICY_CMD_END" && return 0
  if ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}reset([[:space:]]+(-[A-Za-z]+|--[A-Za-z0-9-]+(=[^[:space:];|&'\"]+)?))*[[:space:]]+[^[:space:]-][^[:space:];|&'\"]*$AI_POLICY_CMD_END"; then
    ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}reset([[:space:]]+(-[A-Za-z]+|--[A-Za-z0-9-]+(=[^[:space:];|&'\"]+)?))*[[:space:]]+HEAD[[:space:]]+--[[:space:]]+" && return 1
    return 0
  fi

  return 1
}

ai_policy_strip_staged_only_restores() {
  sed -E "s/${AI_POLICY_GIT_CMD}restore[^;&|]*[[:space:]](--staged|-[A-Za-z]*S[A-Za-z]*)[^;&|]*//g" <<< "$1"
}

# Remove only stash invocations whose first stash argument selects an explicit
# allowlisted operation. The subcommand forms consume their ordinary argument
# tail so a later argument named `pop`, for example, is not redispatched. Help
# is intentionally narrower: only the exact -h/--help invocation is removed.
# The argument-tail regex does not descend into $() or backtick substitutions; nested stash mutations there are outside the accidental-use threat model.
# Any `git stash` command left in the residue is denied by the caller, which
# makes bare, option-led, mutating, and unknown/future forms fail closed.
ai_policy_strip_allowed_git_stash() {
  local normalized

  # Normalize the option-bearing git prefix first so the strip expressions'
  # backreferences cannot be shifted by captures inside AI_POLICY_GIT_CMD.
  normalized=$(sed -E "s/${AI_POLICY_GIT_CMD}/git /g" <<< "$1")
  sed -E \
    -e "s/git[[:space:]]+stash[[:space:]]+(list|show|create)([[:space:]]+[^;&|]*)?([;&|]|$)/\\3/g" \
    -e "s/git[[:space:]]+stash[[:space:]]+(list|show|create)[[:space:]]*['\"\`)][[:space:]]*([;&|]|$)/\\2/g" \
    -e "s/git[[:space:]]+stash[[:space:]]+(-h|--help)[[:space:]]*([;&|]|$)/\\2/g" \
    -e "s/git[[:space:]]+stash[[:space:]]+(-h|--help)[[:space:]]*['\"\`)][[:space:]]*([;&|]|$)/\\2/g" \
    <<< "$normalized"
}

ai_policy_has_disallowed_git_stash() {
  local residue

  residue=$(ai_policy_strip_allowed_git_stash "$1")
  ai_policy_has_command "$residue" "${AI_POLICY_GIT_CMD}stash$AI_POLICY_CMD_END"
}

ai_policy_has_git_worktree_loss() {
  local cmd="$1"
  local restore_residue

  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}(checkout|switch)[^;&|]*[[:space:]](--force|-[A-Za-z]*f[A-Za-z]*)$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}checkout[^;&|]*[[:space:]]--[[:space:]]+[^;&|]+" && return 0
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}checkout([^;&|]*[[:space:]])?\.$AI_POLICY_CMD_END" && return 0

  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}restore[^;&|]*[[:space:]](--worktree|-[A-Za-z]*W[A-Za-z]*)$AI_POLICY_CMD_END" && return 0
  restore_residue=$(ai_policy_strip_staged_only_restores "$cmd")
  ai_policy_has_command "$restore_residue" "${AI_POLICY_GIT_CMD}restore([^;&|]*[[:space:]])?(--[[:space:]]+)?(\.|\./[^[:space:];|&'\"]*)$AI_POLICY_CMD_END" && return 0

  return 1
}

ai_policy_has_git_push_to_main() {
  local cmd="$1"
  local work_root="${2:-}"
  local branch
  local push_command_end
  local push_flags_re
  local push_redirect_tail
  local push_remote_re

  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push[^;&|]*[[:space:]]((refs/heads/)?(main|master)|[^[:space:];|&'\"]+:(refs/heads/)?(main|master))$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push[^;&|]*[[:space:]]--(all|branches)$AI_POLICY_CMD_END" && return 0

  branch=$(ai_current_branch "$work_root")
  ai_branch_is_protected "$branch" || return 1

  push_command_end="($|[;|&'\"])"
  push_flags_re="([[:space:]]+(-[A-Za-z][A-Za-z0-9-]*|--[A-Za-z0-9-]+(=[^[:space:]]+)?))*"
  push_redirect_tail="[[:space:]]*[0-9]*(>&|<&|[<>])[^[:space:];|&'\"]*"
  push_remote_re="([[:space:]]+[A-Za-z0-9._/-]+)?"
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push${push_flags_re}${push_remote_re}[[:space:]]*$push_command_end" && return 0
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push${push_flags_re}${push_remote_re}${push_redirect_tail}" && return 0
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push${push_flags_re}${push_remote_re}[[:space:]]+HEAD[[:space:]]*$push_command_end" && return 0
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push${push_flags_re}${push_remote_re}[[:space:]]+HEAD${push_redirect_tail}" && return 0
  return 1
}

ai_policy_has_git_commit_on_main() {
  local cmd="$1"
  local work_root="${2:-}"
  local branch scrubbed stripped

  # Direct callers get the same heredoc-safe command view as the central
  # violation boundary. On stripping failure retain CMD and match raw text.
  if stripped=$(ai_strip_noncommand_text "$cmd"); then
    cmd="$stripped"
  fi

  # Drop dry-run commits first: a `git ... commit ... --dry-run` validates
  # without creating a commit, so it is never blocked. Stripping it (segment-
  # bounded) before the live-commit test closes the bypass where a real commit
  # rides on a later, unrelated `--dry-run`, e.g. `git commit -m x && echo --dry-run`.
  scrubbed=$(ai_policy_strip_dry_run_commits "$cmd")

  # Match a real `git commit`, including the `git -c <cfg> ... commit` form.
  # Only genuine global options may precede the verb (see
  # AI_POLICY_GIT_PRECOMMIT_OPTS), so read-only subcommands that merely name
  # `commit` are not caught, and `commit-tree`/`commit-graph` plumbing and a
  # bare `... commit-ish` arg are excluded because CMD_END requires a separator.
  ai_policy_has_command "$scrubbed" "git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit$AI_POLICY_CMD_END" || return 1

  branch=$(ai_current_branch "$work_root")
  ai_branch_is_protected "$branch"
}

# Completion sentinel: policy.sh resets this before sourcing and fails closed
# unless this module reaches its final statement. An empty or truncated module
# still sources cleanly, so this is what proves the definitions above ran.
# shellcheck disable=SC2034 # read by policy.sh's module guard, which sources this file
declare -g AI_POLICY_MODULE_GIT_CLASSIFY_COMPLETE=1
