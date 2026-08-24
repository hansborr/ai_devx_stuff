# Sources and Verdicts

Status: Complete disposition ledger
Date: 2026-07-29

## Method

The audit covers every routed section in the twelve topic notes under
`/home/node/persist/musi/pain_points/`, consulting the verbatim archive only
where exact commands, timing, or error text matters. Candidate work is checked
against the live tree at HEAD before acceptance and deduplicated against the
prior pain-point pack, the ready queue, the code-quality and AI-harness packs,
the harness-review records, and `docs/agent_notes/finished_work/`.

Only easy, bounded changes become leaves. Fixed, external, duplicate, too-large,
insufficient-evidence, and owner-decision-needed findings remain in this ledger.

## Disposition ledger

| Source | Finding | Verdict | Evidence and disposition |
| --- | --- | --- | --- |
| `agent-cli-and-external-reviews.md` — backend lifetime | Wrapper death can leave a backend alive. | Duplicate / owner-decision-needed | The previous pack's `04-bound-agent-backend-lifetime.md` is the exact owner and is explicitly Cancelled; manual recovery is the accepted contract. Do not reopen it. |
| same | Editing `agent-run.sh` during its own run can change unread shell input. | Fixed | `agent-run.sh` now defines phase functions before entering main; finished work records `c24f502e5`. No live reproduction remains. |
| same — trailer trust | Completion-looking backend text can fool `agent-wait`. | Implemented as redesigned leaf 11 | Backend stdout boundaries now reserve anchored wrapper records; the leaf records the live contamination proof and withdrawal of correlation framing. |
| same — nested dispatch | Delegates launch reviews without explicit authority, or treat self-review as independent approval. | Owner-decision-needed | Repository wrappers cannot infer delegated review authority safely. The current orchestrator owns review, and broader skill policy requires an owner rule rather than wrapper enforcement. |
| same — retry artifacts | Copilot retries lose artifact lineage or overwrite caller-owned paths. | Duplicate | Previous pack leaf `12-preserve-copilot-retry-artifacts.md` is implemented and its caller-owned `--share` contract is authoritative. |
| same — backend reliability | Cursor capacity, provider quota/model discovery, and Claude stalls. | External | These are provider/account/CLI behaviors outside this repository. Existing retry/resume guidance is the bounded local response. |
| `backlog-and-documentation-drift.md` — status and git truth | Open prose can name a landed SHA or existing deliverable. | Too-large / duplicate | Same-pack and cross-pack structural identity are owned by AI-harness audit leaves 12 and 18; the one-time reconciliation is finished. Parsing arbitrary prose and judging deliverable truth is not a bounded extension. |
| same — deferred reconciliation | A plan lands without one clear index reconciler. | Owner-decision-needed / duplicate | Existing plans name their applying slices, while structural links remain owned by audit leaves 12/18. A new plan-to-index authority protocol needs an owner decision. |
| same — numeric allocation | Parallel branches choose the same next leaf number. | Owner-decision-needed | The proposed merge-base maximum check cannot detect two branches choosing the same number. UUIDs, reserved ranges, central allocation, or merge-time renumbering are policy choices. |
| same — module/generated docs | Branch drift makes module-index validation look broken. | Fixed | Foreground `bun run module:index:check` returned `module:index: OK` at HEAD. |
| `focused-verification-gaps.md` — shell smokes | Passing a `.sh` file to `test:scripts:file` exits zero without tests. | Accepted as leaf 14 | Code-quality leaf `27-shell-test-substrate.md` is unpromoted and only warns about the pitfall inside its own migration procedure (`:117-123`). Leaf 14 adds the bounded permanent argv guard. |
| same — package commands | Package-local `bun run test -- <file>` can fall through silently. | Owner-decision-needed | Root `AGENTS.md` now gives the root-command form, but package manifests still have no local aliases. Adding aliases versus documenting root-only use changes the package command contract. |
| same — changed dependencies | Server inputs read by the concurrency drift guard do not select scripts tests. | Closed (won't fix) | Leaf 07 records the live raw-file dependency; full PR verification deliberately owns coverage. |
| same — cache prerequisites | A focused cached result can survive rebuilding ignored shared output. | Duplicate | AI-harness audit leaf `03-bun-cache-identity-and-artifacts.md` owns cache identity and artifact coherence. Feed the prerequisite-freshness reproduction to that owner rather than adding a cache leaf. |
| `gate-diagnostics-and-process-lifecycle.md` — logs | Direct verify logs collide across worktrees. | Fixed | `scripts/verify.sh:54-77`, `scripts/lib/verify-metadata.sh:189-263`, and `scripts/tests/test-verify-metadata.sh:592-614` show worktree-keyed state and regression coverage. |
| same | Agent adapters read failure evidence from the hook checkout rather than the producing worktree. | Accepted as leaf 02 | C8 S4 gestures at adapter state propagation but is held behind blocked S3 and does not specify the producer-footer reader seam. Leaf 02 is the bounded, dispatchable compatibility repair; C8 retains eventual typed propagation. |
| same — lifecycle | A foreground tool returns while descendants continue. | External / insufficient-evidence | Repository lifecycle helpers wait and reap their process trees; no live repository reproduction tied the reported yield to these wrappers. The remaining behavior belongs to the execution host. |
| same — contradictory reports | A wrapper reports both exit zero and commit failure. | Fixed | Current `scripts/ai-hooks/git-commit-quiet.sh:289-324` distinguishes swallowed exit status, no landing, unattributable target, and generic failure; live adapter regressions cover those paths. |
| same — progress | Long checks need a generic heartbeat/current-slot framework. | Duplicate | AI-harness audit leaf `20-verify-output-signal.md` explicitly rejected that design and records the proportionate output policy. |
| `gate-timeouts-and-load.md` — registration | Five-second registration admission lacked margin over recorded cold and standalone runs; lane load was correlated, not established as the cause. | Accepted as leaf 04 | The current literal and bounded change are in the leaf. |
| same — actionlint | Ten-second actionlint budget expires amid the lint slot's own concurrent sensors. | Accepted as leaf 05 | The current default and proven 60-second workaround are in the leaf. |
| same — config resolution | The 30-second resolved-config hang guard expired once during a loaded session. | Insufficient-evidence | `eslint-rules/eslint-config-resolution-timeout.js:3-19` already raised the former 15-second limit and documents its hang-guard intent. One isolated recurrence does not justify another policy change. |
| same — memory assertion | The queue-release fixture fails only its coarse `<5s` assertion. | Accepted as leaf 03 | The leaf separates semantic release from host scheduling delay. |
| same — shared admission | The common commit queue and 30-second memory cap make sibling commits wait or return no-launch. | Accepted in bounded part as leaf 12 | Queue/retry policy remains unchanged. Leaf 12 closes the correctness defect that labels an unlaunched slot as a test failure; the gate still blocks as incomplete. |
| same — full budgets | Split the full scripts result or redesign per-slot timeout provenance. | Too-large / insufficient-evidence | The total timeout is already configurable; one observed long run does not justify a new aggregation protocol. |
| same | V8 heap defaults fail under normal verification. | Fixed | `scripts/lib/gate-env.sh` now owns the gate heap default; the prior pack ledger already closed the old manual `NODE_OPTIONS` advice. |
| `git-hooks-and-commit-workflow.md` — targets | Command parsing, compound targets, HEAD, locks, and cache state use the wrong checkout. | Duplicate / fixed | The concrete literal-target defects landed; indeterminate and compound cases are the binding C8 rider and ready C8 campaign. |
| same — stash | Hook wrappers mutate stash state or need a stash-based partial-commit flow. | Duplicate / owner-decision-needed | Previous pack leaf 06 implemented repository-wide stash blocking. Its boundary deliberately excludes automating partial same-file commits; relaxing that safety needs an owner policy. |
| same — landing | Worktree landing and teardown require hand-built recovery commands. | Fixed | `scripts/land.sh` supports sibling-primary recovery and `--branch`; previous pack leaf 07 implemented one-command worktree recovery. |
| same — merge subjects | No-ff merge commits need a documented conventional subject. | Owner-decision-needed | `chore(merge): ...` versus a new commit type is a repository convention decision, not evidence of a broken gate. |
| `harness-registration-and-generated-surfaces.md` — registration | One control must be copied through many independent registration surfaces. | Duplicate | Previous pack leaves 08/09 generated skill mirrors and fast structural registration. The broader harness consolidation remains owned by the code-quality harness plans. |
| same — generated docs | The lint coverage map and land-flow pins are hand-maintained. | Fixed / duplicate | Finished ready work C5 generated the coverage map; previous pain leaf 02 removed duplicated land-flow ownership. |
| same — manifest validation | Exact/prefix overlaps are accepted and preflight returns the first wiring failure. | Insufficient-evidence | The current manifest contains no overlap. Admission hardening is plausible, but no persisted failure demonstrates it should displace the bounded leaves selected here. |
| same | JSON Unicode escapes create formatting churn. | Owner-decision-needed | A durable fix requires choosing a canonical serializer and registering its generated output; editing advice alone does not remove the problem. |
| same — reduced fixtures | Harness fixtures rebuild slowly and drift. | Duplicate / too-large | Code-quality harness leaf 27 and the harness cluster plans own shell substrate and fixture organization. A separate fixture architecture leaf would overlap them. |
| `lint-ratchet-and-source-policy.md` — moves | Net-neutral file moves are charged as new ratchet debt. | Duplicate | Previous pack leaf `10-lint-ratchet-path-renames.md` is the open design-review owner. |
| same — install state | Stale installed rule packages or generated clients mislead ratchet/worktree checks. | Owner-decision-needed | Prisma regeneration is already handled in `scripts/worktree-db.sh:862-910`; a remaining fix spans init freshness, doctor version diagnosis, and ratchet guidance and needs one owner boundary. |
| same | Ratchet retirement fails because the effective remote base is stale. | Owner-decision-needed | Preflight behavior depends on whether authoring may override the base ref or must require fetch/current default. That policy is not settled. |
| same — source edge cases | A literal NUL makes maintained source invisible to normal Git text tooling. | Accepted as leaf 09 | Live evidence and the staged-blob policy boundary are in the leaf. |
| same | Zero-match source globs silently bypass a ratchet. | Fixed | `lint:ratchet:check-registry` passes at HEAD and the registry rejects dead globs. |
| same | Static SRD tables trip generic max-lines policy. | Fixed | The live max-lines exception baseline contains the durable catalog exception; no general table-body exemption is justified. |
| same | Helper normalization increases exact-clone groups. | Duplicate | Ready C3 owns exact-tier near-duplicate behavior and already records that normalization can reveal groups. |
| same | Generic word-boundary codemods rewrite property accesses. | Insufficient-evidence | No named reusable codemod surface or failing corpus remains; typecheck caught the recorded one-off edit. |
| `subagents-and-review-convergence.md` — delivery | Completed teammates do not reliably return an attributable result. | Duplicate | Previous pack leaf 05 owns the required feasibility probe and conditional implementation. |
| same — review loops | Repeated P0/P1 review rounds need an automatic checkpoint. | Owner-decision-needed | The stop threshold and authority to launch reviews are orchestrator policy; wrapper inference would also block legitimate delegated review. |
| same — independence | An implementer's self-dispatched reviewer is not independent. | External | The current orchestrator explicitly owns independent review. Repository code cannot certify who commissioned a review. |
| `test-fixtures-races-and-environment.md` — readiness | Lock fixtures use fixed setup sleeps. | Accepted as leaf 06 | The leaf cites the live sleeps and existing ready/release precedent. |
| same — shared state | AI-hooks tests race on the repository-root protected-file marker. | Fixed | Finished ready work F7 and the live private-root parallel regression close this issue. |
| same | A combat-store reset spy leaks under `isolate:false`. | Insufficient-evidence | Five shuffled focused runs did not reproduce the pair at HEAD. The active client-isolation remainder is deferred and owns a `vi.mock`/`vi.unmock` web, not this Zustand spy; require a reproduction before assigning an owner. |
| same | Radix tests copy missing DOM capability shims. | Accepted as leaf 10 | The four live blocks and central setup seam are in the leaf. |
| same | Fsmonitor cleanup removes a directory another case needs. | Fixed | The fixture now removes an explicit tracked file and restores it through `checkout-index`. |
| same — database races | Parallel database tests lack deterministic barriers. | Duplicate | Landed code-quality race work and `docs/CONCURRENCY.md` now use real-driver barriers and forced interleavings. |
| same — browser/mutation | Playwright's default browser cache is unwritable or stale. | Owner-decision-needed | A docs-only writable fallback is bounded, but repository-local per-worktree versus Git-common shared cache is an unresolved ownership/disk tradeoff. |
| same | Stryker copies `.tools/lib64` or loads incompatible config modules. | Fixed / duplicate | The `.mjs` shared factory and `.tools` ignore landed under code-quality leaf 43. |
| same | Mutation tests combine `process.chdir` with cached path-policy imports. | Duplicate | Code-quality harness leaf 31/H15 owns lazy or injected cwd discovery for this exact substrate. |
| same — synthetic load | Ad hoc busy loops survive a review and contaminate later runs. | External / insufficient-evidence | The reported process was not repository code. A generic process/load doctor would be platform-specific and broad. |
| same — host-global fixtures | The doctor smoke uses fixed `/tmp` output files. | Accepted as leaf 13 | `scripts/tests/test-doctor-json.sh:233-242,803-805` can truncate or unlink another worktree's capture; private temporary paths are bounded and dispatchable. |
| `tooling-and-skill-documentation.md` — commands | `ts-graph refs` documentation uses a nonexistent `--name` form. | Fixed | The live skill and `docs/guides/code-intel.md` use positional `path:line:column`. |
| same | Migration guidance encourages blocked direct database inspection. | Duplicate | AI-harness audit leaf 10 is the Prisma guidance owner; a new migration recipe also needs an owner choice between task-local script, helper, or integration pattern. |
| same | Shell smoke paths are passed to the Vitest scripts-project command. | Accepted as leaf 14 | `package.json:55-57` routes the command through `scripts/vitest.sh`, whose no-test success at `:69-71` makes this a repeated false green. The new leaf rejects the invalid positional `.sh` form before Vitest. |
| same — performance | There is no obvious command for identifying a slow Vitest test. | Insufficient-evidence | `scripts/vitest.sh` already exposes `MUSI_VITEST_VERBOSE_SUCCESS=1`; the remaining gap is low-impact documentation, not a demonstrated failing workflow. |
| same — portability | Stryker config factories fail across module systems. | Fixed | All live configs are `.mjs` and import the shared `.mjs` factory; code-quality leaf 43 is done. |
| `worktree-provisioning-and-isolation.md` — dependencies | Worktree dependencies and generated Prisma clients stay stale. | Fixed / owner-decision-needed | `scripts/worktree-db.sh:862-910` refreshes the Prisma client and shared output. Extending init from “directory exists” to full lock/version freshness needs the broader owner boundary recorded above. |
| same — peer coupling | One unprovisioned peer makes opportunistic GC abort current init. | Accepted as leaf 08 | The live exit boundary and safe fail-closed GC behavior are in the leaf. |
| same — lightweight setup | Docs-only worktrees have no dependency-only bootstrap. | Owner-decision-needed | `--dependencies-only`, a separate command, symlinks, or frozen local install have different branch-isolation contracts. |
| same — browser cache | Browser installation is not provisioned per worktree. | Owner-decision-needed | Same cache-location decision as the Playwright row above. |
| same — teardown | Recovery and teardown are ambiguous or non-idempotent. | Fixed | Previous pack leaf 07 landed `worktree:drop <path> --remove` and the one-command recovery output. |

## Cross-lane verification boundary

Direct gate markers, logs, history, locks, and ordinary caches are
worktree-scoped. The Git-common-dir commit queue, fast-commit policy/provenance,
and host-wide memory reservations are deliberately shared coordination. They
do not overwrite direct evidence, but sibling activity can change execution.

Three bounded correctness residues have leaves here (leaf 02 still awaits its
owner carve-out confirmation):

- leaf 02 uses the producing footer first and the already-resolved target
  worktree when that footer is absent;
- leaf 12 labels memory-admission no-launch separately from an executed test
  failure while preserving the blocking scheduler policy; and
- leaf 13 removes the doctor smoke's fixed host-global output paths.

Leaves 03-06 own separate timing defects: a coarse wall-clock proxy, two hang
guards without enough recorded margin, and fixture setup sleeps. The AI-hooks
repository-marker race is fixed by private-root fixtures and a parallel
regression. Leaf 08 owns peer-worktree provisioning availability.
