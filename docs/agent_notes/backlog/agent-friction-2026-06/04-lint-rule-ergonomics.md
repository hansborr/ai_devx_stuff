# 04 — ESLint rule & lint-ratchet ergonomics (E1, F1, R1, E2, E3, W1, Q1, L1)

> Proposals only — not implemented. Verified against current HEAD.

These rules/idioms repeatedly forced *unrelated* refactors or rediscovered
work-arounds. Suggested PR grouping: **A** = E1+R1 (rule fixes), **B** = E2+E3
(shared TS-AST helpers), **C** = Q1+L1 (fixture/list de-dup), **D** = F1
(max-lines structural), **W1** folded into A or B.

> Meta-note: two earlier drafts of this file were written with *literal*
> control bytes (NUL / unit-separator) in the L1 example and the PostToolUse
> tidy hook flagged it as `skipped (binary file)` — a live reproduction of the
> L1 pain (and of the harness-level `Write`-tool corruption). The example below
> now describes the separators by char code only, never embedding the bytes.

---

## E1 — `complexity` over-counts optional-chains & dispatch in tests/fakes

**Status: not addressed.** Enforced only by core `complexity: ["error", {max: 10}]`
(`eslint-config/rule-groups.js:25`) via `maintainabilityRules` →
`createRepoCodeQualityConfigs` (`eslint-config/code-quality-configs.js:54-55`).
The unit-test override (`eslint-config/test-configs.js:96-108`) already disables
`max-lines`, `local/max-lines`, `max-lines-per-function`, `no-magic-numbers` for
tests — **but not `complexity`**. There is **no complexity ratchet** underneath
(every ratchet in `lint-ratchet-config.ts` is `metric: "message-count"`), so
relaxing it for tests cannot be undercut by a floor.

**Root-cause fix (decided 2026-06-12 — `"off"`, not a raised cap).** Add
`"complexity": "off"` to the existing test override (`test-configs.js:96-108`),
scoped to `unitTestFiles`; prod untouched. A `max: 20` guardrail is rejected: it
is just a delayed version of the same arbitrary friction, and it would be
incoherent next to the sibling maintainability rules (`max-lines`,
`local/max-lines`, `max-lines-per-function`) which are already `"off"` here — not
raised. There is no complexity ratchet underneath (every ratchet is
`message-count`), so nothing is undercut.

For the *production* dispatch case (the central switch agents kept converting),
the codebase already has a blessed idiom:
`scripts/drift-ai/prototype-subcommands.ts:49-77` (a `satisfies Record<Id,
Handler>` table + `ReadonlyMap.get()` early-return dispatch). **Document this** in
`docs/guides/local-eslint-rules.md` so prod dispatch surfaces adopt it
deliberately instead of rediscovering it under complexity pressure (complementary
to the test override, which does not help assertion-heavy test callbacks).

**Effort:** S. **Risk:** low.

---

## F1 — Registry/data files keep crossing the `local/max-lines` floor

**Status: partial (band-aided).** Floor is `local/max-lines` `max: 300`
(`eslint-config/rule-groups.js:8-12`), counting effective lines
(`eslint-rules/max-lines.js:83-105`). Per-file caps come from
`maxLinesPolicy.exceptions` (`eslint-config/shared-policy.js:133-336`).
`scripts/path-policy/path-policy-smoke-subjects.ts` already has `cap: 410`
(`shared-policy.js:299-306`) and is **408 raw lines today** — one or two entries
from breaching even the raised cap. The cap-bump only deferred the friction.

**Root-cause fix — separate pure data from logic so the data isn't under the
logic floor.** Two options:
- **Per-file (immediate):** split the flat lookup table (`SCRIPT_SMOKE_SUBJECTS`,
  `path-policy-smoke-subjects.ts:20`) into a sibling `*-data.ts` and give it a
  `maxLinesPolicy.exceptions` entry with `ratchetExcluded: true` + a high cap,
  justified "flat data table, grows with subjects not logic" — mirroring the
  existing precedent for `lint-ratchet-config.ts` (`cap: 600`,
  `shared-policy.js:137-145`).
- **Systemic (durable):** establish a `*.data.ts` convention and one override
  block disabling/raising `local/max-lines` for that glob (analogous to how
  `test-configs.js:99-101` turns it off for tests). Then any registry just adopts
  the suffix — no future per-file exception edits.

**Sequencing (Codex review).** Ship the **per-file** split/exception first. A
broad `*.data.ts` lane that *disables* `max-lines` risks hiding real logic behind
a filename suffix. Only adopt the convention afterwards, and constrain it (e.g.
require data modules to be side-effect-free / no control-flow — enforceable via a
small lint check) rather than blanket-disabling the floor for the glob.

**Decision (2026-06-12).** Confirmed: split now, no broad `*.data.ts` lane yet.
Extra support for the constraint — the current file is *data + logic* (it imports
`existsSync`/`readdirSync`/`join`, `path-policy-smoke-subjects.ts:1-2`), so split
only the pure `SCRIPT_SMOKE_SUBJECTS` literal into a side-effect-free sibling and
leave the fs logic under the floor. That a "data" file imports `fs` is itself the
argument against a filename-only escape hatch. When the convention is eventually
added, gate the glob on "side-effect-free / no `fs` imports" via a small lint
check, not the suffix alone.

**Effort:** M. **Risk:** low–med (update importers of `SCRIPT_SMOKE_SUBJECTS` —
`path-policy.test.ts`, `path-policy.ts`, `path-policy-query-core.ts` — and keep
knip happy).

---

## R1 — `type-assertion-boundary` rejects a 2-line `//` marker; message omits the rule

**Status: not addressed.** Rule: `eslint-rules/type-assertion-boundary.js`.
`nearbyBoundaryComments` (lines 128-167) keeps only comments whose
`loc.end.line` is the line directly above (or with one blank line between). A
multi-line `/** */` JSDoc is one token and works (test at
`type-assertion-boundary.test.js:66-74`), but two `//` lines are two tokens; a
marker on the first line ends two lines above the statement and is dropped, so a
correctly-categorised marker is flagged. The message (lines 182-183) says "same
line or directly above" but never states "the marker must be on the single
immediately-preceding line; multi-line `//` comments aren't joined."

**Root-cause fix (in the rule).**
1. Treat a contiguous run of `//` Line comments immediately above the statement
   as one logical block: collect `getCommentsBefore(statement)` Line tokens that
   are contiguous and whose **last** line is `lineAboveStatement`, then run
   `classifyBoundaryComment` over the run (it already tolerates the marker on any
   line of a Block comment via `BOUNDARY_COMMENT_PREFIX_PATTERN`).
2. Clarify the three messages (lines 182-187) to state the placement rule and
   that a contiguous `//` block (or a JSDoc block) directly above is accepted.

**Why not doc-only.** The message fix is part of the fix, but only the matching
change stops the false positive without forcing authors to reformat working
comments.

**Effort:** S. **Risk:** low (additive matching; add the 2-line-marker case to
`type-assertion-boundary.test.js`).

---

## E2 — `no-unnecessary-condition` vs `ts.Node.parent`; E3 — `unbound-method` vs `ts.sys`

**Status: not addressed; both idioms already rediscovered in-tree.**
- E2: `ts.Node.parent` is typed non-nullable, so `cursor !== undefined` walks are
  flagged. Already worked around once at
  `scripts/drift-ai/class-construction-references.ts:158-167`
  (`while (!ts.isSourceFile(cursor))` + explanatory comment).
- E3: `ts.sys.fileExists` etc. trip `unbound-method`; wrapped ad hoc in arrows at
  `scripts/drift-ai/import-cycles-graph.ts:333-341` and
  `import-cycles-tsconfig.ts:29`.

Both rules ship in `strictTypeChecked` (`eslint-config/base-configs.js:69`).

**Root-cause fix — shared helpers in `scripts/drift-ai/ts-source-util.ts`** (it
already imports `ts` and exports `hasModifier`, `scriptKindFor`,
`sourceLineCount`):
- E2: `walkUpToSourceFile(node, predicate)` / `findAncestor(node, predicate)`
  using the `!ts.isSourceFile(cursor)` stop; migrate
  `class-construction-references.ts`.
- E3: `tsSysHost(repoRoot)` returning a `ts.ModuleResolutionHost` with arrow-bound
  methods (and/or `tsSysReadFile`/`tsSysFileExists`); migrate
  `import-cycles-graph.ts` / `import-cycles-tsconfig.ts`.

New consumers import the helper and never trip the rule. Co-locate E2+E3 in one
PR; there's a `*.test.ts` sibling pattern (`source-walk.test.ts`,
`path-util.test.ts`) for a `ts-source-util.test.ts`.

**Effort:** S each. **Risk:** low (pure helper extraction).

---

## W1 — No blessed way to probe a plugin rule under flat config

**Status: not addressed.** `eslint --rule '{"local/…"}'` fails because
CLI-supplied plugin rules don't resolve `plugins` declared in file-scoped flat
config objects (the local plugin is registered inside
`createRepoCodeQualityConfigs`, `code-quality-configs.js:40-42`).

**Root-cause fix.** Provide a documented/scripted probe that uses an inline flat
`--config`/`overrideConfig` carrying both the plugin registration and the enabled
rule (not `--rule`). E.g. a tiny `scripts/lib/lint-rule-probe.*` doing
`eslint --no-config-lookup --config <inline-flat-config-importing-localPlugin>
<file>`, or programmatic `ESLint` with `overrideConfig: [{ plugins: { local },
rules: { [id]: "error" } }]`. Document `eslint --print-config <file>` as the way
to see which config object owns a rule. Given how rarely this is needed, a
documented recipe in `docs/guides/lint-ratchet.md` / `local-eslint-rules.md` may
suffice; a script is nicer if probing is common in the ratchet workflow.

**Decision (2026-06-12) — documented recipe first.** This is genuinely rare
(Tier 3), and the "prefer tooling over docs" principle is aimed at *frequent*
recurrences, so a documented recipe is proportionate. One trip-wire: if authoring
the precise incantation shows it is long/fiddly (inline flat config registering
the local plugin usually is), write the ~10-line `scripts/lib/lint-rule-probe.*`
in the same pass instead of waiting for a second recurrence — a fiddly copy-paste
recipe is exactly the kind of doc this backlog says does not stick. Promote to a
script on first sign of fiddliness or repeat use.

**Effort:** S. **Risk:** low.

---

## Q1 — Hand-maintained `runtimeFiles` copy list in the lint-ratchet vitest fixture

**Status: partial — the masking is real.** Two parallel lists:
- Shell smoke `scripts/tests/test-lint-ratchet.sh:24-35`: a few explicit
  cross-dir files **plus a glob** `for runtime_file in scripts/lint-ratchet/*.ts`
  → auto-picks up new modules (which is why it stayed green and masked the
  failure).
- Vitest fixture `scripts/lint-ratchet/lint-ratchet-output.test.ts:28-81`: a
  **fully hand-enumerated** `runtimeFiles` array → a new module must be added or
  the copied fixture CLI throws "Cannot find module".

**Root-cause fix.** In `lint-ratchet-output.test.ts`, derive the
`scripts/lint-ratchet/*.ts` entries via `readdirSync` (minus `*.test.ts` and
`lint-ratchet-config.ts`, which the fixture writes itself via
`writeFixtureRatchetConfig`, lines 113-198), keeping the four cross-dir files
(`eslint-rules/max-lines.js`, `scripts/lint-ratchet.ts`,
`scripts/lib/lint-rule-docs.ts`, `packages/shared/.../harness-diagnostics.ts`) as
a small explicit constant — mirroring the shell smoke's shape so the two lists
can't diverge. Over-copy is harmless for a copy-and-run fixture; under-copy is
what breaks.

(The lint-agent smoke copies in `test-lint-agent.sh:26-32` are a small specific
dependency set — keep explicit unless it grows.)

**Effort:** S. **Risk:** low.

---

## L1 — Control-byte git-log fixtures re-derived (and corruptible) across 9 files

**Status: not addressed — heavily duplicated.** No shared builder exists.
`scripts/drift-ai/hotspots-history.test.ts:8-47` is the most complete reference
(separator constants + `metaLine`/`commitBlock`/`gitLog` builders); at least
8 other drift-ai test files re-derive the constants with **inconsistent
escaping** — some via `String.fromCharCode(0)` / `String.fromCharCode(0x1f)`,
some via backslash-u escapes. The two styles are the symptom: a raw NUL typed
into Write/Edit content decodes to a literal NUL byte and the `.ts` becomes
"binary" (the tidy hook skips it; corruption surfaces later as a failing test).
This is the codebase-adjacent half of the harness-level `Write`-tool corruption
noted in [07](07-already-addressed-and-out-of-scope.md). (It also bit *this very
document* twice — see the meta-note at the top.)

**Root-cause fix.** Add a lint-visible shared helper
`scripts/drift-ai/git-log-fixture.test-helper.ts` (the `*.test-helper.ts` suffix
is a recognised helper pattern; **don't** put it under
`scripts/drift-ai/fixtures/`, which is lint-excluded via `scriptFixtureIgnores`,
`shared-policy.js:40-46`). API generalising `hotspots-history.test.ts`:
- A single `GIT_LOG_CONTROL` constant defining the three separators **by char
  code** — NUL (char code 0), the unit separator (char code 0x1f / 31) and the
  group separator (char code 0x1d / 29) — produced with `String.fromCharCode(...)`
  so the `.ts` stays plain text and no literal control byte is ever typed into
  source. (Using `String.fromCharCode` rather than backslash-u escapes is the
  safer convention precisely because tools that JSON-encode content can decode a
  backslash-u escape into a real byte.)
- `buildGitLogFixture(entries: readonly GitLogEntry[]): string` with
  `GitLogEntry = { hash, authorName, authorEmail, authorDate, committerDate,
  subject, coAuthors?, numstat?: readonly string[] }`, producing the NUL-prefixed
  metaLine + blank + numstat rows joined like real git output. Export `metaLine`
  / `commitBlock` for partial-structure tests.

New subcommand tests import the builder and never re-derive the escaping; migrate
the 9 existing files incrementally (validate against
`hotspots-history.test.ts`'s current expected output).

**Effort:** S (helper) – M (migrate all callers). **Risk:** low (pure test
helper).

## Critical files
`eslint-config/test-configs.js` (E1), `eslint-rules/type-assertion-boundary.js`
(R1), `scripts/drift-ai/ts-source-util.ts` (E2/E3),
`scripts/lint-ratchet/lint-ratchet-output.test.ts` (Q1),
`eslint-config/shared-policy.js` (F1), and a new
`scripts/drift-ai/git-log-fixture.test-helper.ts` (L1). References:
`eslint-config/rule-groups.js`, `scripts/drift-ai/prototype-subcommands.ts`
(blessed dispatch idiom), `scripts/drift-ai/hotspots-history.test.ts` (L1
template).
