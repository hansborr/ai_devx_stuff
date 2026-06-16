# Drain Selector Debt: Campaign Page-Object Family

Status: Done (2026-06-12, landed in "feat(e2e): drain campaign page-object
family selector ratchet debt")
Order: 03c
Source: per-file baseline counts, 2026-06-12. Read
`03-e2e-selector-drain-method.md` first.

## Context

Six campaign-surface page objects carry 31 findings between them:

- `e2e/page-objects/campaigns.po.ts` (4 role, 1 nth)
- `e2e/page-objects/campaign-chat.po.ts` (3 role, 3 native)
- `e2e/page-objects/campaign-detail.po.ts` (6 role, 1 nth, 2 native)
- `e2e/page-objects/campaign-notes.po.ts` (4 role)
- `e2e/page-objects/campaign-npcs.po.ts` (4 role, 1 nth)
- `e2e/page-objects/campaign-settings.po.ts` (2 role)

They share the campaign-detail layout, so accessible-name fixes in one
shared component (tabs, cards, dialogs) may drain findings across several
files at once — do the shared-component pass first.

## Scope

- Rewrite every flagged selector in the six files per the umbrella method.
- The UX audit's P1-9 notes missing `DialogDescription` on New Note / New
  NPC dialogs — if a selector fight traces back to that, add the
  description as part of this leaf.
- Drain all six to zero, update the baseline, and remove them from the
  debt-file override sets.

## Definition Of Done

None of the six files appear in the baseline for any selector ratchet,
and consuming specs pass.

## Verification

Umbrella gates, with consuming specs found via
`rg -l "campaign.*po" e2e/*.spec.ts` (expect at least
`campaign-lifecycle`, `campaign-chat`, `campaign-collab`,
`campaign-notes`, `campaign-npcs` specs).

## Notes (2026-06-12)

- All 31 findings drained across the six files; baseline shrank
  101 -> 70. Consumers are wider than the leaf guessed: eight specs
  (campaign-lifecycle, campaign-collab, campaign-chat, campaign-notes,
  campaign-npcs, notifications, dice-roller, encounter-combat — the last
  five via `helpers/campaign-setup.ts`); 65/65 passed.
- `getInviteCode` no longer reads the first `<code>` element (a positional
  read that silently relied on the server's newest-first invite ordering);
  `createInvite` now captures the code from the invite.create response
  envelope and `getInviteCode` returns it after asserting it visible.
- The campaigns page header's "Create Campaign" button is duplicated by an
  identically named empty-state button (both legitimately named — same
  action), so the header actions div got
  `data-testid="campaigns-page-actions"` and the PO scopes through it.
  First e2e run caught this: the explorer-agent claim that the two were
  mutually exclusive was wrong — re-verify renders against source.
- Settings PO: name field scoped via `getByRole("tabpanel")` (Radix
  exposes the active tab content); the delete-confirm field's label embeds
  the campaign name, so it is matched as the dialog's only textbox.
- New Note / New NPC dialogs still lack `DialogDescription` (UX audit
  P1-9): no selector here traces back to it (dialog names come from their
  titles), so it stays with the UX audit queue per leaf scope.
- Codex review: no findings; it specifically confirmed the tRPC envelope
  parse, the tabpanel role surface, and the test-id justification.
