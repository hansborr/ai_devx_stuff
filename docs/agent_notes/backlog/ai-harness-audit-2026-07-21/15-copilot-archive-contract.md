# Pin Copilot Registration Into Public Archives

Status: Proposed — opportunistic; revise archive fixture first
Date: 2026-07-21
Priority: P3

## Problem

The Public Archive Boundary in `docs/ai-harness.md` lists
`.copilot/hooks/` but omits `.github/hooks/copilot.json`, the file that
registers those adapters. It is currently included only because `.github` is
not export-ignored; a future broad archive rule could silently ship unusable
hooks.

## Scope

- Add `.github/hooks/copilot.json` to the public-boundary inventory.
- Extend the archive smoke to assert the registration and Copilot shim tree.
  Continue to rely on `harness:check` for registration/reference/orphan parity;
  the archive smoke owns only exported presence.
- The current smoke archives `HEAD`. Do not derive expected paths from live or
  staged registration while comparing them with a HEAD archive: a newly staged
  shim could never pass pre-commit. Either archive the index tree produced by
  `git write-tree`, derive expectations from `git show HEAD:...`, or keep stable
  presence assertions.

## Acceptance

- The same committed or staged tree supplies both archive contents and expected
  Copilot paths.
- Generated source archives contain the Copilot config and shim tree.
- Documentation names both the adapters and registration file.
- `harness:check` continues to reject missing/drifted live registration or shim
  wiring; archive tests independently reject omission of either side from the
  exported source archive.

Do not add a redundant carve-back while `.github` is included. If a future
change export-ignores `.github/**`, add the exception in that same ordered rule
block; the archive smoke remains the durable protection.
