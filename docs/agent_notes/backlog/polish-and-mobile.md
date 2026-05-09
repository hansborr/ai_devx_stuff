# Polish, Mobile, and Accessibility

Parked. Mobile optimization, file handling, data portability, accessibility,
and UX refinement scope kept here so it does not get re-derived from scratch
when this becomes the active track. Promote one milestone at a time into
`in_progress/` and `NEXT.md`.

`production-readiness.md` is the recommended predecessor — file uploads,
PDF export, and a11y verification land more cleanly once monitoring and
deploys exist.

## Milestones

### Mobile Optimization

- [ ] Audit all pages/components for mobile usability
- [ ] Touch-friendly controls (larger tap targets, swipe gestures)
- [ ] Mobile-specific layouts where desktop layout doesn't adapt well
- [ ] Bottom sheet patterns for modals/panels on mobile
- [ ] Tabletop mobile controls (pinch zoom, tap-to-select token)
- [ ] Performance profiling on mid-range mobile devices

### File Uploads & Avatars

- [ ] File upload infrastructure (S3-compatible object storage — MinIO local, S3/R2 production)
- [ ] Image processing (resize, thumbnail generation)
- [ ] Upload targets: character avatar, campaign banner, homebrew artwork
- [ ] File size and type validation (client + server)
- [ ] Image cropping UI for avatars
- [ ] Character avatars on sheet, vault cards, campaign members, chat, combat tracker
- [ ] Campaign banner on campaign card and detail page
- [ ] Default avatar generation (initials or icon based on class/species)
- [ ] Token images from character avatars (tabletop integration)

> Note: Map background image upload already shipped.

### Data Export & Import

- [ ] Export character as JSON (full character data, portable)
- [ ] Export character as PDF (formatted character sheet)
- [ ] Import character from JSON
- [ ] Export campaign data (characters, chat history, encounters, maps)

> Homebrew collection JSON import/export already shipped.

### Accessibility Verification

> Accessibility is built incrementally as features land. This milestone is a verification pass, not initial implementation.

- [ ] Full keyboard navigation audit
- [ ] Screen reader testing (ARIA labels, roles, live regions for real-time updates)
- [ ] Color contrast audit (WCAG 2.1 AA compliance)
- [ ] Focus management audit (modals, drawers, page transitions)
- [ ] Reduced motion support (`prefers-reduced-motion`)
- [ ] VTT canvas accessibility review (text alternatives for token positions)

### UX Refinements

- [ ] Onboarding flow (first-time user guide)
- [ ] Keyboard shortcuts (roll dice, next turn, open chat)
- [ ] Undo/redo for character edits
- [ ] Bulk DM operations (heal all, damage all, reset encounter)
- [ ] Cross-campaign search (characters, spells, items)
- [ ] Notification preferences (which events trigger toasts)

### Enhancement Backlog

Deferred items from earlier work:

- [ ] Richer campaign-note editing than the current plain textarea flow
- [ ] Campaign activity feed
- [ ] Heroic Inspiration auto-grant on natural 20
- [ ] Richer offline recovery beyond the current reconnect invalidate/refetch model
- [ ] Combat undo (compensating log entries)
- [ ] Compact vs expanded combat tracker view
- [ ] Condition duration variants: save-ends, concentration-linked
- [ ] Expanded monster bestiary (SRD data, when structured 2024 JSON available)

## Definition of Done

- App is usable on mobile devices without compromise
- File uploads work for avatar/image targets
- Characters and campaigns can be exported and imported
- Accessibility audit passes with no critical issues
- Performance is acceptable with realistic data volumes

## Key Technical Decisions

- **Object storage, not database BLOBs**: images in S3-compatible storage, database stores URLs only.
- **PDF generation**: server-side using a PDF library. Match official D&D sheet layout where possible.
- **Code splitting boundaries**: tabletop (Konva), character wizard, PDF generation — lazy load all three.
- **Progressive enhancement for mobile**: tabletop on mobile is view + basic interaction, complex editing is desktop-only.
