# 25. collections/MODULE.md cites ../../lib; correct depth is ../../../lib

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: docs-drift · Area: product · Severity: quality-low · Size: XS
Source: drift:ai target-config doc-path audit (target-config) · Confidence: high

## Problem
`collections/MODULE.md` line 18 documents the module's shared dependencies with a relative path one level too shallow:

> Talks to `../../lib/trpc.js` and `../../lib/download-json.js` for server calls and export-to-file.

The MODULE.md sits at `packages/client/src/components/homebrew/collections/`. From there `../../lib/` resolves to `packages/client/src/components/lib/`, which does not exist. The real target is `packages/client/src/lib/` (`../../../lib/`). Every sibling source file in this folder imports those same modules at the correct depth (`../../../lib/trpc.js`, `../../../lib/download-json.js`). So the doc's only concrete file pointers are broken: an engineer following them lands in a nonexistent directory, and the doc visibly disagrees with the code it describes. Low severity (docs-only, no runtime impact) but a trivially verifiable, trivially fixable drift.

## Evidence
- `packages/client/src/components/homebrew/collections/MODULE.md:18` — cites `../../lib/trpc.js` and `../../lib/download-json.js`; `../../lib/` resolves to nonexistent `src/components/lib/`.
- `packages/client/src/components/homebrew/collections/collection-card.tsx:11-12` — `import { downloadJson, slugifyForDownload } from "../../../lib/download-json.js";` and `import { useTRPC } from "../../../lib/trpc.js";` (correct `../../../lib/` depth).
- `packages/client/src/components/homebrew/collections/collection-dialog.tsx:15`, `delete-collection-dialog.tsx:7`, `import-collection-dialog.tsx:12` — all import `../../../lib/trpc.js`, confirming the canonical depth.
- `packages/client/src/lib/` exists; `packages/client/src/components/lib/` does not (verified via `realpath -m` from the collections dir).

## Proposed fix
1. Edit `packages/client/src/components/homebrew/collections/MODULE.md` line 18: change `../../lib/trpc.js` → `../../../lib/trpc.js` and `../../lib/download-json.js` → `../../../lib/download-json.js`.
2. No code or test changes; MODULE.md is documentation. There is no automated check for these relative paths, so confirm by hand that `../../../lib/` from the collections folder resolves to `src/lib/`.

## Verification / caveats
- False-positive risk: low. The fix only edits prose path references; it cannot change behavior. Double-check no other line in this MODULE.md (or the sibling `homebrew/MODULE.md` if present) repeats the shallow `../../lib/` pattern before closing — only line 18 currently does.
- This is a code-change fix (correct the doc), not a config suppression; there is no lint rule governing MODULE.md relative paths to suppress.
