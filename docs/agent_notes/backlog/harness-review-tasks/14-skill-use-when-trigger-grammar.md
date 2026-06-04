# 14 - Skill trigger grammar

Status: Parked
Track: D (docs/feedforward)
Size: small
Depends on: none
Blocks: none

## Goal

Rewrite the tracked skill descriptions so the first sentence states capability
and the second sentence starts with `Use when ...`.

## Background

Skill descriptions are router metadata. The review recommends doing this only
for the existing skills now, and deferring guide frontmatter until a real
`docs:intel` task lands.

## Seams to touch

- `.codex/skills/ts-graph/SKILL.md`
- `.codex/skills/playwright-cli/SKILL.md`
- Any tracked `.claude/skills/*/SKILL.md` mirror that exists in the current
  tree.

## What to do

1. Reconfirm which skill files are tracked.
2. For each tracked skill, make the frontmatter description two sentences:
   - Sentence 1: what the skill can do.
   - Sentence 2: `Use when ...` with concrete triggers.
3. Do not rewrite the bodies except to fix obvious drift caused by the
   description change.

## Testing

- `bun run format:changed:check`
- `git status --short --ignored .claude/skills .codex/skills` to make sure the
  intended files are tracked and no ignored local skill was accidentally copied.

## Out of scope

- Adding new skills.
- Building `docs:intel`.
- Adding frontmatter to every guide.
