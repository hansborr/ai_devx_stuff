# Public Release Notes

This branch resolves the known SRD/public-sharing review items tracked before
publication.

## Agent Harness And Notes

Decision: keep `.codex/`, `.claude/`, and `docs/agent_notes/` tracked in git for
now. They are part of the repository's development harness: scripts, generated
harness docs, path policies, and tests reference those paths directly.

Generated source archives should include the copyable harness config that the
public harness docs reference, while still excluding private process notes by
default. `.gitattributes` marks those trees `export-ignore`, then carves back the
public subset:

- `.codex/config.toml`, `.codex/hooks.json`, `.codex/hooks/`, and
  `.codex/skills/`
- `.claude/settings.json`, `.claude/hooks/`, `.claude/output-styles/`, and
  `.claude/skills/`
- `.copilot/hooks/`

The generated harness docs `docs/generated/lint-coverage-map.md` and
`docs/generated/observed_flaky_tests.md` are not carved back — they are never
`export-ignore`d in the first place, so they ship in every archive; generated
and hook-facing harness docs point at those references.

The rest of `docs/agent_notes/` remains export-ignored because it contains
process notes such as recent-history logs, active backlog packs, and decision
handoff material. Use a full git clone when those notes are part of the review.

On 2026-06-16, a keyword scan over those tracked files found example/test
passwords, token placeholders, and documentation mentions, but no real secret
material. Run a dedicated secret scanner before public publication if the
release process changes or if private operational notes are added later.

## Dependency Licenses

Run `bun run audit:licenses` after `bun install`. The current production
dependency audit is clean for strong copyleft and copyleft-review licenses; see
`docs/dependency-license-audit.md` for the snapshot and the separate full
installed-tree dev-tooling review.
