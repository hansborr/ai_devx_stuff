# 131. The provider-neutral agent dispatch executables live only under `.claude/`, so the Codex skill is a broken unit that points every entrypoint at another provider's tree

Status: Landed on fix/cq-131
Theme: provider-neutral executable placement · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The agent-cli skill is the repo's cross-provider dispatch adapter: one wrapper
(`agent-run.sh`) and one waiter (`agent-wait.sh`) that drive Claude, Codex,
Copilot, and Cursor backends alike. But both executables physically live under
`.claude/skills/agent-cli/scripts/`, and the Codex projection of the skill owns
no executables at all — every command it teaches invokes a path under
`.claude/`. Two costs follow:

1. **Copying the Codex skill alone produces a broken unit.** A Codex-only
   adopter of this public harness reference must carry a `.claude/` tree to get
   a working skill, even though nothing about the wrapper is Claude-specific.
   The documented porting story makes this explicit — "copy
   `.claude/skills/agent-cli/` wholesale" — which cures the trap by
   instruction while the reference repo keeps demonstrating the anti-pattern.
2. **`.claude` placement reads as provider-specific behavior.** Contributors
   can reasonably infer the wrapper is Claude-only machinery, when it is the
   shared implementation for all four backends.

`docs/ai-harness.md` provides a nearby Adapter Boundary precedent: shared hook
policy and reusable hook behavior live in `scripts/ai-hooks/`, while files under
the three per-harness `hooks/` trees are thin shims. That text is explicitly
about hooks, so this relocation applies the same neutral-home principle to
cross-provider skill executables rather than fixing a direct violation of the
existing hook rule. The bundling defense
("Claude Code skills package their scripts inside the skill dir") is hollow
here because every documented invocation is already repo-root-anchored via
`$(git rev-parse --show-toplevel)/...` — nothing resolves the scripts relative
to the skill directory.

The within-repo maintenance story is *not* broken — `.claude` is the declared
canonical source and the `.codex` mirror is machine-generated — which is why
this is medium, not high. The defect is copyability, this repo's stated bar.

## Evidence

- `.codex/skills/agent-cli/SKILL.md` — 12 references to
  `.claude/skills/agent-cli/scripts/` (re-counted at the pin): `agent-run.sh`
  invocations at :23, :27, :43, :48, :107, :111, :129, :138, :164;
  `agent-wait.sh` invocations at :64, :70, :185. All are repo-root-anchored
  (`"$(git rev-parse --show-toplevel)/.claude/skills/agent-cli/scripts/..."`).
- The Codex skill tree owns zero executables: `find .codex/skills/agent-cli
  -name '*.sh'` returns nothing; `agent-run.sh` and `agent-wait.sh` exist only
  under `.claude/skills/agent-cli/scripts/`.
- The canonical `.claude/skills/agent-cli/SKILL.md` carries the same
  repo-root-anchored path 10 times (:23, :27, :43, :48, :64, :70, :107, :111,
  :129, :138); `references/trailer-contract.md:4` (both copies) names it once
  more.
- `.codex/skills/agent-cli/references/portability.md:16` — the porting
  contract is "copy `.claude/skills/agent-cli/` wholesale"; :37 repeats the
  ownership assumption; :74-75 tells adopters to `shellcheck` the `.claude`
  path and notes Musi's lint lane "already ShellChecks `.claude/skills/**/*.sh`".
- `harness.controls.json:2746` — the `skill/agent-cli` control declares
  `.claude/skills/agent-cli` canonical with the `.codex` target generated from
  it; :2761-2764 is the `{"path": "scripts", "kind": "canonical-only"}`
  overlay that keeps the executables out of the mirror (so the layout is a
  documented decision, not an accident).
- `docs/ai-harness.md:68-80` — the Adapter Boundary precedent for hooks:
  shared hook policy and reusable hook behavior live in `scripts/ai-hooks/`,
  while files under the per-harness `hooks/` trees are thin shims. It does not
  currently state the equivalent rule for skill executables.
- `docs/ai-harness.md:313-319` — the recorded 2026-07-07 rejection of a
  Bun/TS rewrite of `agent-run.sh`, whose closing clause "the skill stays
  self-contained" is the recorded text a relocation supersedes (the
  pre-`bun install` plain-bash constraint at :313-316 and :287 stays valid).
- Harness plumbing that hard-codes the current home:
  `scripts/tests/test-skill-dispatch-wrappers.sh:38-39` (WRAPPER/WAITER
  defaults), :12-13 (script smoke-subject entries, inside the generated
  block at :3-22); `scripts/path-policy/path-policy.ts:214` (the
  `{ prefix: ".claude/skills/", extension: ".sh" }` shellSurfaces clause;
  the generic `scripts/` clause is at :209);
  `scripts/path-policy/path-policy.test.ts:225-231` (asserts the `.claude`
  script path matches shellSurfaces);
  `scripts/path-policy/path-policy-smoke-subjects-data.ts:846-847` (generated).

## Proposed direction

Relocate only the two executables; change no machinery. Skill trees become
documentation-only projections under the existing single-source model
(`.claude/skills/agent-cli` stays canonical for docs, the `.codex` mirror
stays generated). Do not build any new projection, generation, or linking
system — the mirror machinery already exists.

1. `git mv` `agent-run.sh` and `agent-wait.sh` from
   `.claude/skills/agent-cli/scripts/` to a neutral repo-owned
   `scripts/agent-cli/` (sibling of the `scripts/ai-hooks/` adapter-boundary
   precedent). Keep them plain bash with no build step — the
   pre-`bun install` constraint from the 2026-07-07 decision remains binding.
2. Hand-edit the one path string in the canonical sources: canonical
   `SKILL.md` (10 refs), `references/portability.md`,
   `references/trailer-contract.md:4`. All invocations stay repo-root-anchored
   as `$(git rev-parse --show-toplevel)/scripts/agent-cli/...` — no symlinks
   or stub entrypoints in provider trees.
3. `scripts/tests/test-skill-dispatch-wrappers.sh` — update the
   WRAPPER/WAITER defaults at :38-39 and any remaining literal refs. The two
   script smoke-subject entries at :12-13 sit inside the generated block
   (:3-22), which `harness:skills:refresh` rewrites from the manifest; once
   the scripts leave the skill tree the regen drops them, so keep the
   relocated scripts registered as smoke subjects via hand-maintained
   `# smoke-subjects:` lines outside the generated block (the :23 self-entry
   is the pattern).
4. `scripts/path-policy/path-policy.test.ts:225-231` — repoint the
   shellSurfaces assertion at the new path.
5. `harness.controls.json` — delete the
   `{"path": "scripts", "kind": "canonical-only"}` overlay from the
   `skill/agent-cli` control (:2761-2764). `gitignoreOptIns` stay unchanged:
   skill dirs still hold docs, and `scripts/` is tracked normally so the new
   home needs no opt-in.
6. Drop the now-moot `{ prefix: ".claude/skills/", extension: ".sh" }`
   shellSurfaces clause at `scripts/path-policy/path-policy.ts:214` — after
   the move no skill ships `.sh`, and the new home is auto-covered by the
   existing `scripts/` prefix clause at :209 (shell-lint selection runs off
   path-policy shellSurfaces; there is no separate ShellCheck glob to edit).
7. Regens, in order: `bun run harness:skills:refresh` (regenerates the `.codex` mirror, including
   its 12 `SKILL.md` script-path refs and the two references in
   `references/{portability,trailer-contract}.md`), `bun run test:scripts:subjects` (rewrites
   `path-policy-smoke-subjects-data.ts`), then `bun run harness:check`.
8. **Documented-decision carries, in the same change** (mandatory, not
   follow-ups):
   - Amend the `docs/ai-harness.md` recorded rejection (:313-319) to retire
     only the "skill stays self-contained" placement clause while preserving
     the no-TS-rewrite decision, and record the new invariant: dispatch
     executables live in `scripts/agent-cli/`; skill dirs are doc
     projections. Add one sentence to the Adapter Boundary section stating
     agent-cli dispatch executables follow the same neutral-home rule as
     hooks.
   - Rewrite `portability.md`'s copy story: the :16 wholesale-copy claim and
     the :74-75 shellcheck-coverage claim become a two-piece copy set —
     `scripts/agent-cli/` plus your provider's thin skill dir (keep the
     pre-existing `.cursor/cli.json` note).

Size accounting: 8 hand-edited files, two relocated scripts, one manifest
overlay deletion, one path-policy clause deletion, two regens, and three
substantive doc paragraphs — S-to-M in practice. Risk is low: the
dispatch-wrapper smoke suite re-verifies both entrypoints at the new path,
and no invocation relies on skill-relative resolution.

## Scope / caveats

Binding rulings from the review of this direction:

- **No new projection/generation/linking system** for provider skill
  entrypoints. Edit the canonical `.claude` sources, delete the manifest
  overlay, rerun `harness:skills:refresh` — the mirror machinery exists.
- **No symlinks or stub entrypoints in provider trees**; every documented
  invocation stays repo-root-anchored.
- **Do not mirror the executables into `.codex`** as the fix — two committed
  copies held together by a generator violates the duplicates-are-defects
  adapter-boundary rule and is worse than both the move and the status quo.
- **Do not land the relocation without the same-change documented-decision
  amendments** (step 8): this move contradicts two recorded texts (the
  2026-07-07 "self-contained" clause and portability.md's wholesale-copy
  contract), and per the documented-decision rule the doc updates travel with
  the code.
- **No TypeScript rewrite and no build step** for the dispatch scripts; the
  pre-`bun install` plain-bash constraint remains binding.
- **Do not edit frozen historical backlog documents** that reference the old
  path (e.g. `docs/agent_notes/backlog/agent-pain-points-2026-07-21/`,
  `pain-points-2026-07-29/`); they are records, not live surfaces.
- **Do not hand-edit generated surfaces**
  (`path-policy-smoke-subjects-data.ts`, the `.codex` skill mirror, the
  generated smoke-subject block in the wrapper test): edit smoke-subject
  headers and canonical sources, then regenerate via `test:scripts:subjects`
  and `harness:skills:refresh`, and validate with `harness:check`.

Other notes:

- Prior rulings do not block this: the `docs/ai-harness.md:313` rejection and
  the 2026-07-25 pack's harness-cluster decisions rejected only a full Bun/TS
  *rewrite* of `agent-run.sh` (a substrate ruling), and the 2026-07-25 pack's
  smoke-subject routing slice excluded shell relocation from *its* scope —
  neither is an ownership ruling on where the executables live.
- `CONTRACT_DOC` at `test-skill-dispatch-wrappers.sh:40` points at
  `references/trailer-contract.md`, which stays in the skill tree — leave it.
- [152-path-policy-query-core-closed-over-musis.md](./152-path-policy-query-core-closed-over-musis.md)
  also edits `path-policy.ts`, `path-policy.test.ts`,
  `path-policy-smoke-subjects-data.ts`, and `harness.controls.json`. Either leaf
  may land first, but do not implement them concurrently; after both changes
  are combined, regenerate smoke subjects so 131's relocated wrapper paths use
  152's new registry type and ownership boundary.
- [159-path-policy-gives-single-segment-glob-two.md](./159-path-policy-gives-single-segment-glob-two.md)
  also edits `path-policy.ts`, `path-policy.test.ts`, and
  `harness.controls.json`. Either leaf may land first, but do not implement
  them concurrently; preserve 131's relocated-script shell coverage while
  routing its updated assertion through 159's canonical star-only matcher,
  then refresh the combined manifest closures.
