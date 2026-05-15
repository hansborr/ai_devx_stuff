# Musi: inspect an authenticated route

Use `playwright-cli` snapshots as the default browser inspection surface for
Musi. Start broad with shallow page snapshots, then switch to element-scoped
snapshots for dense screens.

## Get the URL

- Primary checkout default: `http://localhost:8000`.
- Secondary worktree: run `bun run worktree:status`. If it prints
  `allocation: server=<server> client=<client> ...`, use
  `http://localhost:<client>`.

## Get test credentials

- Run `bun playwright test --project=setup` if `.auth/user-info.json` is
  missing.
- Read `.auth/user-info.json` for `email`, `password`, and `displayName`.

## First authenticated inspection

```bash
playwright-cli open http://localhost:8000/login
playwright-cli snapshot --depth=4
playwright-cli fill <email-ref> "<email from .auth/user-info.json>"
playwright-cli fill <password-ref> "<password>"
playwright-cli click <submit-ref>
playwright-cli state-save .auth/playwright-cli-state.json
playwright-cli goto http://localhost:8000/<route-under-inspection>
playwright-cli snapshot --depth=6
```

## Returning to an authenticated session

```bash
playwright-cli open http://localhost:8000
playwright-cli state-load .auth/playwright-cli-state.json
playwright-cli goto http://localhost:8000/<route-under-inspection>
playwright-cli snapshot --depth=6
```

## Token budgeting

- Use `--depth=<n>` for whole-page snapshots.
- Use element-scoped snapshots, such as `playwright-cli snapshot e34`, for
  dense screens such as the character sheet and VTT drawer.

## Selector discipline while inspecting

- Prefer refs from snapshots for interaction.
- Use role locators only when refs are stale.
- Use CSS only for canvas or structural debugging.
