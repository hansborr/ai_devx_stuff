#!/bin/bash

# Shared policy checks and verification command matching.
#
# Command matching is regex-based for accidental agent commands, not full shell
# parsing. It covers direct commands, one prefix level, common shell separators
# and reserved words, and command substitutions. Deliberately-unhandled
# residuals include ssh-wrapped commands and double-wrapped `bash -c` strings;
# do not re-flag those without changing the threat model.

AI_POLICY_HOOK_BYPASS="Hook bypass is not allowed. Pre-commit hooks must always run."
AI_POLICY_POSTGRES="Do not use PostgreSQL CLI tools directly. You are in a container - use Prisma for all DB operations: 'bun run --filter @musi/server db:push' for schema, 'bun run --filter @musi/server db:seed' for seeding, or Prisma CLI commands routed through the repo scripts. Credentials are in .devcontainer/.env."
AI_POLICY_REDIS="Do not use redis-cli directly. You are in a container - Redis is managed by the app. If you need to inspect Redis state, read the app code or use 'bun run' scripts."
AI_POLICY_DOCKER="Do not run docker or docker-compose commands. You are in a container - PostgreSQL and Redis are already running and managed by the dev container. Use Prisma CLI for database operations."
AI_POLICY_CHANGEME="Wrong database credentials. 'ThisIsNotTheRealDatabasePassword' is not the password for this environment. Read .devcontainer/.env for the correct credentials."
AI_POLICY_GIT_AMEND="Git commit amend is not allowed from agents because it rewrites local history. The amend did NOT run — HEAD and your staged changes are untouched. Stage your changes and create a NEW follow-up commit instead. If the previous commit genuinely must be amended, ask the user to do it manually."
AI_POLICY_GIT_REBASE="Git rebase is not allowed from agents because it rewrites local history. Use merge or add follow-up commits; if a rebase is required, ask the user to run it."
AI_POLICY_GIT_RESET="Dangerous git reset modes are not allowed from agents. Use path-scoped 'git restore --staged <path>' or ask the user to run the reset."
AI_POLICY_GIT_WORKTREE_LOSS="Git worktree-discarding commands are not allowed from agents because they can destroy uncommitted work. Use non-destructive inspection commands, path-scoped staged-only restores, or ask the user to run the discard."
AI_POLICY_GIT_HISTORY_REWRITE="Git history rewrite and direct ref manipulation are not allowed from agents. Add a follow-up commit or ask the user to run the rewrite."
AI_POLICY_GIT_FORCE_PUSH="Git force-push, remote ref pruning, and remote branch deletion are not allowed from agents. Push normal feature-branch updates only, or ask the user to perform the remote mutation."
AI_POLICY_GIT_PUSH_MAIN="Pushing to main or master is not allowed from agents. Push a feature branch or ask the user to push the protected branch."
AI_POLICY_GIT_COMMIT_ON_MAIN="Committing on main or master is not allowed from agents. Create a feature branch ('git switch -c feat/...') and commit there; reviewers merge to the protected branch."
AI_POLICY_GIT_BRANCH_FORCE_DELETE="Force-updating or force-deleting branches and tags, and force-removing worktrees, are not allowed from agents. Use non-force ref operations or 'bun run worktree:drop', or ask the user to perform the destructive update."
AI_POLICY_GIT_CLEAN_FORCE="Git clean with force is not allowed from agents because it destroys untracked files. Remove specific generated files by name or ask the user to clean the tree."
AI_POLICY_GH_REMOTE_MUTATION="GitHub remote mutations are not allowed from agents. Use read-only 'gh ... view/list/status' commands, or ask the user to perform the mutation."
AI_POLICY_GH_AUTH="GitHub auth token output and auth reconfiguration are not allowed from agents. Use 'gh auth status' for read-only auth checks, or ask the user to manage authentication."
AI_POLICY_ALLOW_PROTECTED_EDITS_ADVISORY="Protected edit override marker .allow-protected-edits is repo-wide. Use it only for deliberate protected-file maintenance, and remove it immediately after that work is done."
AI_FLAKY_NOTE="Note: If this failure looks flaky (passes in isolation, fails under load), ensure you document it under docs/generated/observed_flaky_tests.md if you are unable to resolve it right now."

# Generated classifier slices (AI_GENERATED_WRAPPED_BUN_SCRIPTS /
# AI_GENERATED_BYPASS_BUN_SCRIPTS) for generator-contributed package scripts,
# rendered from harness.controls.json generatedSurface bunHook facets. Sourced
# relative to this file so every consumer (hooks, tests, other checkouts)
# resolves the sibling fragment without needing REPO_ROOT.
# shellcheck source=classified-bun-scripts.generated.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/classified-bun-scripts.generated.sh"

# porting-knob: wrapped-bun-scripts -- retarget the package scripts handled by hook wrappers
# Hand-maintained slice only: generator-contributed scripts render into
# AI_GENERATED_WRAPPED_BUN_SCRIPTS (appended below) and must not be re-added here.
AI_WRAPPED_BUN_SCRIPTS='
adr:check
audit:deps
audit:licenses
backlog:lint
build
check:eslint-react-peer-exception
check:fast-uri-override
code:intel
db:migration-safety
docs:local-eslint-rule-starter:check
docs:lint-coverage-map:audit
docs:lint-coverage-map:check
docs:lint-coverage-map:suggest
drift:ai
drift:triage
drift:e2e
e2e
eval:lint-messages
format
format:changed
format:changed:check
format:check
harness:audit
harness:check
lint
lint:agent:local-rules
lint:agent:local-rules:changed
lint:changed
lint:config-sensors
lint:fix
lint:import-cycles
lint:max-lines-exceptions
lint:max-lines-exceptions:install-merge-driver
lint:max-lines-exceptions:merge-driver:check
lint:probe-rule
lint:ratchet
lint:ratchet:check-baseline
lint:ratchet:check-debt-accounting
lint:ratchet:check-registry
lint:ratchet:debt-log
lint:ratchet:install-merge-driver
lint:ratchet:merge-driver:check
lint:ratchet:report
lint:ratchet:summary
lint:ratchet:trend
lint:shell
lint:suppressions
lint:suppressions:changed
logs:audit
module:index:check
sensor:blob-size
sensor:knip
sensor:knip-unused-exports
sensor:knip-unused-exports:install-merge-driver
sensor:knip-unused-exports:merge-driver:check
sensor:near-duplicates
sensor:near-duplicates:install-merge-driver
sensor:near-duplicates:merge-driver:check
sensor:near-duplicates:benchmark
test
test:changed
test:client
test:client:isolated
test:client:split
test:coverage
test:eslint-rules
test:scripts
test:scripts:changed
test:scripts:file
test:server
test:shared
test:slow
typecheck
verify
verify:async:status
verify:async:stop
verify:async:tail
verify:changed
verify:history
verify:logs
verify:parallel
verify:slow
'

AI_WRAPPED_BUN_SCRIPTS="${AI_WRAPPED_BUN_SCRIPTS}
${AI_GENERATED_WRAPPED_BUN_SCRIPTS}"

ai_wrapped_bun_script_regex() {
  local script sep=""

  while IFS= read -r script; do
    [ -n "$script" ] || continue
    printf '%s%s' "$sep" "$script"
    sep='|'
  done <<EOF
$AI_WRAPPED_BUN_SCRIPTS
EOF
}

AI_WRAPPED_BUN_RE="^bun run ($(ai_wrapped_bun_script_regex))( --| [A-Za-z0-9._:/=-]+| --[A-Za-z0-9._=-]+)*$"
AI_POLICY_CMD_START='(^[[:space:]]*|[;&|][[:space:]]*|(^|[;&|])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=)?[$][(][[:space:]]*|(^|[;&|])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=)?`[[:space:]]*|(^|[;&|])[[:space:]]*(then|do|else|elif)[[:space:]]+|(^|[;&|])[[:space:]]*([{]|!)[[:space:]]+)'
AI_POLICY_CMD_END="($|[[:space:];|&'\"\`)])"
AI_POLICY_ENV_PREFIX='env[[:space:]]+([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)+'
AI_POLICY_SHELL_PREFIX="(bash|sh)[[:space:]]+-[^[:space:]]*c[^[:space:]]*[[:space:]]+['\"]?"
AI_POLICY_TIMEOUT_PREFIX='timeout[[:space:]]+(((-s|--signal|-k|--kill-after)(=|[[:space:]]+)[^[:space:];&|]+|--(foreground|preserve-status|verbose)|-[v])[[:space:]]+)*[0-9]+([.][0-9]+)?[smhd]?[[:space:]]+'
AI_POLICY_COMMAND_PREFIX='command[[:space:]]+'
AI_POLICY_NICE_PREFIX='nice([[:space:]]+(-n[[:space:]]+|-)[0-9]+)?[[:space:]]+'
AI_POLICY_RUNNER_PREFIX="($AI_POLICY_TIMEOUT_PREFIX|$AI_POLICY_COMMAND_PREFIX|$AI_POLICY_NICE_PREFIX)+"
# Global git options that may legitimately sit between `git` and the verb: a
# value-taking option with its argument (`-c key=val`, `-C path`, `--git-dir
# path`, …) or any other single dash-led flag. Restricting pre-verb tokens to
# these keeps read-only subcommands that merely *name* a guarded verb from being
# mistaken for the verb itself; subcommands are bare words, never dash-led.
# Option arguments are a run of quoted spans, escaped characters, and bare
# characters, so whitespace carried by any quoting style ('a b', "a b", a\ b,
# or concatenations) cannot hide the verb from the matcher.
AI_POLICY_GIT_OPT_ARG="('[^']*'|\"[^\"]*\"|\\\\.|[^\\\\[:space:];&|])+"
AI_POLICY_GIT_GLOBAL_OPTS="((-[cC]|--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix))[[:space:]]+${AI_POLICY_GIT_OPT_ARG}[[:space:]]+|--[A-Za-z][A-Za-z0-9-]*=${AI_POLICY_GIT_OPT_ARG}[[:space:]]+|--[A-Za-z][^[:space:];&|]*[[:space:]]+|-[A-Za-z][^[:space:];&|]*[[:space:]]+)*"
AI_POLICY_GIT_PRECOMMIT_OPTS="$AI_POLICY_GIT_GLOBAL_OPTS"
AI_POLICY_GIT_CMD="git[[:space:]]+${AI_POLICY_GIT_GLOBAL_OPTS}"

ai_policy_command_re() {
  local command_re="$1"
  local cmd_start="${2:-$AI_POLICY_CMD_START}"

  printf '%s(%s)?%s|%s%s(%s)?%s|%s%s(%s)?(%s)?%s' \
    "$cmd_start" "$AI_POLICY_RUNNER_PREFIX" "$command_re" \
    "$cmd_start" "$AI_POLICY_ENV_PREFIX" "$AI_POLICY_RUNNER_PREFIX" "$command_re" \
    "$cmd_start" "$AI_POLICY_SHELL_PREFIX" "$AI_POLICY_ENV_PREFIX" "$AI_POLICY_RUNNER_PREFIX" "$command_re"
}

ai_policy_has_command() {
  local cmd="$1"
  local command_re="$2"
  local cmd_start="${3:-$AI_POLICY_CMD_START}"

  grep -qE -- "$(ai_policy_command_re "$command_re" "$cmd_start")" <<< "$cmd"
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

# Print CMD with non-executable heredoc text removed while leaving every
# executable command position (including quoted shell strings) intact. The
# model is a handful of conservative rules, not a shell parser; whenever a
# construct is not confidently modeled, the text stays policy-visible:
#
# - Quoted-delimiter bodies are pure data and are removed entirely. POSIX
#   quote removal applies to the delimiter word: quoting ANY part of it
#   (<<\X, <<X"Y") suppresses expansion, and the terminator matches the
#   dequoted word.
# - Unquoted bodies undergo shell expansion. From the first line containing a
#   substitution opener ($( or backtick) the rest of the body is retained
#   wholesale — no substitution depth, quote, or comment modeling.
# - A body fed to an obvious stdin-reading shell invocation (bash <<EOF,
#   cat <<EOF | sh) is the script that shell runs and is kept whole.
# - << inside $((...))/((...)) arithmetic is a shift operator, not a
#   declaration.
#
# Returns non-zero for an unterminated heredoc (which includes delimiter
# spellings the parser does not model, e.g. $'...'). Callers fall back to
# scanning the RAW text in that case: policy guards fail closed, and commit
# routing (ai_is_git_commit_cmd) matches the raw text too so a commit behind
# a malformed heredoc still goes through the wrapper.
ai_strip_noncommand_text() {
  awk '
    function queue_heredoc(delimiter, indent_mode, quoted, executable) {
      heredoc_count++
      heredoc_delimiter[heredoc_count] = delimiter
      heredoc_indent[heredoc_count] = indent_mode
      heredoc_quoted[heredoc_count] = quoted
      heredoc_executable[heredoc_count] = executable
    }

    # True when SEG (one raw pipeline/command segment) invokes a shell that
    # will execute its stdin: env/assignment prefixes and a leading path are
    # allowed before the shell word; an explicit script operand or a -c/-n
    # style invocation (script from argument / syntax-check only) is not a
    # stdin executor. Redirection words are skipped, as is the target word
    # after a detached redirection operator; a # word ends the scan (trailing
    # comment).
    function segment_runs_shell(seg,    k, n, parts, shell_seen, skip_next, word) {
      n = split(seg, parts, /[[:space:]]+/)
      shell_seen = 0
      skip_next = 0
      for (k = 1; k <= n; k++) {
        word = parts[k]
        if (word == "") {
          continue
        }
        if (skip_next) {
          skip_next = 0
          continue
        }
        if (word ~ /^#/) {
          break
        }
        if (!shell_seen) {
          if (word == "env" || word ~ /^[A-Za-z_][A-Za-z0-9_]*=/ || word ~ /^-/) {
            continue
          }
          sub(/^.*\//, "", word)
          if (word !~ /^(r?bash|sh|dash|ash|ksh|ksh93|mksh|zsh|yash)$/) {
            return 0
          }
          shell_seen = 1
          continue
        }
        if (word ~ /^-[A-Za-z]*[cn]/) {
          return 0
        }
        if (word ~ /^[0-9]*(>>?|<)$/) {
          skip_next = 1
          continue
        }
        if (word ~ /^-/ || word ~ /[<>]/) {
          continue
        }
        return 0
      }
      return shell_seen
    }

    # Conservative stdin-consumer check for a declaration with PRE before the
    # << and POST after the delimiter word on the same line. The declaration
    # sits inside one command segment, so the text on both sides of the
    # <<WORD token is rejoined before the scan: an operand after it
    # (bash <<EOF script.sh) counts exactly like one before it. Later
    # segments are scanned on their own (covers cat <<EOF | bash). Splitting
    # is raw text — quotes are not modeled, which can only over-mark a body
    # as executable (it is then retained for the policy scan, never hidden).
    function heredoc_feeds_shell(pre, post,    k, n, parts, seg) {
      n = split(pre, parts, /[;&|()]+/)
      seg = parts[n]
      n = split(post, parts, /[;&|()]+/)
      if (segment_runs_shell(seg " " parts[1])) {
        return 1
      }
      for (k = 2; k <= n; k++) {
        if (segment_runs_shell(parts[k])) {
          return 1
        }
      }
      return 0
    }

    function scan_heredoc_declarations(line,    ch, closed, delimiter, i, indent_mode, j, length_line, malformed, nxt, quote, quoted, word_start) {
      length_line = length(line)
      i = 1
      # A fresh physical line starts a shell word unless it continues a quote.
      # Within a word, escaped whitespace/metacharacters do not make a later #
      # a comment opener.
      word_start = (shell_quote == "")
      while (i <= length_line) {
        ch = substr(line, i, 1)

        if (shell_quote != "") {
          if (ch == shell_quote) {
            shell_quote = ""
          } else if (shell_quote == "\"" && ch == "\\") {
            i++
          }
          i++
          continue
        }

        if (ch == "\\") {
          word_start = 0
          i += 2
          continue
        }
        if (ch == "\047" || ch == "\"") {
          shell_quote = ch
          word_start = 0
          i++
          continue
        }

        # $((...)) / ((...)) arithmetic: a << inside is a shift operator, not
        # a heredoc declaration. Track parens only to find where the span ends.
        if (decl_arith_depth > 0) {
          if (ch == "(") {
            decl_arith_depth++
          } else if (ch == ")") {
            decl_arith_depth--
          }
          i++
          continue
        }
        if (substr(line, i, 3) == "$((") {
          decl_arith_depth = 2
          word_start = 0
          i += 3
          continue
        }
        if (substr(line, i, 2) == "((" && word_start) {
          decl_arith_depth = 2
          i += 2
          continue
        }

        if (ch == "#" && word_start) {
          break
        }
        if (ch ~ /[[:space:];&|()<>]/) {
          word_start = 1
        } else {
          word_start = 0
        }
        if (substr(line, i, 3) == "<<<") {
          i += 3
          continue
        }
        if (substr(line, i, 2) != "<<") {
          i++
          continue
        }

        j = i + 2
        indent_mode = ""
        ch = substr(line, j, 1)
        if (ch == "-" || ch == "~") {
          indent_mode = ch
          j++
        }
        while (substr(line, j, 1) == " " || substr(line, j, 1) == "\t") {
          j++
        }

        # POSIX: the delimiter is the word after << with quote removal
        # applied. Quoting ANY part of it (\X, aXa, "X", a"X") suppresses
        # body expansion, and the terminator matches the dequoted word.
        delimiter = ""
        quoted = 0
        malformed = 0
        while (j <= length_line) {
          ch = substr(line, j, 1)
          if (ch == "\\") {
            if (j == length_line) {
              malformed = 1
              break
            }
            quoted = 1
            delimiter = delimiter substr(line, j + 1, 1)
            j += 2
            continue
          }
          if (ch == "\047" || ch == "\"") {
            quote = ch
            closed = 0
            j++
            while (j <= length_line) {
              ch = substr(line, j, 1)
              if (ch == quote) {
                closed = 1
                j++
                break
              }
              if (quote == "\"" && ch == "\\") {
                # POSIX: inside "..." a backslash is special only before
                # $ ` " \; elsewhere it stays a literal delimiter character.
                nxt = substr(line, j + 1, 1)
                if (nxt == "$" || nxt == "`" || nxt == "\"" || nxt == "\\") {
                  j++
                  ch = nxt
                }
              }
              delimiter = delimiter ch
              j++
            }
            if (!closed) {
              malformed = 1
              break
            }
            quoted = 1
            continue
          }
          if (ch ~ /[[:space:];&|()<>]/) {
            break
          }
          delimiter = delimiter ch
          j++
        }

        # An empty or malformed delimiter word is not modeled: skip the
        # operator and leave the text visible (fail closed).
        if (malformed || delimiter == "") {
          word_start = 1
          i += 2
          continue
        }
        queue_heredoc(delimiter, indent_mode, quoted, \
          heredoc_feeds_shell(substr(line, 1, i - 1), substr(line, j)))
        word_start = 0
        i = j
      }
    }

    BEGIN {
      heredoc_index = 1
      heredoc_count = 0
      decl_arith_depth = 0
      shell_quote = ""
    }

    {
      line = $0
      if (heredoc_index <= heredoc_count) {
        comparable = line
        if (heredoc_indent[heredoc_index] == "-") {
          sub(/^\t+/, "", comparable)
        } else if (heredoc_indent[heredoc_index] == "~") {
          sub(/^[[:space:]]+/, "", comparable)
        }

        if (comparable == heredoc_delimiter[heredoc_index]) {
          print line
          delete heredoc_delimiter[heredoc_index]
          delete heredoc_indent[heredoc_index]
          delete heredoc_quoted[heredoc_index]
          delete heredoc_executable[heredoc_index]
          delete heredoc_expands[heredoc_index]
          heredoc_index++
        } else if (heredoc_executable[heredoc_index]) {
          # An interpreter executes this body: command text, not data.
          print line
        } else if (!heredoc_quoted[heredoc_index]) {
          # Unquoted bodies undergo expansion. Once a substitution opener
          # appears, any later line may still be inside it: retain the rest
          # of the body wholesale (fail closed) instead of modeling
          # substitution depth, quotes, and comments.
          if (index(line, "$(") > 0 || index(line, "`") > 0) {
            heredoc_expands[heredoc_index] = 1
          }
          if (heredoc_expands[heredoc_index]) {
            print line
          }
        }
        next
      }

      print line
      scan_heredoc_declarations(line)
    }

    END {
      if (heredoc_index <= heredoc_count) {
        exit 1
      }
    }
  ' <<< "$1"
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

ai_policy_has_git_worktree_loss() {
  local cmd="$1"
  local restore_residue

  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}(checkout|switch)[^;&|]*[[:space:]](--force|-[A-Za-z]*f[A-Za-z]*)$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}checkout[^;&|]*[[:space:]]--[[:space:]]+[^;&|]+" && return 0
  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}checkout([^;&|]*[[:space:]])?\.$AI_POLICY_CMD_END" && return 0

  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}restore[^;&|]*[[:space:]](--worktree|-[A-Za-z]*W[A-Za-z]*)$AI_POLICY_CMD_END" && return 0
  restore_residue=$(ai_policy_strip_staged_only_restores "$cmd")
  ai_policy_has_command "$restore_residue" "${AI_POLICY_GIT_CMD}restore([^;&|]*[[:space:]])?(--[[:space:]]+)?(\.|\./[^[:space:];|&'\"]*)$AI_POLICY_CMD_END" && return 0

  ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}stash[[:space:]]+(drop|clear)$AI_POLICY_CMD_END" && return 0
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

ai_policy_has_husky_zero_prefix() {
  local cmd="$1"
  local env_assignment
  local env_option
  local env_option_value
  local git_commit_re
  local husky_prefix
  local split_string_husky_prefix

  env_assignment='[A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|]+'
  env_option_value='[^[:space:];&|]+'
  env_option="(-i|--ignore-environment|--null|--debug|--list-signal-handling|(-u|--unset|-C|--chdir|--argv0|-S|--split-string)[[:space:]]+${env_option_value}|--(unset|chdir|argv0|split-string)=${env_option_value}|--(block-signal|default-signal|ignore-signal)(=${env_option_value})?)"
  git_commit_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit$AI_POLICY_CMD_END"
  husky_prefix="((${env_assignment}[[:space:]]+)*HUSKY=0[[:space:]]+|env[[:space:]]+(${env_option}[[:space:]]+|${env_assignment}[[:space:]]+)*HUSKY=0[[:space:]]+)"
  split_string_husky_prefix="env[[:space:]]+(${env_option}[[:space:]]+)*(-S|--split-string)(=|[[:space:]]+)['\"]?HUSKY=0[[:space:]]+"
  ai_policy_has_command "$cmd" "(${husky_prefix}|${split_string_husky_prefix})[^;&|]*${git_commit_re}" && return 0
  ai_policy_has_command "$cmd" "export([^;&|]*[[:space:]])?HUSKY=0($|[[:space:];&|])" \
    && ai_policy_has_command "$cmd" "$git_commit_re"
}

ai_policy_has_git_commit_hook_bypass_flag() {
  local cmd="$1"
  local git_commit_re

  git_commit_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}commit"
  ai_policy_has_command "$cmd" "${git_commit_re}[^;&|]*[[:space:]]--no-verify$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "${git_commit_re}[^;&|]*[[:space:]]-[A-Za-z]*n[A-Za-z]*$AI_POLICY_CMD_END" && return 0
  return 1
}

ai_policy_has_git_push_hook_bypass_flag() {
  local cmd="$1"
  local git_push_re

  git_push_re="git[[:space:]]+${AI_POLICY_GIT_PRECOMMIT_OPTS}push"
  ai_policy_has_command "$cmd" "${git_push_re}[^;&|]*[[:space:]]--no-verify$AI_POLICY_CMD_END"
}

ai_policy_touches_allow_protected_edits_marker() {
  local cmd="$1"
  local marker_re='[^;&|]*\.allow-protected-edits'

  ai_policy_has_command "$cmd" "touch${marker_re}$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(:|true|printf|echo|cat)${marker_re}(>|>>)[^;&|]*$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(:|true|printf|echo|cat)[^;&|]*(>|>>)[^;&|]*\.allow-protected-edits$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "tee([[:space:]]+-[A-Za-z]+)*${marker_re}$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "(install|cp|mv)${marker_re}$AI_POLICY_CMD_END" && return 0
  return 1
}

ai_policy_load_protected_files() {
  local policy_dir

  declare -F ai_protected_file_deny_entry >/dev/null && return 0

  policy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [ -f "$policy_dir/protected-files.sh" ] || return 1
  # shellcheck source=/dev/null
  . "$policy_dir/protected-files.sh"
}

ai_policy_clean_shell_path_token() {
  local token="$1"

  while [[ "$token" == \"* || "$token" == \'* ]]; do
    token="${token:1}"
  done
  while [[ "$token" == *\" || "$token" == *\' || "$token" == *\; || "$token" == *\& || "$token" == *\| ]]; do
    token="${token%?}"
  done

  printf '%s' "$token"
}

ai_policy_shell_token_ends_segment() {
  local token="$1"

  [[ "$token" == ";" || "$token" == "&&" || "$token" == "||" || "$token" == "|" \
    || "$token" == *";" || "$token" == *"&&" || "$token" == *"||" || "$token" == *"|" ]]
}

ai_policy_resolve_bash_path() {
  local path="$1"
  local candidate repo_root

  [ -n "$path" ] || return 1
  case "$path" in
    -|--|[0-9]|'&'*) return 1 ;;
  esac

  repo_root="${REPO_ROOT:-$(ai_repo_root)}"
  if [[ "$path" = /* ]]; then
    candidate="$path"
  else
    candidate="$repo_root/$path"
  fi

  realpath -m -- "$candidate" 2>/dev/null || printf '%s\n' "$candidate"
}

ai_policy_print_resolved_bash_path() {
  local token="$1"
  local path

  path=$(ai_policy_clean_shell_path_token "$token")
  ai_policy_resolve_bash_path "$path"
}

ai_policy_bash_redirect_path_from_token() {
  local token="$1"
  local path=""

  case "$token" in
    \'*|\"*) return 1 ;;
  esac

  case "$token" in
    *"&>>"*) path="${token##*&>>}" ;;
    *"&>"*) path="${token##*&>}" ;;
    *">|"*) path="${token##*>|}" ;;
    *">>"*) path="${token##*>>}" ;;
    *">"*) path="${token##*>}" ;;
    *) return 1 ;;
  esac

  [ -n "$path" ] || return 1
  printf '%s' "$path"
}

ai_policy_bash_redirect_write_paths() {
  local cmd="$1"
  local -a tokens=()
  local token path expect_target=0

  read -r -a tokens <<< "$cmd"
  for token in "${tokens[@]}"; do
    if [ "$expect_target" -eq 1 ]; then
      ai_policy_print_resolved_bash_path "$token" || true
      expect_target=0
      continue
    fi

    case "$token" in
      \'*|\"*) continue ;;
      ">"|">>"|">|"|[0-9]">"|[0-9]">>"|[0-9]">|"|"&>"|"&>>")
        expect_target=1
        continue
        ;;
      *)
        path=$(ai_policy_bash_redirect_path_from_token "$token") || continue
        ;;
    esac

    ai_policy_print_resolved_bash_path "$path" || true
  done
}

ai_policy_bash_sed_write_paths() {
  local cmd="$1"
  local -a tokens=()
  local token clean active=0 inplace=0 ends_segment

  ai_policy_has_command "$cmd" "sed$AI_POLICY_CMD_END" || return 0

  read -r -a tokens <<< "$cmd"
  for token in "${tokens[@]}"; do
    clean=$(ai_policy_clean_shell_path_token "$token")
    ends_segment=0
    ai_policy_shell_token_ends_segment "$token" && ends_segment=1

    if [ "$active" -eq 1 ]; then
      case "$clean" in
        -i|-[A-Za-z]*i[A-Za-z]*|-i*|--in-place|--in-place=*) inplace=1 ;;
        -*|"") ;;
        *)
          if [ "$inplace" -eq 1 ]; then
            ai_policy_resolve_bash_path "$clean" || true
          fi
          ;;
      esac

      if [ "$ends_segment" -eq 1 ]; then
        active=0
        inplace=0
      fi
      continue
    fi

    if [ "$clean" = "sed" ]; then
      active=1
      inplace=0
    fi
  done
}

ai_policy_bash_tee_write_paths() {
  local cmd="$1"
  local -a tokens=()
  local token clean active=0 ends_segment

  ai_policy_has_command "$cmd" "tee$AI_POLICY_CMD_END" || return 0

  read -r -a tokens <<< "$cmd"
  for token in "${tokens[@]}"; do
    clean=$(ai_policy_clean_shell_path_token "$token")
    ends_segment=0
    ai_policy_shell_token_ends_segment "$token" && ends_segment=1

    if [ "$active" -eq 1 ]; then
      case "$clean" in
        -*|"") ;;
        *) ai_policy_resolve_bash_path "$clean" || true ;;
      esac

      if [ "$ends_segment" -eq 1 ]; then
        active=0
      fi
      continue
    fi

    if [ "$clean" = "tee" ]; then
      active=1
    fi
  done
}

ai_policy_emit_copy_like_paths() {
  local command_name="$1"
  shift
  local -a paths=("$@")
  local path last_index

  [ "${#paths[@]}" -gt 0 ] || return 0

  if [ "$command_name" = "mv" ]; then
    for path in "${paths[@]}"; do
      ai_policy_resolve_bash_path "$path" || true
    done
    return 0
  fi

  last_index=$((${#paths[@]} - 1))
  ai_policy_resolve_bash_path "${paths[$last_index]}" || true
}

ai_policy_bash_copy_like_write_paths() {
  local cmd="$1"
  local -a tokens=()
  local -a paths=()
  local token clean active=0 command_name="" ends_segment

  ai_policy_has_command "$cmd" "(cp|install|mv)$AI_POLICY_CMD_END" || return 0

  read -r -a tokens <<< "$cmd"
  for token in "${tokens[@]}"; do
    clean=$(ai_policy_clean_shell_path_token "$token")
    ends_segment=0
    ai_policy_shell_token_ends_segment "$token" && ends_segment=1

    if [ "$active" -eq 1 ]; then
      case "$clean" in
        -*|"") ;;
        *) paths+=("$clean") ;;
      esac

      if [ "$ends_segment" -eq 1 ]; then
        ai_policy_emit_copy_like_paths "$command_name" "${paths[@]}"
        active=0
        command_name=""
        paths=()
      fi
      continue
    fi

    case "$clean" in
      cp|install|mv)
        active=1
        command_name="$clean"
        paths=()
        ;;
    esac
  done

  [ "$active" -eq 1 ] && ai_policy_emit_copy_like_paths "$command_name" "${paths[@]}"
}

ai_policy_bash_write_candidate_paths() {
  local cmd="$1"

  ai_policy_bash_redirect_write_paths "$cmd"
  ai_policy_bash_sed_write_paths "$cmd"
  ai_policy_bash_tee_write_paths "$cmd"
  ai_policy_bash_copy_like_write_paths "$cmd"
}

ai_policy_bash_protected_file_write_context() {
  local cmd="$1"
  local abs entry deny marker

  ai_policy_load_protected_files || return 1

  while IFS= read -r abs; do
    [ -n "$abs" ] || continue
    if entry=$(ai_protected_file_deny_entry "$abs"); then
      deny="${entry#*$'\t'}"
      marker=$(ai_protected_files_allow_marker_path)
      if ai_protected_files_allow_marker_enabled; then
        printf 'protected-files: Repo-wide protected edit override marker is active: %s. Without that marker, this Bash write would have been denied for %s. Remove the marker after this deliberate maintenance. %s' "$marker" "$abs" "$deny"
      else
        printf 'protected-files: %s' "$deny"
      fi
      return 0
    fi
  done < <(ai_policy_bash_write_candidate_paths "$cmd")

  return 1
}

ai_policy_bash_protected_file_violation_reason() {
  local cmd="$1"
  local context

  ai_policy_load_protected_files || return 1
  context=$(ai_policy_bash_protected_file_write_context "$cmd") || return 1
  ai_protected_files_allow_marker_enabled && return 1
  printf '%s' "$context"
}

ai_policy_bash_protected_file_advisory() {
  local cmd="$1"
  local context

  ai_policy_load_protected_files || return 1
  ai_protected_files_allow_marker_enabled || return 1
  context=$(ai_policy_bash_protected_file_write_context "$cmd") || return 1
  printf '%s' "$context"
}

ai_policy_advisory_context() {
  local cmd="$1"
  local advisory stripped

  # Advisory scanners are policy guards too: ignore well-formed heredoc data,
  # but keep matching raw text if a terminator is missing.
  if stripped=$(ai_strip_noncommand_text "$cmd"); then
    cmd="$stripped"
  fi

  if ai_policy_touches_allow_protected_edits_marker "$cmd"; then
    printf '%s' "$AI_POLICY_ALLOW_PROTECTED_EDITS_ADVISORY"
    return 0
  fi

  if advisory=$(ai_policy_bash_protected_file_advisory "$cmd"); then
    printf '%s' "$advisory"
    return 0
  fi

  return 1
}

ai_policy_has_gh_api_explicit_get() {
  ai_policy_has_command "$1" "gh[[:space:]]+api[^;&|]*[[:space:]]((--method(=|[[:space:]]+)|-X[[:space:]]*)[Gg][Ee][Tt])$AI_POLICY_CMD_END"
}

ai_policy_has_gh_api_visible_graphql_query() {
  local cmd="$1"

  ai_policy_has_command "$cmd" "gh[[:space:]]+api[[:space:]]+graphql" || return 1
  grep -qE -- '(^|[[:space:]])(-f|-F|--field|--raw-field)[[:space:]]+query=['"'"'"]?(query|\{)' <<< "$cmd" || return 1
  ! grep -qiE -- 'mutation[[:space:]]*(\{|[[:alpha:]_])' <<< "$cmd"
}

ai_policy_has_gh_api_mutation() {
  local cmd="$1"

  ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]]((--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Oo][Ss][Tt]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Uu][Tt]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Pp][Aa][Tt][Cc][Hh]|(--method(=|[[:space:]]+)|-X[[:space:]]*)[Dd][Ee][Ll][Ee][Tt][Ee])$AI_POLICY_CMD_END" && return 0
  ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]]--input($|[[:space:]=])" && return 0
  if ai_policy_has_command "$cmd" "gh[[:space:]]+api[^;&|]*[[:space:]](-f|-F|--field|--raw-field)([[:space:]=]|$)"; then
    ai_policy_has_gh_api_explicit_get "$cmd" && return 1
    ai_policy_has_gh_api_visible_graphql_query "$cmd" && return 1
    return 0
  fi

  return 1
}

ai_policy_violation_reason() {
  local cmd="$1"
  local work_root="${2:-}"
  local rebase_residue stripped

  # Central boundary for every hard policy scanner, including direct callers
  # such as bash-pre-tool-use.sh and no-direct-db.sh. A missing terminator keeps
  # CMD raw so malformed heredocs cannot hide a forbidden executable command.
  if stripped=$(ai_strip_noncommand_text "$cmd"); then
    cmd="$stripped"
  fi

  if ai_policy_has_husky_zero_prefix "$cmd" \
    || ai_policy_has_git_commit_hook_bypass_flag "$cmd" \
    || ai_policy_has_git_push_hook_bypass_flag "$cmd"; then
    printf '%s' "$AI_POLICY_HOOK_BYPASS"
    return 0
  fi

  if ai_policy_has_command "$cmd" "(psql|pgcli|pg_dump|pg_restore|pg_isready|createdb|dropdb)$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_POSTGRES"
    return 0
  fi

  if ai_policy_has_command "$cmd" "redis-cli$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_REDIS"
    return 0
  fi

  if ai_policy_has_command "$cmd" "docker(-compose)?$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_DOCKER"
    return 0
  fi

  if grep -qF 'ThisIsNotTheRealDatabasePassword' <<< "$cmd"; then
    printf '%s' "$AI_POLICY_CHANGEME"
    return 0
  fi

  if ai_policy_bash_protected_file_violation_reason "$cmd"; then
    return 0
  fi

  # Match `git commit … --amend` and global-option forms such as
  # `git -c <cfg> commit … --amend`. `--amend` must still appear, so
  # `git commit -c <commit>` (reuse-message, not an amend) is not matched.
  if ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}commit[^;&|]*[[:space:]]--amend$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GIT_AMEND"
    return 0
  fi

  rebase_residue=$(ai_policy_strip_allowed_rebase_controls "$cmd")
  if ai_policy_has_command "$rebase_residue" "${AI_POLICY_GIT_CMD}rebase$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$rebase_residue" "${AI_POLICY_GIT_CMD}rebase[[:space:]]+"; then
    printf '%s' "$AI_POLICY_GIT_REBASE"
    return 0
  fi

  if ai_policy_has_dangerous_git_reset "$cmd"; then
    printf '%s' "$AI_POLICY_GIT_RESET"
    return 0
  fi

  if ai_policy_has_git_worktree_loss "$cmd"; then
    printf '%s' "$AI_POLICY_GIT_WORKTREE_LOSS"
    return 0
  fi

  if ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}(filter-branch|filter-repo|replace|update-ref)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}reflog[[:space:]]+expire[^;&|]*--expire=now[^;&|]*--all"; then
    printf '%s' "$AI_POLICY_GIT_HISTORY_REWRITE"
    return 0
  fi

  if ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push[^;&|]*[[:space:]]((--force|--force-with-lease)(=[^[:space:];|&'\"]*)?|--mirror|--delete|--prune)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push[^;&|]*[[:space:]]-[A-Za-z]*[fd][A-Za-z]*$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push[^;&|]*[[:space:]]\\+[^[:space:];|&'\"]+" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}push[^;&|]*[[:space:]]:[^[:space:];|&'\"]+"; then
    printf '%s' "$AI_POLICY_GIT_FORCE_PUSH"
    return 0
  fi

  if ai_policy_has_git_push_to_main "$cmd" "$work_root"; then
    printf '%s' "$AI_POLICY_GIT_PUSH_MAIN"
    return 0
  fi

  if ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*[[:space:]]-D$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*[[:space:]]-[A-Za-z]*D[A-Za-z]*$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*[[:space:]]-[A-Za-z]*d[A-Za-z]*f[A-Za-z]*$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*d[A-Za-z]*$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*[[:space:]]-[A-Za-z]*d[A-Za-z]*[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*[^;&|]*[[:space:]]-[A-Za-z]*d[A-Za-z]*" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*--delete[^;&|]*--force" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*--force[^;&|]*--delete" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*--delete[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*[^;&|]*--delete" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}branch[^;&|]*[[:space:]](--force|-[A-Za-z]*[fMC][A-Za-z]*)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}tag[^;&|]*[[:space:]]+(-[A-Za-z]*d[A-Za-z]*|--delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}tag[^;&|]*[[:space:]]+(--force|-[A-Za-z]*f[A-Za-z]*)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}worktree[[:space:]]+remove[^;&|]*[[:space:]]--force$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}worktree[[:space:]]+remove[^;&|]*[[:space:]]-[A-Za-z]*f[A-Za-z]*$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GIT_BRANCH_FORCE_DELETE"
    return 0
  fi

  if ai_policy_has_command "$cmd" "${AI_POLICY_GIT_CMD}clean[^;&|]*[[:space:]](--force|-[A-Za-z]*f[A-Za-z]*)$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GIT_CLEAN_FORCE"
    return 0
  fi

  if ai_policy_has_command "$cmd" "gh[[:space:]]+auth[[:space:]]+(token|login|logout|refresh|setup-git)$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GH_AUTH"
    return 0
  fi

  if ai_policy_has_command "$cmd" "gh[[:space:]]+pr[[:space:]]+(create|comment|merge|close|reopen|ready|edit|lock|unlock|review)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+issue[[:space:]]+(create|comment|close|reopen|edit|delete|develop|lock|unlock|transfer|pin|unpin)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+repo[[:space:]]+(create|fork|delete|archive|rename|transfer|edit|sync|set-default)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+repo[[:space:]]+deploy-key[[:space:]]+(add|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+release[[:space:]]+(create|edit|delete|delete-asset|upload)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+workflow[[:space:]]+(disable|enable|run)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+run[[:space:]]+(cancel|rerun|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+cache[[:space:]]+delete$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+secret[[:space:]]+(set|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+variable[[:space:]]+(set|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_gh_api_mutation "$cmd" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+codespace[[:space:]]+(create|delete|edit|rebuild|stop)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+gist[[:space:]]+(create|edit|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+(gpg-key|ssh-key)[[:space:]]+(add|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+label[[:space:]]+(create|edit|delete|clone)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+alias[[:space:]]+(set|delete)$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+config[[:space:]]+set$AI_POLICY_CMD_END" \
    || ai_policy_has_command "$cmd" "gh[[:space:]]+extension[[:space:]]+(install|remove|upgrade)$AI_POLICY_CMD_END"; then
    printf '%s' "$AI_POLICY_GH_REMOTE_MUTATION"
    return 0
  fi

  # Checked last so command-specific violations (amend, bypass, …) win first:
  # a plain `git commit` is otherwise allowed, and we only block it on the
  # protected branch where work must land on a feature branch instead.
  if ai_policy_has_git_commit_on_main "$cmd" "$work_root"; then
    printf '%s' "$AI_POLICY_GIT_COMMIT_ON_MAIN"
    return 0
  fi

  return 1
}

# Soft-guidance policies nudge toward a better command instead of forbidding an
# action. No soft guidance policies are currently active.
ai_policy_is_soft_guidance() {
  return 1
}

# Self-block guard for *executing* hooks. PreToolUse Bash hooks that run the
# command themselves (`bash -c "$CMD"`) must never run a policy-violating command:
# the executing hook's side effect lands regardless of what no-direct-db.sh or the
# harness deny globs decide in parallel (G1 — the amend rewrote HEAD even though
# the agent saw a "blocked" message). Call this *before* the lock/exec so a
# forbidden command is denied before any mutation.
# Requires ai_emit_block from common.sh (executing hooks already source it).
ai_preflight_or_block() {
  local cmd="$1"
  local work_root="${2:-}"
  local reason

  if reason=$(ai_policy_violation_reason "$cmd" "$work_root"); then
    ai_policy_is_soft_guidance "$reason" && return 0
    ai_emit_block "$reason"
  fi
  return 0
}

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

ai_is_git_commit_dry_run() {
  [[ "$1" =~ (^|[[:space:]])--dry-run($|[[:space:]]) ]]
}

ai_has_force_verify_prefix() {
  [[ "$1" =~ ^FORCE_VERIFY=1[[:space:]]+ ]]
}

ai_strip_force_verify_prefix() {
  local cmd="$1"
  if ai_has_force_verify_prefix "$cmd"; then
    printf '%s' "${cmd#FORCE_VERIFY=1 }"
  else
    printf '%s' "$cmd"
  fi
}

ai_is_wrapped_bun_cmd() {
  [[ "$1" =~ $AI_WRAPPED_BUN_RE ]]
}

ai_bun_script_from_cmd() {
  printf '%s' "$1" | awk '{print $3}'
}

ai_bun_script_bypasses_cache() {
  case "$1" in
    code:intel|verify:logs|verify:async:status|verify:async:tail|verify:async:stop)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ai_bun_cmd_bypasses_cache() {
  ai_is_wrapped_bun_cmd "$1" || return 1
  ai_bun_script_bypasses_cache "$(ai_bun_script_from_cmd "$1")"
}

ai_bun_cmd_bypasses_lock() {
  ai_bun_cmd_bypasses_cache "$1"
}

ai_safe_script_name() {
  local script="$1"
  printf '%s' "${script//:/_}"
}

# Fingerprint of the argv tail after `bun run <script>`, used to scope the cache
# marker to the EXACT command (H1/H2). Without this the marker keys only on the
# script name, so `bun run test -- a` and `bun run test -- a b` share a marker
# and a broader (or corrected) command replays a narrower run's cached pass/fail
# on an unchanged worktree.
#
# Normalization rules (correctness over dedup cleverness — see backlog H1):
#   - Whitespace runs collapse to single spaces (tabs/newlines too).
#   - Options keep their exact order; option order is semantically meaningful
#     (`--bail --reporter=x` != `--reporter=x --bail`), so we never sort them.
#   - ONLY the file operands AFTER a `--` separator are sorted, because a `--`
#     tail is a safely-parsed file list where order does not change which tests
#     run. The `--` separator itself is preserved so a tail differs from a
#     same-token option run.
# The wrapped-bun whitelist restricts argv to `[A-Za-z0-9._:/=-]` tokens and
# `--`, so plain whitespace word-splitting here is safe (no quotes/globs).
ai_bun_argv_fingerprint() {
  local cmd="$1"
  local -a tokens=()
  local -a pre=()
  local -a post=()
  local tail seen_sep=0 tok normalized

  # Drop `bun run <script>`; keep the rest as the argv tail.
  read -r -a tokens <<< "$cmd"
  tail="${tokens[*]:3}"

  seen_sep=0
  for tok in $tail; do
    if [ "$seen_sep" -eq 0 ] && [ "$tok" = "--" ]; then
      seen_sep=1
      continue
    fi
    if [ "$seen_sep" -eq 1 ]; then
      post+=("$tok")
    else
      pre+=("$tok")
    fi
  done

  normalized="${pre[*]}"
  if [ "$seen_sep" -eq 1 ]; then
    # Sort only the post-`--` file operands; re-attach behind the separator.
    local sorted
    sorted=$(printf '%s\n' "${post[@]}" | LC_ALL=C sort | tr '\n' ' ')
    sorted="${sorted% }"
    normalized="${normalized:+$normalized }-- $sorted"
  fi

  printf '%s' "$normalized" | sha256sum | cut -c1-16
}

# Marker filename for a wrapped bun command: `last.<script_safe>.<argv_fp>`.
# Baking the argv fingerprint into the filename (rather than an in-marker field)
# keeps the schema simple and avoids cross-argv collisions. All three call sites
# — Claude bun-run-quiet.sh and the Codex pre/post hooks — derive the marker
# through this helper so they stay in lockstep.
ai_bun_marker_name() {
  local cmd="$1"
  local script script_safe argv_fp
  script=$(ai_bun_script_from_cmd "$cmd")
  script_safe=$(ai_safe_script_name "$script")
  argv_fp=$(ai_bun_argv_fingerprint "$cmd")
  printf 'last.%s.%s' "$script_safe" "$argv_fp"
}

ai_append_flaky_note() {
  local script="$1"
  local summary="$2"

  case "$script" in
    *test*|*e2e*)
      printf '%s\n\n%s' "$summary" "$AI_FLAKY_NOTE"
      ;;
    *)
      printf '%s' "$summary"
      ;;
  esac
}
