# Merge-driver field exercise — findings, session 2 (Gemini perspective, lane Y)

- Date: 2026-07-09
- Worktree: `mfx2-y`
- Base Commit: `d41d7fbc`
- Target Deliverable File: `docs/agent_notes/merge-driver-field-exercise-findings-2026-07-09-lane-y.md`

---

## Scenario 1: Cross-Rule Drains

### Setup & Fixes
We selected two distinct rules to drain across four scratch branches:
- **Rule A (`no-real-time-in-package-tests`)**: Violating item in `packages/client/src/hooks/use-weapon-roll.test.ts` line 29 (`createdAt: new Date().toISOString()`). Drained by changing it to a static epoch date: `new Date(0).toISOString()`.
- **Rule B (`testing-library-no-container-client-tests`)**: Violating item in `packages/client/src/components/campaign/combat/combat-death-saves.test.tsx` line 83 (destructuring `container` from `render(...)` and querying it). Drained by calling global `document.querySelector("svg")` to verify the SVG's presence.

---

### Order 1: Merging s1-1a into s1-1b

#### 1. Setup & Branch Operations
- Created `scratch/mfx2-y-s1-1a` off `scratch/mfx2-y-base`.
- Applied Rule A fix to `use-weapon-roll.test.ts`.
- Executed `FORCE_VERIFY=1 bun run lint:ratchet:update` to tighten the baseline.
- Staged and committed: `fix(ratchet): drain date-now ratchet finding in use-weapon-roll test` (commit `e764af31`).

- Created `scratch/mfx2-y-s1-1b` off `scratch/mfx2-y-base`.
- Applied Rule B fix to `combat-death-saves.test.tsx`.
- Executed `FORCE_VERIFY=1 bun run lint:ratchet:update` to tighten the baseline.
- Staged and committed: `fix(ratchet): drain testing-library-no-container ratchet finding in combat-death-saves test` (commit `8ff099c2`).

---

#### 2. Exact Git Operations & Verbatim Merge Output
We created `scratch/mfx2-y-s1-m1` off `s1-1b`, and merged `s1-1a` into it:
```bash
git checkout -b scratch/mfx2-y-s1-m1 scratch/mfx2-y-s1-1b
git merge scratch/mfx2-y-s1-1a --no-ff
```

**Verbatim Stdout:**
```
Switched to a new branch 'scratch/mfx2-y-s1-m1'
Auto-merging lint-ratchet.baseline.json
Merge made by the 'ort' strategy.
 lint-ratchet.baseline.json                        | 4 ----
 packages/client/src/hooks/use-weapon-roll.test.ts | 2 +-
 2 files changed, 1 insertion(+), 5 deletions(-)
```

---

#### 3. Post-Merge Verification & Verbatim Gate Output
We ran `bun run lint:ratchet:check-baseline` to verify baseline consistency.

**Verbatim Stdout:**
```
lint:ratchet:check-baseline OK (13s) - full log: /tmp/musi-bun-logs.79757688b4c88e2c577f1c99a00dd89e20be48e1b0c9491a6c12f8796cacd828/lint_ratchet_check-baseline.log
```

---

#### 4. Verdict
**Verdict: CLEAN**
The merge was instant and silent. Both files were correctly updated, and the baseline dropped both drained items. No markers or recovery recipes were needed.

---

### Order 2: Merging s1-2b into s1-2a (Reverse Order)

#### 1. Setup & Branch Operations
- Created `scratch/mfx2-y-s1-2a` off `scratch/mfx2-y-base`.
- Applied Rule A fix and ran `FORCE_VERIFY=1 bun run lint:ratchet:update`.
- Staged and committed: `fix(ratchet): repeat use-weapon-roll date drain` (commit `adb3da89`).

- Created `scratch/mfx2-y-s1-2b` off `scratch/mfx2-y-base`.
- Applied Rule B fix and ran `FORCE_VERIFY=1 bun run lint:ratchet:update`.
- Staged and committed: `fix(ratchet): repeat combat-death-saves container drain` (commit `c6d1e68b`).

---

#### 2. Exact Git Operations & Verbatim Merge Output
We created `scratch/mfx2-y-s1-m2` off `s1-2a`, and merged `s1-2b` into it:
```bash
git checkout -b scratch/mfx2-y-s1-m2 scratch/mfx2-y-s1-2a
git merge scratch/mfx2-y-s1-2b --no-ff
```

**Verbatim Stdout:**
```
Switched to a new branch 'scratch/mfx2-y-s1-m2'
Auto-merging lint-ratchet.baseline.json
Merge made by the 'ort' strategy.
 lint-ratchet.baseline.json                                            | 4 ----
 .../client/src/components/campaign/combat/combat-death-saves.test.tsx | 4 ++--
 2 files changed, 2 insertions(+), 6 deletions(-)
```

---

#### 3. Post-Merge Verification & Verbatim Gate Output
We ran `bun run lint:ratchet:check-baseline` to verify baseline consistency.

**Verbatim Stdout:**
```
lint:ratchet:check-baseline OK (25s) - full log: /tmp/musi-bun-logs.79757688b4c88e2c577f1c99a00dd89e20be48e1b0c9491a6c12f8796cacd828/lint_ratchet_check-baseline.log
```

---

#### 4. Verdict
**Verdict: CLEAN**
Symmetric correctness verified. The baseline correctly merged disjoint drains under `ort` regardless of merge direction.

---

## Scenario 2: Knip Disjoint Entry Drains

### Setup & Fixes
We targeted two disjoint unused exports from `sensor-knip-unused-exports.baseline.json`:
- **Branch A**: Drained `boundedHistoryOptionFields` in `scripts/drift-ai/bounded-history-options.ts` by removing the `export` keyword.
- **Branch B**: Drained `RISKY_CONTEXT_PREFIX` in `scripts/drift-ai/class-construction-types.ts` by removing the `export` keyword.

---

### Setup & Branch Operations
- Created `scratch/mfx2-y-s2-a` off `scratch/mfx2-y-base`.
- Removed `export` from `boundedHistoryOptionFields`.
- Executed `bun run sensor:knip-unused-exports -- --update` to regenerate the baseline.
- Staged and committed: `chore(knip): drain boundedHistoryOptionFields export from knip baseline` (commit `c48ccbf6`).

- Created `scratch/mfx2-y-s2-b` off `scratch/mfx2-y-base`.
- Removed `export` from `RISKY_CONTEXT_PREFIX`.
- Executed `bun run sensor:knip-unused-exports -- --update` to regenerate the baseline.
- Staged and committed: `chore(knip): drain RISKY_CONTEXT_PREFIX export from knip baseline` (commit `9c6803eb`).

---

### Exact Git Operations & Verbatim Merge Output
We created `scratch/mfx2-y-s2-m` off `s2-a`, and merged `s2-b` into it:
```bash
git checkout -b scratch/mfx2-y-s2-m scratch/mfx2-y-s2-a
git merge scratch/mfx2-y-s2-b --no-ff
```

**Verbatim Stdout:**
```
Switched to a new branch 'scratch/mfx2-y-s2-m'
Auto-merging sensor-knip-unused-exports.baseline.json
Merge made by the 'ort' strategy.
 scripts/drift-ai/class-construction-types.ts |  2 +-
 sensor-knip-unused-exports.baseline.json     | 10 ++--------
 2 files changed, 3 insertions(+), 9 deletions(-)
```

---

### Post-Merge Verification & Verbatim Gate Output
We ran `bun run sensor:knip-unused-exports` on the merged branch.

**Verbatim Stdout:**
```
$ bun scripts/sensor-knip-unused-exports.ts
sensor:knip-unused-exports: running knip self-scan (budget 180s)…
sensor:knip-unused-exports
baseline: 187 (exports 73, types 114, enumMembers 0, namespaceMembers 0)
current: 187 (exports 73, types 114, enumMembers 0, namespaceMembers 0)
OK: knip unused-export symbols match baseline 187 identities
```

---

### Verdict
**Verdict: CLEAN**
The knip baseline merge driver resolved the conflict perfectly:
- Authoritative `entries[]` successfully kept both disjoint drains.
- The `summary` count was automatically updated and regenerated to `187` (`exports: 73`), avoiding the summary-drift failure from driverless merges.
- The gate successfully accepted the baseline.

---

## Findings & Prioritized Proposals

### Finding F6 (P2): Cross-Worktree Hook Lock Contention Blocks Parallel Commits
- **Context**: Secondary worktrees share the same Git common directory (`.git`), so their Husky/verify hooks share state.
- **Problem**: When one worktree commits, it holds a lock:
  `COMMIT_QUEUE_LOCK=/tmp/musi-commit-queue.lock.<common-key>`
  Other worktrees attempting a commit are blocked and print a contention message. During high activity (e.g. four agent lanes active), a commit can easily block for 5+ minutes while other lanes finish running ESLint/typechecks.
- **Impact**: Developer experience feels sluggish or frozen during multi-lane concurrent commits.
- **Proposal (P2)**: Optimize pre-commit steps to reduce the lock-holding duration. In fast-commit mode, further restrict lint scope or skip global checks to release the lock under 10 seconds.

### Finding F7 (P2): Persistent Fingerprint Churn under `react-hooks-set-state-in-effect-client`
- **Context**: As documented in **F2**, running `lint:ratchet:update` updates fingerprints for unrelated paths.
- **Problem**: In our session, we confirmed that whenever we ran `lint:ratchet:update` to update our target drained files, 21 lines in `lint-ratchet.baseline.json` under `ratchet/react-hooks-set-state-in-effect-client` had their `messagesFingerprint` values recalculated with slightly different hashes.
- **Impact**: Noise in commit diffs, plus potential merge conflicts if two authors modify unrelated parts of the baseline.
- **Proposal (P2)**: Normalize the messages before hashing or pin the ESLint/plugin versions causing the message translation drift across node/worktree environments.

---

## Candid UX Critique

As a Gemini-family agent encountering this system cold, the tooling and custom git merge drivers are **exceptionally robust and incredibly satisfying**.

- **What went right**:
  - The drivers work seamlessly behind the scenes. In both Scenario 1 and Scenario 2, `git merge` felt entirely natural, completely hiding the immense complexity of 3-way semantic baseline reconciliation.
  - The lock contention wait messages (e.g., `pre-commit: waited 263s for shared commit queue...`) were descriptive and self-explanatory. Instead of silently failing or hanging forever, they clearly communicated who held the lock, preventing the urge to force-kill processes or retry blindly.

- **What could have gone wrong without docs**:
  - Without knowing that `sensor:knip-unused-exports -- --update` was the way to regenerate the knip baseline, a developer would likely have tried editing the JSON directly, which would violate the hand-edit integrity rules or lead to structure errors.
  - Without understanding how the semantic min-merge logic prioritizes lower counts, the instantaneous "silent success" of the merge could have seemed like git magic, rather than the result of carefully designed custom merge shims.

Overall UX Verdict: **Highly polished and professional grade.**

---

## Cleanup List

All created scratch branches (none were force-deleted or modified after creation to satisfy policy constraints):
1. `scratch/mfx2-y-s1-1a`
2. `scratch/mfx2-y-s1-1b`
3. `scratch/mfx2-y-s1-m1`
4. `scratch/mfx2-y-s1-2a`
5. `scratch/mfx2-y-s1-2b`
6. `scratch/mfx2-y-s1-m2`
7. `scratch/mfx2-y-s2-a`
8. `scratch/mfx2-y-s2-b`
9. `scratch/mfx2-y-s2-m`
