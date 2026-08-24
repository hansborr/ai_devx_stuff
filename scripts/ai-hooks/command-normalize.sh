#!/bin/bash

# Heredoc-aware normalization of command text for the shared policy layer.
#
# COPIED VERBATIM out of policy.sh. Do not reimplement, retune, or tidy the awk
# program below. Its specification is the header comments in this file plus the
# shell corpus (scripts/ai-hooks/test.sh and its test-*.sh siblings) — nothing
# else records the conservative semantics it encodes, and every rule here is
# deliberately narrower than a shell parser so unmodeled text stays
# policy-visible.

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

# Completion sentinel: policy.sh resets this before sourcing and fails closed
# unless this module reaches its final statement. An empty or truncated module
# still sources cleanly, so this is what proves the definitions above ran.
# shellcheck disable=SC2034 # read by policy.sh's module guard, which sources this file
declare -g AI_POLICY_MODULE_COMMAND_NORMALIZE_COMPLETE=1
