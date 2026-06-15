# MCP & Tool Design for Agents

**TL;DR.** A tool is an API consumed by a non-deterministic reader with a finite context budget, so the design rules differ from human-facing APIs: build fewer, higher-level, workflow-shaped tools; shape every response for token efficiency; write descriptions as if onboarding a new colleague; defer-load the rest; and treat the tool surface as a security boundary. The biggest wins are structural — progressive disclosure cuts ~85% of definition tokens and code-execution wrappers turn 150k-token intermediate results into ~2k — but the highest-frequency defect is mundane: ~97% of real-world MCP tool descriptions carry at least one "smell." Right-size all of it against evals, not intuition.

**Top actionable takeaways**
- Consolidate raw API calls into task-shaped tools; prefer `search_*`/`filter_*` over `list_all_*`; keep a small set of high-impact tools loaded and defer the rest.
- Shape results: return high-signal fields only, expose a `response_format` enum (`concise`/`detailed`), paginate server-side, and stay under Claude Code's **25,000-token** tool-response cap. Return a `ResourceLink` for large blobs.
- Write descriptions for a new hire: unambiguous params, strict schemas, worked examples; surface failures as MCP `isError` results with the *next action*, not a stack trace.
- Use progressive disclosure: `defer_loading` / Tool Search Tool (**~85%** token reduction) and Code Execution with MCP (150k→~2k on the worked example).
- Pin and scan servers, scope tokens, sandbox execution, front everything with a gateway, and never use wildcard allowlists — distinct attack classes (description injection, rug-pull, supply-chain prompt injection) all land through the tool surface.

---

## 1. Fewer, higher-level, workflow-shaped tools (high confidence)

The reflex of wrapping each REST endpoint 1:1 produces a tool surface that is large, low-signal, and easy for the agent to misuse. Anthropic's guidance is to **build tools around the task, not the API**: consolidate multi-call workflows into a single tool that returns the thing the agent actually needs.

- Replace `list_users` + `list_events` + `create_event` chains with a `schedule_meeting` tool that does the orchestration server-side.
- Prefer **`search_*` / `filter_*` over `list_all_*`**. A list-everything tool forces the agent to page through and reason over noise; a search tool pushes that work to the server where it is cheap and deterministic.
- Keep a **small set of high-impact tools** loaded and consolidate or defer the rest. (Note: the cited Anthropic article recommends consolidation and eval-driven right-sizing but does *not* publish a specific "3–5 tools" threshold — treat any such number as a heuristic, not a sourced figure.)
- **Right-size against evals.** Whether two tools should be one, and which fields a response needs, is an empirical question. Build a small eval set of realistic tasks and measure tool-call count, token cost, and success rate before freezing the surface.

Trade-off: workflow tools encode opinions. A `schedule_meeting` tool that always books a 30-minute slot is wrong for teams that default to 25. Parameterize the genuinely variable bits and document the defaults; don't fold every edge case back into a kitchen-sink tool.

## 2. Shape results for token efficiency (high confidence)

Every token a tool returns competes with the agent's reasoning budget and is re-read on every subsequent turn. Design the *response* as deliberately as the request.

- **High-signal fields only.** Strip internal IDs, timestamps, and pagination cruft the agent will never use. If a field is there "just in case," it is costing tokens on every call.
- **Offer a `response_format` enum** with `concise` and `detailed` values so the agent (or caller) can opt into verbosity only when needed; default to `concise`.
- **Paginate server-side** and return small pages. Push filtering and ranking to the server.
- **Respect the response cap.** Claude Code truncates tool responses at **25,000 tokens**; a tool that can exceed this must page or summarize rather than rely on truncation.
- **Return a `ResourceLink` for large data.** The MCP spec (2025-06-18) lets a tool return a reference to a resource instead of inlining a multi-megabyte payload; the agent fetches it only if needed.

```jsonc
// Tool result: high-signal + opt-in verbosity + link-out for bulk data
{
  "content": [
    { "type": "text", "text": "3 open incidents (showing concise view)." },
    { "type": "resource_link",
      "uri": "incidents://export/2026-06-15.csv",
      "name": "full_incident_export",
      "mimeType": "text/csv" }
  ],
  "isError": false
}
```

```jsonc
// Input schema fragment: give the agent the throttle
{
  "response_format": {
    "type": "string",
    "enum": ["concise", "detailed"],
    "default": "concise",
    "description": "Use 'detailed' only when you need full field-level data."
  }
}
```

## 3. High-signal descriptions and actionable errors (high confidence)

The single most common real-world defect is in the *prose*, not the schema. Hasan et al. (arXiv 2602.14878) audited **856 tools across 103 MCP servers** and found **97.1%** contain at least one description "smell" (ambiguity, missing constraints, no examples, inconsistent naming). The fixes are cheap:

- **Write for a new colleague.** Assume zero prior context. State what the tool does, when to use it (and when *not* to), units, formats, and side effects.
- **Strict schemas.** Constrain enums, formats (`date-time`, `email`), and required fields. A loose schema turns into runtime ambiguity the model has to guess through.
- **Embed worked examples** in the description — one realistic input/output pair removes most ambiguity faster than prose.
- **Make errors actionable.** Surface failures as MCP `isError: true` results whose text tells the agent the *next step* ("date must be ISO-8601, e.g. 2026-06-15"), not a raw exception. The agent reads this and retries; a stack trace just gets echoed back.

```jsonc
// Actionable error: the agent can recover without a human
{
  "content": [{ "type": "text",
    "text": "create_event failed: 'start' (\"6/15\") is not ISO-8601. Use YYYY-MM-DDTHH:MM:SSZ, e.g. 2026-06-15T14:00:00Z." }],
  "isError": true
}
```

## 4. Progressive disclosure (high confidence)

Loading every tool definition up front is the dominant context tax once you have more than a handful of servers. Two complementary techniques attack it:

- **Tool Search Tool / `defer_loading`** — defer most tool *definitions* and let the agent search for them on demand, loading only the ones a task needs. Anthropic reports an **~85% reduction in token usage** from this. (Source: Anthropic's *advanced tool use* article, which documents the `defer_loading` parameter and the 85% figure — note this is a *different* article from the code-execution piece below.)
- **Code Execution with MCP** — expose MCP servers as a code API the agent calls inside a sandbox, so large intermediate results stay in the execution environment instead of the context window. Anthropic's worked example collapses a **150,000-token** intermediate result to roughly **2,000 tokens** (a ~98.7% reduction) by filtering in code before returning.

```ts
// Code-execution pattern: filter in the sandbox, return only what matters
const rows = await mcp.bigquery.query("SELECT * FROM events");  // ~150k tokens, stays local
const summary = rows
  .filter(r => r.severity === "critical")
  .map(r => ({ id: r.id, ts: r.ts }));                          // ~2k tokens, returned
return summary;
```

Trade-off: code execution needs a real sandbox and raises the security stakes (see §6). `defer_loading` adds a search round-trip, so for a tiny, stable tool set it can be net-negative — measure against your eval set.

## 5. TypeScript / React / Storybook specifics

- **SDK & strict schemas.** Use the official `@modelcontextprotocol/sdk` and define input schemas with **Zod** (`server.tool(name, zodSchema, handler)`). Zod gives you compile-time types *and* runtime validation from one source, which directly attacks the §3 "loose schema" smell. Export the inferred types so callers stay in sync.
- **Discriminated unions for `response_format`.** Model the `concise`/`detailed` variants as a TS discriminated union so the handler's return type narrows correctly and you can't accidentally return detailed fields in concise mode.
- **Token budgeting in tests.** Add a unit test that asserts a representative response serializes under the **25,000-token** cap (approximate with a chars/4 heuristic or a tokenizer). Treat a regression as a failing build, the same way you'd treat a broken type.
- **Storybook MCP.** If you run the Storybook MCP addon to give agents component context, scope it tightly and keep its tool descriptions current — a design-system MCP is exactly the kind of high-fan-out surface where a stale or ambiguous description (the 97% smell) silently degrades every component the agent touches. See [13-typescript-react-storybook.md](13-typescript-react-storybook.md) and [07-ui-design-systems-enforcement.md](07-ui-design-systems-enforcement.md).
- **React rendering.** When a tool feeds a UI (e.g. rendering tool results in a chat surface), keep the `ResourceLink` pattern: render a link/affordance for bulk data rather than dumping it into the message tree.

## 6. Treat tools as a security boundary (high confidence)

A tool is an attacker's entry point into your agent's privileges. Several *distinct* attack classes — often loosely lumped together — all land through the MCP surface; keep them separate when reasoning about defenses:

- **Tool poisoning (description injection).** Invariant Labs' original definition: hidden malicious instructions embedded in a tool's *description* field, which the model reads and obeys while the human sees only the innocuous name. Mitigation: pin server versions, checksum/scan descriptions, and review diffs.
- **Rug-pull / MCPoison — `CVE-2025-54136` (CVSS 7.2).** A *different* mechanism: an already-approved MCP config is silently swapped *after* approval (a config-file-swap RCE first reported in Cursor). The lesson is that approval-time trust is not run-time trust — re-validate configs, not just first-use prompts. Do **not** conflate this with description-injection tool poisoning; they are related but mechanically distinct.
- **STDIO RCE (2026).** Remote code execution via the STDIO transport — sandbox the server process; never run an untrusted MCP server with host privileges.
- **Clinejection (disclosed Feb 2026).** Not an MCP-protocol bug: an **indirect-prompt-injection + broad-tool-permission supply-chain** compromise, where a triage bot with broad Bash/Write/Edit permissions acted on unsanitized GitHub issue content (a tampered package reportedly reached thousands of machines). The lesson generalizes to MCP: broad tool permissions + untrusted input is the lethal combination, regardless of protocol.

**Defenses (apply all):**
- **Pin & scan** every server (version + checksum); review description diffs in CI.
- **Scoped tokens** — give each tool the *minimum* credential; no shared admin tokens.
- **Sandbox** server processes and any code execution (§4); deny host filesystem/network by default.
- **Gateway** all MCP traffic through a proxy that logs, rate-limits, and enforces policy centrally.
- **No wildcard allowlists** — never auto-approve `*`; enumerate permitted tools explicitly.

This is the tool-design slice of a larger story; see [14-security-and-supply-chain.md](14-security-and-supply-chain.md) for the lethal trifecta, OWASP Agentic Top 10, and provenance/egress controls.

## Trade-offs & confidence

| Practice | Confidence | Main trade-off |
|---|---|---|
| Workflow-shaped tools | High | Encodes opinions; needs parameterization |
| Token-shaped responses | High | More server-side logic to maintain |
| New-hire descriptions / `isError` | High | Ongoing upkeep; descriptions go stale (the 97% smell) |
| Progressive disclosure | High | Sandbox + search round-trip cost; can be net-negative for tiny tool sets |
| Tools as security boundary | High | Real operational cost (gateway, scanning, sandboxing) |

The structural numbers (85%, 150k→2k/98.7%, 97.1%, 25,000-token cap) are all sourced and verified below. The "3–5 core tools" heuristic and any per-team threshold are *not* sourced — validate with your own evals.

## Freshness (2026)

Compiled 2026-06-15 from shared verification notes plus the listed sources. **Verified load-bearing figures:** the 25,000-token Claude Code response cap, the `response_format` concise/detailed enum, search-over-list-all and new-hire-description framing (all *writing-tools-for-agents*); the 150k→2k / 98.7% example (*code-execution-with-mcp*); the ~85% `defer_loading` reduction (*advanced-tool-use* — **not** the code-execution article); the 97.1% smell rate across 856 tools / 103 servers (arXiv 2602.14878, real and correctly attributed); `ResourceLink`/`isError` (MCP spec 2025-06-18); `CVE-2025-54136`; the 2026 STDIO RCE; and Clinejection. **Corrected here:** the 85% figure is re-attributed to *advanced-tool-use*; `CVE-2025-54136` is labeled rug-pull/MCPoison, not generic "tool poisoning"; Clinejection is framed as supply-chain prompt injection, not an MCP-protocol flaw; the "3–5 tools" number is downgraded to a heuristic. Re-verify the 2026 STDIO RCE and Clinejection details (snippet-level) once full sources are re-retrievable.

## Sources

- [Writing effective tools for AI agents — Anthropic Engineering](https://www.anthropic.com/engineering/writing-tools-for-agents) (2025) — workflow tools, search-over-list, `response_format`, 25,000-token cap, new-hire descriptions, eval-driven right-sizing
- [Advanced tool use — Anthropic Engineering](https://www.anthropic.com/engineering/advanced-tool-use) (2025) — Tool Search Tool / `defer_loading`, **~85%** token reduction
- [Code execution with MCP — Anthropic Engineering](https://www.anthropic.com/engineering/code-execution-with-mcp) (2025) — 150k→~2k tokens (~98.7% reduction)
- [Model Context Protocol — Tools (spec 2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) (2025-06-18) — `isError`, `ResourceLink`, tool result shape
- [MCP Tool Descriptions Are Smelly! — Hasan, Li, Rajbahadur, Adams, Hassan](https://arxiv.org/abs/2602.14878) (2026-02) — **97.1%** of 856 tools / 103 servers carry ≥1 description smell
- [MCP Security Notification: Tool Poisoning Attacks — Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks) (2025) — description-injection definition + pinning/checksum mitigation
- [Cursor AI Code Editor vulnerability (MCPoison / CVE-2025-54136) — The Hacker News](https://thehackernews.com/2025/08/cursor-ai-code-editor-vulnerability.html) (2025-08) — rug-pull / config-swap RCE (CVSS 7.2)
- [Cline supply-chain attack: prompt injection via GitHub Actions (Clinejection) — Snyk](https://snyk.io/blog/cline-supply-chain-attack-prompt-injection-github-actions/) (2026-02) — indirect-prompt-injection + broad-tool-permission supply-chain compromise

*See also: [14-security-and-supply-chain.md](14-security-and-supply-chain.md), [10-agent-guidance-and-context.md](10-agent-guidance-and-context.md), [13-typescript-react-storybook.md](13-typescript-react-storybook.md), [19-emerging-themes-and-frontier.md](19-emerging-themes-and-frontier.md), [00-overview.md](00-overview.md).*
