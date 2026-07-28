# Reduce Misleading Codex Edit Status Chatter

Status: Proposed — candidate after adversarial review; configuration cleanup only
Date: 2026-07-21
Priority: P3
Size: S

## Finding

Every Codex `apply_patch` displays several PostToolUse status messages even when
most hook bodies immediately no-op. "Regenerating Prisma client" is false for
almost every edit: the shared body exits unless the payload contains a Prisma
schema path. The six static strings are recurring UI noise, not model-visible
context corruption.

## Rejected design

Do not build the proposed M-L post-edit aggregator, child supervisor, manifest
aggregate-group schema, output-precedence protocol, and nested timeout model.
Codex already launches matching hooks concurrently and combines their feedback;
duplicating that runtime creates new process-tree and malformed-output failure
modes to remove a few static UI strings.

## Active S-sized scope

- Relax the repository wiring schema so Codex `statusMessage` is optional.
- Update the hook README and generator/schema tests to pin omission as a valid
  Codex projection.
- Omit the six no-value post-edit statuses. Retain a status only where measured
  runtime needs liveness; make any retained phrase truthful, such as "Checking
  for schema edits" rather than claiming work occurred.
- Delete Prisma's success-only stderr line in this leaf.
- Preserve individual hook registration, native concurrency, and existing
  output behavior.

## Acceptance

- A generated Codex hook may omit `statusMessage`, and schema/generator tests
  reject any accidental return to mandatory static statuses.
- Ordinary `apply_patch` calls no longer display six repository-authored status
  strings; any retained status is both useful and truthful for its full match.
- No-op hooks and successful Prisma generation remain silent, while all native
  PostToolUse feedback and failure paths remain intact.
- Claude and Copilot wiring is unchanged.

This cleanup does not depend on leaves 05 or 09. Reopen aggregation only after
measured lost child feedback or process overhead, not for UI polish alone.
