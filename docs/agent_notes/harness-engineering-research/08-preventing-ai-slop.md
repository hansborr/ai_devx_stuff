# Preventing "AI Slop"

> **TL;DR** — "AI slop" is low-value agent output — plausible-looking code, tests, and PRs that nobody fully understands — that accumulates because agents emit it faster than humans can comprehend it. The defense is not better prompts; it is a **comprehension contract** (never merge what you can't explain) backed by **deterministic gates** (linters, strict TS, mutation tests, dead-code detection) and **second-pass cleanup agents** that strip the tell-tale signatures. The unit you are protecting is human understanding per merge, so the winning moves shrink each change (small stacked PRs), measure real test quality (mutation score, not line coverage), and make "you merge it, you own it" a hard rule rather than an aspiration.

**Top actionable takeaways**

- **Adopt the golden rule as a merge gate:** never commit code you couldn't explain to someone else (Willison). Make it a checklist item on every PR, human- or agent-authored.
- **Run deterministic slop detectors in CI:** `dabit3/deslop` (0–100 slop score, fails CI above a threshold), `peakoss/anti-slop` (34 heuristic PR checks, auto-close), and `knip` for dead code.
- **Don't trust line coverage on AI tests** — gate on **mutation score** (Stryker). High coverage with weak assertions is itself a slop signature.
- **Enforce test-first with `nizos/tdd-guard`** so agents can't write implementation before a failing test exists.
- **Keep PRs small and stacked.** A large all-green diff is comprehension debt, not progress.
- **Add a second-pass `/simplify` + `/deslop` step** to remove defensive boilerplate, divider comments, and AI signatures — but lock behavior with tests *first*.
- **Make ownership explicit:** the human who merges is accountable for the diff. Avoid AI-reviews-AI as the *only* gate.

See also: [Overview](00-overview.md) · [Codebase Structure for Agents](03-codebase-structure-for-agents.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [UI Design Systems Enforcement](07-ui-design-systems-enforcement.md) · [Linting for AI](09-linting-for-ai.md)

---

## What "slop" actually is (and why it compounds)

Slop is output that *looks* done but carries no comprehension. Three properties make it dangerous specifically with agents:

1. **It is fast.** An agent produces a 600-line green PR in minutes. The reviewer's budget did not scale with it. Addy Osmani's framing is **"comprehension debt"**: the gap between code that exists in your repo and code anyone actually understands. (Confidence: high that the concept and term are Osmani's; the specific claim that *"a large green PR is comprehension debt"* is an editorial extension/paraphrase of his argument, not a direct quote.)
2. **It is plausible.** Slop passes a skim. Hallucinated APIs, near-duplicate helpers, and over-defensive boilerplate all read as "normal code," so review-by-reading misses them — which is exactly the failure Mark Seemann describes for AI-generated *tests*.
3. **It accumulates silently.** Each unreviewed merge raises the baseline of code nobody owns, and the next agent reads that code as an example to imitate. Drift becomes self-reinforcing.

The corollary that drives every practice below: **you cannot out-prompt slop; you can only out-gate it.** Probabilistic instructions in `AGENTS.md` ("write clean code") are suggestions; a non-zero exit code is a contract.

---

## 1. The golden rule + a comprehension gate

The most-cited human-side defense is Simon Willison's golden rule from his *vibe engineering* essay: he won't commit code he couldn't explain to someone else. This is a **comprehension gate**, not a style rule.

Make it operational without inventing false precision:

- Add one line to your PR template, applied to human- and agent-authored PRs alike:
  > "I can explain every changed file in this PR. Files I cannot explain: ______"
- If that blank is non-empty, the PR is not ready — split it, simplify it, or read until you can.
- For large diffs, prioritize reading the files with the **largest changes** and the highest-risk surfaces (auth, data access, money, migrations) first; that is where unexplained code does the most damage.

> **Caveat (fact-check):** A widely-circulated version of this practice attaches a "rate comprehension 1–5, reject below 3" scale and a specific "read the largest-diff files" rule to Willison. **Neither the 1–5/reject-below-3 scale nor the largest-diff line is in Willison's essay** — they appear to be invented specificity. Use the qualitative golden rule as the source of truth; the "largest-diff first" triage above is reasonable engineering practice, just don't attribute it to Willison.

---

## 2. Deterministic slop detectors in CI

Three real, installable tools turn "this feels sloppy" into a failing check.

### `dabit3/deslop` — slop score on the diff
A CLI (by Nader Dabit) that scans `git diff` for AI code patterns and emits a **0–100 slop score**:

- **0–19** clean · **20–49** cleanup needed · **50+** significant issues
- Issues are weighted: high = 10 pts, medium = 5, low = 1.
- **High severity:** leftover debug `console.log`, function entry/exit logging.
- **Medium:** generic `TODO` placeholders, triple null/undefined checks, empty catch blocks that only log.
- **Low:** verbose obvious comments, section-divider comments, redundant `return undefined`, explicit boolean comparisons (`=== true`), unnecessary `try/catch` wrappers, `Promise.all` with a single promise.

It supports `--json` and **exits 1 when high-severity issues are found**, so it drops into CI directly:

```yaml
# .github/workflows/slop.yml
- name: Deslop diff scan
  run: npx deslop --json --base origin/main > deslop.json || (cat deslop.json && exit 1)
```

### `peakoss/anti-slop` — PR-level heuristic gate
A GitHub Action that runs **34 checks** and can **auto-close** failing PRs. It is *not* just a size gate — that framing undersells it. Categories include:

- Branch patterns (source/target), **size** (changed files + lines — only 2 of the 34),
- PR quality (negative reactions, maintainer-edit permission),
- Title (conventional-commit format), description (length, **emoji count**, code refs, linked issues, blocked terms),
- PR-template compliance, commit messages (length, conventional format, author match),
- File checks (extensions, paths, final newlines, comment counts),
- **User signals** (account age, fork velocity, profile completeness), and historical merge-ratio across repos.

Tune the `max-failures` threshold (default **4**, range 1–25) before enabling auto-close, or you will close legitimate PRs:

```yaml
- uses: peakoss/anti-slop@v1
  with:
    max-failures: 6        # higher = more lenient; default is 4
    action-on-failure: comment   # start here; switch to "close" once tuned
```

> **Honest trade-off:** the account-age / profile / emoji heuristics are aimed at *drive-by AI spam on open-source repos*. On an internal team they will mostly fire on size, template, and commit-message checks — disable the contributor-reputation checks there to avoid noise.

### `knip` — delete the slop that's already merged
Dead code is the residue of slop: abandoned helpers, unused exports, orphaned files an agent generated and never wired up. `knip` finds **unused files, dependencies, and exports**. Gate it in CI and run it periodically as a deletion pass.

```jsonc
// knip.json
{ "entry": ["src/main.ts", "src/**/*.stories.tsx"], "project": ["src/**/*.{ts,tsx}"] }
```

> **Source discipline:** `knip` documents *only* the dead-code tool. Do not cite `knip.dev` for the golden rule, ESLint rules, hooks, or Storybook guidance (a common misattribution). Each belongs to its own source — see [Sources](#sources).

---

## 3. Linters, strict TypeScript, and blocking hooks

The cheapest slop filter is the type system plus a couple of lint rules that ban the agent's favorite escape hatches.

- Ban the two slop accelerators in ESLint:

```jsonc
// eslint.config.js (typescript-eslint)
rules: {
  "@typescript-eslint/no-explicit-any": "error",   // any is how slop bypasses the typechecker
  "@typescript-eslint/ban-ts-comment": "error"     // no @ts-ignore to silence real errors
}
```

- Turn on strict TS and the flags `strict` omits (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`). See [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) for the full flag set.
- Wire it into the **agent's own loop** with a Claude Code `PostToolUse` hook so the agent self-corrects before you ever see the diff: run `eslint --fix` and `prettier`, then a **blocking `tsc --noEmit`** (non-zero exit blocks the turn).

```jsonc
// .claude/settings.json (sketch — see Custom Hooks for the full shape)
"hooks": {
  "PostToolUse": [{
    "matcher": "Edit|Write",
    "hooks": [{ "type": "command",
      "command": "eslint --fix \"$FILE\" && prettier --write \"$FILE\" && tsc --noEmit" }]
  }]
}
```

The key property: the same gate that blocks a bad human PR is the fast, machine-readable signal an agent loops against. See [Custom Hooks](12-custom-hooks.md) for the exact hook contract.

---

## 4. Tests: mutation score over coverage, and test-first enforcement

AI-generated tests are a *premier* slop vector because they manufacture the appearance of safety. Mark Seemann's argument in *AI-generated Tests as Ceremony* is the load-bearing one: a test you never watched fail proves nothing — it's "cargo-cult" assurance.

Two concrete defenses:

1. **Gate on mutation score (Stryker), not line coverage.** High coverage with weak assertions — tests that exercise code without asserting on its behavior — is itself a slop signature: the lines run, but nothing is actually checked. Mutation testing measures whether your tests *detect injected bugs*, which is the property you care about.

   > **Caveat (fact-check):** A circulating claim that "AI tests give 93% coverage but 34% mutation" is **not in the cited ploeh.dk post** (which contains *no* coverage or mutation numbers at all) and could not be sourced anywhere. Treat the *qualitative* point — high coverage can mask low assertion quality — as well-founded, but **do not cite the 93/34 figures as fact.** Run Stryker on your own suite to get real numbers for your codebase.

2. **Enforce test-first with `nizos/tdd-guard`.** It installs as a Claude Code plugin and **blocks implementation written before a failing test exists**, and blocks code that goes beyond what current tests require. It supports Vitest, Jest, Storybook, pytest, PHPUnit, Go, Rust (RSpec/Minitest too) — so the same discipline spans your stack. This kills the most common test-slop pattern: code first, then a test reverse-engineered to pass it.

---

## 5. A second-pass simplify / deslop step

Generation optimizes for "works," not "minimal." A dedicated cleanup pass removes the bloat:

- **Claude Code `/simplify`** spawns **three parallel sub-agents** (reuse, quality/issues, simplification & efficiency) to find duplication, dead branches, and over-engineering. It is a *quality* pass — it does **not** hunt for bugs; pair it with a code-review pass for that.
- **`/deslop`** strips AI signatures: divider comments, redundant docstrings, over-defensive `try/catch`, explicit boolean comparisons.

**Hard prerequisite:** lock behavior with tests *before* running either, or the cleanup pass silently changes semantics. Pin the suite green, run `/simplify`, re-run the suite, then review the diff against the golden rule.

A practical anti-slop review checklist (cheap, high-yield):

- [ ] **Should this exist?** Is the whole change necessary, or scope creep?
- [ ] **Reuse vs. duplicate** — does a helper/component for this already exist? (`/simplify` reuse agent, Knip, Storybook MCP)
- [ ] **Hallucinated APIs** — every imported symbol/prop resolves to something real.
- [ ] **Strip defensive boilerplate** — no triple null checks, empty catches, single-promise `Promise.all`.
- [ ] **I can explain every changed file.** (the golden rule)

---

## 6. Small stacked PRs and explicit ownership

- **A large green PR is comprehension debt.** Shrink the review unit: small, **stacked** PRs that each do one thing and can be understood in full. `anti-slop`'s size checks and your own CI can flag oversized diffs, but the cultural rule matters more — split before you ship.
- **You merge it, you own it.** The human who clicks merge is accountable for the whole diff, not just the lines they wrote. (Confidence: medium — this is a sound *governance opinion*, widely advocated, but not a sourced empirical finding. State it as your team's policy, not as a cited fact.)
- **Be wary of AI-reviews-AI as the only gate.** Using an agent to review another agent's PR can deepen the accountability gap if no human ever forms an independent understanding. AI review is fine as a *first pass*; it does not discharge the golden rule. (Confidence: medium — opinion, not sourced data.)
- **Weakening CI to land a PR is a blocker, not a workaround.** If an agent (or human) proposes lowering `--max-warnings`, raising `max-failures`, or skipping a check to merge, that is the slop alarm — treat the CI-weakening diff as the thing under review.

---

## TypeScript / React / Storybook specifics

- **Storybook MCP server (10.3, React-first):** wire it up so agents read *real* component props, stories, and tests instead of hallucinating props and re-implementing existing components — duplication is a primary slop source. See [UI Design Systems Enforcement](07-ui-design-systems-enforcement.md) and [TS/React/Storybook](13-typescript-react-storybook.md).
- **Stories as tests:** run CSF3 `play` functions as browser tests via `@storybook/addon-vitest` (with axe a11y). A red story is a deterministic anti-slop signal for UI work, and `tdd-guard` supports the Storybook reporter.
- **Strict TS + `no-explicit-any` + `ban-ts-comment`** catch the most common React slop: `any`-typed props and `@ts-ignore`'d event handlers.
- **`knip` + `jscpd`** catch the React-specific residue: unused components/exports and copy-pasted near-duplicate components.
- **`AGENTS.md` as prevention:** a lean, hierarchical `AGENTS.md` documenting "one pattern per job" reduces slop at generation time — but treat its productivity benefit as *promising, not proven*, and remember it's a probabilistic nudge that the gates above still have to backstop.

---

## Freshness (2026)

- **Current:** Deterministic gating as the primary control surface; mutation testing over line coverage; second-pass `/simplify` + `/deslop`; test-first enforcement (`tdd-guard`); Storybook **10.3** MCP server (React-only today). These reflect the post-late-2025 reality where frontier agents emit code far faster than review scales, making comprehension — not generation — the bottleneck.
- **Watch / evolving:** `peakoss/anti-slop`'s contributor-reputation heuristics are tuned for open-source spam and may over-fire on internal teams; `dabit3/deslop`'s pattern list is heuristic and will need periodic tuning as model output styles shift; Storybook MCP framework coverage beyond React is expanding.
- **Now stale / unreliable:** Any *specific numeric* slop benchmarks circulating without a primary source — notably the "93% coverage / 34% mutation" and "comprehension 1–5, reject below 3" figures, both of which traced back to **no verifiable source**. The underlying *qualitative* claims hold; the numbers do not. Line-coverage-as-quality-gate is the stale practice these supersede.

---

## Sources

- Simon Willison, [Vibe engineering](https://simonwillison.net/2025/Oct/7/vibe-engineering/) — the golden rule: won't commit code you couldn't explain (Oct 7, 2025). *(Substack mirror: simonw.substack.com/p/vibe-engineering.)*
- Addy Osmani, [Comprehension debt](https://addyosmani.com/blog/comprehension-debt/) — the gap between code that exists and code anyone understands (~Mar 2026).
- Mark Seemann, [AI-generated Tests as Ceremony](https://blog.ploeh.dk/2026/01/26/ai-generated-tests-as-ceremony/) — why tests you never saw fail prove nothing (Jan 26, 2026). *(Contains no coverage/mutation statistics.)*
- [dabit3/deslop](https://github.com/dabit3/deslop) — CLI, 0–100 slop score, `--json`, exits 1 on high-severity (Nader Dabit).
- [peakoss/anti-slop](https://github.com/peakoss/anti-slop) — GitHub Action, 34 heuristic checks, auto-close, `max-failures` default 4 (range 1–25).
- [nizos/tdd-guard](https://github.com/nizos/tdd-guard) — Claude Code plugin blocking implementation-before-tests; Vitest/Jest/Storybook/pytest/Go/Rust/PHP.
- [Knip](https://knip.dev/) — unused files, dependencies, and exports (deletion pass only).
- [Storybook AI best practices](https://storybook.js.org/docs/ai/best-practices) — Storybook MCP server for component reuse + test self-correction.
- typescript-eslint: [`no-explicit-any`](https://typescript-eslint.io/rules/no-explicit-any/) · [`ban-ts-comment`](https://typescript-eslint.io/rules/ban-ts-comment/).
- Claude Code: `/simplify` (three parallel sub-agents — reuse, quality, simplification) and `/deslop` slash commands.
