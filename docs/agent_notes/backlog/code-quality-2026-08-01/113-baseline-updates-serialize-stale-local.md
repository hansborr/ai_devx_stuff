# 113. Ordinary baseline updates serialize the caller's stale installed toolchain into repository-wide hash churn

Status: Landed on fix/cq-113
Theme: baseline update toolchain hygiene · Area: harness · Severity: high · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Every entry in `lint-ratchet.baseline.json` commits a `ruleSourceHash` whose
inputs include the versions of eslint, typescript-eslint, and TypeScript that
happen to be installed in the caller's `node_modules` at update time. So an
ordinary debt-floor update — the routine `bun run lint:ratchet:update` a
contributor runs after paying down findings — also silently re-serializes
dependency identities from whatever tree that contributor has installed. If the
installation is stale relative to `bun.lock`, the update rewrites most of the
baseline's hash lines, burying the intended debt movement in review-hostile
churn and, worse, baking one lane's wrong toolchain identity into the shared
file so that every *fresh* lane then fails the ratchet.

This is not hypothetical: a hash-refresh commit produced from a lane with
typescript-eslint 8.59.4 installed (lockfile pinned 8.63.0) rewrote 20 hash
lines and had to be reverted with a hand-reconciled corrective commit. Under
this repo's multi-lane worktree workflow, stale installations are a recurring
condition, yet nothing in the update path establishes the installation hygiene
its output depends on — the repo already computes exactly the needed freshness
signal for `doctor` and pre-commit, but the one command that *writes*
toolchain identity into a committed file never consults it. The pre-commit
check that comes closest only warns, and only when `bun.lock` itself is
staged, so a stale lane staging only the baseline sees nothing. Since the
lint-ratchet is the flagship copyable harness surface (the demo README tells
external adopters to copy it wholesale and to pin "your installed" versions
with no freshness precondition), the gap ships to every adopter.

## Evidence

- `lint-ratchet.baseline.json:19` — the first `ruleSourceHash` field (line 18
  is `configHash`); every baseline entry commits one alongside its debt floor.
- `lint-ratchet.baseline.json` — 19 `ruleSourceHash` fields with 13 distinct
  values (counted at the pin), so a dependency-identity refresh fans out
  across most of the generated file.
- `tools/lint-ratchet/src/kernel/rule-source.ts:127` — `readPackageVersion`
  reads `node_modules/<pkg>/package.json`; `:141-158` route the eslint,
  typescript-eslint, and TypeScript versions through it into the hash inputs.
- `tools/lint-ratchet/src/kernel/baseline-hash.ts:92` (`configHashInput`) and
  `:128` (`computeCoreLintRatchetRuleSourceHash`) — where those inputs are
  serialized into the committed hashes.
- Incident, in history at the pin: commit `45e57e33d` regenerated the baseline
  and changed 20 hash lines ("metadata only"); `a81fda0dc` reverted all 20
  because the producing lane had typescript-eslint 8.59.4 installed while
  `bun.lock` pinned 8.63.0 — the refresh baked one lane's stale
  `node_modules` identity into the shared baseline.
- `scripts/dependency-freshness.sh:37-91` — `musi_dependency_freshness` (with
  the `musi_dependency_status`/`musi_dependency_message` wrappers at
  `:85-91`) already computes the exact signal needed: `bun.lock` content
  digest vs `node_modules/.musi-install-digest`, with a documented legacy
  mtime fallback (`:74-78`) when the digest marker is absent.
- `scripts/doctor.sh:49` and `.husky/pre-commit:62` — both source that helper;
  the `--update` path does not (no reference to `dependency-freshness`,
  `.musi-install-digest`, or `musi_dependency_*` anywhere under
  `scripts/lint-ratchet.ts`, `scripts/lint-ratchet/`, or
  `tools/lint-ratchet/src/`, verified at the pin).
- `.husky/pre-commit:185-199` — `warn_if_staged_lockfile_needs_install`
  returns early unless `bun.lock` itself is staged, and even then only prints
  a WARN; a stale lane committing only `lint-ratchet.baseline.json` gets no
  signal at all.
- `tools/lint-ratchet/src/kernel/rule-source-drift.ts:69` —
  `formatRuleSourceDriftClassification`, the check-side classifier whose
  recovery text (`:84`, `:89`) instructs "run bun run lint:ratchet:update to
  refresh ruleSourceHash metadata" — the documented recovery path routes users
  straight into the unguarded write.
- `examples/lint-ratchet-demo/README.md:97-99` — "Make it yours" step 3 tells
  adopters `bun run lint:ratchet:update` "pins your installed
  eslint/typescript-eslint versions", with no freshness precondition.
- `package.json:101` — `lint:ratchet:update` is `bun scripts/lint-ratchet.ts
  --update`, the adapter entry point where a preflight belongs.

## Proposed direction

1. **Add a hard toolchain-freshness preflight to the adapter-side `--update`
   path** (`scripts/lint-ratchet.ts` / `scripts/lint-ratchet/`), not the
   kernel. Before any baseline write, evaluate the same signal
   `scripts/dependency-freshness.sh` already computes for `doctor` and
   pre-commit (`bun.lock` content digest vs
   `node_modules/.musi-install-digest`), and on missing/stale refuse to write
   with a focused message: "install state is stale; run bun install, then
   re-run bun run lint:ratchet:update". This closes the exact gap that
   produced `45e57e33d`/`a81fda0dc`, since pre-commit's existing check only
   warns and only when `bun.lock` itself is staged.
2. **Reuse one implementation of the digest semantics** — shell out to the
   sourced sh helper, or extract a tiny shared TS reader covered by a fixture
   test — rather than re-deriving them in TypeScript. The helper is POSIX sh
   sourced by both doctor and pre-commit; if a TS consumer is added, prove
   parity with a shared fixture test instead of duplicating logic.
3. **Keep the kernel portable.** The preflight is either wholly adapter-local
   or exposed as an optional hook on the engine binding (e.g. an
   `assertToolchainFresh` seam the Musi adapter fills in), so external
   adopters copying `tools/lint-ratchet` get the seam without inheriting
   Musi's `bun.lock`/marker convention.
4. **Implement "separate intentional refreshes" at review-legibility level,
   not as a new command.** When the recomputed baseline differs from the
   committed one only in `ruleSourceHash` values, `--update` prints an
   identity-refresh classification (reusing the vocabulary of
   `formatRuleSourceDriftClassification` in `kernel/rule-source-drift.ts`)
   with the refreshed-hash count; mixed updates report the hash-refresh count
   separately from debt-floor deltas, so a reviewer can distinguish identity
   churn from debt movement in the diff.
5. **Update the demo README "Make it yours" step 3**
   (`examples/lint-ratchet-demo/README.md:97-99`) to document the freshness
   precondition/seam, since it currently instructs adopters to pin whatever is
   installed.

## Scope / caveats

- **Out of scope, explicitly:** splitting refreshes into a separate CLI mode
  or flag — the check-side recovery message ("run bun run lint:ratchet:update
  to refresh ruleSourceHash metadata",
  `kernel/rule-source-drift.ts:84,89`) depends on plain `--update` performing
  the refresh, and that contract must not break; any change to hash inputs or
  computation (`kernel/baseline-hash.ts`); and the kernel Musi-vocabulary
  cleanup, which belongs to
  [122-portable-lint-ratchet-package-hard-codes.md](./122-portable-lint-ratchet-package-hard-codes.md).
- **Parity risk:** a second implementation of the digest/freshness semantics
  in TS can drift from `scripts/dependency-freshness.sh` (whose POSIX
  constraints exist because pre-commit sources it), silently re-opening the
  gap or producing phantom-stale blocks. Single-source or fixture-test the
  parity — this is a hard requirement, not a preference.
- **False-positive risk:** a hard preflight can misfire where the digest
  marker was never written (fresh clone before postinstall, external adopters
  of the copied engine, per-worktree `node_modules` just provisioned). Honor
  the helper's documented fallback semantics (legacy mtime path at
  `scripts/dependency-freshness.sh:74-78`) rather than treating a missing
  marker as unconditionally stale, and keep the binding seam optional.
- **Recovery-flow chaining:** the new failure can fire inside existing
  recovery flows whose messages tell users to run update (the rule-source
  drift classification, `scripts/lint-ratchet/post-merge-baseline-preflight.ts`).
  Its message must chain cleanly — `bun install`, then re-run — rather than
  dead-ending a documented recovery path.
- **Sequencing (soft, no hard dependencies):** keep the preflight and its
  remediation prose in the adapter/binding rather than the kernel so it does
  not enlarge the surface of the kernel-vocabulary cleanup in
  [122-portable-lint-ratchet-package-hard-codes.md](./122-portable-lint-ratchet-package-hard-codes.md);
  and if
  [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md)
  restructures CLI parsing, whichever leaf lands second rebases trivially,
  since both touch the `--update` entry path in `scripts/lint-ratchet`.
