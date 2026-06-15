# Security & Supply-Chain for Agentic Development

> **TL;DR** — Prompt injection is architectural, not a model bug: an agent that simultaneously touches untrusted input, sensitive credentials, and a state-change/egress capability can be turned into an exfiltration tool. The defenses that actually hold are deterministic and layered *under* the model — OS sandboxes, default-deny egress, least-privilege agent identities, and a lockfile-only supply chain with release-age cooldown — not the model policing itself. AI-generated code independently introduces vulnerabilities and leaks secrets at materially higher rates than human code, so every merge needs SAST + secret scanning gates regardless of how the diff was authored.

**Top actionable takeaways**
- **Never let one unsupervised agent hold all three of: untrusted input · sensitive data/credentials · state change/egress.** Split into a read-only discovery agent and a separately-credentialed action agent, or insert a human approval gate ("Rule of Two" / lethal trifecta).
- **Turn the network OFF by default** for CLI agents (Codex, Claude Code Bash). Disabling egress deterministically breaks the exfiltration leg of an injection.
- **Lock the supply chain:** `npm ci` / `pnpm install --frozen-lockfile`, `--ignore-scripts`, dependency **cooldown** (`minimumReleaseAge` / `min-release-age`), and a human gate on any package not already in the lockfile.
- **Assume AI code is insecure:** block merges on SAST (Semgrep/CodeQL → SARIF) high/critical findings + secret scanning (`gitleaks`/`trufflehog`) in pre-commit *and* CI.
- **Give the agent its own short-lived OIDC identity** with narrow scopes; the identity that reads untrusted content must not also hold publish/admin scopes.
- **In CI, treat `github.event.*` as hostile data** — never interpolate it into a prompt or shell command; publish via OIDC Trusted Publishers, not long-lived PATs.

See also [01-challenges-of-ai-development.md](./01-challenges-of-ai-development.md), [04-static-analysis-and-ci-cd-gates.md](./04-static-analysis-and-ci-cd-gates.md), [12-custom-hooks.md](./12-custom-hooks.md), and [18-mcp-and-tool-design.md](./18-mcp-and-tool-design.md).

---

## 1. The threat model: prompt injection is architectural

There is no reliable instruction/data separation inside a single token stream, so any untrusted text an agent reads can act as instructions. Model-side mitigations reduce but never eliminate this. The practical control is to constrain *what the agent can do once injected.*

### The Rule of Two (lethal-trifecta test)

An unsupervised agent should satisfy **at most two** of:

| | Capability |
|---|---|
| **A** | Exposure to **untrusted input** (issues, web pages, emails, tool output, repo contents) |
| **B** | Access to **sensitive data / credentials** |
| **C** | Ability to **change state or communicate externally** (egress) |

If a task genuinely needs all three, **insert a human approval gate** or **split the work**: a read-only *discovery* agent (A only) feeds a separately-credentialed *action* agent (B+C, no untrusted input). This is the single most load-bearing design rule in this report. *(Confidence: high.)*

The **Clinejection** incident (see §5) is the canonical worked example of an agent that held all three at once.

---

## 2. Deterministic controls beat model self-policing

Layered, architectural defenses are what move the needle. Reported results:

- **CaMeL** ("Defeating Prompt Injections by Design", arXiv:2503.18813): a *privileged* LLM compiles the task into a restricted program; a *quarantined* LLM processes untrusted content **with no tool access**; an interpreter tracks taint to block dangerous sinks. Reported ~**77%** AgentDojo utility under attack vs ~**84%** undefended — i.e. most utility retained while closing the injection path. The AgentDojo benchmark itself is arXiv:2406.13352.
- A layered-defense composition has been reported to cut attack success from roughly **73% to ~9%**.
- Cheaper approximations of the same idea: **spotlighting / data-marking** (visibly delimit untrusted content) + **egress allowlists**.

**Takeaway:** the reliable controls are structural — *separate discovery from action, and gate exfiltration* — with model-level mitigations layered on top, never relied on alone. *(Confidence: high; exact percentages are from the cited papers and should be re-confirmed against the primary PDFs.)*

---

## 3. Hardening the agent runtime

### 3.1 Claude Code: deny-first + OS sandbox + minimal egress

Permissions evaluate **deny → ask → allow**. Critical defaults to know: read access still allows `~/.aws` and `~/.ssh`, and the network proxy does **not** inspect TLS.

```jsonc
// .claude/settings.json
{
  "permissions": {
    // Deny wins. Block credential dirs and dangerous fetchers.
    "deny": [
      "Read(~/.aws/**)",
      "Read(~/.ssh/**)",
      "Read(./.env*)",
      "Bash(curl:*)",
      "Bash(wget:*)",
      "mcp__*"                     // default-deny all MCP; allow vetted tools explicitly below
    ],
    "ask": [
      "Bash(git push:*)",
      "Bash(npm publish:*)"
    ],
    "allow": [
      "mcp__vetted_server__safe_tool"
    ]
  },
  // OS sandbox confines Bash + children even when the model is injected.
  "sandbox": { "enabled": true },
  // Keep egress allowlist as small as possible.
  "allowedDomains": ["registry.npmjs.org", "github.com"]
}
```

- **Enable the OS sandbox** (Seatbelt on macOS; bubblewrap + socat on Linux) so Bash and its children are OS-confined regardless of model behavior.
- Block `curl`/`wget` so `WebFetch(domain:...)` is the only egress path, then keep `allowedDomains` minimal.
- Set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` to strip credential env-vars from subprocess environments.

### 3.2 A PreToolUse deny-hook for what rules can't express

Permission rules are pattern-based; a hook can apply *logic*. A `PreToolUse` hook that **exits with code 2 hard-blocks** the tool call (it beats `allow`, but cannot override `deny`/`ask`).

```bash
#!/usr/bin/env bash
# .claude/hooks/pretooluse-guard.sh  — exit 2 to block
cmd="$(jq -r '.tool_input.command // empty')"
# Block credential-named env vars, base64-pipe-to-network exfil,
# writes to git/CI metadata or lockfiles, and curl to non-allowlisted hosts.
if echo "$cmd" | grep -qiE '(AWS_SECRET|NPM_TOKEN|VSCE_PAT|OVSX_PAT|GITHUB_TOKEN)'; then exit 2; fi
if echo "$cmd" | grep -qiE 'base64.*(curl|wget|nc|/dev/tcp)'; then exit 2; fi
if echo "$cmd" | grep -qiE '>\s*\.(git|github)/|package-lock\.json|pnpm-lock\.yaml'; then exit 2; fi
exit 0
```

Pair with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`. See [12-custom-hooks.md](./12-custom-hooks.md) for the full hook framework. *(Confidence: high.)*

### 3.3 Codex / other CLI agents: network OFF by default

Codex couples `sandbox_mode` × `approval_policy`; **`network_access` is OFF by default even in `workspace-write`**, and only `--dangerously-bypass-approvals-and-sandbox` removes the controls.

The portable rule for any agent runtime:
1. **Default-deny egress.**
2. **Scope writes to the workspace.**
3. **Approve state-changing actions.**
4. **Enable network per-task**, only when the task provably needs it.

Disabling egress deterministically removes leg **C** of the trifecta. *(Confidence: high.)*

---

## 4. Supply chain: stopping slopsquatting and smash-and-grab

AI agents hallucinate package names that attackers then register ("slopsquatting"). Package-name hallucination persists across frontier models at roughly **4.62–6.10%** (arXiv:2605.17062; ~4.62% for one Claude-class model, ~6.10% for a GPT-5-mini-class model). A large share of AI-suggested dependencies carry supply-chain risk.

### 4.1 Lockfile-only install, scripts off, human gate

```bash
# Reproducible installs only — fail if lockfile would change.
npm ci                              # or: pnpm install --frozen-lockfile
# Lifecycle scripts are the primary malware vector (postinstall/preinstall).
npm ci --ignore-scripts
pip install --only-binary :all: -r requirements.txt
```

- **Never install a package not already in the lockfile** without review; emit and review a **lockfile diff** in PRs.
- **Disable lifecycle scripts** (`--ignore-scripts`; pip `--only-binary :all:`) — `postinstall`/`preinstall` is the execution vector (Clinejection installed its payload via `postinstall`).
- **Verify each suggested package actually exists** before adding it.

### 4.2 Dependency cooldown (minimum release age)

Most malicious versions are caught and yanked within hours, so refusing brand-new versions filters the bulk of smash-and-grab attacks.

```jsonc
// .npmrc (npm 11.10.0+) — value in DAYS
min-release-age=1

// .npmrc / pnpm config — value in MINUTES; pnpm 11 defaults to 1440
minimum-release-age=1440
// pnpm: allow trusted internal packages to skip cooldown
// minimumReleaseAgeExclude: ["@your-scope/*"]
```

Cooldown was reportedly the control that protected teams during the 2026 npm worm incidents. *(Confidence: high; "protected teams" is a reported claim, not a measured figure.)*

### 4.3 MCP servers are untrusted supply-chain dependencies

- **Tool poisoning / rug-pull:** malicious instructions live in tool *descriptions* (treated as ground truth) and can change **after** approval — the Invariant Labs WhatsApp rug-pull is the documented case. Scan metadata (e.g. MCP-Scan), pin/allowlist servers, and **re-verify on any change**.
- **STDIO RCE:** Anthropic SDKs pass the STDIO `command` to the shell and may execute it even if no server starts. **Never interpolate untrusted values into the `command` field**, and **container-isolate** MCP servers.
- In Claude Code, **default-deny `mcp__*`** and allow only individually vetted tools (see §3.1).

More on safe tool design in [18-mcp-and-tool-design.md](./18-mcp-and-tool-design.md). *(Confidence: high.)*

---

## 5. AI-in-CI: the Clinejection pattern

The Clinejection attack needed only an **opened GitHub issue**. The chain:

1. The issue **title was interpolated into the agent's prompt unsanitized** (injection).
2. The agent ran an attacker-chosen `npm install`.
3. A `preinstall` script **poisoned the Actions cache**.
4. The nightly publish workflow then leaked `VSCE_PAT` / `OVSX_PAT` / `NPM_RELEASE_TOKEN`.

**Controls:**

- **Treat `github.event.*` (titles, bodies, comments, branch names) as hostile data** — never interpolate into prompts or shell. Pass via env vars, not string templating.
- **Scope `GITHUB_TOKEN` minimally** per workflow.
- **Avoid `pull_request_target` with untrusted checkout.**
- **Publish via OIDC Trusted Publishers, not PATs.**
- **Separate triage workflows from publish workflows** — the workflow that reads untrusted issues must not hold publish secrets (separation of duties).

This is the supply-chain expression of the Rule of Two. See [04-static-analysis-and-ci-cd-gates.md](./04-static-analysis-and-ci-cd-gates.md). *(Confidence: high.)*

---

## 6. Gate every merge: assume AI code is insecure

AI-authored code introduces vulnerabilities at a high baseline rate, and this has stayed roughly flat into Spring 2026:

- Veracode (Spring 2026): ~**45%** of AI-generated code introduces a known vulnerability **unprompted**. Note the two distinct ~72% figures so they aren't conflated: **Java ~72% is a security-*failure* rate** (the riskiest language tested), whereas **a GPT-5-Mini-class model's ~72% is a security-*pass* rate** (the notable exception). XSS pass rates were especially poor (~86% failing in the relevant cohort).
- GitGuardian (State of Secrets Sprawl 2026): AI leaks secrets at roughly **2×** the human rate (~**3.2%** of AI commits vs ~**1.5%** of human commits).

**Required gates (apply to all code, AI or not):**

```yaml
# SAST → SARIF, block on high/critical
- run: semgrep --config p/owasp-top-ten --config p/secrets --sarif -o semgrep.sarif
# or CodeQL. Fail the job on high/critical findings.

# Secret scanning — run in pre-commit AND in CI (defense in depth)
- run: gitleaks detect --redact --exit-code 1
- run: trufflehog filesystem . --fail
```

Wire `gitleaks`/`trufflehog` into a pre-commit hook *and* the CI pipeline — pre-commit catches most leaks locally, CI catches what bypasses local hooks. *(Confidence: high.)*

---

## 7. Identity & authorization

Map primarily to **OWASP ASI03 (Identity & Privilege Abuse)** in the OWASP Top 10 for Agentic Applications (2026 edition, released Dec 2025):

- **Give the agent its own managed identity** with narrow scopes — do **not** let it inherit a human's session.
- **Prefer short-lived OIDC over long-lived PATs.**
- **Separation of duties:** the identity that reads untrusted content must not also hold publish/admin scopes.
- **Intent gates:** require a secondary check before irreversible actions (moving money, deletes, config changes, publishing). The intent-gate rationale connects to **ASI01 (Agent Goal Hijack)** — guarding against objective tampering — which is a distinct category from identity. *(Confidence: high.)*

---

## 8. IP / licensing risk (unsettled)

This area is **not legally settled** — treat as governance, not a solved problem. *(Confidence: medium.)*

- In *Doe v. GitHub* (Copilot litigation), the **DMCA §1202(b) claim was dismissed with prejudice**, while **breach-of-contract and open-source-license claims remained pending** as of early 2026 (per BakerHostetler's case tracker). Do **not** assume a settlement or any specific remedy — none is established in retrievable reporting.
- Copyleft contamination remains a real governance gap: code suggestions carry **no provenance tracking**.

**Controls that stand on their own regardless of the litigation outcome:**
- Enable **verbatim / duplicate-detection filters** in your AI coding tools.
- Generate an **SBOM** (CycloneDX or SPDX) and run **license scanning** to flag GPL/AGPL/other copyleft.
- Define and enforce an **acceptable-license policy** in CI.

---

## TypeScript / React / Storybook specifics

- **npm/pnpm cooldown + lockfile-only is the highest-leverage control here**, because the JS ecosystem has the deepest transitive trees and the most active worm activity. Use `pnpm install --frozen-lockfile` with `minimumReleaseAge: 1440` and `minimumReleaseAgeExclude` for first-party scopes.
- **`--ignore-scripts` can break native-binary packages** (e.g. `esbuild`, `sharp`, some `node-gyp` builds). Maintain a small allowlist of packages permitted to run scripts rather than globally re-enabling them.
- **XSS is the dominant AI-code failure mode for React.** Lint against `dangerouslySetInnerHTML`, ban `eval`/`new Function`, and add a Semgrep React ruleset to the merge gate. See [09-linting-for-ai.md](./09-linting-for-ai.md).
- **Storybook + addons are an npm supply-chain surface and serve a dev server** — keep it off the public network, pin addon versions, and include it in cooldown/lockfile policy. Don't expose a Storybook instance with project secrets in `process.env`.
- **CycloneDX has first-class JS tooling** (`@cyclonedx/cyclonedx-npm`) for the SBOM step in §8.
- Deeper framework-specific guidance: [13-typescript-react-storybook.md](./13-typescript-react-storybook.md).

---

## Freshness (2026)

Current as of **June 2026**. The supply-chain figures (Veracode Spring 2026, GitGuardian 2026), tool versions (npm 11.10.0 `min-release-age`, pnpm 11 `minimumReleaseAge` default 1440), and the OWASP Agentic Top 10 2026 edition are all 2025–2026 sources. The *Doe v. GitHub* litigation is **active and moving** — re-check status before relying on any IP claim. Cooldown defaults and npm worm-incident reporting evolve fast; re-confirm version numbers before pinning policy.

## Confidence & trade-offs

- **High confidence:** Rule of Two, OS sandbox + deny-first permissions, network-off-by-default, lockfile-only + cooldown, MCP-as-untrusted-dependency, the Clinejection control set, SAST/secret-scanning gates, least-privilege identity.
- **Medium confidence:** exact benchmark percentages (CaMeL ~77%/~84%, layered ~73%→~9%) and the secret-leak/vuln statistics — directionally solid, but re-confirm against primary PDFs before quoting as hard numbers. The IP/licensing section is medium confidence and legally unsettled.
- **Removed as unverifiable:** an "80% of AI deps are risky" figure (no primary source found) — stated qualitatively instead.
- **Trade-offs:** cooldown delays access to legitimate urgent patches (use `minimumReleaseAgeExclude` for trusted internals and a documented break-glass path). Strict sandboxing and `--ignore-scripts` add friction and can break native builds. The discovery/action split adds orchestration cost — but it is the only structurally reliable injection defense.

---

## Sources

- Meta AI — [Practical AI Agent Security](https://ai.meta.com/blog/practical-ai-agent-security/)
- Simon Willison — [The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) (2025-06-16)
- Simon Willison — [CaMeL: Defeating prompt injections by design](https://simonwillison.net/2025/Apr/11/camel/) (2025-04-11)
- arXiv — [Defeating Prompt Injections by Design (CaMeL)](https://arxiv.org/abs/2503.18813)
- arXiv — [AgentDojo: A Dynamic Environment to Evaluate Attacks and Defenses for LLM Agents](https://arxiv.org/abs/2406.13352)
- Claude Code docs — [Permissions](https://code.claude.com/docs/en/permissions)
- Claude Code docs — [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- OpenAI — [Codex sandboxing concepts](https://developers.openai.com/codex/concepts/sandboxing)
- Andrew Nesbitt — [Package security defenses for AI agents](https://nesbitt.io/2026/04/09/package-security-defenses-for-ai-agents.html) (2026-04-09)
- arXiv — [Package-hallucination study (frontier models)](https://arxiv.org/abs/2605.17062)
- Socket — [npm introduces minimumReleaseAge and bulk OIDC configuration](https://socket.dev/blog/npm-introduces-minimumreleaseage-and-bulk-oidc-configuration)
- pnpm docs — [Supply chain security](https://pnpm.io/supply-chain-security)
- Invariant Labs — [MCP Security: Tool Poisoning Attacks](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks)
- Ox Security — [The Mother of All AI Supply Chains: systemic vulnerability in MCP](https://www.ox.security/blog/the-mother-of-all-ai-supply-chains-critical-systemic-vulnerability-at-the-core-of-the-mcp/)
- Snyk — [Cline supply chain attack: prompt injection via GitHub Actions](https://snyk.io/blog/cline-supply-chain-attack-prompt-injection-github-actions/)
- Cloud Security Alliance — [Research note: Claude Code GitHub Action prompt injection](https://labs.cloudsecurityalliance.org/research/csa-research-note-claude-code-github-action-prompt-injection/)
- Veracode — [Spring 2026 GenAI Code Security report](https://www.veracode.com/blog/spring-2026-genai-code-security/)
- GitGuardian — [The State of Secrets Sprawl 2026](https://blog.gitguardian.com/the-state-of-secrets-sprawl-2026/)
- OWASP — [Top 10 for Agentic Applications (2026)](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/)
- Auth0 — [OWASP Top 10 Agentic Applications: lessons](https://auth0.com/blog/owasp-top-10-agentic-applications-lessons/)
- BakerHostetler — [The Copilot Litigation (case tracker)](https://www.bakerlaw.com/the-copilot-litigation/)
- arXiv — [AI code IP/licensing analysis](https://arxiv.org/abs/2508.16853)
