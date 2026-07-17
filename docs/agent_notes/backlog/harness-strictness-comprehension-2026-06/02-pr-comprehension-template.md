# 02 - PR comprehension template

Status: Done — `.github/pull_request_template.md` now opens with the `## Intent / Comprehension` section (`1fdea456`). Proposed change below is retained as the original finding.

## Problem

The PR template is intentionally small and already keeps the important local
gate in the test plan:

```md
- [ ] `bun run verify:changed`
```

It does not currently require the author or human sponsor to state the intended
behavior in plain language. The harness research's strongest process point is
that human accountability depends on comprehension: do not merge code the
sponsor cannot explain.

## Proposed Change

Update `.github/pull_request_template.md` with one required comprehension line
near the top, while preserving the existing `verify:changed` checkbox.

Suggested shape:

```md
## Intent / Comprehension

- I can explain why this change is needed and how the main code path works:

## Summary

-

## Risk

- Risk level:
- Notes:

## Test Plan

- [ ] `bun run verify:changed`
```

The exact heading can be bikeshedded, but it should stay short and hard to
misread. "Intent / Comprehension" is explicit enough for AI-assisted PRs without
turning the template into process theater.

## Optional Follow-Up

If blank sections keep appearing, add a lightweight CI/template check that fails
only when the PR body leaves the line empty or repeats boilerplate. Keep that out
of the first PR unless there is already a suitable PR-body validation workflow.

## TDD / Verification

- This is a docs/process template change; no runtime tests are expected.
- Verify the template renders cleanly in Markdown.
- Keep `bun run verify:changed` in the test plan unchanged.

## Acceptance Criteria

- `.github/pull_request_template.md` includes an explicit intent/comprehension
  prompt before risk and testing.
- The existing `bun run verify:changed` checkbox remains present.
- The template remains short enough that contributors will actually fill it out.

## Risks

- A required sentence can become boilerplate. If that happens, promote the
  optional PR-body check or tighten reviewer expectations.
- Too much process text would dilute the useful signal. Keep the template small.
