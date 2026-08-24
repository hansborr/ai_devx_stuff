# 148. Parse local-rule imports with TypeScript instead of maintaining a partial JavaScript lexer

Status: Landed on fix/cq-148
Theme: rule-source identity · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Local lint-rule identity includes the source closure of each rule, so dependency
discovery must recognize every supported static import without mistaking
comments, strings, templates, or regular expressions for executable syntax.
That correctness boundary currently rests on anchored regular expressions, a
naive comment stripper, and a second custom masking pass.

The masking guard fails loudly when it encounters dynamic loading or multiple
static imports on one physical line, which bounds the risk of silent
mis-hashing. It nevertheless imposes a formatting restriction solely because
the scanner recognizes only the first import on a line. Supporting another
JavaScript syntax shape requires coordinated changes to extraction, masking,
and contributor-facing diagnostics. That is an unnecessary maintenance burden
and a poor copyable boundary for a package presented as a portable harness
kernel.

## Evidence

- `tools/lint-ratchet/src/kernel/rule-source.ts:20-46` defines two anchored
  import regular expressions and `stripCommentsForImportScan`, whose comment
  explicitly describes it as naive.
- `tools/lint-ratchet/src/kernel/rule-source-import-guard.ts:3-15` rejects both
  dynamic loading and a second static import after a semicolon on the same
  physical line because the scanner's `^\s*` anchors only find the first.
- `tools/lint-ratchet/src/kernel/rule-source-import-guard.ts:17-68` implements
  context-sensitive masking for comments, quoted and template literals, and
  regular-expression literals before applying the guard expressions.
- `tools/lint-ratchet/src/kernel/rule-source.ts:161-172` separately runs the two
  import expressions with `matchAll`; `:210-224` couples the guard, comment
  stripping, bare-package collection, and relative-import recursion.
- Measured at the pin, `rule-source.ts` is 356 lines and
  `rule-source-import-guard.ts` is 89 lines, 445 combined. The proposed removal
  concerns the 89-line guard and the extraction/call-site regions above, not the
  closure resolution, package-version identity, and hashing that occupy most of
  `rule-source.ts`.
- `tools/lint-ratchet/src/kernel/rule-source.test.ts:186-317` carries the guard
  scenarios inside the main rule-source suite. In particular, `:289-303`
  rejects two valid static imports on one line, while `:203-277` distinguishes
  executable dynamic loading from the same text in strings, templates, regular
  expressions, and comments.
- `tools/lint-ratchet/package.json:52-57` already declares
  `typescript: ~6.0.3` as a direct runtime dependency, so parser-based discovery
  needs no new package.

## Proposed direction

Replace the extraction and masking surface with the TypeScript parser API.
Inside `collectLocalRuleSourceClosure`, parse each `.js` closure file once with
`ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, false,
ts.ScriptKind.JS)`. Enumerate module specifiers from top-level
`ImportDeclaration` nodes and from `ExportDeclaration` nodes that have a module
specifier. This covers imported bindings, bare side-effect imports, named
re-exports, and `export * from` without formatting restrictions.

Keep `bareSpecifierPackageRoot` and `resolveLocalRuleImport` as the classifiers
for the discovered strings. Walk the parsed tree for executable `import(...)`
and calls whose callee is the identifier `require`; reject those with a
`ConfigError` whose guidance remains recognizably the current static-ESM
message, minus the obsolete one-import-per-line clause. For JavaScript closure members, surface malformed-source diagnostics as a
`ConfigError` through a supported public TypeScript API;
`SourceFile.parseDiagnostics` is not declared by TypeScript 6.0.3. Keep
non-JavaScript closure members such as imported JSON as opaque hashed leaves,
and reconcile the supported diagnostic path with the parse-once requirement.

Delete `rule-source-import-guard.ts`,
`stripCommentsForImportScan`, and both import regular expressions. This also
absorbs the deferred regex-comment cleanup for this lexer: there should be no
separate follow-up preserving or refining comment stripping after parser-based
discovery lands. Rewrite the narrative comments at
`rule-source.ts:20-47` and `:210-216` around the parser-based contract.

Keep hashing raw file bytes. When the parser discovers the same closure, the
resulting hash must remain byte-identical. Characterize the live ratchet set
before the replacement and compare `buildRuleSourceHashesById` results after it;
there is no dedicated parity command today, so use a temporary dual-run harness
or equivalent checked comparison rather than citing a nonexistent script. An
intentional discovery-set correction may require one documented baseline
update.

Rework `rule-source.test.ts:121-317` through its existing injected
`LocalRuleSourceFileSystem` seam. Invert the multi-import rejection into an
acceptance test that proves both files affect the closure hash, retain dynamic
`import()` and `require()` rejection, turn string/comment false-positive cases
into ordinary parser acceptance, and add malformed-source rejection through
parse diagnostics.

## Scope / caveats

- Do not change relative-import resolution, extension and `index.js` probing,
  bare-package version identity, raw-byte hash construction,
  `LINT_RATCHET_CONFIG_HASH_PREFIX`, third-party/core source identity, or
  baseline formats.
- AST-based dynamic-loading detection must remain at least as strict as the
  current guard. Parser migration is not permission to admit runtime-resolved
  dependencies into a closure model that cannot follow them.
- Parse each source once per closure calculation and avoid multiplying parser
  work when several ratchets share the same local-rule source.
- A changed discovery set can legitimately move `ruleSourceHash` values; prove
  parity first, and treat any resulting baseline churn as an explicit migration
  rather than hiding it.
- [150-engine-context-leaves-local-rule-cache.md](./150-engine-context-leaves-local-rule-cache.md)
  also edits `rule-source.ts`, but only around `localRulePath` and binding
  threading. The changes are semantically independent and require coordination
  only to avoid merge friction.
- No 2026-07-25 leaf establishes a ruling or dependency for this surface.
