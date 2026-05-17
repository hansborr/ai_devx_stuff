# Parked / rejected upstream lint rules — verification pass

> **Centralized backlog**: lint-related upcoming work lives in
> `docs/agent_notes/backlog/lint-hardening-cross-repo-review.md`. The only
> remaining follow-up from this audit (two `.sort()` comparator fixes) is
> tracked as `lint-hardening/24-llm-core-parked-rules-followups.md`. This
> document remains the authoritative audit record — re-read it before
> reconsidering any of the six skipped upstream rules.

Status: One-off audit complete. No rules promoted.
Date: 2026-05-11
Scope: The five rules the previous agent left as "parked" or "would not spend
more time on" in
`docs/agent_notes/in_progress/eslint-llm-core-evaluation.md`:
`no-incorrect-sort`, `max-nesting-depth`, `no-empty-catch`,
`no-commented-out-code`, `no-exported-function-expressions`,
`prefer-early-return`.

## Method

Installed the upstream `eslint-plugin-llm-core@0.18.1` (from
`/home/node/tmp/eslint-plugin-llm-core` packed locally), wired each rule one
at a time through a throwaway `eslint.parked-each.js` config that extends the
real `eslint.config.js`, and ran `eslint` over
`packages/**/*.{ts,tsx}` plus `scripts/code-intel/**/*.ts` (the same scope our
main config lints). Each violation was opened in source and judged for
whether it points at a real correctness or maintainability problem.

Totals matched the prior agent's audit: 23 / 21 / 7 / 4 / 4 / 1 across
`prefer-early-return`, `no-incorrect-sort`, `no-empty-catch`,
`no-exported-function-expressions`, `max-nesting-depth`,
`no-commented-out-code`.

User priority for this pass: correctness and maintainability matter, pure
style does not.

## Per-rule findings

### `no-incorrect-sort` — 21 hits, 0 real bugs, 2 latent smells

The rule bans `.sort()` without a comparator. JS default sort coerces to
strings, so numeric sorts silently produce e.g. `[1, 10, 2]`. Real bug
class — but recall on this codebase is mostly known-string sorts.

Walk-through:

| File:line | Sorted values | Verdict |
|---|---|---|
| `routers/app-router.output-coverage.test.ts:25,33` | tRPC procedure key strings | Correct as-is |
| `routers/authz-logging-plumbing.test.ts:15` | filenames (`*.ts`) | Correct as-is |
| `routers/campaign.test.ts:159` | campaign name strings | Correct as-is |
| `routers/cast-spell-concentration.test.ts:383` | HTTP status numbers (200/400/409) | Latent smell — works because all 3-digit, breaks the day a 2-digit or 4-digit status shows up |
| `routers/homebrew-campaign.test.ts:316` | entry name strings | Correct as-is |
| `routers/homebrew-import.test.ts:269,270` | entry-type strings | Correct as-is |
| `routers/weapon-mastery.test.ts:142,238` | weapon name strings | Correct as-is |
| `seed/generate-srd-rules-glossary.ts:91` | `[string, number]` tuples sorted on string first element | Correct as-is |
| `services/level-up/level-up-multiclass-sorcerer.test.ts:80,81` | metamagic id strings | Correct as-is |
| `services/presence-multi-tab.test.ts:114,115` | user-id strings | Correct as-is |
| `test/enum-sync.test.ts:78` | enum value strings | Correct as-is |
| `test/prepare-test-db.ts:64` | Prisma migration dirs (timestamp-prefixed) | Correct as-is |
| `test/race-helpers.test.ts:35` | numeric concurrency indices (0,1,2) | Latent smell — works for single-digit values, breaks at concurrency ≥ 10 |
| `test/race-helpers.test.ts:50` | `"ok-N"` string array | Correct as-is |
| `shared/rules/sorcery-points.test.ts:82` | metamagic name strings | Correct as-is |
| `scripts/code-intel/graph-cache.ts:50` | manifest string array for hashing | Correct as-is |

19/21 are deliberately sorting strings (or string-prefix tuples). 2/21 are
numeric arrays that produce the right answer today only because all values
happen to be uniform-width (3-digit HTTP codes) or single-digit (0..2
indices). They are not bugs producing wrong output now, but they are the
exact shape `no-incorrect-sort` is designed to surface, and both should be
fixed by hand — see "Follow-up" below.

Should we enable the rule globally? No. Recall is dominated by intentional
string sorts; the signal-to-noise ratio with the upstream syntactic shape
is roughly 2/21. A narrowed type-aware variant ("only fire when receiver is
`number[]`") would catch both real cases and ignore the rest, but that
needs a TypeChecker-using rule, and we have only two known sites — fix
them in place and move on.

### `no-empty-catch` — 7 hits, 0 real bugs

Every hit is a `catch { /* comment */ }` block. Walk-through:

| File:line | Context | Verdict |
|---|---|---|
| `client/components/sheet/ability-scores-state.ts:89` | Mutation hook's `onError` already toasts; catch keeps edit mode open intentionally | False positive |
| `client/hooks/use-map-image-upload.test.ts:100` | Test asserting an error fires; `catch { /* expected */ }` is the canonical shape | False positive |
| `server/scripts/pgexec.ts:63` | Cleanup `client.end()` inside the outer error handler; ignoring is correct | False positive |
| `server/routers/rest-long.test.ts:456` | Concurrency test: the "simulated level-up" is intentionally racy with a Serializable tx | False positive |
| `server/services/upload-service.ts:129` | `unlink()` on a file that may already be gone | False positive |
| `server/socket/campaign-room-handler.ts:167` | Fire-and-forget presence cleanup on socket disconnect; stale presence falls out naturally | False positive |
| `scripts/code-intel/graph-cache.ts:76` | Hash manifest scan skipping unreadable files | False positive |

Every one of these is an explicit best-effort cleanup, a test expecting
failure, or fire-and-forget background work, and every one is documented in
its comment. Core `no-empty` already rejects the truly bare `catch {}`. The
upstream rule's stance — "a comment alone does not satisfy this rule" —
would force seven sites to add a no-op `logger.debug()` or contrived return
value with no protective value.

If we ever want stronger coverage we can write a narrower local rule that
requires *either* a non-empty body *or* a comment matching
`intentional|expected|ignore|best-effort` — but that's basically
"trust the comment", which is what we already do.

Skip. (Matches the prior agent's verdict; I confirmed each site.)

### `max-nesting-depth` — 4 hits

The rule fires at depth 4 (`max: 3`). Hits:

| File:line | Shape | Verdict |
|---|---|---|
| `server/routers/character-spell.ts:209` | tRPC mutation with nested `if (record.prepared) … if (character.stats) … if (maxPrepared > 0) … if (preparedCount >= maxPrepared) throw` | Legitimate refactor target — guard-clause chain would be cleaner |
| `server/seed/generate-class-features.ts:202` | Seed-script triple `for` (classes → levels → tableName) with inner `if (…) continue` | Legitimate refactor target (extract per-class helper). Seed script, runs once at build time |
| `server/seed/seed-srd-backgrounds.ts:95` | JSON-parse loop: `for opt … if/else … for item … if (parsed.item) items.push` | Marginal — compact JSON shape mapping, readable |
| `shared/map/area-template.ts:216` | AoE math: 2D scan `for dx … for dy … if (along && perp ≤ halfWidth) … if (inBounds) cells.push` | Performance-critical D&D area math; extracting the inner condition adds call overhead without readability win |

2 of 4 are real refactor targets. The other 2 are intentional shapes (seed
JSON parser, tight 2D scan). `complexity: 10` is already wired and
already catches harder cases — these 4 sites pass complexity comfortably,
which is itself a signal that depth alone is not a strong proxy for
maintainability here.

Verdict: skip the global rule. If we want a refactor signal, the two
real targets (`character-spell.ts`, `generate-class-features.ts`) can be
done by hand without a rule. Promoting the rule would force noisy churn
into the area-template math kernel.

### `no-commented-out-code` — 1 hit, 0 real findings

Only hit is `packages/server/src/utils/character-stats-mutations.ts:6`, which
is a 34-line **policy** comment documenting the sole-sanctioned escape for
`CharacterStats` writes (see `docs/CONCURRENCY.md`). The rule's
heuristic regex fired on a substantive comment that is the single most
important piece of documentation in that file.

Across the linted tree there are zero actual blocks of commented-out code
that this rule catches. `local/no-llm-artifacts` already covers the
narrow LLM-leftover patterns (`// ... existing code ...`, bare TODOs, "Not
implemented" stubs). Skip.

### `no-exported-function-expressions` — 4 hits

All four are typed function values where the expression form carries the
contract:

- `client/src/lib/local-rng.ts:4` — `export const localRng: RngFn = (min, max) => …`
- `server/src/utils/crypto-rng.ts:15` — `export const cryptoRng: RngFn = (min, max) => …`
- `scripts/code-intel/daemon-client.ts:154` — `defaultDaemonTransport` matches a transport interface
- `scripts/code-intel/daemon-process.ts:34` — `defaultDaemonSpawner` matches a spawner interface

Converting to `export function name(...): T` either drops the typed
interface annotation (the type can move into params + return, but it
duplicates the interface signature, which is exactly the brittleness the
typed-value form avoids) or requires casting. User priority: not style.
Skip.

### `prefer-early-return` — 23 hits, 0 maintainability findings

Every hit is a single-statement function body of the shape
`useCallback(() => { if (cond) { …body… } })` or
`useEffect(() => { if (open) { …body… } })`. These are the canonical
React/hook idioms; rewriting each to `if (!open) return; …body…` does
not reduce complexity, does not catch bugs, and adds line count and
churn.

Spot-checked: `level-up-state.ts:105`, `use-long-press.ts:50`,
`worker-test-database.ts:49`, `encounter-card.tsx:34`,
`use-background-image.ts:31` — all hook bodies guarded by an `if` that
is the only statement. Skip.

## Verdict summary

| Rule | Hits | Real findings | Decision |
|---|---:|---:|---|
| `no-incorrect-sort` | 21 | 0 bugs, 2 latent smells | Skip rule, fix the 2 sites by hand |
| `no-empty-catch` | 7 | 0 | Skip |
| `max-nesting-depth` | 4 | 2 refactor candidates | Skip rule, refactor by hand if desired |
| `no-commented-out-code` | 1 | 0 (false positive on policy doc) | Skip |
| `no-exported-function-expressions` | 4 | 0 | Skip (pure style) |
| `prefer-early-return` | 23 | 0 | Skip (pure style) |

The previous agent's overall recommendation holds. The verification adds
two concrete things:

1. The `no-commented-out-code` hit is a substantive false positive — the
   rule flagged the most important comment in `character-stats-mutations.ts`,
   which is itself an argument against enabling it.
2. `no-incorrect-sort` has two sites that work today by luck (uniform-width
   3-digit HTTP codes and single-digit concurrency indices) — worth fixing
   even though we don't enable the rule.

## Follow-up

Optional small repairs to the two latent `.sort()` smells, no rule wiring
needed:

- `packages/server/src/routers/cast-spell-concentration.test.ts:383` —
  `codes.sort((a, b) => a - b)` to make the assertion robust to status-code
  width changes.
- `packages/server/src/test/race-helpers.test.ts:35` —
  `[...seenIndices].sort((a, b) => a - b)` so the test stays correct if
  `concurrency` is raised past 9.

Both are one-character fixes inside test files. Not worth a leaf on their
own; pick them up the next time these files are touched.

## Artifacts

- Temporary configs (`eslint.parked.js`, `eslint.parked-each.js`) and per-rule
  output dumps under `/tmp/parked/` were used for the audit and removed
  after.
- Upstream plugin installed locally for the audit (`bun add --dev
  /home/node/tmp/eslint-plugin-llm-core/eslint-plugin-llm-core-0.18.1.tgz`).
  Removed after the audit so the workspace `package.json` stays clean.
