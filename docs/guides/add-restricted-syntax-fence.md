# Add a `no-restricted-syntax` fence

`no-restricted-syntax` is the one ESLint rule in this repo whose whole policy is
composed from data instead of written as config objects. Two modules own it:

- `eslint-config/restricted-syntax-policy.js` — **the policy, as data.** Every
  selector object, every file family, and the emission `order`. This is the file
  you edit.
- `eslint-config/restricted-syntax-builder.js` — **the engine.** Turns that data
  into ordinary flat-config objects and refuses to emit an ambiguous tree. You
  should rarely need to touch it.

`eslint.config.js` spreads the result once and nothing else in the repo sets the
rule key — a test enforces that, because flat config *replaces* rule entries by
key, so a second owner would silently delete the whole policy for its files.

## Why it is a builder and not nine config blocks

Because flat config replaces rather than merges, every block that wanted the
rule for an overlapping family used to restate its neighbours' selectors by
hand. Nine blocks did that across three modules, each with a "flat config
replaces" comment, and a dropped line was a silent policy loss. In the builder a
family declares only the selectors it *adds*; the emitter unions them down the
family tree.

## The checklist

### 1. Declare the selector

Add one entry to `restrictedSyntaxSelectors`. The id is yours to pick and is the
name everything else refers to; the value is the ordinary ESLint
`{ selector, message }` pair.

```js
"no-test-only": {
  selector: "CallExpression[callee.property.name='only']",
  message: "Remove `.only(` before committing; it silently skips the rest of the suite.",
},
```

Write the message as guidance, not as a restatement of the selector — the same
convention as local rules (see
[`local-eslint-rules.md`](local-eslint-rules.md)).

### 2. Add the id to `order`

`order` is the total order every emitted selector array is sorted by, so the
resolved arrays stay stable no matter how the policies are authored. A selector
missing from `order` is a build error.

### 3. Attach it to a policy

Either add the id to an existing policy's `selectors`, or declare a new family:

```js
restrictedSyntaxPolicy({
  id: "server-jobs",
  within: "server-raw-sql",   // the family that contains this one
  files: ["packages/server/src/jobs/**/*.ts"],
  ignores: [...testAndHelperFiles],
  selectors: ["no-test-only"],
}),
```

Rules the builder enforces, and what they mean in practice:

- **Families form a tree.** `within` names the parent policy. A child's emitted
  `files` is the intersection of its own patterns with every ancestor's, and its
  `ignores` is the union along that chain, so a child is a subset of its parent
  by construction. Omit `within` only for a root family.
- **Non-nested families must be provably disjoint.** Two families that are not
  ancestor/descendant may not share a file, or the resolved entry would depend
  on emission order. Three sound proofs are accepted: one family's `files`
  patterns listed **verbatim** in the other's `ignores` (exact string equality —
  an equivalent but differently spelled glob will not do); a literal-path family
  with no member inside the other; or prefix-incomparable static glob prefixes.
- **A new top-level family almost always needs `ignores: [...testAndHelperFiles]`.**
  The cross-cutting `test-env-boundaries` exception owns that family, and your
  new policy has to be provably disjoint from it. This is also a real policy
  choice, not a formality — see the recorded decision in the policy module.
- **Exceptions are terminal.** Nothing nests under an exception, and a new
  sibling that overlaps one is rejected, so an exception's family can only ever
  *lose* selectors. To add a fence inside one — banning `.only(` in test files,
  say — re-express that exception as a policy node covering the same files with
  the selectors it keeps, and demote its removal to an exception nested under
  it. The builder names this restructure in both error messages.
- **Patterns must be positive.** A `!`-prefixed pattern is rejected: ESLint
  applies ignores in order and re-includes after a negation, which would defeat
  the disjointness proofs.

To *remove* selectors for a narrower boundary, use `restrictedSyntaxException`
with `remove: [...]`. A non-global exception must list literal paths inside its
parent's family; a deliberately cross-cutting one sets `global: true`.

### 4. Add a representative case

`eslint-rules/restricted-syntax-and-globals-config.test.js` holds
`restrictedSyntaxSelectorCompositionCases`: one real file per family pinning the
**exact** resolved selector-id list. Add a case for the family you touched. A
separate test fails if any registered selector id is unreachable from every
case, so a new selector without a case is caught.

Two structural tests run automatically and need nothing from you unless they
fail: every emitted family must be the deepest match for at least one real
non-ignored tracked file (a typo'd glob is otherwise invisible — it builds clean
and enforces nothing), and every literal path in the policy must exist on disk.

### 5. Decide about the snapshot

`eslint-rules/restricted-syntax-resolution.snapshot.json` pins the resolved
entry for 29 representative files. It exists to prove *refactors* are
behavior-neutral, so:

- Refactoring, or adding a fence that does not touch those 29 files → it must
  stay green untouched.
- Deliberately changing policy for a pinned file → regenerate with
  `MUSI_UPDATE_RESTRICTED_SYNTAX_SNAPSHOT=1` and say why in the commit body.

Regenerating to make a red snapshot green is how a silent policy loss ships;
treat a surprising diff as a finding, not a chore.

## Answering "which selectors apply to this file?"

Ask ESLint rather than reading globs:

```sh
bunx eslint --print-config packages/server/src/routers/character.ts
```

The `no-restricted-syntax` entry in that output is the resolved truth, including
severity. Note it resolves paths that do **not** exist, which is handy for
checking what a file *would* get before you create it — and is why the liveness
test above exists.

## Verifying

```sh
bash scripts/vitest.sh run --project=eslint-rules
bun run lint
```

## Related

- [`lint-overview.md`](lint-overview.md) — how the lint system fits together.
- [`local-eslint-rules.md`](local-eslint-rules.md) — authoring a `local/*` rule,
  which is the right tool when a fence needs more than an AST selector.
- `docs/agent_notes/backlog/lint-deep-dive-2026-07/40-restricted-syntax-additive-composition.md`
  — the design record and the recorded policy decisions.
