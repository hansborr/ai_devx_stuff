# 63 — Archive-vs-clone boundary is invisible in the first hour

Status: Done
Track: DOC (docs) · Priority: P2 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** Deep documentation is accurate, but the only README route to public release notes is in the License footer. Earlier leaf 70 evidence is partially superseded by current carve-backs.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `.gitattributes:20-46` — archive export ignores harness trees and then carves copyable subsets back in.
- `docs/ai-harness.md:57-70` and `docs/ai-harness.md:146-149` — the archive-versus-clone boundary is documented in depth.
- `docs/public-release-notes.md:12-30` — public archive contents are described consistently.
- `README.md:178-179` — the only public-release-notes link appears under License.

Failure: A talk attendee downloading a source archive can miss process notes and misunderstand which harness artifacts are intentionally included without seeing the boundary until deep reading.

## Do

Add one early README sentence beneath the harness pointer: a full clone includes process notes; archives contain carved copyable harness configuration; link the existing Public Archive Boundary. Reconcile the partially superseded evidence in [harness-review leaf 70](../harness-review-2026-07/70-export-ignore-vs-reference-goal.md).

## Verify

```
git archive --format=tar HEAD | tar -tf - | rg "^(docs/agent_notes|\.claude|\.codex|scripts/ai-hooks)"
```

## Acceptance

- The README’s harness entry explains clone-versus-archive behavior.
- The statement matches the actual carve-backs in `.gitattributes`.
