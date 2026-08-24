# 65. Four `eslint-rules/` guards can pass when their scan finds nothing, and one has been passing that way since June

Status: **Done 2026-07-30** on branch `fix/cq-57-65-vacuous-guards`, commit
`4c252b8e3`, review follow-ups `9fa1958ba`, `8f8100169`, and `08ec2fbf7`.
The retired `maxLinesPolicy.ratchets` parser/type/config surface is gone, and
the sole live registry check rejects any `local/max-lines` entry regardless of
metric. The restricted-syntax guard directly asserts a non-empty snapshot and
coverage of its eight representative source boundaries before iterating the
snapshot; `08ec2fbf7` deliberately removes the exact 29-file mirror introduced
by `8f8100169`. The shared concurrency corpus and local-rule meta-contract also
fail before an empty scan can pass. Historical `ratchetExcluded` fields remain
baseline metadata rather than expanding this leaf into a baseline-format
migration. No shared assertion helper was added: the direct assertions keep
each guard's reason local.
Theme: A guard that cannot fail is not a guard · Area: harness (lint guards) · Severity: low · Size: S

Source: a sweep of the scanning guards in `eslint-rules/`, run while repairing
`socket-registry-broadcasts.test.js` on `feat/cq-broadcast-registry-cleanup`
2026-07-29 · Confidence: high for the live instance and the three shapes — each
was re-derived against the tree by evaluating the actual inputs, not by reading
the test

Anchors pinned to `08d9443ad`, the merge that landed that branch. The repair
itself shipped there and is not part of this leaf; the durable rule it produced
is in [CONSTRAINTS.md](./CONSTRAINTS.md).

## Problem

A guard that discovers its own subjects — by scanning a source file, walking a
config, reading a fixture — has a failure mode ordinary tests do not: the scan
can come back empty, and the comparison that follows then succeeds *because*
there is nothing to compare. Nothing fails, so nothing says the guard stopped
working.

This is not hypothetical here. `socket-registry-broadcasts.test.js` keyed its
scanner on the literal name `BROADCAST_REGISTRY`; when slice S4 split that
declaration in two, the scanner matched nothing, the event inventory went empty,
and the guard stayed green through exactly the change it exists to catch. That
was found by accident, while reading the file for another reason.

The sweep that followed asked which other `eslint-rules/` guards have the same
shape. Four do. **One of them is vacuous today** — it has been since 2026-06-12,
and no gate has ever said so.

## Evidence

### 1. `max-lines-policy.test.js` — live-vacuous, six weeks and counting

`eslint-rules/max-lines-policy.test.js:83-87` filters the ratchet registry:

```js
function maxLinesRatchets() {
  return lintRatchets.filter(
    (ratchet) => ratchet.ruleId === "local/max-lines" && ratchet.metric === "effective-line-count",
  );
}
```

Measured on `08d9443ad`: `lintRatchets` holds **19** entries, **zero** declare
`ruleId: "local/max-lines"`, and zero declare `metric: "effective-line-count"`.
`maxLinesRatchets()` returns `[]`. `maxLinesPolicy.ratchets`
(`eslint-config/shared-policy.js:270`) is likewise `[]`. So the comparison at
`:171-187`, "keeps max-lines ratchet floors aligned with policy", reduces to
`expect([]).toEqual([])`.

The follow-on test degrades rather than emptying, which is why it is easy to
miss. `:190-196` asserts, for each policy exception, that ratchet coverage
matches the entry's own flag:

```js
const isCovered = ratchets.some((ratchet) => matchesRatchet(ratchet, entry.path));
expect(isCovered, entry.path).toBe(!entry.ratchetExcluded);
```

With `ratchets` empty, `isCovered` is `false` for every path, so the assertion
reduces to `entry.ratchetExcluded === true` — measured: all **28** exceptions
carry `ratchetExcluded: true`, so all 28 pass tautologically. The test named
"keeps each exception's ratchet exclusion flag aligned with ratchet coverage"
checks no alignment against any coverage; it restates the flag it reads.

**The emptiness was deliberate and the guard still should have said something.**
`e922556b4` (2026-06-12, "refactor(lint): adopt codemod sources") promoted
codemod sources into normal ESLint coverage and drained
`ratchet/local-max-lines-codemods`, taking `maxLinesPolicy.ratchets` from one
entry to `[]` in the same commit. That was the right call. What it also did was
silently retire two tests, and the drain landed behind a full gate with nothing
to show for it. So the fix here is **not** "assert non-empty" — that would fail
immediately and correctly, because there genuinely are no max-lines ratchets. It
is to decide which of the two the repo wants and make the file say so.

### 2. `restricted-syntax-resolution-snapshot.test.js` — both sides from one fixture

`:70-82` builds the "actual" side by iterating the fixture it is about to compare
against:

```js
for (const file of Object.keys(snapshot.files)) {
  actual[file] = await resolvedFingerprint(file);
}
…
expect(actual).toEqual(snapshot.files);
```

The fixture currently carries **29** files. Emptying `files` to `{}` — by a bad
regeneration under `MUSI_UPDATE_RESTRICTED_SYNTAX_SNAPSHOT=1` (`:75-80`), or a
merge that resolves the JSON to an empty object — makes this
`expect({}).toEqual({})`. The pin is over a byte-identity claim made by
`eslint-config/restricted-syntax-builder.js`, so an emptied fixture retires the
only evidence that the composition refactor is still behaviour-preserving.

### 3. `concurrency-guard.test.js` — bare loop over a shared corpus

`:535-565` iterates `corpus.cases` (currently **44** cases) with no floor. A
corpus of `{"cases": []}` passes.

**Partly covered elsewhere, which is why it is third and not first.** The same
corpus is run through the codemod by
`scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts`, which does
carry `expect(corpus.cases.length).toBeGreaterThan(0)` at `:495`. So the corpus
cannot silently empty repo-wide. What the asymmetry costs is that the *rule* side
— the enforcement gate, per [leaf 64](./64-concurrency-guard-direct-branch-parity.md) —
is the half with no floor, and the two files are in different vitest projects, so
a scoped run of the eslint-rules project alone proves nothing about the corpus.

### 4. `message-guidance.test.js` — six unguarded loops, rescued only incidentally

Six tests loop over `ALL_LOCAL_RULES` with no length assertion: `:298`, `:326`,
`:445`, `:475`, `:511`, `:527`. The set currently holds **32** rules.

A *total* wipe does fail, but not because of anything in those loops — it fails
in the later allowlist tests (`:569`, `:584`, `:609`), which resolve hard-coded
rule ids through `RULE_BY_ID` and assert `expect(rule).toBeDefined()`. A
*partial* loss — rules that leave the plugin and are not named in an allowlist —
passes silently, and the meta-contract's coverage shrinks with nothing said.

**Weakest of the four, and the note should say so.** `ALL_LOCAL_RULES` is
derived from `localPlugin.rules` (`eslint-rules/all-local-rules.js:14`), and
`local-plugin-registry.test.js:62-64` pins the rule files on disk to that same
registry — a comparison against a statically imported object, so it is not itself
vacuous. Coverage cannot drift without a rule file leaving the tree.

### For contrast — two guards in the same directory already do this right

- `no-shared-schemas-barrel.test.js:161-168` reads a scanned key set and asserts
  `expect(exportKeys.length).toBeGreaterThan(0)` **with the reason written
  down**: "Guard against a manifest reshape that would make the assertion below
  pass over an empty key set."
- `restricted-syntax-and-globals-config.test.js:348-369` is inverted: it collects
  families whose globs match nothing into a `dead` list and asserts
  `expect(dead).toEqual([])`. An empty scan marks every family dead and fails
  loudly, which is the opposite of degrading to silence.

Both patterns are already in the repo. Neither is exotic and neither needs new
machinery.

## Why it is low severity

Nothing here is a production defect and nothing opens an enforcement hole that
was not already open. `local/max-lines` still runs as an ordinary ESLint rule
with real caps, pinned by the resolved-config tests in the same file (`:104`,
`:138`), which are not vacuous — they resolve real config for real paths. The
restricted-syntax fixture is intact, the corpus is intact, the rule set is
intact. What is at stake is the trustworthiness of four green checkmarks: three
that would keep reporting success through a change that removes their subject,
and one that is already reporting success over nothing.

## Proposed direction

1. **Decide what `max-lines-policy.test.js` means to check, then make it say
   that.** Two coherent answers: either max-lines is deliberately not ratcheted
   any more, in which case assert the emptiness on purpose (`ratchets` is `[]`
   *and* no registry entry claims `local/max-lines`) and state why, so a
   reintroduced ratchet trips a review; or the alignment check is still wanted,
   in which case it needs a non-empty precondition and the 28 `ratchetExcluded`
   flags need something other than themselves to check against. Do not simply
   add `toBeGreaterThan(0)` — it fails today, correctly, and answers nothing.
   `e922556b4` is the commit that drained it; read it before choosing.
2. **Give the snapshot test a floor and a shape check.** A non-empty
   `snapshot.files` assertion, plus an expected count or a spot-check that the
   representative set still covers the package boundaries it was captured for.
3. **Add the corpus floor on the rule side too**, mirroring
   `concurrency-guard-drift.test.ts:495`, so a scoped eslint-rules run is
   self-sufficient.
4. **Put one floor in `message-guidance.test.js`** near the top of the
   meta-contract describe, rather than six.
5. **Consider a shared helper for the pattern** — something like
   `expectDiscovered(items, what)` that fails with the subject's name rather than
   a bare length — and use it in all four. Whether that earns its keep at four
   call sites is an owner call; if not, copy the `no-shared-schemas-barrel.test.js`
   comment idiom, which is what makes that one readable.
6. **The class-level fix is already recorded.** The [CONSTRAINTS.md](./CONSTRAINTS.md)
   ruling produced by the `socket-registry-broadcasts.test.js` repair — a
   scanning guard must assert it found something, and must discover by pattern
   rather than by an allowlist it also compares against — is the durable form. If
   this leaf is promoted, the sweep should also cover the scanning guards outside
   `eslint-rules/`; only that directory was swept.

## Verify

```
bun run test:eslint-rules -- eslint-rules/max-lines-policy.test.js
bun run test:eslint-rules -- eslint-rules/restricted-syntax-resolution-snapshot.test.js
bun run test:eslint-rules -- eslint-rules/concurrency-guard.test.js
bun run test:eslint-rules -- eslint-rules/message-guidance.test.js
bun run test:scripts:file -- scripts/codemods/concurrency-guard/concurrency-guard-drift.test.ts
```
