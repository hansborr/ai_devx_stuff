# 06 — Harden rule-source identity hashing (latent hazard)

Status: Done — 2026-07-16 fail-closed guard (scripts/lint-ratchet/rule-source-import-guard.ts)
rejects dynamic import()/require() and a second static import per line as
ConfigError; the guard masks comment AND string/template-literal contents so it
neither false-positives on import()-in-a-string nor misses an import() hidden
behind a `//`-bearing string literal. Regression tests pin both fail-open
categories and both literal cases (multi-import chosen to be rejected, not
supported); specifier extraction is unchanged, so no scanned closure hash moves.
Priority: P2 · Size: S · Risk: low (tightens an existing invariant)
Source: lint architecture review 2026-07-16 (R6) — GPT's unique find; not
independently confirmed by other reviewers. Failure mode verified against
the code 2026-07-16 (see below).

## Problem

Baseline identity trusts a source-closure hash computed by a hand-written
regex import scanner (`scripts/lint-ratchet/rule-source.ts`). Verified at
HEAD (2026-07-16): the scanner **fails closed on everything it scans** —
missing relative targets, directories without `index.js`, and missing
`node_modules/<pkg>/package.json` all throw `ConfigError`. It fails *open*
(silent exclusion from the hash) in exactly two categories:

1. dynamic `import()`/`require()` — out of scope by design
   (`rule-source.ts:20-28`); a helper reachable only that way would be
   edited without the closure hash changing — a silent identity lie;
2. a second static import placed after `;` on the same physical line (the
   `^\s*` regex anchor matches only the first import per line).

Neither is currently triggered in any *scanned closure*: `eslint-rules/`
local rules use ordinary one-per-line static imports (JSDoc
`import('eslint')` type annotations are comment-stripped before scanning
and never misfire). Note (found while implementing): one non-test file,
`eslint-rules/no-redundant-central-mock.js`, contains `await import(...)`
text, but every occurrence is inside backtick **factory-source string
literals** (the mock factories it compares against) — none is executable
code, so it is not a real dynamic-import user; it is also not a ratchet and
no ratcheted rule's static-import closure reaches it, so the scanner never
visits it. It matters as a *false-positive* demonstration: a comment-only
guard would wrongly reject those literals, which is why the guard masks
string/template-literal contents (see below). The hazard is conventional —
nothing *enforces* the static-ESM convention the scanner relies on — and
`rule-source.test.ts` does not pin either fail-open category.

## Do

1. Add a fail-closed guard: reject dynamic `import(`/`require(` call syntax
   in scanned closure files as a `ConfigError`, turning the static-ESM
   convention into an enforced invariant (a rule author who genuinely needs
   dynamic loading then gets a loud config error, not a stale hash).
2. Add regression tests pinning both fail-open categories (dynamic-import
   rejection; multi-import-per-line handling — either support it or reject
   it explicitly).

The review's original prescriptions (real module lexer / bundler metafile /
explicit `sourceDependencies`) are disproportionate for a hazard no current
rule exercises; revisit only if the guard proves too restrictive.
