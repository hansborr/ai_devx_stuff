# Lane 08 — cross-cutting idiom, organization, and opportunities

Status: Dispatch material — not a schedulable note

**Scope.** The whole repo, read *across* the other lanes' boundaries rather
than within them. You are not a second pass over any one package — you hunt
patterns that only show up when you compare areas. A pattern finding must
carry evidence spanning **at least two other lanes' areas**; anything
confined to one lane's rows belongs to that lane.

**Emphasis.**

- **Idiom consistency:** the same problem solved three different ways in
  three packages (error handling, validation, logging, date/id handling,
  async patterns); pick the best-of-breed and propose convergence.
- **Layering and dependency shape:** imports that fight the
  `shared → server → client` flow; `scripts/` reaching into package
  internals; utilities living one layer away from all their consumers.
- **Naming as a system:** vocabulary that shifts between packages for the
  same concept (campaign/game/session, character/sheet/actor …); file-name
  conventions that differ per directory.
- **New-contributor tripwires:** the five things a capable outsider would
  get wrong in week one, with evidence.
- **Feature opportunities** (`category: "feature"`): you are the **only**
  lane that emits `feature` findings. Each one needs the observed workaround
  or forced friction (with evidence paths), who benefits (DM / player /
  contributor / harness user), and why the current structure makes it cheap.
  Judge on usefulness, not novelty. You also triage the `featureIdeas`
  one-liners the other lanes hand up: promote the ones that meet this bar
  into findings, drop the rest. That triage happens in your wave-2 top-up
  brief — the orchestrator aggregates the banked one-liners after wave-1
  banking and routes them to you — or during Phase 4 if wave 2 is skipped.

**Boundary.** Lane 08 owns code-side new-contributor tripwires; lane 07 owns
docs-side onboarding friction.

**Known context.** Open leaf 46 owns a set of pure renames — dedup. The
2026-07-25 pack's comment and naming lenses ran repo-wide; read
AUDIT-SUMMARY.md so you re-derive neither.
