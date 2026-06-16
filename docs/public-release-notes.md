# Public Release Notes

This branch resolves the known SRD/public-sharing review items tracked before
publication.

## Agent Harness And Notes

Decision: keep `.codex/`, `.claude/`, and `docs/agent_notes/` tracked in git for
now. They are part of the repository's development harness: scripts, generated
harness docs, path policies, and tests reference those paths directly.

They are not needed in generated source archives, so `.gitattributes` marks them
`export-ignore`:

- `.codex/`
- `.claude/`
- `docs/agent_notes/`

On 2026-06-16, a keyword scan over those tracked files found example/test
passwords, token placeholders, and documentation mentions, but no real secret
material. Run a dedicated secret scanner before public publication if the
release process changes or if private operational notes are added later.

## Dependency Licenses

Run `bun run audit:licenses` after `bun install`. The current production
dependency audit is clean for strong copyleft and copyleft-review licenses; see
`docs/dependency-license-audit.md` for the snapshot and the separate full
installed-tree dev-tooling review.
