# Harness Audit 2026-07 — Sources and Verdicts

Status: Authoritative triage record for this pack.

Method: Six audit lanes ran 2026-07-13 at HEAD `14106498`: five codex consults in isolated
provisioned worktrees (tools-ux behavioral, docs-drift, mirror-parity, bug hunt,
lint-showcase adoption) plus one Grok 4.5 first-contact/presentation lane, each
with an explicit dedup mandate against the reconciled 2026-07 packs. Every
finding was then adversarially re-verified at HEAD by an independent verifier
agent (one per lane) instructed to refute: re-read all citations, re-check
reachability (with throwaway reproductions where cheap), and re-check dedup
claims against the named indexes and kill lists.

Tally: 21 confirmed, 17 amended (kept with corrections below), 0 fabricated.
Three severity claims were deflated (bughunt 1 and 5 from P1, bughunt 8 from
P2); bughunt 3's exit-143 mechanism was REFUTED (verify.sh runs under `set -u`
only, so the trap completes; reproduced both ways) and only its hang half
(no TERM→KILL escalation; unbounded `wait` retains the verify flock) survives.

Verdict lines below: lane/finding → verdict, priority/size after triage, and
the corrections a leaf must fold in. Original finding text lives in the lane
answer files (session artifacts); leaves must embed the corrected evidence.

## Lane A — tools-ux (behavioral)

- A1 empty verify:changed launches full gate → CONFIRM, P2/S. Corrections:
  steps.generated.sh line 92/95 are changed-scoped test commands (not full);
  heavy unconditional slots are typecheck, lint:suppressions, lint:ratchet,
  knip. The 120s last-verified marker (verify.sh:170-176) bounds repeats; only
  the first no-op run pays. Gap location: verify.sh:113-115 only calls
  musi_changed_gate_fail_if_unstaged (verify-metadata.sh:428-458); no
  emptiness check exists.
- A2 backlog:lint --file missing target reports OK → AMEND, P3/XS (was P2).
  Tool is advisory, wired into no gate; silent typo misleads triage but blocks
  nothing. Evidence exact: backlog-lint.ts:89-99, backlog-lint-format.ts:50-51.
  Reproduced: exit 0, "OK - 0 note(s) checked".
- A3 max-lines-exceptions ignores unknown options → AMEND, P3/XS (was P2).
  Narrower: misspelled --update falls through to check mode which exits 2
  loudly when the baseline needs normalizing (max-lines-exceptions.ts:260-261);
  silent window = clean baselines + informational flags. Flag surface is
  argv.includes("--update") at :233, raw argv at :274-276.
- A4 root scripts unusable from package subdirs → CONFIRM, P3/S. doctor.sh
  comment is at :415-421. All five failures reproduced ("Script not found").
  Extends landed agent-friction U1 (doctor-internal workaround only). bun's
  message is not customizable — fix must be a root-anchored launcher and/or
  documented `bun --cwd "$(git rev-parse --show-toplevel)" run ...` recovery.
- A5 ratchet trend default output ~3.1k tokens → CONFIRM, P3/S. Re-measured:
  60 lines/12,579 chars default vs 16 lines/2,876 chars with --max 5. Code:
  lint-ratchet-trend.ts:96-110, :266-289. Note: harness-review-2026-07 leaf 17
  index row still says "not implemented" though trend shipped in 3b79af88 —
  the leaf should note that staleness. Consistent with sweep c72's rationale
  (single-tool bounded default, measured need).

## Lane B — docs-drift

- B1 README quickstart password mismatch → CONFIRM, P1/XS. Cite README.md:31;
  password also embedded at .env.example:9,12,13; docker-compose.yml:8 seeds
  from POSTGRES_PASSWORD; prisma.config.ts:10 connects via DATABASE_URL.
  Blocks the documented quickstart at step 4 (db:migrate auth failure).
- B2 CONCURRENCY writer inventory omits applyLevelUp + sorcery conversions →
  CONFIRM, P2/S. Inventory at docs/CONCURRENCY.md:167-197 (four writers),
  update contract at :225-230. applyLevelUp writes Stats→CharacterClass→CSS
  (apply-level-up.ts:32/43/80); both sorcery conversions write Stats→CSS
  (sorcery-point.ts:46-67, :82-108). convertSlotToPoints is miscited at :113
  as single-table. Doc-completeness drift, not a live bug.
- B3 ai-harness.md calls blocking suppression registers manual/report-only →
  CONFIRM, P2/XS. docs/ai-harness.md:283-284 vs lint-suppressions.sh:15-18,
  package.json:72, steps.generated.sh:12-15 (all four gate consumers).
  lint:suppressions appears nowhere in ai-harness.md. Post-implementation
  drift after lint-deep-dive leaf 50 landed.
- B4 README describes wrong verification workflow → CONFIRM, P2/XS.
  Strengthened: .husky/pre-push is a fast-commit provenance backstop that
  never runs verify:changed, so README.md:81 "default pre-push gate" is doubly
  wrong. Changed set has 12 slots (steps.generated.sh:13); unstaged abort
  (verify-metadata.sh:428-451) never mentioned at README.md:99-102. Align with
  AGENTS.md:46 (pre-commit is the normal gate).
- B5 CONTEXT.md assigns concentration to wrong service boundary → CONFIRM,
  P2/XS. Tightened citations: ownership seam at spell-casting.ts:112,
  dropConcentration at :122-134; router-owned broadcast cast-spell.ts:100-139;
  character-live-state/ contains zero concentration code. MERGE with E2 into
  a single CONTEXT.md leaf (rename/purpose-header + fix the ownership list).
- B6 character-sheet MODULE.md recommends removed useRef pattern → CONFIRM,
  P2/XS. MODULE.md:98-100 vs use-character-stats.ts:18,143-160; refs removed
  in f4711bfc when react-hooks recommended-latest landed
  (eslint-config/client-configs.js:127-132).

## Lane C — mirrors

- C1 branch/tag force-update protected only in Claude → CONFIRM, P1/M.
  Verified: .claude/settings.json:43-58 denies branch -f/-M/-C and tag
  -f/--force; policy.sh:1100-1112 matches only delete-carrying forms
  (patterns require d/D in the flag cluster or --force paired with --delete;
  tag pattern :1110 is delete-only). Codex/Copilot route Bash exclusively
  through shared policy (.codex/hooks.json:3-13, .github/hooks/copilot.json:4-10).
  No force-update case in the fixture table (scripts/ai-hooks/test.sh:573-589).
  Claude deny list is hand-maintained (generator writes only the three hook
  configs). Fix: add families to policy.sh + fixtures + a Claude-deny parity
  corpus.
- C2 shim wiring check accepts wrong body or no body → CONFIRM, P2/M. Skip is
  the `grep '^exec ' || true` at check-wiring.sh:35 (comment :19);
  any-existing-body acceptance at :29; copilot check :49-69 requires only some
  existing body. harness-check.ts:227-232 runs it as the structural check.
  C3 is a live instance of the blindness.
- C3 orphan tracked .codex/hooks/session-state.sh → CONFIRM, P2/S. Git history
  proves oversight: dfbc8a0a removed the wiring + added the manifest omission
  note but left the shim; the analogous SubagentStop removal (dbebaec6)
  deleted its shim. check-wiring.sh:141-143 walks only wired commands. New
  counterevidence to arch-review 00-report.md:299-301 "zero orphans".
- C4 skills/mirrors/gitignore allowlists outside the manifest → CONFIRM, P2/M.
  KINDS (control-field-validation.ts:11-23) has no skill kind; freshness set
  (harness-check.ts:204-219) has no skill inventory; byte-mirror assertion
  covers only agent-cli (test-skill-dispatch-wrappers.sh:2372-2381);
  .gitignore:45,:54 double opt-in means a new skill dir gives no untracked
  signal. Note: ts-graph SKILL.md copies already diverge by a Claude-only
  allowed-tools frontmatter line — intentional overlay, indistinguishable from
  drift; the manifest needs a permitted-overlays concept.
- C5 agent-run accepts attachment-only missions → AMEND, P3/XS (was P2).
  Accepting check is agent-run.sh:249 (not :243). Reframed: contract
  ambiguity, not violation — the wrapper's own reject message words
  attachment-only as acceptable and SKILL.md:48's grammar marks [-p | -P]
  optional. Fix: decide semantics (reject or document) + a contract test;
  no fixture exercises attachment-only in either direction.

## Lane D — bug hunt (+ orchestrator seeds 9-10)

- D1 failed git diff fingerprints as clean → AMEND, P2/S (was P1).
  Reproduced: GIT_EXTERNAL_DIFF=/nonexistent → git diff --binary HEAD exits
  128 with empty output; 2>/dev/null at verify-metadata.sh:25 hides the error;
  dirty fingerprint collapses to clean. Wider scope: ai_staged_fingerprint
  (:388) and ai_precommit_fingerprint (:472) share the unguarded pattern;
  land.sh:260,313 restamp from the same function; also guard the
  `xargs sha256sum 2>/dev/null` untracked leg. Deflated: precondition is a
  broken external-diff config (self-inflicted, globally visible) and the
  120s marker TTL bounds the silent-skip window. Fix: --no-ext-diff + guard
  every fingerprint input command.
- D2 land.sh verifies untracked deps that never enter the merge → AMEND,
  P2/S (was P1/M). land.sh:168-171 checks only tracked/staged; verify runs in
  the live worktree (:248-258); push-ready proof is tree-equality only
  (:307-318). Deflated: pre-commit unconditionally runs
  musi_changed_gate_fail_if_unstaged (.husky/pre-commit:279) which fails
  closed on source-relevant untracked files, so reaching it needs a file
  created after the last commit, --no-verify, a merge commit (skips
  pre-commit), or path-policy misclassification. Fix is one
  musi_changed_gate_fail_if_unstaged call in land.sh (it already sources
  verify-metadata.sh at :111).
- D3 verify timeout exit-143/hang → AMEND, P2/S (was P1/M). Exit-143 half
  REFUTED: verify.sh runs under `set -u` only (line 31), trap completes and
  exits 124 (reproduced with a faithful mirror). Hang half stands:
  musi_signal_process_tree (scripts/process-tree.sh:46-55 — cited lib/ path
  was wrong) sends one signal, watchdog fires once (verify-engine.sh:35-54),
  cleanup_children waits unbounded (verify.sh:191-204); a TERM-ignoring child
  blocks exit 124 and retains the FD-9 flock, queueing later runs to death.
  Fix: bounded TERM grace then KILL.
- D4 selector crashes read as empty successful selections → CONFIRM, P2/M.
  All four scripts + preflight citations check out. Fail-open direction:
  path_policy_has_match fails toward NOT escalating to full scan. The guarded
  pattern already exists in-tree: musi_staged_has_source_relevant_change
  (verify-metadata.sh:398-414) returns 2 on selector failure — spread it.
- D5 impossible numeric allocations pass validation → AMEND, P3/S (was P1/M).
  Gap real (resolve_worktree_resources :1987-1995 checks only three numeric
  fields; bands :99-107 unenforced on the existing-slug path :1953-1957; no
  uniqueness) but observed corruption classes are now blocked by
  assert_state_json (:272-281, commit 9063e39e) and guarded capture
  (6f002720, 81a1af1c). Defense-in-depth against hand-edits/out-of-band
  writers.
- D6 GC erases live reservations on transient DB-list failure → AMEND, P3/S
  (was P2). `|| true` fail-open at :2035,:2077 (templates :2099,:2126) +
  destructive phase 3 (:2079-2090) confirmed; but only tombstoned slugs are
  in the loop, allocation_forget duplicates an existing stale-drop, and
  tombstone loss delays (not accelerates) drops. Residual harms: clone
  fingerprint loss (re-provisioning cost) and the recreated-lane edge. Fix:
  distinguish failed from empty list_worktree_dbs; skip phase 3 on failure.
- D7 verify:async start lies on unusable state → AMEND, P3/S. Mechanics
  confirmed (set -u only at :8; unguarded mkdir/write_state :274,:286-287;
  post-spawn :297; latest pointer :298; success print :301-304). Softened:
  mkdir/mktemp errors do print to stderr above the misleading success line,
  and the failure direction is fail-closed (no success marker minted).
- D8 concurrent merge-driver installers lose blocks → AMEND, P3/S (was P2).
  Lost-update real (install-baseline-merge-driver.sh:106-123, no flock/CAS;
  three installer entry points share common-git-dir info/attributes). Deflated:
  aggressively self-healing — next checkout/merge/install re-renders; doctor
  reports drift. Harm: a baseline briefly merges without its semantic driver.
- D9 (seed) worktree:new breaks on new template fingerprints — lane's shared
  dist unbuilt → CONFIRM, P1/S. Chain verified: worktree-new.sh:180-182 →
  cmd_init ensure_dependencies (worktree-db.sh:975; bun install +
  prisma:generate only) → template_refresh runs seed-template.ts (:663) →
  seed-srd-monsters.ts:4 imports @musi/shared/rules/conditions.js → shared
  exports map to ./dist/*, absent in a fresh worktree. Misleading hint
  verbatim at worktree-new.sh:182 ("e.g. an exhausted port/Redis pool").
  Aggravator: dev.sh has musi_dev_prebuild_shared for exactly this but runs
  it AFTER worktree:init (:247 vs :250), so `bun run dev` in a fresh worktree
  hits the same failure. Fix belongs in cmd_init before template refresh (or
  a dist preflight with an exact error). Untracked anywhere; observed live
  this session (5/5 lanes failed).
- D10 (seed) init-*.lock files accumulate forever → CONFIRM, P3/XS. 82
  present; created per-slug at worktree-db.sh:968 (also :1146); cmd_gc
  (:1997-2141) never removes them. Caveat: deleting flock files races a
  concurrent holder — only remove locks for slugs with no live worktree while
  holding gc.lock, or switch to a single shared init lock.

## Lane F — lint showcase

- F1 no adopter-ready local-rule starter → CONFIRM, P2/M. Guide is internal
  conventions (local-eslint-rules.md:3-10; "Adding A New Rule" :125-143 is
  Musi registration); 23 rules registered (local-plugin.js:27-52); examples/
  has only the ratchet demo.
- F2 demo's "wire-up-ready" rule is Musi-coupled → AMEND, P2/M (was S). Demo
  README:121-123; max-lines.js:118,122,126 reference Musi guide/baseline/
  script absent from the demo. Constraint the fix must respect: demo copy is
  byte-identical to eslint-rules/max-lines.js enforced by
  check-lint-ratchet-demo-sync.ts via portable-manifest.json:4, and the rule
  message's tokens are pinned by message-guidance.test.js + guide :111-123 —
  so either swap in a demo-local neutral rule (manifest/sync/README) or change
  rule+guide+test together.
- F3 test-file-location doesn't enforce co-location → CONFIRM, P2/S.
  Refinement: meta.docs.description (:26) is honest; the overclaim lives in
  principle (:27-28), both messages (:35,:37), and ai-harness.md:261; also
  publicly repeated at harness-presentation-2026-06/01-research-report.md:81.
  create() checks only filename shape + test-block presence (:42-77).
- F4 no-llm-artifacts accepts bare roadmap/agent-note words → AMEND, P3/S
  (was P2). The diagnostic discloses the allowance (:70-71) — visible design
  choice, not hidden gap. Real mismatch is with ai-harness.md:251 and the
  locatability intent. Tightening surfaces existing debt; may need a ratchet
  entry per policy.
- F5 ai-harness sensors table shows 17 of 23 local rules → CONFIRM, P3/S.
  Rows at :249-261,264,272,289-290. Six omitted rules (type-assertion-boundary,
  socket-listener-cleanup, no-arbitrary-tailwind-value,
  no-outer-client-in-transaction, no-plain-error-in-trpc,
  no-redundant-central-mock) appear nowhere in the file, while
  docs/README.md:13-16 calls the map the authoritative inventory of every
  lint rule.
- F6 ratchet summary `files` column ambiguity → CONFIRM, P3/XS. summary.ts:68
  counts debt-bearing files, label at :200,:212; zero-baseline audit's Files
  column means scope (2020 for type-assertion-boundary vs summary 0) — same
  word, opposite semantics across two reports. Guide :1097-1101 undifferentiated.
- F7 trend reports retired ratchets as current debt → CONFIRM, P2/S. Live:
  local-max-lines-lint-coverage-map-check prints "current 1 delta +1" while
  absent from the 14-ratchet registry (retired carrying 1 finding, debt-log
  Acceptance 3). trendCells :212-233 takes current from the last historical
  point with no registry check. Note harness-review leaf 17's status line is
  itself stale ("NOT implemented" though trend shipped).
- F8 debt-log renders legacy retirements as "Acceptance" → CONFIRM, P3/XS.
  debt-log.ts:142-153; jq confirms entries 1-12 have 0 regressions (orphan
  removals/promotions), only entry 13 is a real acceptance. Forward workflow
  already fixed (agent-friction N1: --retire-ratchet); legacy rendering
  untouched.
- F9 config-surface pattern not teachable → AMEND, P3/S. Generator path is
  scripts/harness/generate-config-surfaces.ts (:53-60). lint-overview.md:46
  gives the manifest one clause; fan-out across config-surfaces.js:84-106 +
  collectors; adoption guide :352-364 marks it not-portable with no adoption
  path. harness-explore prose calls registration "solved and only
  under-documented" but filed no teaching leaf.

## Lane E — first-contact / presentation (Grok 4.5)

- E1 README front door buries the harness → CONFIRM, P2/S. All cites check
  out; all five proposed link targets exist. No kill-list conflict: c79's own
  residue text concedes a README-link reframe is the surviving shape.
- E2 root CONTEXT.md mislabeled → AMEND, P2/S. Facts confirmed. Caveat: R18's
  glossary expansion was demoted by two critics (harness-review-2026-05/
  03-recommendations.md:394-395, anti-doc-rot) — the rename/purpose-header
  half is the safe path; a rename also touches lint-coverage-map.md:427.
  MERGED with B5 into one CONTEXT.md leaf.
- E3 docs/README "never hand-edited" vs hand-derived map → CONFIRM, P2/S.
  Extends harness-explore leaf 13 (map/generator) with the landing-page
  contract contradiction (docs/README.md:34-35 vs map :13-18).
- E4 agent_notes has no stranger reading contract → CONFIRM, P2/S. ~10 dated
  packs + ~40 loose leaves visible in a clone; existing READMEs are
  agent-workflow directives only. Leaf 70 owns archive policy, not clone
  navigability.
- E5 archive-vs-clone boundary invisible in first hour → CONFIRM, P2/XS.
  README's only public-release-notes link is :178-179 (License). Bonus:
  leaf 70's evidence (full .claude export-ignore, no carve-backs) is
  partially superseded by .gitattributes:36-43 carve-backs — note for
  reconciliation.
- E6 substrate ruling still "awaiting owner sign-off" in the public map →
  CONFIRM, P3/XS. Rides arch-review #13 (sign-off is that leaf's done signal);
  filed as public-facing hygiene.
- E7 no 15-minute visitor tour → CONFIRM, P2/M. No docs/harness-tour.md;
  ai-harness.md is inventory (:1-4), Minimal starter (:126-135) is a file
  list. c48 killed an examples/ index (orientation owned by landed leaf 75
  Milestone 1); c79 killed a GENERATED HARNESS.md — a hand-written timed tour
  is a different shape. Caution: tour must LINK the copy-boundary map, not
  re-enumerate it. MERGED with E12: the tour includes the copy ladder.
- E8 no gate-lifecycle walkthrough → CONFIRM, P3/S. lint-overview mermaid
  exists; nothing sequences edit → hook → generated slots → envelope →
  failure text. Distinct from explore leaves 16/21.
- E9 root DESIGN.md unlabeled → CONFIRM, P3/XS. Product UI-token system
  absent from README structure tree and docs/README topic index.
- E10 drift-ai.config.json reads as committed local state → AMEND, P3/XS.
  Overclaim fixed: ai-harness.md:294 also names the file (not only
  scripts/drift-ai/README.md). README never names drift:ai. Natural fix: a
  $comment key (harness.controls.json:1-2 precedent).
- E11 root baselines look like dump files → AMEND, P3/XS. README:114 already
  links the ratchet guide — the delta is naming the three baseline filenames
  as intentional committed floors under Quality Gates.
- E12 adoption paths scattered, no copy ladder → AMEND, P2/S. Third tiering
  already exists (lint-ratchet-adoption.md:3-5 "two adoption tiers") — a
  ladder must absorb/reconcile the three enumerations, not add a fourth;
  prefer folding into the E7 tour. MERGED into E7's leaf.
- E13 presenter ranking (protect: ratchet platform; controls→generated→check
  chain; shared-body/thin-shim adapters) → CONFIRM, P3/XS. Calibration, not a
  defect — recorded in the pack index prose, not as a leaf.

## Reconciliation notes for existing packs (fold into the new pack index)

- harness-review-2026-07b leaf 60: fully stale at HEAD — all four gaps now
  present in AGENTS.md; only its leaf-53 header-hygiene footnote remains.
- harness-review-2026-07 leaf 17: status line stale ("NOT implemented");
  trend shipped in 3b79af88. F7/A5 extend it.
- harness-review-2026-07 leaf 70: evidence partially superseded by
  .gitattributes carve-backs (E5).
- arch-review 00-report.md:299-301 "zero hook orphans": contradicted by C3.
- Memory-recorded worktree allocation bugs (swallowed die, allocations.json
  truncation): FIXED at HEAD (6f002720, 81a1af1c, 9063e39e) — do not re-file.
