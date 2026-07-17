# 08 — Changed-file collection loop copy-pasted across three scripts

Status: Done
Track: T (tooling) · Priority: P2 · Size: M

## Evidence (verified 2026-07-11; re-verified in 2026-07-11 adversarial triage; re-verify before implementing)

- `path_policy_has_match()` is defined byte-identically three times:
  `scripts/lint-changed.sh:33-38`, `scripts/lint-config-sensors.sh:99-104`,
  `scripts/lint-agent-changed.sh:46-51`.
- `scripts/lint-changed.sh:95-118`, `scripts/lint-config-sensors.sh:189-209`,
  and `scripts/lint-agent-changed.sh:147-175` — each re-implements the same
  NUL-delimited changed-candidate collection (`git diff -z --name-only
  --diff-filter=ACMRD base...HEAD` plus `--cached`) and the
  `path_policy_has_match full-scan-trigger:*` escalation check.
- The loops are deliberately NOT identical — a shared helper must preserve
  two divergences, not flatten them:
  - Diff sources: `lint-agent-changed.sh:151-163` additionally includes
    unstaged diffs and untracked files (`git ls-files --others
    --exclude-standard`) because agents create files without staging; the
    other two instead hard-fail on unstaged source-relevant work via
    `musi_changed_gate_fail_if_unstaged`.
  - Post-collection filtering: only `lint-changed.sh:113-118` and
    `lint-agent-changed.sh:170-175` share the `lintable:<class>` filter +
    `SEEN` dedupe + `[ -f ]` existence loop. `lint-config-sensors.sh`
    fans candidates into five `config-surface:*` buckets via
    `collect_config_sensor_candidates` (lines 134-159) with per-category
    dedupe, and has no single `lintable:*` class.
- `scripts/lib/changed-base.sh` already models the fix — base-ref resolution
  was factored once and sourced everywhere.
- Same collection idiom (without escalation) also appears in
  `scripts/format-changed.sh:58-81` (diff-filter=ACMR, includes unstaged)
  and `scripts/lint-shell.sh:93-98`; candidate later adopters, out of scope
  here.

## Do

Factor a `scripts/lib/changed-lintable-files.sh` exposing three shared
primitives, sourced by all three scripts:

1. `path_policy_has_match` (single definition).
2. A changed-candidate collector filling `CHANGED_FILES`, parametrized on
   whether unstaged + untracked files are included (agent mode) or only
   `base...HEAD` + `--cached` (gate mode).
3. The `full-scan-trigger:<class>` escalation check.

Additionally factor the `lintable:<class>` filter/dedupe/existence loop for
the two consumers that share it (`lint-changed.sh`,
`lint-agent-changed.sh`). `lint-config-sensors.sh` keeps its multi-bucket
`config-surface:*` fanning but consumes the shared collector and escalation
check. Full-scan fallback behavior (parallel full lint / `collect_full_files`
/ `exec lint-agent.ts`) stays in each consumer.

## Verify

```
bash scripts/tests/test-lint-changed.sh
bash scripts/tests/test-lint-config-sensors.sh
bash scripts/tests/test-lint-agent-changed.sh
bun run test:scripts:changed
```

## Acceptance

The diff-collection and full-scan-escalation logic and
`path_policy_has_match` each have exactly one definition; the three
consumers declare only their path-policy classes, full-scan trigger, and
diff-source mode. The agent script still picks up untracked/unstaged files;
the two gate scripts still see only base + staged changes.
