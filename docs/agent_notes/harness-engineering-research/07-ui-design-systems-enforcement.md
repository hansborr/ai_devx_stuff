# Enforcing UI Design Systems & Standards

> **TL;DR** — When agents write UI, the failure mode is not "ugly code" — it is **plausible invention**: a coding agent will happily hand-roll a `<Button>` with a raw `#3B82F6`, an arbitrary `p-[13px]`, and no `aria-label`, because that satisfies the prompt and looks right in isolation. The fix is the same as everywhere else in harness engineering — **make the design system machine-readable and the standards deterministically enforced** — but UI adds two distinctive levers: a **Storybook MCP server** that feeds the agent your *real* components (so it reuses instead of inventing), and **visual/a11y gates** that catch the rendered-DOM failures lint can never see. Build both: feed the agent the system on the way in, block off-system output on the way out.

**Top actionable takeaways**

- **Expose your component library to the agent via the Storybook MCP server** (`npx storybook add @storybook/addon-mcp`) so it reuses real, documented components instead of hallucinating new ones. Requires **Storybook 10.3+ and a Vite-based framework**.
- **Forbid raw design values in lint, not docs.** `@lapidist/design-lint` flags raw hex/off-token colors; `stylelint-plugin-rhythmguard` enforces spacing/radius/type scale; declare tokens in Tailwind v4's `@theme` (v3: `tailwind.config.js theme`).
- **Push design *and* copy standards into custom ESLint rules** — the error message is the teaching channel for the agent. Add `@typescript-eslint/no-explicit-any` (requires the `typescript-eslint` plugin).
- **Run two layers of a11y:** `jsx-a11y` `flatConfigs.strict` (static AST) *plus* runtime **axe** via the Storybook a11y addon with `parameters.a11y.test = 'error'`. By Deque's own research, automated axe-core scanning detects roughly **~57% of accessibility issues *by volume*** (not 57% of WCAG success criteria); static lint catches a different, smaller slice.
- **Turn stories into tests** with the Storybook Vitest addon, and add **Chromatic + TurboSnap** for visual regression to catch what types and unit tests cannot.

See also: [Overview](00-overview.md) · [Static Analysis & CI/CD Gates](04-static-analysis-and-ci-cd-gates.md) · [Linting for AI](09-linting-for-ai.md)

---

## The core problem: agents invent, they don't reuse

A design system only works if everyone uses it; an agent is the easiest "everyone" to violate it because it has no memory of your conventions and no instinct that "we already have a Button." Left unguided, agents:

- **Re-implement existing components** (a second toast, a third modal) instead of importing yours.
- **Hard-code design values** — raw `#hex`, `rgb()`, magic pixel paddings, one-off Tailwind arbitrary values like `text-[13px]` — bypassing your token scale.
- **Drop accessibility** — missing labels, roles, focus management, contrast — because nothing in the prompt forced it.

The strategy is a **two-sided pipeline**: feed the system *in* (so the agent has the right raw material) and gate violations *out* (so off-system output cannot merge). Neither half suffices alone — a great MCP feed still needs gates because the model is probabilistic, and great gates without a feed just make the agent fail repeatedly.

---

## 1. Feed the system in: machine-readable design systems

### Storybook MCP server (component reuse)

Storybook's MCP addon exposes **Component Manifests** — structured JSON describing your real components (props, variants, stories) — to the coding agent. This is explicit **anti-hallucination** tooling: the agent queries what exists and reuses it rather than inventing a parallel component.

```bash
npx storybook add @storybook/addon-mcp
```

**Hard prerequisites (confidence: high — per Storybook docs):**
- Storybook **10.3+**.
- A **Vite-based framework** (`@storybook/react-vite`, `@storybook/nextjs-vite`). **Webpack-based Storybook is not supported** — on a Webpack build this addon will not work, so plan a migration or use an alternative manifest export.
- **React renderer only (preview).** Per Storybook's docs, the AI capabilities — Component Manifests and the MCP server — are currently supported **only for React projects**; Svelte/Vue renderers are not yet covered, so don't promise this for a non-React design system today.

Pair the MCP server with a clear instruction in `AGENTS.md`/`CLAUDE.md`: *"Before building any UI, query the Storybook MCP server for an existing component; only create a new one if none matches."*

### Don't over-tool the MCP surface

Counterpoint worth heeding: Nx's **"Why we deleted (most of) our MCP tools"** (Feb 2026) found that flooding an agent with many narrow MCP tools *degraded* performance — the model spent budget choosing tools instead of solving the task. Keep the MCP surface **small and high-signal**: a component-manifest lookup earns its place; a dozen overlapping design tools do not. (Confidence: medium — single vendor's experience report, but it aligns with broader "context economy" findings.)

### Make the system machine-readable beyond components

Brad Frost's *Agentic Design Systems in 2026* and Indeed's machine-readable DS work both push the same idea: tokens, component APIs, usage guidelines, and **do/don't rules** should be emitted as data the agent can consume — not just prose in a human design site. If your tokens live only in a Figma file or a PDF, the agent cannot honor them. Export tokens (W3C Design Token format / `@theme`), publish component manifests, and keep machine-readable usage rules adjacent to the code.

---

## 2. Gate violations out: token-aware lint

Prose ("use our tokens") is a probabilistic suggestion; a failing lint rule is a deterministic contract that also *teaches* via its error message. Forbid raw design values at the source.

**Tool-to-capability mapping (be precise — these are not interchangeable):**

| Concern | Tool | What it actually does |
|---|---|---|
| Raw hex / off-token **color** values | **`@lapidist/design-lint`** | Flags raw `#hex`/`rgb()` and values not in your token set |
| **Spacing / radius / type / size / motion** scale discipline | **`stylelint-plugin-rhythmguard`** | Enforces values come from your scale (e.g. `prefer-token`/`use-scale`) |
| Tailwind **arbitrary values** (`p-[13px]`) | rhythmguard's **ESLint companion** (not the stylelint plugin itself) | Catches one-off arbitrary utilities that bypass the scale |

> **Correction vs. source material:** `stylelint-plugin-rhythmguard` is *not* the tool that forbids raw hex colors — that is `@lapidist/design-lint`. rhythmguard targets **spacing/radius/type/size/motion scales**, and Tailwind arbitrary-value detection comes from its **separate ESLint companion**, not the stylelint plugin. Don't expect either tool to do both jobs.

### Declare tokens, then forbid everything else

With Tailwind **v4**, declare tokens CSS-first in the `@theme` directive:

```css
/* app.css — Tailwind v4 */
@import "tailwindcss";

@theme {
  --color-brand-500: oklch(0.62 0.19 256);
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --radius-card: 0.75rem;
}
```

> **Version caveat:** `@theme` is a **Tailwind v4** feature (CSS-first config). On **Tailwind v3** (still widely deployed), tokens live in `tailwind.config.js` under `theme`/`theme.extend`. Pick the path that matches your version — the *principle* (declare tokens centrally, forbid raw/arbitrary values everywhere else) is identical.

Example Stylelint config wiring the token gate:

```js
// stylelint.config.js
export default {
  plugins: ["stylelint-plugin-rhythmguard"],
  rules: {
    "rhythmguard/use-scale": true,           // spacing/radius/type from scale only
    "color-no-hex": true,                    // no raw #hex in CSS
    "declaration-property-value-disallowed-list": {
      "/color/": ["/rgb\\(/", "/^#/"],       // belt-and-suspenders
    },
  },
};
```

---

## 3. Custom ESLint rules: design AND copy as code

The highest-leverage move (per *jw.hn — "Using ESLint to enforce copy and design quality"*) is writing **custom ESLint rules** for your house standards, because **the error message is how you teach the agent**. A rule that says *"Use `<Button>` from `@acme/ui` instead of a raw `<button>`"* both blocks the violation and tells the agent exactly what to do next turn.

Targets that pay off:

- **Component substitution** — ban raw `<button>`/`<a>` where a design-system component exists.
- **Copy/voice standards** — forbid banned phrasings, enforce sentence case, catch "Click here" link text.
- **Type safety** — enable **`@typescript-eslint/no-explicit-any`** (note: this is the fully-qualified rule ID and **requires the `typescript-eslint` plugin** — there is no bare core-ESLint `no-explicit-any`).

```js
// eslint.config.js (flat config)
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

export default [
  jsxA11y.flatConfigs.strict,
  {
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // custom house rules, e.g.:
      // "acme/no-raw-button": "error",
    },
  },
];
```

Write the error messages **for the agent**: imperative, specific, with the correct import path. See [Linting for AI](09-linting-for-ai.md) for the general pattern.

---

## 4. Accessibility gates: two layers, different coverage

A11y is the canonical example of why **static lint alone is insufficient** — a rule can't measure rendered contrast or focus order. Run both layers and understand what each covers.

**Layer 1 — static (build/edit time):** `jsx-a11y` `flatConfigs.strict` catches a class of issues from the AST (missing `alt`, invalid ARIA, etc.). Its own docs are explicit that **static analysis cannot catch everything** and recommend pairing with runtime axe.

**Layer 2 — runtime (rendered DOM):** the **Storybook a11y addon** runs **axe-core** against each rendered story. Fail the build on violations:

```ts
// .storybook/preview.ts
export const parameters = {
  a11y: { test: 'error' }, // violations fail the test run, not just warn
};
```

> **Attribution correction (important):** the widely-cited **~57%** figure is a **Deque (axe-core vendor)** statistic that describes the **runtime DOM scan**, *not* `eslint-plugin-jsx-a11y`. Be precise about what it measures: Deque's *Automated Accessibility Coverage Report* (13,000+ pages/page-states, ~300,000 issues) found **~57.38% of accessibility issues — measured by *issue volume* — are detectable by automated testing** for first-time-audit customers. It is explicitly **not** "57% of WCAG success criteria" (Deque argues volume is the more meaningful metric than the lower success-criteria count), and it is a **vendor figure**, not an independent benchmark. jsx-a11y has no published "57%" number; it is static AST analysis covering a different, smaller slice. So: cite the jsx-a11y repo only for `flatConfigs.strict`, and attribute the ~57% to Deque/axe-core. The honest framing: **runtime axe catches roughly ~57% of accessibility issues by volume (vendor figure); static lint adds coverage at edit time but is not part of that 57%; the remainder still needs manual/assistive-tech review.**

---

## 5. Stories as tests + visual regression

This closes the loop: the same Storybook stories the agent reads become the tests that verify its output.

- **Stories as component tests** — the **Storybook Vitest addon** transforms stories into component tests via *portable stories*, running them in a real browser (Playwright). The agent's `play` functions and assertions execute as tests; one artifact serves docs, agent-context, and test.
- **Visual regression** — **Chromatic + TurboSnap** snapshots stories and flags pixel diffs that types and unit tests will never catch (a token regression, a broken layout). **TurboSnap** snapshots only stories affected by a change (via dependency tracing), cutting cost.

> **Vendor-claim caveat:** Chromatic's "**on average 41% cost savings for the same coverage**" (alongside "up to **85% faster** test runs") is a **vendor marketing figure**, not an independent benchmark — and it is a *cost-efficiency* claim, **not** a measured ~41% reduction in the number of snapshots. TurboSnap only re-snapshots stories in files affected by your git changes, so the actual snapshot/cost reduction **varies per project and is not pinned to 41%**. Treat ~41% as a directional vendor claim, not a guaranteed flat discount. (Confidence: the *mechanism* — snapshot only affected stories — is sound and high-confidence; the *exact percentage* is marketing.)

---

## TypeScript / React / Storybook specifics

- **Storybook version floor:** the MCP addon and the `a11y.test` build-failing behavior assume modern Storybook (**10.3+** for MCP). Verify your version before promising these to a team on an older major.
- **Vite-only *and* React-only constraint** for `@storybook/addon-mcp` is the single most common gotcha — Webpack setups need to migrate to `nextjs-vite`/`react-vite` first, and the manifests/MCP capabilities are currently in preview for **React projects only** (no Svelte/Vue support yet).
- **Flat config everywhere:** `jsx-a11y.flatConfigs.strict` and `typescript-eslint` assume ESLint flat config (`eslint.config.js`). Legacy `.eslintrc` users must migrate or use the `extends` shims.
- **`@typescript-eslint/no-explicit-any`** needs `typescript-eslint` installed and (for type-aware rules generally) `parserOptions.project` pointed at your `tsconfig`.
- **Portable stories** (Vitest addon) work best with the React renderer + Vite; check renderer support for Svelte/Vue before committing.
- **Tailwind v3 vs v4** changes *where tokens live* (`@theme` vs `tailwind.config.js`) — your lint rules and any token-export step must target the right one.

---

## Debates & trade-offs (honest)

- **MCP feed vs. tool bloat.** A component-manifest MCP demonstrably reduces invention, but Nx's experience warns that *more* MCP tools can hurt. Net: adopt the manifest lookup, resist piling on. (Medium confidence.)
- **Custom ESLint rules are real maintenance.** They are the best teaching channel for agents, but each rule is code you own and debug. Start with the highest-frequency violations (raw button, raw hex, banned copy) rather than boiling the ocean.
- **Visual regression has a flake/cost tax.** TurboSnap mitigates cost; flake (font loading, animation timing) still needs discipline (freeze animations, deterministic data). The coverage it adds over unit tests is real and worth the tax for design-system-critical UI.
- **Automated a11y ≠ accessible.** ~57% by issue volume (axe/Deque vendor figure) + static lint is a floor, not a ceiling. The remaining issues — keyboard traps, meaningful labels, screen-reader semantics — still require human/AT testing. Don't let a green a11y gate imply "accessible."

---

## Freshness (2026)

**Current (post-late-2025 model jump):**
- **Storybook MCP server** (10.3+) and **Component Manifests** are the live, vendor-recommended way to feed agents a design system — this is genuinely new and specific to the agentic era.
- **Storybook `a11y.test = 'error'`** to *fail builds* (not just warn) and the **Vitest addon / portable stories** model are current.
- **Tailwind v4 `@theme`** CSS-first tokens are the current direction; v3 `tailwind.config.js` is still common and not deprecated overnight.
- **Brad Frost's "agentic design systems"** framing (machine-readable DS) is the current mental model.

**Now-stale / watch out:**
- **Webpack-only Storybook** assumptions — the best agent tooling is Vite-gated.
- **Legacy `.eslintrc`** config — flat config is the default for the rules above.
- **"57% = full a11y coverage"** framing was always wrong and remains so; treat it as a Deque/axe-core runtime figure measuring *issue volume* (not WCAG success criteria), and a vendor stat at that.
- **Vendor percentages** (TurboSnap "41%") age and vary — cite the mechanism, not the number.

---

## Sources

- [Storybook — AI best practices](https://storybook.js.org/docs/ai/best-practices) — MCP addon, Component Manifests, anti-hallucination guidance (accessed 2026-06).
- [Storybook 10.3 release](https://storybook.js.org/blog/storybook-10-3/) — MCP addon availability and version floor (2026).
- [Storybook — accessibility testing docs](https://storybook.js.org/docs/writing-tests/accessibility-testing) — a11y addon, `parameters.a11y.test`, axe-core integration (accessed 2026-06).
- [Deque — Automated Accessibility Coverage Report](https://www.deque.com/automated-accessibility-coverage-report/) — source of the ~57.38% figure (issues by volume, first-time-audit customers; vendor study, 13,000+ pages / ~300,000 issues) (accessed 2026-06).
- [Brad Frost — Agentic Design Systems in 2026](https://bradfrost.com/blog/post/agentic-design-systems-in-2026/) — machine-readable design systems (2026).
- [Indeed / Into Design Systems — AI design system MCP example](https://intodesignsystems.substack.com/p/ai-design-system-mcp-example) — machine-readable DS in practice.
- [Deslint — Forbidding Tailwind arbitrary values](https://deslint.com/blog/tailwind-arbitrary-values) — token-aware lint, `@theme` (accessed 2026-06).
- [eslint-plugin-jsx-a11y (GitHub)](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y) — `flatConfigs.strict`; static-analysis limitations (accessed 2026-06).
- [jw.hn — Using ESLint to enforce copy and design quality](https://jw.hn/eslint-copy-design-quality) — custom rules as teaching channel.
- [Chromatic — TurboSnap](https://www.chromatic.com/features/turbosnap) — affected-story snapshotting; "on average 41% cost savings" / "up to 85% faster" vendor cost-efficiency claims, not a fixed snapshot-count reduction (accessed 2026-06).
- [Nx — Why we deleted (most of) our MCP tools](https://nx.dev/blog/why-we-deleted-most-of-our-mcp-tools) — keep MCP surface small (Feb 2026).
