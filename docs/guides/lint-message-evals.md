# Lint Message Evals

Use `bun run eval:lint-messages` to replay Musi's small treatment/control lint-message eval. It measures how many edit-and-lint iterations each recorded arm needed to make the same fixture green under the current structural rule cluster.

This is a message experiment, not a model benchmark. The control arm receives the raw ESLint diagnostic. The treatment arm receives that same diagnostic plus the current `why` and `howToFix` envelope overlay. Both arms start from byte-identical source and are parsed with `typescript-eslint`, including TypeScript annotations and TSX syntax. Grading is intentionally limited to these four structural rules and production limits:

- `complexity` at 10;
- `max-depth` at 3;
- `max-lines-per-function` at 100 effective lines;
- `max-params` at 4.

In this lane, “green” means that the submitted complete-source snippet parses
and has no findings from those four rules. It does **not** mean the snippet
typechecks, preserves exported APIs or call sites, passes the complete Musi
ESLint configuration, or satisfies runtime tests. Parse failures are
infrastructure errors rather than repair outcomes; type/API/full-config
validation belongs to a broader evaluator, not this structural message grader.

The runner reports iterations to green and detects three interaction failures: a rule is **stuck** when it survives every attempt, **oscillating** when it disappears and later returns, and **cascading** when an attempt introduces a rule absent from the initial fixture. Unresolved arms remain report data; malformed traces, unparsable attempts, and stale recorded messages are infrastructure errors.

## Run and inspect

The default command replays the committed pilot trace and writes gitignored reports:

```sh
bun run eval:lint-messages
cat reports/lint-message-eval/latest.md
```

Use explicit paths to grade another captured trace:

```sh
bun run eval:lint-messages -- \
  --trace scripts/fixtures/lint-message-eval/my-run.json \
  --output reports/lint-message-eval/my-run.md \
  --json-output reports/lint-message-eval/my-run.json
```

The weekly slow-drift workflow replays the committed trace and uploads both report formats as `slow-drift-lint-message-eval`. This scheduled replay proves the recorded prompts, TypeScript parsing, source attribution, and structural grading still match the current lint surface; it does not call a model or measure fresh treatment-versus-control behavior.

The committed pilot sources are exact line-span copies of findings frozen by
the production function-structure ratchets. Its focused test compares each
copy with the attributed repository `file:start-end` span, so a synthetic or
misattributed source cannot silently replace the real Musi corpus.

## Capture a fresh run

1. Choose two or more small, real Musi violations frozen by the lint-ratchet baseline and record their exact file, start line, and end line. Keep unrelated structural diagnostics out of the starting source.
2. Open separate, fresh agent sessions for each arm and randomize arm order. Do not show one arm's output to the other.
3. Give both sessions the same task and source. Give the control session only the raw ESLint message; give the treatment session the raw message plus the envelope `Why` and `How to fix` text.
4. After each complete-source response, parse it with `typescript-eslint` and lint it with the four-rule cluster. If findings remain, return only the current diagnostics and request another complete-source response. Stop when structurally green or after five attempts. Run typecheck, API/call-site checks, the full ESLint configuration, and relevant tests separately if the experiment intends to claim a production-valid repair.
5. Record every complete-source attempt in order, the full evaluated commit SHA, the exact presented message, agent/model identity, and sampling caveats. Do not edit a response before recording it.
6. Run the evaluator with explicit trace/output paths. Commit the trace and Markdown report together only after the focused eval test passes.

The exact message strings are deliberate freshness locks. If an overlay or ESLint version changes them, replay fails with `stale control message` or `stale treatment message`; capture a fresh behavior sample instead of updating the prompt text while retaining old responses.

## Interpretation

Compare arms per fixture first, then averages only across resolved arms. Report unresolved counts beside averages so failed arms cannot disappear from the headline. A one-session pilot can validate plumbing but cannot establish that treatment wording is better; use independent sessions, repeated samples, and more than one rule before drawing that conclusion.

Committed pilot: [`docs/agent_notes/evals/2026-07-15-lint-message-eval.md`](../agent_notes/evals/2026-07-15-lint-message-eval.md).
