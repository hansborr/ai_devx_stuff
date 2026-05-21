# Leaf 21 Pass 2b Scout

Re-probe command:

```bash
bun run lint -- --max-warnings=0 2>&1 | tee /tmp/leaf21-pass2b-scout.log
```

Temporary probe result: 26 errors, matching Pass 1: 24
`regexp/no-super-linear-backtracking`, 1
`regexp/no-misleading-capturing-group`, and 1
`regexp/no-contradiction-with-assertion`. The temporary `eslint.config.js`
rule flips were reverted before this note was written.

Corpus checks used while scouting:

- `docs/refs/dndsrd5.2_markdown/src/07_Spells.md`: 339 parsed spell blocks,
  0 `parseSpellBlock` failures.
- `docs/refs/dndsrd5.2_markdown/src/03_Classes/*.md`: 232 level feature
  heading matches and 12 subclass headings.
- `docs/refs/dndsrd5.2_markdown/src/08_RulesGlossary.md`: 155 glossary
  entries, 0 `parseGlossaryEntry` failures.

## Site 1: `packages/client/src/components/homebrew/monster/monster-form-data.ts:325`

- **Site**: `parseCommaPairs` parses comma-separated saving throw and skill
  bonuses from monster homebrew form text.
- **Current regex**: `/^(\w+)\s*([+-]?\d+)$/`; it matches a trimmed comma
  part as a word key, optional whitespace, and a signed integer bonus. Today
  `STR +4`, `DEX+6`, `STR-2`, and `Perception +5` match; `Animal Handling +4`
  does not. Ambiguous strings also match: `STR12` becomes key `str1` and value
  `2`, and `12` becomes key `1` and value `2`.
- **Intent**: Convert the `savingThrows` and `skills` text fields into
  lowercase `{ key: number }` records for `buildMonsterData`. The UI
  placeholders are `STR +5, WIS +3` and `Perception +5`, and `recordToStr`
  emits `KEY +N`.
- **Backtracking source**: `\w+` includes digits and can exchange a digit suffix
  with the later `\d+`. Because `\s*` can match zero characters, a long numeric
  run followed by a nonmatching suffix lets the engine retry many split points
  between group 1 and group 2. This also causes the misleading-capture finding:
  group 1 captures fewer word characters than its own `\w+` suggests.
- **Recommended rewrite**: Prefer
  `/^([A-Z_]+)(?:\s+|(?=[+-]))([+-]?\d+)$/i` if no-space signed inputs should
  remain accepted. It keeps `STR +4`, `STR-2`, `DEX+6`, and `Perception +5`,
  rejects `STR12` and `12`, and prevents digit exchange. Simpler but stricter:
  `/^([A-Z_]+)\s+([+-]?\d+)$/i`, which requires whitespace before every bonus.
  A right-to-left string parser would be the path if multi-word skills such as
  `Animal Handling +4` are in scope, but that is a feature expansion.
- **Behavior change risk**: Recommended regex is a subset of current behavior:
  it rejects digit-bearing or numeric-only keys that currently parse oddly.
  It is equal for the intended corpus examples in
  `monster-form-data.test.ts` (`STR +4, DEX +6`, `STR -2, WIS +4`) and for
  UI placeholder examples. The no-space signed case is a judgment call.
- **Existing tests**: `bun run code:intel -- tests
  packages/client/src/components/homebrew/monster/monster-form-data.ts --direct`
  returns `monster-form-data.test.ts` and `monster-form-fields.test.tsx`.
  Actual parser coverage is in `monster-form-data.test.ts`: `STR +4, DEX +6`
  via `BASE_FORM.skills`, `parses skills into record`, and `STR -2, WIS +4`
  in the negative saving throw roundtrip.
- **Test additions needed**: Add characterization cases to
  `monster-form-data.test.ts` for `Perception +5`, `STR+4, WIS-2` if
  preserving compact signed syntax, malformed chunks such as
  `STR +, DEX +6, bad`, ambiguous `STR12` and `12`, and a pathological invalid
  chunk like `${"9".repeat(20_000)}x` that is ignored without timing-sensitive
  assertions.

## Site 2: `packages/server/src/seed/generate-class-features.ts:130`

- **Site**: `parseDescriptions` extracts class feature heading descriptions
  from SRD class markdown.
- **Current regex**: `/^#{2,4}\s+Level\s+(\d+):\s+(.+)$/`; it matches `##` to
  `####` headings like `#### Level 1: Rage`, captures the level and feature
  title, then collects following non-heading lines as the feature description.
- **Intent**: Build a `Map<"level:name", description>` for base class features
  until the parser reaches that class's subclass section. It must accept
  normal `#### Level ...` headings and corpus outliers such as
  `### Level 3: Primal Knowledge`.
- **Backtracking source**: The final `:\s+(.+)$` lets the whitespace after the
  colon exchange characters with `(.+)` when the title starts with whitespace,
  so a failing or near-failing line can retry each title length.
- **Recommended rewrite**: Prefer a small prefix parse: match
  `/^#{2,4}[ \t]+Level[ \t]+(\d+):[ \t]+/`, then slice the remainder as the
  title and require `title.trim()` to be nonempty. Regex-only option:
  `/^#{2,4}[ \t]+Level[ \t]+(\d+):[ \t]*(\S.*)$/`.
- **Behavior change risk**: Prefix parse with `title.trim()` is equal for the
  232 corpus feature headings and rejects whitespace-only titles that current
  code would match and then skip after trimming. `[ \t]` is a subset of `\s`,
  but corpus headings use spaces. Output-level characterization is important
  because the current `subclassRe` does not stop on the bold Bard subclass
  heading.
- **Existing tests**: `bun run code:intel -- tests
  packages/server/src/seed/generate-class-features.ts --direct` returns
  0 results. `rg` found no Vitest coverage for `parseDescriptions`.
- **Test additions needed**: Add a generator/parser test file after exposing or
  extracting pure helpers. Cover `#### Level 1: Spellcasting`,
  `### Level 3: Primal Knowledge`, punctuation/apostrophe names,
  whitespace-only titles, stopping at the subclass section, and a real-doc
  output/count characterization for the 12 class markdown files.

## Site 3: `packages/server/src/seed/generate-srd-spells.ts:42`

- **Site**: `isPreambleHeader` recognizes preamble `###` headers to skip while
  splitting the SRD spell markdown into spell blocks.
- **Current regex**: `/^###\s+\*{0,2}(.+?)\*{0,2}\s*$/`; it matches a `###`
  heading, strips optional one or two leading/trailing `*` markers from the
  captured title, and compares the title against `PREAMBLE_HEADERS`.
- **Intent**: Skip non-spell explanatory headings such as `### Preparing
  Spells`, `### **School of Magic**`, `### Range`, and `### Duration`.
  In the current corpus those headings are before `## Spell Descriptions`, so
  this helper is mostly defensive for post-marker preamble-like headers.
- **Backtracking source**: The leading `\s+`, lazy `(.+?)`, optional
  `\*{0,2}`, and trailing `\s*` all have overlapping ways to consume spaces or
  stars near the end of the heading. On nonmatching or star-heavy input the
  engine can retry title lengths and optional-star placements.
- **Recommended rewrite**: Prefer string parsing: require a `### ` prefix
  (for example `line.startsWith("### ")`), take `line.slice(4).trim()`, strip
  balanced `**...**` and optionally `*...*`, then check `PREAMBLE_HEADERS`.
  A regex-only option can use a
  non-overlapping body such as `/^###[ \t]+(?:\*\*)?([^\s*](?:.*[^\s*])?)(?:\*\*)?[ \t]*$/`,
  but the string parser makes the markdown-emphasis policy clearer.
- **Behavior change risk**: String parsing can be equal for current corpus
  headers. It needs an explicit choice on whether single-star emphasis remains
  accepted; the current `{0,2}` accepts either one or two stars. The post-marker
  spell corpus has 339 blocks and 0 parser failures today.
- **Existing tests**: `bun run code:intel -- tests
  packages/server/src/seed/generate-srd-spells.ts --direct` returns 0 results.
  `parse-spell-block.test.ts` covers spell block parsing but not
  `splitIntoBlocks`, `SECTION_HEADER_RE`, or `isPreambleHeader`.
- **Test additions needed**: Add `generate-srd-spells.test.ts` or extract a
  pure splitter module. Cover `### **School of Magic**`,
  `### Preparing Spells`, trailing spaces, single-star behavior if preserved,
  and a fixture proving preamble-like headers are skipped only where intended.
  Add pathological star/space-heavy nonmatches.

## Site 4: `packages/server/src/seed/generate-subclasses.ts:81`

- **Site**: `parseSubclass` extracts subclass feature headings and bodies from
  each class markdown file.
- **Current regex**: `/^#{2,4}\s+Level\s+(\d+):\s+(.+)$/`; it matches level
  headings after the subclass header, captures level and feature name, and
  collects body text until a non-feature h2/h3 heading.
- **Intent**: Build subclass feature rows for seeded subclass data. It must
  preserve normal `#### Level ...` headings and corpus outliers such as
  `### Level 17: Thief's Reflexes`; the separate subclass heading regex also
  handles the bold Bard heading `### **Bard Subclass: College of Lore**`.
- **Backtracking source**: Same as Site 2: the final `:\s+(.+)$` lets colon
  whitespace exchange with `(.+)` when the title can begin with whitespace.
- **Recommended rewrite**: Use the same prefix parse as Site 2, or a strict
  full regex such as
  `/^#{2,4}[ \t]+Level[ \t]+(\d+):[ \t]*(\S.*)$/`.
- **Behavior change risk**: Equal for the 232 corpus feature headings, subset
  for whitespace-only titles and non-horizontal whitespace. The corpus includes
  12 subclass headings and the Bard bold-heading case should be pinned because
  it is part of the surrounding parser intent.
- **Existing tests**: `bun run code:intel -- tests
  packages/server/src/seed/generate-subclasses.ts --direct` returns 0 results.
  `rg` found no Vitest coverage for `parseSubclass`.
- **Test additions needed**: Add or extract tests covering bold Bard subclass
  heading, `#### Level ...`, `### Level ...`, stopping at the next non-feature
  heading, punctuation/apostrophes, whitespace-only title behavior, and a
  generated subclass feature count from the real docs.

## Site 5: `packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.ts:8`

- **Site**: `HEADER_RE` parses Rules Glossary entry headers and optional
  category tags.
- **Current regex**: `/^#{3,4}\s+(.+?)(?:\s+\[([^\]]+)\])?\s*$/`; it matches a
  `###` or `####` header, captures the title, optionally captures a trailing
  `[tag]`, and trims both before mapping known tags to categories.
- **Intent**: Parse entry headers such as `#### Ability Check`,
  `#### Blinded [Condition]`, and `#### Cone [Area of Effect]`; unknown or
  missing tags become `general`.
- **Backtracking source**: The initial `\s+` and lazy title can both consume
  spaces. The title can also exchange spaces with the optional tag separator
  `\s+`, and with the trailing `\s*` when no tag is present. Long whitespace or
  bracket-near-miss headers create many retry points.
- **Recommended rewrite**: Prefer string parsing: validate a `### ` or `#### `
  prefix, trim the rest, and if the text ends in `]`, split at the final
  `" ["`; otherwise treat it as untagged. That keeps the optional-tag policy
  visible and avoids nested quantified regex. A stricter regex can use a
  non-space first title char plus a tag-specific suffix, but string parsing is
  simpler.
- **Behavior change risk**: String parsing can be equal for the 155 current
  glossary entries and 41 tagged corpus examples. Pin unknown-tag behavior:
  today `#### Foo [Unknown]` becomes name `Foo`, tag `Unknown`, category
  `general`. Brackets inside non-trailing title text should remain part of the
  name.
- **Existing tests**: `bun run code:intel -- tests
  packages/server/src/seed/rules-glossary-parser/parse-glossary-entry.ts --direct`
  returns the colocated `parse-glossary-entry.test.ts`. Existing tests cover
  untagged entries, `Condition`, multi-word `Area of Effect`, `Hazard`,
  `Action`, table preservation, and trimming.
- **Test additions needed**: Add `###` header support, trailing header spaces,
  unknown final tags, bracket-in-title behavior, malformed headers, and a
  pathological whitespace/bracket near miss such as
  `#### ${" ".repeat(20_000)}[Condition`.

## Site 6: `packages/server/src/seed/spell-parser/parse-spell-block.ts:84`

- **Site**: Casting time field extraction in `parseSpellBlock`.
- **Current regex**:
  ```ts
  new RegExp(String.raw`\*\*Casting Time:\*\*\s*(.+?)${FIELD_BOUNDARY_LOOKAHEAD}`)
  const FIELD_BOUNDARY_LOOKAHEAD = String.raw`(?=\s+\*\*[A-Z][\w ]*:\*\*|$)`;
  ```
  It matches a `**Casting Time:**` marker and lazily captures the value until
  the next inline bold field marker or end of line. The value is later stripped
  of `or Ritual`.
- **Intent**: Extract casting time from both normal one-field lines and inline
  multi-field lines. Corpus examples include `Action`, `Bonus Action`,
  `1 minute or Ritual`, and Counterspell's long reaction text. Forcecage has
  all four fields on one line at `07_Spells.md:2743`.
- **Backtracking source**: `\s*` before `(.+?)` can exchange whitespace with
  the lazy capture, and the capture is followed by a lookahead containing
  `\s+` plus `[A-Z][\w ]*`. On long values or near-markers like
  ` **Almost Field**`, the engine can retry the lookahead at many positions.
- **Recommended rewrite**: Use one shared field-scanning helper for Sites 6-9:
  find all `**Title:**` marker spans with a global marker regex, then slice the
  target marker's value to the next marker start or line end and trim. Preserve
  the current generic boundary semantics (`**Any Title:**` ends a value). A
  whitelist boundary (`Casting Time|Range|Components?|Duration`) is simpler but
  changes behavior if unknown inline fields appear.
- **Behavior change risk**: Generic marker scanning should be equal for current
  corpus and preserve the Forcecage inline-field regression. A whitelist is a
  subset. Current duration-like malformed source lines show that line end is a
  meaningful boundary; the scanner should not silently move text to the next
  physical line.
- **Existing tests**: `bun run code:intel -- tests
  packages/server/src/seed/spell-parser/parse-spell-block.ts --direct` returns
  `parse-spell-block.test.ts`. Existing tests cover standard fields, ritual,
  concentration, Counterspell's long reaction casting time, singular
  `Component:`, and Forcecage inline fields.
- **Test additions needed**: Add a shared field-extraction characterization for
  Forcecage, Counterspell reaction text, unknown inline boundary behavior if
  generic markers are preserved, and a pathological line with thousands of
  near-markers and no valid boundary.

## Site 7: `packages/server/src/seed/spell-parser/parse-spell-block.ts:91`

- **Site**: Range field extraction in `parseSpellBlock`.
- **Current regex**:
  ```ts
  new RegExp(String.raw`\*\*Range:\*\*\s*(.+?)${FIELD_BOUNDARY_LOOKAHEAD}`)
  ```
  it captures the value after `**Range:**` until the next inline field marker
  or line end.
- **Intent**: Extract a range string such as `Self`, `Touch`, `60 feet`,
  `300 feet`, `500 miles`, or `Unlimited`.
- **Backtracking source**: Same shared source as Site 6: `\s*` plus lazy
  `(.+?)` before a variable-length marker lookahead.
- **Recommended rewrite**: Same shared marker-scanning helper as Site 6.
- **Behavior change risk**: Equal for current corpus with generic marker
  scanning. The Forcecage corpus line must keep `range === "100 feet"`.
- **Existing tests**: Covered by `parse-spell-block.test.ts`, including
  standard range examples and Forcecage inline extraction.
- **Test additions needed**: Add a dedicated inline range assertion through the
  shared test table, plus a pathological range value with near-markers before
  the next real field.

## Site 8: `packages/server/src/seed/spell-parser/parse-spell-block.ts:96`

- **Site**: Component(s) field extraction in `parseSpellBlock`.
- **Current regex**:
  ```ts
  new RegExp(String.raw`\*\*Components?:\*\*\s*(.+?)${FIELD_BOUNDARY_LOOKAHEAD}`)
  ```
  it supports both `**Components:**` and singular `**Component:**`, then
  `parseComponents` splits component letters and material text.
- **Intent**: Extract component text such as `V, S`, `V, S, M (a bell and
  silver wire)`, and Forcecage's material text
  `ruby dust worth 1,500+ GP, which the spell consumes`.
- **Backtracking source**: Same shared source as Site 6.
- **Recommended rewrite**: Same shared marker-scanning helper as Site 6, with
  target marker matching `Component` or `Components`.
- **Behavior change risk**: Equal for current corpus with generic marker
  scanning. The corpus has 327 plural `Components` lines and 12 singular
  `Component` lines; both must remain accepted.
- **Existing tests**: Covered by `parse-spell-block.test.ts`, including
  singular `Component:` for Barkskin and Forcecage inline extraction.
- **Test additions needed**: Add shared field tests for singular/plural
  components, a long material string, an inline next-field boundary, and a
  pathological component value with many near-boundaries.

## Site 9: `packages/server/src/seed/spell-parser/parse-spell-block.ts:102`

- **Site**: Duration field extraction in `parseSpellBlock`.
- **Current regex**:
  ```ts
  new RegExp(String.raw`\*\*Duration:\*\*\s*(.+?)${FIELD_BOUNDARY_LOOKAHEAD}`)
  ```
  it captures the duration value until the next inline field marker or line
  end, then strips leading `Concentration, ` into the structured
  `concentration` flag.
- **Intent**: Extract duration strings such as `Instantaneous`,
  `Concentration, up to 1 minute`, `8 hours`, `Until dispelled`, and special
  corpus variants like `Up to 8 hours`.
- **Backtracking source**: Same shared source as Site 6.
- **Recommended rewrite**: Same shared marker-scanning helper as Site 6.
- **Behavior change risk**: Equal for current corpus with generic marker
  scanning, including the current behavior where duration lines with appended
  prose keep that prose in the raw duration. Corpus lines with appended prose
  include Fly (`07_Spells.md:2699`), Greater Invisibility (`3050`), Knock
  (`3700`), and Moonbeam (`4336`); whether to fix that is outside this lint
  rewrite unless explicitly chosen.
- **Existing tests**: Covered by `parse-spell-block.test.ts`, including
  concentration and Forcecage inline duration extraction.
- **Test additions needed**: Add a table for common duration values,
  Forcecage's inline duration, the four appended-prose corpus lines as either
  preserved behavior or intentional fix cases, and a pathological near-boundary
  duration value.

## Site 10: `scripts/code-intel/graph-cache.ts:129`

- **Site**: `resolveGitDir` parses a Git worktree `.git` file.
- **Current regex**: `/^gitdir:\s*(.+)$/u`; after
  `readFileSync(gitPath, "utf8").trim()`, it matches `gitdir:`, optional
  whitespace, and captures the git directory path. It accepts
  `gitdir: ../.git/worktrees/x`, `gitdir:../x`, spaces or tabs after the
  colon, and, because `\s*` includes newlines, `gitdir:\n../x`.
- **Intent**: Support repositories where `.git` is a file pointing at the real
  git dir, then let `readGitHead` fingerprint `HEAD`, loose refs, or
  `packed-refs` for `computeWorkspaceManifest` and `GraphCache` invalidation.
- **Backtracking source**: `\s*` and `.+` both consume whitespace after
  `gitdir:`. A malformed input such as `gitdir: ${spaces}x\ny` lets the engine
  retry many splits of the whitespace before failing `$` after `.+` encounters
  the internal newline.
- **Recommended rewrite**: Prefer string parsing: check
  `content.startsWith("gitdir:")`, slice after the prefix, reject line
  terminators, `trimStart()`, require a nonempty path, and resolve it. Regex
  option:
  `/^gitdir:[^\S\r\n]*(\S[^\r\n]*)$/u`, but string parsing makes the one-line
  gitfile policy clearer.
- **Behavior change risk**: String parsing is equal for normal gitfiles and a
  subset if it rejects `gitdir:\npath`, which current regex accepts but Git's
  gitfile format does not need. The current checkout has `.git` as a directory,
  so no local corpus gitfile exists.
- **Existing tests**: `bun run code:intel -- tests
  scripts/code-intel/graph-cache.ts --direct` returns `scripts/code-intel.test.ts`.
  Existing coverage includes injected `GraphCache` rebuild behavior and
  manifest invalidation for source-content edits, but `rg gitdir` found no
  direct gitfile parser tests.
- **Test additions needed**: Add `scripts/code-intel.test.ts` cases for a
  fixture `.git` file `gitdir: .actual-git\n` with `HEAD` and a loose ref,
  whitespace variants (no space, spaces, tab, leading/trailing whole-file
  whitespace), empty/invalid values producing the `no-git` manifest path,
  a decision case for `gitdir:\n.actual-git`, and a pathological malformed
  line like `gitdir: ${" ".repeat(4000)}x\ny`.

## Site 11: `packages/server/src/seed/generate-srd-spells.ts:25`

- **Site**: `SECTION_HEADER_RE` identifies alphabetic spell section headers
  while `splitIntoBlocks` walks the SRD spell markdown.
- **Current regex**: `/^###\s+[A-Z].*\b(?:Spells|and)\b/`; it matches a
  `###` heading starting with an uppercase letter and containing a later word
  boundary before `Spells` or `and`. It is unanchored at the end.
- **Intent**: Skip section headers such as `### A Spells`,
  `### J,K and L Spells`, `### M and N Spells`, and `### U-Z Spells` without
  skipping real spell headers such as `### Freezing Sphere`.
- **Backtracking source**: This site is the
  `regexp/no-contradiction-with-assertion` finding, not a backtracking finding.
  The `\b` before `(?:Spells|and)` contradicts the zero-length case of `.*`
  after `[A-Z]`: if `.*` consumes nothing, the position is between two word
  characters, so the word-boundary assertion cannot pass. Therefore `.*` is
  always entered despite having minimum 0.
- **Recommended rewrite**: Minimum lint-only rewrite:
  `/^###\s+[A-Z].+\b(?:Spells|and)\b/`, which makes the implicit minimum
  explicit but keeps overbroad behavior. Prefer an anchored intended-shape
  parser, either string checks (`startsWith("### ")`, `endsWith(" Spells")`,
  validate the label) or a regex like
  `/^###[ \t]+[A-Z][A-Z,-]*(?:[ \t]+and[ \t]+[A-Z][A-Z,-]*)?[ \t]+Spells$/`.
- **Behavior change risk**: Minimum rewrite is equal to the current matched
  language. Anchored intended-shape parsing is a subset and should be verified
  against the 16 corpus section headers after `## Spell Descriptions`:
  `A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`, `I`, `J,K and L`, `M and N`, `P`,
  `R`, `S`, `T`, and `U-Z` Spells. The role of the `and` alternative is
  ambiguous; the corpus would also be covered by a suffix-`Spells` check.
- **Existing tests**: `bun run code:intel -- tests
  packages/server/src/seed/generate-srd-spells.ts --direct` returns 0 results.
  Existing spell parser tests do not cover `splitIntoBlocks` section skipping.
- **Test additions needed**: Add generator split tests for `### A Spells`,
  `### J,K and L Spells`, `### M and N Spells`, `### U-Z Spells`,
  `### Freezing Sphere`, and an overbroad current-match case such as
  `### Alpha and Beta` to decide whether it should remain skipped.

## Summary

- Total sites: 11.
- Sites with existing test coverage: 7 sites (Site 1, Site 5, Sites 6-9,
  Site 10). Some are only broad candidate coverage and still need focused
  characterization.
- Sites needing new test files: 4 sites by site count (Sites 2, 3, 4, and 11),
  likely 3 new files because Sites 3 and 11 can share `generate-srd-spells`
  splitter tests.
- Estimated rewrite difficulty:
  - Site 1: M, because compact signed and ambiguous digit-key behavior need a
    decision.
  - Site 2: M, because the script has no tests and may need helper extraction.
  - Site 3: M, because it shares untested generator split behavior with
    Site 11.
  - Site 4: M, because the script has no tests and may need helper extraction.
  - Site 5: S, colocated tests already exist and string parsing is direct.
  - Sites 6-9: L as a group, because one shared helper must preserve Forcecage
    and document duration-line corpus quirks.
  - Site 10: M, because tests need a filesystem gitfile fixture.
  - Site 11: M, because the exact section-header language should be pinned.
- Suggested fix-pass order:
  1. Site 5 first, to establish the string-parser pattern in an already tested
     parser.
  2. Site 1 next, after deciding compact signed input and digit-key behavior.
  3. Site 10 next, with gitfile fixture tests.
  4. Sites 6-9 together, since one marker scanner should clear all four.
  5. Sites 2 and 4 together, sharing the level-heading rewrite and new helper
     tests.
  6. Sites 3 and 11 last, sharing `generate-srd-spells` splitter tests and the
     section-header/preamble policy decisions.

## Closing Summary

Leaf 21 Pass 2b closed on 2026-05-17 after three fix batches:

- Fix A landed Sites 1, 5, and 10.
- Fix B landed Sites 6-9.
- Fix C landed Sites 2, 3, 4, and 11.

Fix C extracted `packages/server/src/seed/level-heading.ts` for the shared
level-heading parser and `packages/server/src/seed/spell-splitter.ts` for
testable spell section/preamble splitting. The final corpus check matched the
scout counts: 232 level feature headings, 12 subclass headings, 339 spell
blocks, and 155 glossary entries. The deferred rules
`regexp/no-super-linear-backtracking`,
`regexp/no-misleading-capturing-group`, and
`regexp/no-contradiction-with-assertion` are now promoted to `error`.
