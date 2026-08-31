# Add a "New Workspace Package" Registration Checklist

Status: Implemented
Date: 2026-08-25
Priority: P2
Size: S
Source: `harness-registration-and-generated-surfaces.md` — "Repeated
registration surfaces" (the CQ-181 `tools/harness-diagnostics` extraction)

## Problem

The note calls adding a whole new `tools/*` (or `packages/*`) workspace
package "the widest instance of this" registration-duplication problem and
lists roughly fifteen surfaces one such change had to touch. The commit that
actually did this, `a1f8f13ae` (2026-08-21, "extract harness-diagnostics into
a portable package"), confirms the list is not exaggerated — its own commit
message enumerates: 12 production importers, 9 test importers, the
lint-ratchet acceptance-fixture copy-set/closure/symlink cluster, 8 shell-smoke
`# smoke-subjects:` headers plus their two runtime fixture copies, the
regenerated `path-policy-smoke-subjects-data.ts`, the coverage-map manifest
rows/heading/intro plus the regenerated `docs/generated/lint-coverage-map.md`,
ESLint reach + boundary policy in `eslint-config/tools-configs.js`, the
max-lines engine-zone cap in `eslint-config/code-quality-configs.js`, the root
`tsconfig.json` project reference, `eslint-config/config-surface-manifest.json`
plus the regenerated `tsconfig.configs.json`, the root `package.json`
devDependency and `bun.lock`, a new `vitest.config.ts` project entry plus a
coverage-threshold block in the root `vitest.config.ts`, and a `knip.config.ts`
workspace block — roughly twenty distinct registration surfaces across 52
changed files per `git show --stat a1f8f13ae` (an earlier draft of this note
said "21 files touched in total", which the command contradicts).

The note further records that two of these were *not* caught by any existing
checker on that same change: `eslint-rules/eslint-config-policy.test.js`'s
hand-pinned config-file list (now correctly listing
`"tools/harness-diagnostics/vitest.config.ts"` at
`eslint-rules/eslint-config-policy.test.js:91`, confirming it needed a manual
edit) and `scripts/import-closure/alias-parity.test.ts`, whose
`expect(classifiedPackages).toEqual(workspacePackages)` assertion
(`:87-93`) does catch an unclassified `@musi/*` workspace package — but only
when that Vitest file is actually selected and run, which the note says did
not happen under the fast-commit skip for the `test` slot combined with
changed-mode not routing a `tools/` package addition to it.

No `docs/guides/*.md` or `scripts/README.md` section names this checklist
today (`grep -rln "new workspace package" docs/guides/ docs/*.md scripts/README.md`
returns nothing). `scripts/README.md` gained a comparable checklist for a
narrower case just today (2026-08-25, commit `76674b535`, "Registering a new
doc generator" — five numbered steps), showing the repository's established
pattern for this kind of gap: when a registration surface can't be fully
generated, write down the checklist next to the other generated-surface
documentation instead of leaving it to be rediscovered.

## Scope

- Add a "Adding a new `packages/*` or `tools/*` workspace package" checklist
  to `scripts/README.md`, placed near the existing "Registering a new doc
  generator" section it is modeled on.
- Build the checklist from the real surfaces `a1f8f13ae` touched (re-verify
  each against the live tree before writing, since some may have shifted
  since 2026-08-21): root `package.json` workspace dependency + `bun.lock`;
  root `tsconfig.json` project reference; `eslint-config/config-surface-manifest.json`
  entry + regenerated `tsconfig.configs.json` (`bun run harness:config-surfaces`);
  `eslint-config/tools-configs.js` ESLint reach/boundary policy;
  `eslint-config/code-quality-configs.js` max-lines engine-zone cap (if the
  package needs a non-default cap); a package-local `vitest.config.ts` plus a
  root `vitest.config.ts` project entry and coverage-threshold block;
  `knip.config.ts` workspace block; the `scripts/lint-coverage-map-manifest-*.ts`
  row(s) and regenerated `docs/generated/lint-coverage-map.md`; the
  lint-ratchet acceptance-fixture copy-set/closure/symlink entries if the
  package is copied into that fixture; any `# smoke-subjects:` headers whose
  smokes now exercise the new package, plus `bun run test:scripts:subjects`.
- Explicitly name the two surfaces the note says slipped through on the live
  incident, with a direct pointer to each so a reviewer can check them by
  hand: `eslint-rules/eslint-config-policy.test.js`'s hand-pinned config-file
  list, and `scripts/import-closure/alias-parity.test.ts`'s
  `mappedWorkspaceSources` / `deliberatelyUnmappedWorkspacePackages`
  classification (`scripts/import-closure/alias-parity.test.ts:13-24`) — note
  that the latter test *does* fail if the package is left unclassified, so
  the checklist item is "run `bun run test:scripts:file --
  scripts/import-closure/alias-parity.test.ts` directly," not "trust
  changed-mode selection to pick it up."
- Do not implement a generated/derived version of this checklist, do not
  change `alias-parity.test.ts`'s fast-commit/changed-mode routing, and do not
  touch the `eslint-config-policy.test.js` pin mechanism itself — this leaf is
  documentation only, matching the size and shape of today's doc-generator
  checklist addition.

## Verification

- The new checklist section renders correctly in `scripts/README.md` (no
  broken Markdown, consistent with the surrounding "Generated Files" section
  style).
- Every command named in the checklist (`bun run harness:config-surfaces`,
  `bun run test:scripts:subjects`, `bun run test:scripts:file --
  scripts/import-closure/alias-parity.test.ts`, `bun run docs:lint-coverage-map:generate`)
  is a real `package.json` script at HEAD.
- Manually diff the checklist against `git show --stat a1f8f13ae` and confirm
  no touched registration surface from that commit is missing from the list
  (or is explicitly called out as package-specific and not always required,
  e.g. the max-lines engine-zone cap).
