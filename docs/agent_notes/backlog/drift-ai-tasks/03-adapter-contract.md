# drift:ai — External-adapter contract (the landed deliverable of task 30)

This is the **policy + base contract** that governs every external-tool adapter in
drift:ai. It is the deliverable of [task 30](./30-adapter-policy.md); tasks
[31](./31-import-cycles-plugin.md), [32](./32-knip-orphan-files-adapter.md), and
[33](./33-near-duplicate-plugin.md) implement against it, and a future
lint-baseline adapter validates the Tier-2 path.

**Read order for an adapter task:** [`01-shared-context.md`](./01-shared-context.md)
(the contract, portability target, OpenClaw realities) → [`02-seam-map.md`](./02-seam-map.md)
(verified `file:line` anchors) → **this file** → your single task file. Deeper
rationale lives in `../drift-ai-hotspots-brainstorm.md` Part 2 (§2.1–2.7).

This contract builds directly on the `CheckOutcome` / `CheckPlugin` model that
[task 21](./21-check-plugin-registry.md) landed in
`scripts/drift-ai/check-plugin.ts`. An adapter is **not** a parallel construct —
it is a `CheckPlugin` whose `run` delegates to external-tool orchestration. See
"How an adapter maps onto the existing registry" below.

---

## 0. Governing principle — own the provenance of the verdict

The load-bearing rule of the whole adapter layer:

> **Own the provenance of the verdict.** Every adapter finding must make clear
> whether the opinion came from the *target's own config*, a *tool default*, or a
> *drift:ai baseline*. drift:ai is allowed to run our own rules against a foreign
> repo and report the violations — what it is **not** allowed to do is disguise a
> drift-authored verdict as if the target had agreed to it.

drift:ai stays **report-only / exit 0** by default
([`01-shared-context.md`](./01-shared-context.md) contract #1). Adapters do not
change that; `--fail-on-findings` remains the only opt-in exception and is a
separate task. This contract is about *honesty of attribution*, not neutrality:
running our lint baseline against a foreign repo is a supported, first-class mode
— it just has to say so on every finding.

This sits inside the broader "evidence, not verdicts" stance
([`01-shared-context.md`](./01-shared-context.md) contract #3,
[[feedback_drift_ai_evidence_not_verdicts]]): surface what the tool found, stamped
with who authored the ruleset, and let the human supply judgment. Do **not** add
generated/codegen/i18n auto-classification on top — that is an unwinnable,
unportable calibration treadmill.

---

## 1. Two adapter tiers

| Tier | Mode | Whose verdict | `configSource` |
|------|------|---------------|----------------|
| **Tier-1 pass-through** | Run the target's OWN configured tool (or the tool's published default when no target config exists). Zero imposed opinion. | the target / the tool | `target-config`, or `tool-default` when it ran on the tool's own default with no target config | 
| **Tier-2 imposed baseline** | drift:ai ships a baseline ruleset for a tool the target does not configure, and runs it against the foreign repo. | drift:ai | `drift-baseline` |

- **Tier-1** example: run the target's `knip` with the target's `knip` config and
  report what it says (task 32).
- **Tier-2** example: run a curated `ai_devx_stuff-lint` baseline against a repo
  that has no comparable lint config, and report the generic AI-drift signals.
  Tier-2 is **explicit-only**: it activates via `--baseline-profile=ai_devx_stuff-lint`
  so a normal portable run never unexpectedly floods the report with
  drift-authored opinions.

The three `configSource` values — `target-config` / `tool-default` /
`drift-baseline` — are **defined by this contract** (mirroring
`../drift-ai-hotspots-brainstorm.md` §2.7). They are not an existing seam-map
field; the first adapter to land adds them (see §6, Provenance on findings).

---

## 2. Config-authority precedence ladder (config-honoring adapters only)

For adapters whose findings depend on a ruleset the target *could* author (knip,
eslint, import-x / madge cycles — see the catalog in §7), resolve config in this
order. **First that exists wins.** Target-local discovery reuses the existing
config plumbing (`02-seam-map.md §10`).

1. **Explicit operator override** — `--<tool>-config=<path>` (e.g.
   `--knip-config=<path>`). Highest authority; the operator said exactly which
   ruleset to use.
2. **Target-local config** — search the tool's *known* locations, **do NOT assume
   repo-root**. (OpenClaw ships `config/knip.config.ts`, not `./knip.json` —
   `01-shared-context.md`.) Found → `configSource: "target-config"`.
3. **drift baseline** — only if `--baseline-profile=ai_devx_stuff-lint` is set.
   Resolved → `configSource: "drift-baseline"` (Tier-2).
4. **Skip** — `status: "skipped"`, `code: no-target-config`. **This is the
   DEFAULT** when nothing above matches. It is the *common case* on a foreign repo
   and must read clearly, never as "all clear" (see §4).

`tool-default` (run the tool with no config at all) is a deliberate, narrow choice
for tools whose published default is itself meaningful and target-independent; it
is **not** a rung the ladder falls through to automatically. A config-honoring
adapter that finds no target config and has no baseline profile **skips** — it
does not silently invent a default.

### Measurement-ish carve-out

Some adapters measure a property with **no target standard to honor** — duplication
(jscpd, similarity-ts) has no ruleset the target authored. For these the threshold
is unavoidably **drift:ai-authored**, which is tolerable precisely because there is
no target config to defer to. **The ladder above does not apply to measurement-ish
adapters.** They still:

- carry provenance — `drift-baseline` for the drift-authored threshold, and
- skip cleanly when their engine is absent (see §4).

(task 33 / near-duplicate is the measurement-ish example; the jscpd `duplicates`
check is the existing one.)

---

## 3. How an adapter maps onto the existing registry

An adapter is **a `CheckPlugin`** (`scripts/drift-ai/check-plugin.ts`,
landed by task 21), not a new dispatch path. The mapping:

```ts
// The contract surface (specification — implemented per-adapter in tasks 31–33):
type AdapterConfigResolution<C> =
  | { readonly kind: "resolved"; readonly config: C; readonly configSource: ConfigSource }
  | { readonly kind: "skip"; readonly code: SkipCode; readonly reason: string };

type ConfigSource = "target-config" | "tool-default" | "drift-baseline";

interface ExternalAdapter<C> {
  // Walk the §2 ladder (or, for measurement-ish, just check engine availability)
  // and return either a resolved config source or a skip decision.
  resolveConfig(ctx: CheckRunContext): AdapterConfigResolution<C>;

  // Run the tool and map its output to findings, each stamped with the
  // configSource from resolveConfig. Tool/target absent is handled in
  // resolveConfig (skip); tool-ran-and-failed is handled here (one diagnostic).
  run(ctx: CheckRunContext, resolved: { config: C; configSource: ConfigSource }): CheckOutcome;
}
```

The adapter is wired into the registry as a normal plugin:

- `preflight(ctx, config)` (the existing optional `CheckPlugin` hook) calls
  `resolveConfig`. If it returns `kind: "skip"`, `preflight` returns the human
  `reason` string → the registry turns that into
  `{ status: "skipped", reason }` (see `defineCheckPlugin`,
  `check-plugin.ts:55–58`). The machine-readable `code` is carried in the reason
  string and/or a structured skip field (see §4 on the skip shape).
- `run(ctx, config)` calls the adapter's `run` and returns a `CheckOutcome`.

So adapters reuse the registry, the per-check config (`selectConfig`/`parseConfig`),
the single `CheckRunContext`, and the `CheckOutcome` union with no new dispatch
machinery. New external I/O (the tool subprocess, install/config probing) goes
behind an **injected runner with a `default*` factory** and is tested with a fake,
exactly like `JscpdRunner` / `GitRunner`
([`01-shared-context.md`](./01-shared-context.md) contract #4; no `vi.mock`).

---

## 4. Skip vs. finding — the jscpd-precedent correction

The existing duplicate-code check historically surfaced a **WARN-style finding**
when its tool was unavailable (the jscpd ENOENT path — `02-seam-map.md §4`, the
one-WARN-per-root behavior validated on OpenClaw, which has no `node_modules`).
**That precedent is wrong for foreign repos and is corrected here.** Two distinct
situations, two distinct outcomes:

| Situation | Outcome | Why |
|-----------|---------|-----|
| **Expected absence** — tool not installed, target not installed, or no target config (and no baseline profile) | `status: "skipped"` with a machine-readable `code` + human `reason`. **Never a finding.** | Nothing went wrong; the inputs to a trustworthy answer simply aren't present. A finding here would be a false positive. |
| **Attempted-and-failed** — the tool ran and crashed, or produced unparseable output | **one** diagnostic finding (see below). | Something the operator can act on actually broke. |

Machine-readable skip `code`s the adapter layer standardizes on (extend per
adapter as needed):

- `tool-not-installed` — the engine itself is missing from the tools checkout.
- `target-not-installed` — the foreign repo has no `node_modules`, so the tool
  cannot resolve the target's module graph (knip, import-x). **The common
  OpenClaw case.**
- `no-target-config` — config-honoring adapter, no config found, no baseline
  profile (the §2 default skip).
- `resolution-too-partial` — the tool *could* run but resolution is too partial to
  trust (e.g. cycle detection on an uninstalled target with heavy aliasing). A
  partial, untrustworthy graph must **not** be reported as fact.

### How the skip is represented

`CheckOutcome` today is exactly two states (`check-plugin.ts:9–11`):

```ts
type CheckOutcome =
  | { readonly status: "ran"; readonly findings: readonly DriftFinding[] }
  | { readonly status: "skipped"; readonly reason: string };
```

There is **no `status: "error"` variant** — the task-30 source prose mentioned one
as a possibility, but the landed model folds errors into `skipped`
(`check-plugin.ts:61–63`). The adapter layer therefore expresses the two
situations **without a schema change**:

- **Expected absence → `{ status: "skipped", reason }`.** The machine `code`
  travels inside the reason text (and, if/when `SkippedDriftCheck` grows a
  structured `code` field, there too — that is an additive change the first
  adapter may make; keep it optional and bump `DRIFT_SCHEMA_VERSION` if so).
- **Attempted-and-failed → `{ status: "ran", findings: [oneDiagnostic] }`**,
  where the single diagnostic finding describes what broke (tool name, exit code,
  a short stderr excerpt). This deliberately reuses the `ran` branch rather than
  adding an `error` status, because a tool that ran and broke *is* something the
  report should surface to the human — it is closer to a finding than to an
  absence. **Do not emit one-diagnostic-per-root** (the jscpd mistake); emit a
  single diagnostic for the failed run.

**The skip path is the headline case on foreign repos** (uninstalled +
no-baseline is the default on a large unfamiliar repo — `01-shared-context.md`
OpenClaw realities). Invest in its clarity: a clear `code`, a human reason that
names what is missing and (where useful) how to make the check run (e.g. "install
the target, or pass `--baseline-profile=ai_devx_stuff-lint`"). A skip must never
be mistaken for "the target passed this check."

---

## 5. Shared helpers the adapter layer provides

Tasks 31 and 32 reference "task 30's install-detection and config-discovery
helpers." This contract names them so they are implemented once and shared:

- **`detectTargetInstall(repoRoot)`** — returns whether the target repo has its
  dependencies installed (presence of `node_modules` at the repo root and/or the
  relevant workspace package). Used to produce the `target-not-installed` skip.
  Goes behind a `FileReader`/`DirectoryListing`-style injected probe so it is
  testable with a fake.
- **`discoverToolConfig(ctx, candidates)`** — walks the §2 ladder rungs 1–2 for a
  given tool: explicit override → known target-local locations (a caller-supplied
  candidate list, **not** an assumed repo-root path). Returns the resolved path +
  `configSource`, or `null` (caller then applies rungs 3–4). Reuses the existing
  config plumbing (`02-seam-map.md §10`); does not re-roll path normalization
  (use `path-util.ts` from task 20).

These are **specified here, implemented when the first adapter that needs them
lands** (task 31 needs install-detection + tsconfig discovery; task 32 needs both).
Keep them small, injected, and faked — do not build speculative surface.

---

## 6. Provenance on findings

Findings today are `DriftFinding` (`types.ts:15–21`): `check`, `file`, `message`,
optional `hint` / `relatedFiles` / `details`. The adapter layer adds **provenance**
so the reader always sees who authored the verdict:

```ts
type FindingProvenance = {
  readonly configSource: "target-config" | "tool-default" | "drift-baseline";
  readonly tool: string;       // e.g. "knip", "ts-morph", "ai_devx_stuff-lint"
  readonly configPath?: string; // the resolved config when configSource !== "drift-baseline"
};
```

Recommended shape: a **new optional `provenance` field on `DriftFinding`** rather
than overloading the free-form `details` bag, because provenance is first-class,
machine-readable, and must render in both text and JSON. It is **additive**: the
first adapter to land (task 32, Tier-1 pass-through) adds the field and bumps
`DRIFT_SCHEMA_VERSION` (currently `2`, `types.ts:5`) to `3` through the shared
constant — non-adapter findings simply omit it. Text output should make
provenance visible (e.g. a `[target-config]` / `[drift-baseline]` tag on the WARN
line) so a `drift-baseline` opinion is never read as the target's own.

---

## 7. Candidate adapter catalog

The catalog the layer is scoped against (`../drift-ai-hotspots-brainstorm.md` §2.4).
"In tools checkout?" is per the dependency table (`02-seam-map.md §12`):
`ts-morph`, `knip`, `jscpd`, and `eslint-plugin-import-x` are **present**;
`madge`, `dependency-cruiser`, and `similarity-ts` are **absent**.

| Tool | Category | Tier | What it surfaces | Target config? | In tools checkout? |
|------|----------|------|------------------|----------------|--------------------|
| knip (unused files) | structural | 1 | orphaned / never-imported files | yes (`knip.json` / `config/`) | **yes** |
| madge | structural | 1 | import cycles | tsconfig (aliases) | **no** |
| import-x `no-cycle` | structural | 1 | import cycles | tsconfig (aliases) | **yes** (`4.16.2`) |
| similarity-ts | measurement | 2 | near-duplicate functions | no (drift-authored threshold) | **no** (Rust binary) |
| jscpd | measurement | 2 | exact / token clones | no (drift-authored threshold) | **yes** |
| eslint | lint | 1 | target's own lint findings | yes (eslintrc) | yes (tools-checkout deps/config) |
| `ai_devx_stuff-lint` | lint | 2 | generic AI-drift lint signals (complexity, file length, too many arguments, …) | drift baseline | yes (tools-checkout deps/config) |
| dependency-cruiser | structural | 1/2 | layering / arch rules | yes (rules) | **no** |

Scoping notes carried from the validation:
- **Import cycles (task 31)** spike `ts-morph` first (present, resolves tsconfig
  aliases via its project loader), fall back to import-x `no-cycle` (present); do
  **not** add `madge` without reopening a dependency decision.
- **knip (task 32)** is the canonical Tier-1 pass-through; must locate a non-root
  config and skip cleanly on an uninstalled target.
- **Near-duplicate (task 33)** is measurement-ish via `ts-morph` (needs no target
  install); `similarity-ts` stays an optional high-fidelity mode that activates
  only if the Rust binary is present.

---

## 8. Locked decisions (do not re-escalate)

- **Tier-2 imposed baselines ship as a first-class adapter mode.** drift:ai may
  run shared lint baselines against foreign repos and report the violations.
- **Baseline activation shape:** `--baseline-profile=ai_devx_stuff-lint`.
- **First lint-baseline surface:** a curated, portable `ai_devx_stuff-lint`
  profile focused on generic AI-drift signals (complexity, file length, too many
  arguments, similar broadly-applicable maintainability rules) — **not** this
  repo's raw ESLint config and **not** lint-ratchet baselines. Exclude
  repo-specific checks.
- **Adapter scope ceiling:** broad enough to include lint-rule orchestration
  (especially the `ai_devx_stuff-lint` baseline); structural adapters remain in
  scope. The ceiling is no longer structural-only.
- **Local CI stays canonical for *this* repo.** Re-running the same checks inside
  drift:ai is **not** a replacement for the normal verification stack here.
  `ai_devx_stuff-lint` is a *foreign-repo inspection profile*, not a claim that a
  foreign repo already opted into repo-specific standards.

---

## 9. What this contract is validated by

Doc + contract only — no runnable code lands with task 30. The contract is proven
when the adapters implement against it:

- **Task 32 (knip)** exercises Tier-1 pass-through, the `no-target-config` /
  `target-not-installed` skips, and the first `provenance` + schema bump.
- **Task 31 (import cycles)** exercises a config-honoring structural adapter, the
  tsconfig-alias path, and the `resolution-too-partial` / `target-not-installed`
  degrade.
- **A future lint-baseline adapter** exercises the Tier-2 `drift-baseline` path
  by running `ai_devx_stuff-lint` against a foreign repo.

If any of those cannot cleanly express its skip + provenance behavior using this
contract, **the contract is wrong and comes back to [task 30](./30-adapter-policy.md)** —
do not work around it in an adapter.
