#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${LINT_RATCHET_COMMENT_MARKER:?LINT_RATCHET_COMMENT_MARKER is required}"
: "${PR_NUMBER:?PR_NUMBER is required}"

pr_number="$PR_NUMBER"
marker="$LINT_RATCHET_COMMENT_MARKER"

post_comment() {
  # With --paginate, gh runs --jq once per page, so a `// ""` default
  # would emit one empty line per non-matching page and, on a PR with
  # more than one page of comments, give comment_id embedded newlines.
  # Emit only real matches (select drops non-matches with no default),
  # then take the first non-empty line as the id.
  if ! matching_ids="$(
    gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$pr_number/comments" \
      --jq ".[] | select(.body | contains(\"$marker\")) | .id"
  )"; then
    return 1
  fi
  comment_id="$(printf '%s\n' "$matching_ids" | grep -m1 . || true)"

  if [ -n "$comment_id" ]; then
    # gh --field body=@file reads the file contents into the request field.
    gh api "repos/$GITHUB_REPOSITORY/issues/comments/$comment_id" \
      --method PATCH \
      --field body=@lint-ratchet-report.md >/dev/null
  else
    gh pr comment "$pr_number" --body-file lint-ratchet-report.md >/dev/null
  fi
}

post_comment
