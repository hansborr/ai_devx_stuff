# 75. The message-identity golden calls itself a live collector run while freezing a deleted developer worktree 50 times over

Status: Landed on fix/cq-075
Theme: golden fixture labeling · Area: tests · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet kernel's message-identity golden corpus is a 45,113-byte JSON
capture (25 records: 21 positive entries, 4 negatives) whose own header calls it
a "live collector run", and whose consuming test repeats the claim in its title.
Neither is true anymore, and nothing keeps it true: the corpus pins
`/home/node/persist/worktrees/workspace/mfx2fix-l4` — a developer worktree that
no longer exists — 50 times, one captured file has since been deleted from the
repository, and there is no regeneration script or freshness owner anywhere in
the tree. A contributor who trusts the "live" label will either try to
regenerate it (there is no path) or conclude the corpus is maintained when it is
a one-time historical snapshot. In a package meant to be copied out of this repo
as a reference, a machine-specific home-directory path repeated 50 times is
exactly the kind of wart adopters trip over first.

## Evidence

- `tools/lint-ratchet/src/kernel/fixtures/message-identity-golden.json:2-3` —
  `"capturedRepoRoot": "/home/node/persist/worktrees/workspace/mfx2fix-l4"` and
  `"captureSource": "live collector run for ratchet/react-hooks-set-state-in-effect-client"`.
- Measured at the pin: the fixture is 45,113 bytes with 21 `entries` and 4
  `negatives`; the worktree-root literal occurs 50 times (1 header + 25
  `filePath` fields + 24 embedded inside `rawMessage` bodies), and the same
  React "Calling setState synchronously within an effect…" sentence occurs 42
  times. The 25 `expectedIdentity` strings contain zero occurrences of the root.
- `tools/lint-ratchet/src/kernel/fixtures/message-identity-golden.json:146` —
  captured `filePath` `…/packages/client/src/hooks/use-debounced-cursor-list.ts`;
  that file is absent from the tree at the pin.
- `tools/lint-ratchet/src/kernel/message-identity.test.ts:7` — test title
  "matches every messageId-less identity in the live collector golden corpus";
  lines 7-23 consume the corpus purely as static normalization input, with no
  regeneration or freshness path (repo-wide search finds only this test and one
  coverage-map row referencing the fixture).
- The coverage-map entry for the fixture also describes it as "live
  message-identity golden corpus". Since leaf 111 that text lives in the typed
  manifest (`scripts/lint-coverage-map-manifest-<area>.ts`) and
  `docs/generated/lint-coverage-map.md` is rendered from it.
- `tools/lint-ratchet/src/kernel/message-identity.ts:12-17` — `normalizeRepoRoot`
  does `value.replaceAll(repoRootPath, "<repo-root>")`, and the test passes
  `corpus.capturedRepoRoot` explicitly (`message-identity.test.ts:20`), so the
  root's spelling is functionally irrelevant to every asserted identity — a
  consistent rewrite is identity-preserving by construction.

## Proposed direction

Disposition, verbatim: **"Rewrite the captured worktree root to a stable
synthetic path throughout the fixture, relabel it in both the JSON header and
the test prose as a frozen historical capture (dropping the 'live' claim), and
keep the real diagnostic bodies as-is rather than rebuilding a synthetic
corpus."** Mechanics:

1. Pick a stable synthetic absolute root (e.g. `/golden/worktree`) and replace
   the old root at all 50 occurrences: the `capturedRepoRoot` header, every
   `filePath`, and the paths embedded inside `rawMessage` bodies. The 25
   `expectedIdentity` strings need no edits (zero occurrences). The rewrite must
   be a single consistent string so `normalizeRepoRoot` still maps it to
   `<repo-root>` everywhere.
2. Reword `captureSource` (`message-identity-golden.json:3`) as a frozen
   historical capture — e.g. "frozen capture of a collector run for
   ratchet/react-hooks-set-state-in-effect-client" — and retitle the test at
   `message-identity.test.ts:7` to match (e.g. "…in the frozen golden corpus").
3. Update the fixture's rationale text in its coverage-manifest entry to drop
   the "live" wording, then run `bun run docs:lint-coverage-map:generate`.
4. Verify with `bun run test -- tools/lint-ratchet/src/kernel/message-identity.test.ts`;
   all 25 assertions must pass unchanged, proving the rewrite touched no
   identity.

## Scope / caveats

- **Do not rebuild a synthetic corpus.** The original proposal — a compact
  builder with relative case data and one shared diagnostic template — was
  considered and rejected: goldens are supposed to be frozen captures, and a
  rebuild trades real captured-input fidelity for churn. The 42× repeated
  diagnostic bodies stay as captured.
- The stale captured path (`use-debounced-cursor-list.ts`, fixture line 146)
  stays in the fixture: once relabeled as a frozen capture, referencing a
  since-deleted file is legitimate historical data, not an error. The prior
  pack's [16-client-query-layer.md](../code-quality-2026-07-25/16-client-query-layer.md)
  removed that hook, which explains the staleness; it does not rule on this
  fixture.
- Choose a synthetic root that cannot substring-collide with other fixture text
  (the `rawMessage` bodies contain URLs and code frames), and never an empty
  string — `normalizeRepoRoot` deliberately skips normalization for an empty
  root (`message-identity.ts:14-15`).
- The messageId-keying lock tests in the same file
  (`message-identity.test.ts:49` onward) are out of scope; only the corpus
  test's title changes.
- No sequencing dependencies on other leaves in this pack.
