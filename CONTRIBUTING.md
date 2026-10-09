# Contributing to Musi

This is the short human path from a clone to a reviewed pull request. It routes
rather than repeats. The authorities are [`README.md`](README.md) for setup and
the everyday commands, [`docs/guides/`](docs/guides/) for task recipes,
[`docs/generated/command-catalog.md`](docs/generated/command-catalog.md) for the
full script inventory, and [`.husky/`](.husky/) for what the hooks actually
enforce.

[`AGENTS.md`](AGENTS.md) is the control file for AI agents working in this
repository. It overlaps with this guide but carries agent-only policy; as a
human contributor, read this file instead. See
[`docs/README.md`](docs/README.md) for the rest of the documentation index.

Get the project running first — [`README.md`](README.md#running-the-vtt) covers
prerequisites, environment, and `bun run dev`. `bun run doctor` diagnoses a
local setup that is not behaving.

## 1. Branch before you commit

Work on a `feat/...` or `fix/...` branch:

```bash
git switch -c fix/short-slug
```

`main` is protected locally. Step 0 of [`.husky/pre-commit`](.husky/pre-commit)
refuses a direct commit on `main` or `master`, whichever directory you run
`git commit` from. Work reaches the protected branch by merge, not by direct
commit.

## 2. Make focused changes, and verify them focused

Read the task guide for the area you are touching before you edit it.
[`docs/guides/`](docs/guides/) covers tRPC procedures, Prisma migrations, socket
broadcasts, race-sensitive mutations, client effects and cache, e2e tests, rules
logic, and the lint ratchet; the Guides table in
[`docs/ai-harness.md`](docs/ai-harness.md) indexes them all. If the directory you
are editing has a `MODULE.md`, read that too.

While building, run the focused tests for the files you changed — the
[Scripts](README.md#scripts) section of the README lists the everyday commands
and how to run a single test file. `bun run verify:changed` is the manual
changed-tree check, and the commit gate runs the same slot set, so an ordinary
commit already covers it — including the pull-request Test Plan box. Run it
yourself when you are not committing yet, when you are troubleshooting a gate
failure, or after fast-commit mode (step 4) let a commit skip the slow slots.

## 3. Commit — the gate is the verification step

Commit in logical units and let the pre-commit gate run; on failure it prints
an excerpt from each failing check and the path to that check's full log. Do
not reach for `--no-verify` or `HUSKY=0`; fix the failure instead.

[`.husky/commit-msg`](.husky/commit-msg) runs commitlint, so the message shape
is enforced rather than advised:

```text
<type>(<scope>): <subject, 20-100 characters>

<body, at least 40 characters>
```

The scope is required and kebab-case, and the blank line before the body is
mandatory. Trailers such as `Co-Authored-By:` do not count toward the body
minimum. [`commitlint.config.js`](commitlint.config.js) holds the exact rules.

## 4. Push, then open a pull request

Push the feature branch and open a pull request. The checklist in
[`.github/pull_request_template.md`](.github/pull_request_template.md) is the
review contract: fill in the intent, risk, and test-plan sections rather than
deleting them.

[`.husky/pre-push`](.husky/pre-push) runs two checks: it verifies the committed
near-duplicates baseline against the whole tree — always on a branch's first
push, and later when the pushed range touches the scanner's inputs — and, if
you opted into fast-commit mode, it refuses to publish commits created under it
until the branch tip has fresh `bash scripts/land.sh` or `bun run verify`
evidence. Either one prints the repair command to run when it blocks.
