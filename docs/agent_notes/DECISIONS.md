# Decisions

ADR-lite record of non-obvious cross-cutting choices. Each entry explains
*why* a pattern exists so future agents do not relitigate it or work around it.

**When to read**: when a task is about to cut against one of these patterns.
This should not be mandatory reading on every session.

**When to add**: when you make or discover a choice whose reasoning lives only
in a PR description, finished-work note, or tribal memory. Cite the source if
one exists. Do not duplicate the source's full narrative.

**When to split**: when this file gets too long, split by domain and leave this
file as an index. Do not trim entries just to reduce length; the reasoning is
the asset. Superseded decisions should move to an archive with a "Superseded
by ..." note, not disappear.

Entry template:

```markdown
## <Title>

Status: Active | Superseded by <link> | Archived
Domain: <domain>

### Context
Why this came up.

### Decision
What we chose.

### Consequences
What this implies for future code, including how to apply it.

### References
Files, tests, finished-work notes, docs, PRs, or commits.
```
