# A11y-Tree-First Playwright — Plan

Status: Archived. Stages 1-7 landed; future selector migrations are
opportunistic under the raw-locator drift guard.

## Context

Source: `docs/ai-harness.md` cross-reference with
https://nyosegawa.com/en/posts/harness-engineering-best-practices-2026/
("E2E: Give Agents Eyes" section). The article argues agents should read the
UI as a structured a11y tree (role/name/state), not screenshots, coordinates,
or CSS selectors.

Musi is mostly already on this path:

- Uses Playwright CLI, not Playwright MCP (avoids the 114K-token trap).
- A local `.claude/skills/playwright-cli/` exists and centers
  `playwright-cli snapshot` (YAML a11y tree with stable refs `e3`, `e15`, ...)
  as the default interaction mode, but it is currently ignored by git.
- `.codex/skills/playwright-cli/` does not exist yet; Codex only has the
  tracked `code-intel` skill.
- `playwright-cli` is installed in the devcontainer (`0.1.8`) and supports
  `snapshot --depth`, element-scoped snapshots, `state-save`, and `state-load`.
- Selector use under `e2e/` is already mostly semantic, but there is still a
  meaningful raw-locator tail to keep from growing.
- The local ESLint plugin recently adopted the ERROR/WHY/FIX pattern: every
  `local/*` rule message should name a doc or codemod, and tests should lock
  those pointers in place. New local rules added by this plan must follow that
  convention from day one.

So the work here is **track/mirror the skill + enforcement + Musi-specific
glue + a small guide**. It is not a big-bang selector migration.

## Current state (audited 2026-05-10)

Selector calls under `e2e/`:

| Pattern        | Count | Note                           |
| -------------- | ----- | ------------------------------ |
| `getByRole`    | 165   | dominant — good                |
| `page.locator` | 76    | CSS-selector migration target  |
| `getByText`    | 65    | acceptable, a11y-name-adjacent |
| `getByLabel`   | 32    | a11y-friendly                  |
| `getByTestId`  | 25    | last resort                    |

Broad raw-locator count is 99 when chained/nested `.locator(` calls are
included; that is the local selector rule's migration target.

Layout / facts to anchor the plan in:

- `playwright.config.ts` at repo root. Default ports: client 8000, server
  8001. Worktrees allocate alternate ports; `bun run worktree:status` prints
  `allocation: server=<port> client=<port> ...` when allocation exists.
- `e2e/storage.setup.ts` registers a shared user via `/register` and writes
  `.auth/user-info.json` (credentials JSON), **not** a Playwright
  `storageState`. `.auth/` is gitignored, which is correct for generated auth
  artifacts.
- `e2e/helpers/auth.setup.ts`, `e2e/fixtures.ts`, `e2e/global-setup.ts`
  scaffolding exists; e2e tests log in via fixtures, not by reusing a saved
  Playwright state.
- `.claude/skills/playwright-cli/` exists locally but is ignored by `.gitignore`
  because only `.claude/skills/code-intel/` is opted in today.
- `.codex/skills/playwright-cli/` does not exist. `.codex/skills/*` is also
  ignored except the tracked `code-intel` skill.
- `docs/ai-harness.md` currently points at `.claude/skills/playwright-cli/SKILL.md`
  even though that path is not tracked.
- Scripts: `e2e`, `e2e:ui`, `e2e:debug`. No `e2e:inspect`.
- ESLint currently ignores `e2e/` globally. Running lint on an e2e file only
  reports it as ignored, and forcing `--no-ignore` hits a TypeScript
  project-service error because `e2e/` is not included in an ESLint-visible
  tsconfig. E2E lint enablement must be fixed before new Playwright rules can
  do anything.

## Goals

1. Browser-inspection instructions live in tracked Claude and Codex
   `playwright-cli` skills.
2. Agents have a Musi-specific quickstart for inspecting an authenticated route
   by reading an a11y snapshot.
3. New e2e tests author with role/name/label selectors first (enforced).
4. The 99 legacy raw `.locator(...)` call sites migrate opportunistically when
   touched. No mass rewrite.

## Out of scope

- A new `e2e:inspect` helper script. `playwright-cli` already has the needed
  primitives; this plan tracks the skill, mirrors it for Codex, and adds Musi
  auth/dev-server context.
- Visual regression / screenshot diffing.
- Mass rewrite of existing `page.locator(...)` usage.
- Animation verification layer (see "Deferred").

## Steps

### 1. Track and mirror the `playwright-cli` skill

Make the existing browser-inspection skill a shared repo artifact instead of a
local ignored file.

- Keep the broad personal-skill ignores in `.gitignore`; do **not** remove the
  whole `.claude/skills/*` or `.codex/skills/*` ignore pattern.
- Add explicit opt-ins for the shared Playwright skill, mirroring the
  `code-intel` pattern:
  - `!.claude/skills/playwright-cli/`
  - `!.claude/skills/playwright-cli/**`
  - `!.codex/skills/playwright-cli/`
  - `!.codex/skills/playwright-cli/**`
- Copy the existing `.claude/skills/playwright-cli/` contents to
  `.codex/skills/playwright-cli/`.
- Add `.codex/skills/playwright-cli/agents/openai.yaml`, following the local
  `code-intel` shape:
  - display name: `Playwright CLI`
  - short description: inspect and operate Musi browser routes through
    a11y-tree snapshots
  - default prompt: use `$playwright-cli` to inspect a route, interact by refs,
    save/load auth state, or capture a scoped snapshot
- Keep the Claude and Codex skill bodies materially identical unless a
  harness-specific frontmatter field is required. If they start diverging,
  add a tiny script/check rather than relying on memory.

Add a "Musi: inspect an authenticated route" section to both skill copies
(`SKILL.md` or a directly linked `references/musi-auth.md` if the body is
getting long).

Content:

- **Get the URL**:
  - Primary checkout default: `http://localhost:8000`.
  - Secondary worktree: run `bun run worktree:status`; if it prints
    `allocation: server=<server> client=<client> ...`, use
    `http://localhost:<client>`.
- **Get test credentials**:
  - Run `bun playwright test --project=setup` if `.auth/user-info.json` is
    missing.
  - Read `.auth/user-info.json` for `email`, `password`, and `displayName`.
- **First authenticated inspection**:
  ```
  playwright-cli open http://localhost:8000/login
  playwright-cli snapshot --depth=4
  playwright-cli fill <email-ref> "<email from .auth/user-info.json>"
  playwright-cli fill <password-ref> "<password>"
  playwright-cli click <submit-ref>
  playwright-cli state-save .auth/playwright-cli-state.json
  playwright-cli goto http://localhost:8000/<route-under-inspection>
  playwright-cli snapshot --depth=6
  ```
- **Returning to an authenticated session**:
  ```
  playwright-cli open http://localhost:8000
  playwright-cli state-load .auth/playwright-cli-state.json
  playwright-cli goto http://localhost:8000/<route-under-inspection>
  playwright-cli snapshot --depth=6
  ```
- **Token budgeting**: use `--depth=<n>` for whole-page snapshots and
  element-scoped snapshots (`playwright-cli snapshot e34`) for dense screens
  such as the character sheet and VTT drawer.
- **Selector discipline while inspecting**: prefer refs from snapshots for
  interaction; use role locators only when refs are stale; use CSS only for
  canvas/structural debugging.

Verification:

- `git status --short --ignored .claude/skills/playwright-cli .codex/skills/playwright-cli`
  should show the shared skill as trackable, not ignored.
- `playwright-cli --help snapshot` should show `--depth` and element snapshot
  support.
- `playwright-cli --help state-save` / `state-load` should show auth-state
  support.

### 2. Enable E2E linting before adding Playwright rules

This is a required precursor. Without it, `bun run lint:changed` cannot enforce
anything under `e2e/`.

- Remove `e2e/` from the global ignores in `eslint.config.js`.
- Add an ESLint-visible TypeScript project for e2e files, for example
  `tsconfig.e2e.json` extending `tsconfig.base.json` with:
  - `noEmit: true`
  - Playwright/Node types as needed
  - `include: ["e2e/**/*.ts", "playwright.config.ts"]`
- Add an ESLint flat-config block for `e2e/**/*.{ts,tsx}` that points parser
  options at that project (or otherwise makes project service aware of e2e).
- Keep e2e test artifacts ignored (`.auth/`, `.playwright-cli/`,
  `playwright-report/`, `test-results/`, etc.).
- Verify:
  - `bunx --bun eslint --print-config e2e/storage.setup.ts` returns a config,
    not `undefined`.
  - `bun run lint -- e2e/storage.setup.ts` actually lints the file.
  - `bun run lint:changed` catches changed e2e files instead of silently
    skipping them.

### 3. Lint: Playwright hygiene + role-first authoring

Hybrid: third-party plugin for universal Playwright hygiene + one local rule
for Musi's role-first selector policy. The split keeps the ERROR/WHY/FIX doc
pointer on the rule that needs a Musi-specific recipe.

#### 3a. `eslint-plugin-playwright` for universal hygiene

- Add `eslint-plugin-playwright` (devDep).
- Enable it for `e2e/**/*.{ts,tsx}` only after Step 2 lands.
- Prefer starting from `playwright.configs["flat/recommended"]`, then disable
  rules that are noisy for this repo rather than hand-copying an incomplete
  subset.
- High-value rules to keep as errors if clean, or fix immediately if they
  surface real issues:
  - `playwright/prefer-web-first-assertions`
  - `playwright/missing-playwright-await`
  - `playwright/no-wait-for-timeout`
  - `playwright/no-focused-test`
  - `playwright/no-skipped-test`
  - `playwright/no-page-pause`
  - `playwright/no-networkidle`
  - `playwright/expect-expect`
- Candidate rules that may need repo-specific tuning:
  - `playwright/no-conditional-in-test` (can be noisy around responsive or
    role-dependent flows)
  - `playwright/no-nth-methods` (current e2e code uses `.first()` /
    `.last()` heavily)
  - `playwright/no-raw-locators` / `playwright/prefer-native-locators`
    (do not enable alongside the local selector rule unless duplicate reports
    are acceptable)
- Accept the plugin's third-party messages for universal hygiene rules. The
  rule names and upstream docs are enough for an agent to self-serve.
- Do **not** force plugin messages to cite `docs/guides/add-e2e-test.md`; that
  guide is specifically for Musi's role-first authoring policy.

#### 3b. `local/e2e-prefer-role-selectors` for the project-specific opinion

- New file: `eslint-rules/e2e-prefer-role-selectors.js`.
- Detection:
  - Scope to `e2e/**/*.{ts,tsx}` through config.
  - Flag raw `.locator(...)` member calls broadly in e2e, not only
    `page.locator(...)`. Current legacy code also uses `this.page.locator(...)`,
    `dialog.locator(...)`, `group.locator(...)`, and locator-chain calls.
  - Keep the rule syntax-based for v1; type-aware detection is unnecessary
    once it is scoped to e2e files.
  - Exclude `getByTestId(...)` for v1. It has legitimate last-resort uses;
    revisit if abuse appears.
  - Allow a small option object only if needed for structural exceptions
    (canvas internals, iframe, or app-owned non-accessible implementation
    details). Prefer file-level legacy allowlist for existing debt.
- Pair with `eslint-rules/e2e-prefer-role-selectors.test.js` that asserts the
  message names `docs/guides/add-e2e-test.md`.
- Message template:
  ```
  Prefer role/name selectors in e2e/.
  Use getByRole/getByLabel/getByText before falling back to CSS.
  See docs/guides/add-e2e-test.md for the recipe.
  ```
- Wire into `eslint.config.js` under `local/*` like the existing rules.

#### 3c. Legacy migration

- Handle the 99 legacy raw-locator sites through ESLint flat-config file
  allowlist entries, not inline disables:
  ```
  {
    files: ["e2e/page-objects/character-sheet.po.ts", "..."],
    rules: { "local/e2e-prefer-role-selectors": "off" },
  }
  ```
- The allowlist should be generated from current offenders once, reviewed, and
  then shrink as files are touched.
- When an agent edits a legacy allowlisted file, the expected cleanup is:
  migrate the touched raw selectors that have semantic equivalents, remove the
  file from the allowlist if no raw selectors remain, and leave structural
  exceptions documented in code or in the rule option only when necessary.
- Apply plugin hygiene rules from 3a to legacy files immediately. If they fail,
  fix them as part of adopting the plugin.

### 4. Guide: `docs/guides/add-e2e-test.md`

Recipe shape mirrors `add-trpc-procedure.md`:

- Which page object to add/extend, where to put the spec, and which fixture to
  use.
- Selector preference order:
  `getByRole` -> `getByLabel` -> `getByText` -> `getByTestId` ->
  `locator(css)` only with a reason.
- Examples for common Musi surfaces:
  - forms: `getByLabel`
  - buttons/links/menu items/tabs: `getByRole`
  - transient alerts: `getByRole("alert")` or an accessible label
  - canvas/VTT internals: `getByTestId` or a raw locator only when no a11y
    surface exists
- "To explore a route, use the `playwright-cli` skill" and point to both
  tracked skill paths; do not duplicate the whole quickstart.
- Cite `local/e2e-prefer-role-selectors` in the guide; the lint message cites
  the guide path.

### 5. Update `docs/ai-harness.md`

Update the existing Playwright skill row so it reflects tracked shared skills:

- Guides table:
  - `.claude/skills/playwright-cli/SKILL.md` and
    `.codex/skills/playwright-cli/SKILL.md`
    (Behavior / Inferential, paired sensor = Playwright e2e logs and
    Playwright lint rules)
  - `docs/guides/add-e2e-test.md`
    (Behavior / Inferential, paired sensor = `local/e2e-prefer-role-selectors`
    + Playwright e2e)
- Sensors table:
  - `local/e2e-prefer-role-selectors`
    (Behavior / Computational, `bun run lint:changed`, paired guide =
    `add-e2e-test.md`)
  - `eslint-plugin-playwright` rules
    (Behavior / Computational, `bun run lint:changed`, paired guide =
    `add-e2e-test.md` for repo context; rule-level docs are upstream)

### 6. Track migration drift

Because the local selector rule relies on a legacy allowlist, add a small
report-only drift counter in the same leaf unless the implementation is already
too large.

- `scripts/drift/locator-usage.ts`: count raw `.locator(` calls under
  `e2e/**`, grouped by file.
- Surface via `drift:ai` or a narrow `drift:e2e` entry.
- Goal: total raw-locator count and allowlisted file count trend down and never
  increase without review.
- Do not gate CI on this initially. It is visibility for the allowlist, not a
  hard failure.

## Migration policy

- The local selector rule applies to new code by default; legacy files are
  listed in flat-config allowlist entries.
- When an agent edits a legacy file, touch-only migration is expected where the
  semantic replacement is clear.
- No deadline for migrating every selector. The rule, allowlist, and drift
  counter are the nudges.

## Deferred

- **`bun run dev:auth-state` helper.** Only add if documented
  `playwright-cli state-save` / `state-load` still proves slow or flaky.
- **Animation handling.** `getAnimations()`-based waits, CLS via
  `PerformanceObserver`, freezing animations via `prefers-reduced-motion`.
  No current pain point.
- **Generated-tests-via-agent -> independent CI run.** Article pattern; revisit
  only if agent-authored e2e becomes routine.
- **Token-budget agent-browser.** Possible future replacement for Playwright
  CLI; not needed while `snapshot --depth` and scoped snapshots are sufficient.

## Risks & tradeoffs

- **Gitignored shared skill drift.** Today the Claude skill exists locally but
  is ignored. Explicit opt-ins for the Playwright skill are safer than removing
  the broad personal-skill ignores.
- **E2E linting needs TypeScript config work first.** Without that precursor,
  the new rules will appear configured but will not enforce changed e2e files.
- **Components without proper ARIA roles surface as a11y debt.** Migrating to
  `getByRole` exposes missing roles/labels in components. Treat as a side
  benefit; file individual follow-up notes when the fix is larger than the
  touched test.
- **Broad raw-locator detection can be noisy.** Canvas and structural DOM
  checks may need exceptions. Keep those narrow and visible.
- **`eslint-plugin-playwright` adds a devDep.** Actively maintained and widely
  used; acceptable.
- **Legacy allowlist could rot.** The drift counter and review pressure should
  make new allowlist entries visible.
- **Documented interactive login has friction.** Mitigate first with
  `playwright-cli state-save` / `state-load`; add a helper only if needed.

## Effort estimate

| Step                                      | Effort  |
| ----------------------------------------- | ------- |
| 1. Track + mirror skill + Musi quickstart | 1-1.5 h |
| 2. Enable e2e linting / tsconfig          | 0.5-1 h |
| 3a. eslint-plugin-playwright wired        | 0.5-1 h |
| 3b. Local rule + test + allowlist         | 1-1.5 h |
| 3. Fix any legacy hygiene failures        | 0.5-2 h |
| 4. `add-e2e-test.md` guide                | 1 h     |
| 5. `ai-harness.md` rows                   | 15 min  |
| 6. Drift counter                          | 0.5-1 h |
| **Total**                                 | **5-9 h** |

## Success criteria

- `.claude/skills/playwright-cli/` and `.codex/skills/playwright-cli/` are
  tracked shared skills, not ignored local-only files.
- Agent verifying a client change can use `$playwright-cli` plus the Musi
  quickstart to capture an a11y snapshot of any authenticated route without
  taking a screenshot.
- `playwright-cli state-save` / `state-load` path is documented so repeated
  route inspection does not require manual login every time.
- `bun run lint:changed` actually lints changed `e2e/` files.
- `bun run lint:changed` flags new raw CSS-selector use in `e2e/` with a
  message that names `docs/guides/add-e2e-test.md`.
- The guide exists, is referenced from `docs/ai-harness.md`, and points to the
  tracked skill rather than reinventing the inspection workflow.
- Raw `.locator(` count and allowlisted file count are visible and
  non-increasing after the drift counter lands.

## Open questions

- Should the Claude and Codex `playwright-cli` skills stay as copied files, or
  should a small repo script verify/mirror them to prevent drift?
- Does `playwright-cli snapshot --depth=6` give enough fidelity for dense
  screens (character sheet, VTT drawer)? If not, document element-scoped
  snapshots more prominently in the Musi quickstart.
- Are there structural raw-locator patterns that deserve an explicit rule
  option from day one (canvas internals, iframe), or should all existing cases
  start in the legacy file allowlist?
