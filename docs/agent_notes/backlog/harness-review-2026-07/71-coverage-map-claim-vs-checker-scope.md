# 71. The lint-coverage-map claims every tracked maintained surface is accounted for, but the checker only enforces a dozen file extensions

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: reference-fitness · Area: lint-governance · Severity: med · Size: S · Confidence: high
Theme: gate-matches-claim · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
`docs/agent_notes/lint-coverage-map.md` opens with a total claim: every tracked maintained code/tooling surface resolves to a status, and "new surfaces appearing in future `git ls-files` runs should be added ... before any ratchet/floor batch lands." The gate that keeps that promise, `lint-coverage-map-check`, only holds files whose extension matches a fixed regex in scope — `.ts/.tsx/.js/.mjs/.cjs/.json/.yaml/.yml/.toml/.sh/.md/.prisma/.sql` plus a `Dockerfile` special case. Families like `.css`, `.html`, `.env*`, `.jsonl`, `.csv`, `.txt`, `.pdf`, lockfiles, dot-config files (`.gitattributes`, `.prettierrc`, `.gitignore`), and extensionless hooks (`.husky/*`) are invisible to the checker. Notably, the map *already carries hand-written rows for these families* — but nothing verifies them: a new `.css` or `.env.example` file with no row sails through the gate, and those rows can silently go stale. For a repo whose reference pitch includes "the gate enforces exactly what the doc claims," this is a quiet honesty gap.

## Evidence
- `/workspace/docs/agent_notes/lint-coverage-map.md:3-8` — "Every tracked maintained code/tooling surface below resolves to one of: `linted`, `ratcheted`, `proposed`, `pending-leaf`, `excluded`, or `not-code`. No `unknown` rows remain; new surfaces appearing in future `git ls-files` runs should be added ..."
- `/workspace/scripts/lint-coverage-map-check-patterns.ts:11` — `TRACKED_EXTENSION_PATTERN = /\.(?:ts|tsx|js|mjs|cjs|json|ya?ml|toml|sh|md|prisma|sql)$/u`.
- `/workspace/scripts/lint-coverage-map-check-patterns.ts:144-148` — `trackedFileIsInScope` = generated-dir filter + `Dockerfile` special case + the extension regex; everything else is out of scope.
- Tracked out-of-scope families exist (verified via `git ls-files`): `packages/client/src/app.css`, `packages/client/index.html`, `.env.example` + `.devcontainer/.env.example`, 3× `.jsonl`, 3× `.csv`, `bun.lock`, `docs/SRD_CC_v5.2.1.pdf`, 4 extensionless `.husky/*` hooks, `.gitattributes`, `.prettierrc`, `.gitignore`s, `LICENSE`, `.txt`.
- The map already has *unverified* rows for these: `/workspace/docs/agent_notes/lint-coverage-map.md:355` (`.husky/*`, "linted" via ShellCheck), `:376` (`.env.example`, excluded), `:417` (`index.html`, excluded), `:418` (`app.css`, excluded), `:419` (`bun.lock`, not-code), `:313` (`.jsonl` fixtures), `:411` (`.pdf`).

## Proposed direction
Pick one and say so in the map intro:
1. **Widen the checker** to the families that already have rows (css, html, env-example, jsonl, csv, txt, pdf, lock, the dot-config set, and named extensionless files like `.husky/*` / `LICENSE`). Each newly in-scope family then gets its rows enforced both directions (file→row and row→file). Cost: one-time reconciliation of any rows the wider scope flags; decide whether truly inert families (`.pdf`, `LICENSE`) enter as enforced `not-code` rows or a checker-side named allowlist.
2. **Narrow the claim**: reword lines 3-8 to enumerate the checked families ("every tracked file in the `ts/tsx/.../sql` + Dockerfile families ...") and label the remaining rows as unverified inventory.
Option 1 better fits the reference goal — the doc's promise and the gate become the same statement; option 2 is the honest cheap fallback.

## Scope / caveats
One small commit either way (regex/scope change + map-intro wording + reconciled rows), with `scripts/lint-coverage-map-check.test.ts` updates. If widening, beware the extension-parse trap: `.env.example` ends in `.example`, `.husky/pre-commit` has no extension — scope by full-name/path patterns, not only extensions. The original review framing said the excluded families "each need an owner row"; correction from verification: the rows already exist — the missing piece is enforcement, not authorship. Also note the map is export-ignored (see leaf 70), which compounds the reference-fitness cost.
