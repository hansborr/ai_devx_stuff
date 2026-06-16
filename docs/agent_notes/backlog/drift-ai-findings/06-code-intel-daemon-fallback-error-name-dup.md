# 06. DAEMON_FALLBACK_ERROR_NAME hard-coded in daemon-server.ts though daemon-client.ts already exports it

Status: ✅ Implemented on `chore/driftai-audit` (2026-06-13); verified present in the live tree. The body below is the original finding — its cited line numbers predate the fix.
Theme: duplication · Area: tooling · Severity: quality-med · Size: XS

## Problem
The string literal `"CodeIntelDaemonFallback"` is a wire/error-name contract between a producer and two consumers in the code-intel daemon, but the producer forks its own private copy instead of importing the canonical export.

- Producer: `daemon-server.ts` tags two error envelopes with `name: DAEMON_FALLBACK_ERROR_NAME` (lines 127, 134), where `DAEMON_FALLBACK_ERROR_NAME` is a module-private `const` re-declared at line 25.
- Consumer 1: `daemon-client.ts` declares the canonical `export const DAEMON_FALLBACK_ERROR_NAME = "CodeIntelDaemonFallback"` (line 25) and branches on it at line 143 (`if (errorName === DAEMON_FALLBACK_ERROR_NAME)`) to decide fallback-vs-throw.
- Consumer 2: `lifecycle-probe.ts` already imports the canonical export from `./daemon-client.js` (line 5) and compares against it at line 106.

So two of three parties already share one definition; only the server has its own byte-for-byte duplicate with no compile-time link to it. If the literal is edited in one file but not the other, the consumers silently stop recognizing the server's fallback signal: client/probe would `throw new CodeIntelError(message)` (daemon-client.ts:146) for what should have been a graceful one-shot fallback. No test or type couples the two copies. Deduping to a single source removes a latent correctness footgun and is the standard single-source-of-truth fix for a wire constant.

## Evidence
- `scripts/code-intel/daemon-server.ts:25` — module-private `const DAEMON_FALLBACK_ERROR_NAME = "CodeIntelDaemonFallback"` (the duplicate).
- `scripts/code-intel/daemon-server.ts:127`, `:134` — producer tags thrown error envelopes with that name (protocol-version mismatch; non-routable command).
- `scripts/code-intel/daemon-client.ts:25` — canonical `export const DAEMON_FALLBACK_ERROR_NAME = "CodeIntelDaemonFallback"`.
- `scripts/code-intel/daemon-client.ts:143` — consumer compares `errorName === DAEMON_FALLBACK_ERROR_NAME` to pick fallback vs. throw (`:146`).
- `scripts/code-intel/lifecycle-probe.ts:5`, `:106` — already imports and compares the canonical export, proving the import direction is safe.
- No import edge exists in either direction between `daemon-server.ts` and `daemon-client.ts` today (verified via `rg`), so no cycle constraint blocks the fix.

## Proposed fix
1. Pick the single source. Two viable shapes; prefer the second for cleanliness:
   - (a) Have `daemon-server.ts` import `DAEMON_FALLBACK_ERROR_NAME` from `./daemon-client.js` (mirrors what `lifecycle-probe.ts` does). Cheapest diff, but couples the server to the client module.
   - (b) Move the constant into a small shared module, e.g. add `export const DAEMON_FALLBACK_ERROR_NAME = "CodeIntelDaemonFallback"` to `scripts/code-intel/daemon-protocol.ts` (already the shared protocol contract imported by both server and client), then have `daemon-client.ts` re-export or import from there and delete the server's private copy. Keeps the wire constant beside the protocol version it travels with.
2. Delete `daemon-server.ts:25` and update its two usages (`:127`, `:134`) to reference the imported constant.
3. If choosing (b), update `daemon-client.ts:25` to import (and optionally re-export, since `lifecycle-probe.ts` imports it from `daemon-client.js`) so the existing `lifecycle-probe.ts:5` import keeps resolving.
4. TDD: `scripts/code-intel.test.ts` already covers both `daemon-server.ts` and `daemon-client.ts` (per `code:intel dependents`) but references the literal nowhere. Add one round-trip assertion: build a server error response for a non-routable command (or protocol mismatch) and feed its JSON through the client's `interpretResponse`/`requestDaemonQuery`, asserting `{ kind: "fallback" }` rather than a thrown `CodeIntelError`. That test pins the producer/consumer agreement so a future edit to the literal in one place fails loudly.

## Verification / caveats
- False-positive risk: low. This is a genuine duplicated wire literal with three readers; not a coincidental same-string-different-meaning case (all three uses are the daemon fallback error name).
- A code change (dedup) is the right call here, not a config suppression — there is no lint rule involved; the value is the compile-time single source.
- Scope boundary: do not also fold the unrelated `"Error"` / `FALLBACK_RESPONSE_ID = "unknown"` literals in `daemon-server.ts` into this change; they are separate concerns.
- Implementer should confirm option (b)'s re-export keeps `lifecycle-probe.ts:5` (`import { DAEMON_FALLBACK_ERROR_NAME } from "./daemon-client.js"`) resolving, or switch that import to the new shared module in the same change. Run the scripts test project (`bun run test:scripts:file -- scripts/code-intel.test.ts`) after.
