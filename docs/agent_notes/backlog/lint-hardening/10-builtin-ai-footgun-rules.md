# Leaf 10: Built-in ESLint AI-Footgun Rules

Status: Landed Pass 2 (2026-05-16); 3 of 5 rules adopted at error, 1 deferred, 1 already enabled.
Depends on: Leaf 1 (zero-warning gate)

Dependency detail: Leaf 1 removes the ambiguity between `warn` and `error`
for committed ESLint config. This matters most for `no-await-in-loop`, whose
decision must be adopt, adopt scoped, defer, or reject after inventory rather
than "leave it as a warning."

## Problem

A small set of core ESLint rules (no plugin required) catch high-frequency
AI mistakes and beginner mistakes that the type checker does not detect.
None are currently enabled.

## Low-Ambiguity Candidate Rules

These eight rules are correctness-focused with predictable cleanup. Enable at
`error`, inventory, fix.

| Rule | Catches |
|---|---|
| `no-constant-binary-expression` | `if (x && y \|\| z)` precedence bugs, `x ?? y \|\| z` mixes, comparison with `NaN`, `null == undefined`-style mistakes. Classic AI footgun. |
| `no-param-reassign` (with `props: false` initially) | Beginner footgun. Pairs well with TypeScript readonly types. |
| `no-self-compare` | `x === x` and similar accidental tautologies. |
| `no-template-curly-in-string` | `"hello ${name}"` written inside a single-quoted string (template literal mistake). |
| `no-unreachable-loop` | Loops that always `return`/`throw`/`break` on the first iteration. AI generates these when collapsing a found-item loop. |
| `default-case-last` | `default:` must be last in a switch. Pairs with `switch-exhaustiveness-check` from Leaf 9. |
| `radix` | `parseInt(x)` without `radix`. Beginner footgun. |
| `dot-notation` | Prefer `.foo` over `["foo"]` when statically known. Style-leaning but catches AI-generated stringly-typed accesses. |

## Inventory-First Candidate

`no-await-in-loop` is treated separately. It catches a real AI mistake —
sequential `await` in a `for` loop where `Promise.all` is correct — but Musi
has known legitimate sequential-await sites: rate-limited socket fan-out,
ordered Prisma writes inside a transaction, e2e poll loops, and seed scripts
that need deterministic ordering. Whether the rule has net value globally
depends on the inventory ratio, not on prior conviction.

Note that with Leaf 1's `--max-warnings=0`, there is no "soft" enablement in
this repo — `warn` and `error` both fail the gate. So this leaf cannot hide
the rule's fit question behind a severity choice; it must make a verdict
call after inventory.

### Decision Rule

1. Run the rule globally in a throwaway config. Produce an inventory.
2. Categorise each hit: **real bug** (collapsible to
   `Promise.all`/`Promise.allSettled`), **intentional sequential**
   (rate-limited, ordered, or otherwise correct), or **unclear** (needs a
   closer look).
3. Apply this verdict rule:
   - **Adopt globally** if real-bug hits outnumber intentional-sequential
     hits, or if intentional-sequential hits are at most 3× real-bug hits and
     every intentional site has a clean
     `// eslint-disable-next-line no-await-in-loop -- <reason>` placement.
   - **Adopt scoped** if intentional sites cluster in known dirs
     (`packages/server/src/socket/` fan-out, e2e helpers, seed scripts, or
     transaction helpers) but other code is mostly real bugs. Enable in the
     clean dirs only.
   - **Defer after inventory** if unclear findings dominate, if the bug/intent
     split depends on runtime behavior the leaf did not verify, or if the right
     scope boundary is not obvious. Record the inventory ratio, unresolved
     examples, and the next evidence needed in `evaluation-verdicts.md`. Do not
     enable the rule until a future evaluation can classify those sites.
   - **Reject globally** if intentional sites outnumber real bugs by more
     than 3:1, or if the intentional sites are scattered enough that scoping
     would be arbitrary. Record the verdict and the inventory ratio in
     `evaluation-verdicts.md`. Revisit only if a real `Promise.all`-bug
     postmortem surfaces.
4. The ratio threshold is a starting heuristic, not a contract. Use
   judgement — a single dramatic bug found by the inventory can justify
   adoption even at unfavourable ratios.

## Rollout

1. Land the low-ambiguity rules as a single PR: enable at `error` in a
   throwaway config, inventory, auto-fix where supported (`dot-notation`,
   `radix` partially), hand-fix the rest, promote in `eslint.config.js`.
2. Treat `no-await-in-loop` as a separate workstream. Inventory under the
   decision rule above before deciding adoption mode.
3. If `no-await-in-loop` lands as rejected, scoped, or deferred after
   inventory, record the verdict in `evaluation-verdicts.md` (Leaf 10 is
   already listed in the register's pending-evaluations section).

## Adaptation Policy

For the low-ambiguity rules: correctness with low ambiguity, fix the code,
disable per-site only when intent is deliberate, always attach a reason
comment.

For `no-await-in-loop`: the rule does not get a default treatment — its
adoption is gated on the inventory ratio. False positives at scale are
signal about rule fit in this codebase, not a reason to disable everywhere.
Unclear findings are also a valid outcome: document them and defer adoption
instead of forcing a premature global or scoped decision.

## Implementation Result

Leaf 10 Pass 2 adopted three zero-finding core ESLint rules at `error` in the
broad `eslint.config.js` rules block:

- `no-constant-binary-expression`
- `no-param-reassign` with default `props: false`
- `radix`

No code fixes were needed. Pass 1 confirmed all three adopted rules had 0
findings, and `no-promise-executor-return` was already enabled at `error` on
the base branch.

Deferred:

- `no-await-in-loop`: 164 findings, mostly deliberate sequential server
  transaction/retry loops, seed scripts, e2e step ordering, test scenario
  setup, and socket cleanup. Needs an intentional-vs-bug classification slice
  before adoption.
- `no-param-reassign` with `{ props: true }`: 17 findings, mostly
  canvas-context mutation, CLI parser state accumulation, and project-cache
  lazy init. Defer to a focused refactor leaf.

## Verification

- `bun run lint -- --max-warnings=0`
- `bun run verify:changed`
- Targeted package tests for any production code reshaped.
- If any rule is rejected, deferred, subset-adopted, scoped, or fully adopted
  with caveats, append a row to `evaluation-verdicts.md` before closing the
  leaf.
