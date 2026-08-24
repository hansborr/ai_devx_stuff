# Local ESLint Rules

Authoring conventions for rules in `eslint-rules/`. For the system-wide map of
how local rules relate to the ratchet, suppression policy, and coverage map,
see the [Lint System Overview](lint-overview.md).

For projects adapting the guidance pipeline to Biome, see
[Biome Lint Adoption](biome-lint-adoption.md). The portable part is the
metadata and `HarnessDiagnostics` envelope; the current discovery mechanism is
ESLint-specific.

## Standalone Starter

The smallest useful local-rule setup is four files and three development
dependencies. This starter is repository-neutral: copy it into an empty
directory, run the commands below, and then replace the example policy with
your own. It uses ESLint's flat config and `RuleTester`; it does not import Musi
code or depend on Musi paths.

`package.json`:

```json
{
  "type": "module",
  "private": true,
  "scripts": {
    "lint": "eslint .",
    "test": "vitest run"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.0",
    "eslint": "^10.0.0",
    "vitest": "^4.0.0"
  }
}
```

`eslint-rules/no-console-log.js`:

```js
export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require an application logger instead of console.log",
    },
    schema: [],
    messages: {
      useLogger:
        "Why: console.log bypasses the application logger. How to fix: Call the project logger instead.",
    },
  },
  create(context) {
    return {
      "CallExpression[callee.object.name='console'][callee.property.name='log']"(node) {
        context.report({ node, messageId: "useLogger" });
      },
    };
  },
};
```

`eslint.config.js` registers the rule under the `local` plugin name and enables
it for normal lint:

```js
import js from "@eslint/js";

import noConsoleLog from "./eslint-rules/no-console-log.js";

export default [
  { ignores: ["**/node_modules/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {
      local: {
        rules: { "no-console-log": noConsoleLog },
      },
    },
    rules: {
      "local/no-console-log": "error",
    },
  },
];
```

`eslint-rules/no-console-log.test.js` proves both the clean and reporting
paths without loading the repository's full lint config:

```js
import { RuleTester } from "eslint";
import { describe, it } from "vitest";

import rule from "./no-console-log.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("no-console-log", () => {
  it("requires the project logger", () => {
    ruleTester.run("no-console-log", rule, {
      valid: ["logger.info('ready');"],
      invalid: [
        {
          code: "console.log('ready');",
          errors: [{ messageId: "useLogger" }],
        },
      ],
    });
  });
});
```

Install and exercise the standalone copy with:

```sh
bun install
bun run test
bun run lint
```

The rule, test, plugin object, and `local/<rule-name>` naming convention are
portable. The `Why: ... How to fix: ...` diagnostic shape is recommended for
actionable terminal output, but ESLint does not require it.

Musi integration adds repository policy on top of that portable core:

- Do not declare a one-rule plugin inline. The `local` plugin registry is
  generated from the rule files on disk into
  `eslint-config/local-plugin.generated.js`; you create the module and run
  `bun run lint:local-plugin`.
- Add the extra `meta.docs` fields in [Metadata Contract](#metadata-contract)
  and follow the checked message shapes below.
- Run the repository catalog, paired-guide, and coverage checks described in
  [Adding A New Rule](#adding-a-new-rule). These checks and their `bun run`
  commands are Musi surfaces, not prerequisites for an external ESLint plugin.

## Generated Registration

Musi derives every registration surface a `local/*` rule needs from sources that
already exist, so adding a rule is not a multi-file ritual:

| Surface | Generated file | Refresh |
|---|---|---|
| `local` plugin registry | `eslint-config/local-plugin.generated.js` | `bun run lint:local-plugin` |
| `kind: lint-rule` harness controls | `harness.controls.lint-rules.generated.json` | `bun run harness:lint-rule-controls` |

Run them in that order. Control derivation reads flat-config activation, and
flat config statically imports the generated plugin registry, so the registry
has to exist and be current first.

The plugin generator (`scripts/harness/generate-local-plugin.ts`) scans
top-level `eslint-rules/*.js`, skips `*.test.js`, and keeps only modules whose
default export carries both `meta` and a callable `create`. That shape test —
not an allowlist — is what separates rules from the helper modules that live in
the same directory, so a new helper needs no registration and no exemption.
Rule id and module path come from the filename: `eslint-rules/<name>.js`
becomes plugin key `<name>` and rule name `local/<name>`. Because the filename
also becomes the generated module's import binding, `<name>` must be lowercase
kebab-case starting with a letter and must not be a reserved word — generation
fails by name on `2fa-required.js`, `No-Barrel.js`, or `default.js` rather than
writing a registry that no longer parses.

The output is committed and freshness-gated (`bun run lint:local-plugin:check`,
also reached by `bun run harness:check` and warned about at pre-commit). It uses
static imports only: `eslint.config.js` loads it synchronously on every lint
run, so runtime discovery, a top-level `await`, or config-load IO there is not
an option.

The control generator (`scripts/harness/generate-lint-rule-controls.ts`) reuses
that discovered rule set and derives each control's `id`, `ruleName`, `source`,
and `invocation` — nothing about a lint-rule control is authored. `invocation`
is `bun run lint` when flat config enables the rule and `bun run lint:ratchet`
when only a lint ratchet claims it; when both do, normal lint wins, because that
is the command that actually blocks a merge. **A rule activated on neither
surface fails generation**, so choosing an activation mode is now part of adding
a rule rather than something a late drift check notices.

The output is an include: `harness.controls.json` owns every other control kind,
this file owns lint rules, and `scripts/harness/harness-manifest.ts` merges the
two so every manifest reader sees one assembled inventory. Per-rule `category`,
`principle`, `pairedGuide`, `repairKind`, and `repairCommand` are still
re-projected from the rule's own `meta.docs` by the control-doc generator, and
still belong in neither file.

Two consequences worth knowing before you add a file to `eslint-rules/`:

- A stray rule-shaped module is registered automatically. That is intended —
  a rule file can no longer be dead because someone forgot the import.
- A non-`*.test.js` module in `eslint-rules/` must be importable **without**
  the generated registry. Discovery imports every candidate to classify it, so
  a helper that imports `local-plugin.generated.js` would make the generator
  depend on its own output. Put that dependency in a `*.test.js` file instead;
  discovery reports the rule by name if you trip it.

## Rule Catalog

Use the generated [local rule catalog](../generated/local-lint-rules.md) to
find the current `local/*` rules, their principles, paired guides, and repair
kinds. The catalog is generated from rule metadata; refresh it with
`bun run docs:lint-guidance` after changing rule docs.

## Severity Semantics

Local rules can use ESLint `warn` or `error`, but the meaning depends on the
surface reading the diagnostic.

- In normal ESLint gates, `warn` is editor-advisory severity, not a non-blocking
  escape hatch. `bun run lint`, `bun run lint:changed`, `verify`, pre-commit,
  and CI run ESLint with `--max-warnings=0`, so any warning still fails the
  gate. Repair helpers such as `lint:fix` are not the authority for gate
  behavior.
- In normal ESLint gates, `error` is both an editor error and a gate-enforced
  policy. Use it for permanent policy, drained ratchets promoted into normal
  lint, and findings that must block merge until fixed.
- In the agent lint envelope, `bun run lint:agent:local-rules` and
  `bun run lint:agent:local-rules:changed` emit harness diagnostics for
  `local/*` findings, selected core/plugin steering rules from
  `scripts/lint-agent-guidance.ts`, and parser errors. The legacy package
  script name remains stable for callers. `scripts/lint-agent.ts` maps ESLint
  errors to harness `block` findings and ESLint warnings to harness `warn`
  findings, then exits nonzero only when the envelope has blocking findings.
  Harness warnings are advisory and non-blocking in that envelope. Rules with
  neither local metadata nor an overlay remain info-severity completeness
  disclosures pointing to the full lint report.

The distinction exists because normal ESLint is the enforcement floor, while
the agent envelope is a structured, selected-rule view for agents and hook
surfaces. It carries local rule metadata or checked overlay guidance without
pretending to be full lint parity. Keep merge enforcement in normal lint,
ratchet, pre-commit, and CI. Use envelope warnings for useful agent guidance
that should not stop the local agent loop. If `lint-agent` ever becomes a gate,
add an explicit mode that fails warnings too instead of changing the current
advisory meaning silently.

## Rule Implementation Format

Local rules are intentionally plain `.js` files with `// @ts-check` and JSDoc.
This trades away some implementation type safety so ESLint can load the rules
directly before any TypeScript compilation or repository build step.

## Metadata Contract

Every local rule needs a `meta.docs` object. The guidance generator,
`lint-agent`, and local-rule ratchets all read the same fields:

- `description`: non-empty one-sentence catalog text.
- `principle`: non-empty explanation used in structured repair guidance.
- `category`: one of `maintainability`, `architecture-fitness`, or `behavior`.
- `pairedGuide`: `none` or a path that resolves to an existing file under the
  repository root.
- `repairKind`: one of `autofix`, `suggestion`, `codemod`, or `manual`.
- `repairCommand`: required only when `repairKind` is `codemod`; absent for all
  other repair kinds.

`eslint-config/local-plugin.generated.js` is the local registration point for
this contract, and it is generated — see
[Generated Registration](#generated-registration). The message-guidance suite
derives its rule set from `localPlugin.rules`, then checks each registered
rule's `messageId` against the guidance-shape or policy-shape expectations
below.

Core and plugin rules cannot provide Musi's custom `meta.docs` fields. Selected
high-traffic steering rules instead use the rule-keyed registry in
`scripts/lint-agent-guidance.ts`; a rule can supply default guidance and
optional `messageId` overrides. The same message-guidance suite checks overlay
`why`, `howToFix`, repair metadata, action verbs, length, and anti-gaming shape.
During lint-agent runs, a final flat-config entry also enables `max-depth` at
three and lowers `max-lines-per-function` to 100 effective lines over the same
production scope and ignores as their no-new ratchets. These findings are
warnings so accepted baseline debt remains advisory; changed files still get
the structured guidance named by the edit-time ratchet hook.

The message-guidance suite also carries a curated type-escape repair matrix.
Those standalone snippets must compile and must be clean under exactly
`local/no-explicit-any` plus `local/type-assertion-boundary`. The matrix is a
focused regression check for the documented repair shapes; it is manually
maintained, is not derived from diagnostic prose, and does not claim that every
message repair is clean under the complete repository ESLint configuration.

## Message Guidance

Every rule diagnostic message must follow one of two shapes, verified by
`eslint-rules/message-guidance.test.js`.

### Guidance Shape

Use when the fix requires several steps or context.

```text
Why: <one-sentence reason this is wrong>. How to fix: <one or more imperative steps>.
```

Constraints:

- Starts with `Why: ` and contains ` How to fix: `.
- Single line with no embedded `\n`.
- Length <= 520 characters.
- The "How to fix" half includes an action verb.

Examples: `concurrency-guard/noDirectWrite`,
`structured-logging/noConsole`, `no-explicit-any/noAny`.

### Policy Shape

Use when the rule states a simple policy with one-action repair.

Constraints:

- Single line.
- Length <= 180 characters.
- Includes an action verb.
- Names the sanctioned alternative or repair, such as a codemod, helper, or
  guide link.

Examples: `no-barrel/noBarrel`,
`no-llm-artifacts/leftoverEditNote`.

### Self-Contained Long Diagnostics

Some guidance-shape messages intentionally keep detailed repair policy in plain
lint output. Keep these exact tokens in both the message and this guide;
`eslint-rules/message-guidance.test.js` guards the overlap so the duplicated
prose cannot drift silently:

- `max-lines/exceed`: `eslint-config/max-lines-exceptions.baseline.json` (per-file cap exceptions on the shared baseline framework; edit the JSON then `bun run lint:max-lines-exceptions:update` to normalize); "Do not compress lines or inline useful helpers just to satisfy the metric".
- `no-explicit-any/noAny`: `unknown`, shared type, local type, and
  `// eslint-disable-next-line local/no-explicit-any -- <why this boundary is intentionally untyped>`.
- `type-assertion-boundary/missingBoundary`:
  `// type-assertion-boundary: <category> - <reason>` with categories
  `framework`, `json`, `prisma`, `test`, `interop`.

### Adding A New Rule

When you add a rule under `eslint-rules/`:

1. Decide whether the diagnostic is guidance or policy.
2. Choose the rule's activation mode: enable `local/<name>` in the owning
   `eslint-config/*.js` block for normal lint, or add a lint ratchet entry for
   it (see [Lint Ratchet](lint-ratchet.md)). There is no third option — a rule
   activated on neither surface fails control generation in the next step.
3. Run `bun run lint:local-plugin` then `bun run harness:lint-rule-controls`,
   and commit both generated files. See
   [Generated Registration](#generated-registration).
4. Use the guidance message shape, or add the rule's terse policy `messageId`
   to the policy-shape exemption set when that shape is intentional.
5. If the rule declares a `pairedGuide` (not `none`), inline a pointer to that
   guide in its message, or add the rule to the paired-guide exemption set in
   `eslint-rules/message-guidance.test.js` with a reason. The parity test
   enforces that every paired-guide rule either points at its guide or is
   exempted on purpose.
6. Run `bun run test:eslint-rules` and adjust until green.
7. Run `bun run docs:lint-guidance` if the generated local rule catalog changes,
   and `bun run docs:harness-controls` for the control inventory.

A rule whose registration is not regenerated leaves
`eslint-config/local-plugin.generated.js` or
`harness.controls.lint-rules.generated.json` stale, which fails
`bun run lint:local-plugin:check`, `bun run harness:lint-rule-controls:check`,
and `bun run harness:check`. Regenerate with the implementation change so the
convention tests cover the rule's messages immediately.

## Probing A Single Rule Under The Flat Config

Sometimes you want to run one `local/*` rule against an ad-hoc file or a
paste-in snippet without the rest of the flat config firing. Use the probe
command:

```sh
bun run lint:probe-rule -- local/type-assertion-boundary subject.ts
printf 'const value: any = 1;\n' |
  bun run lint:probe-rule -- --stdin --filename scripts/probe.ts local/no-explicit-any
```

Only the named rule runs; exit 1 means it fired, exit 0 means clean. The command
uses the lint-ratchet generated-config writer, so the `local` plugin is
registered without creating a repo-root scratch file.

The obvious `eslint --rule '{"local/...": "error"}' file.ts` does not work: a
CLI-supplied rule cannot resolve the `local` plugin, because the local plugin is
registered inside a file-scoped flat config object
(`createRepoCodeQualityConfigs` in `eslint-config/code-quality-configs.js`), not
globally. `--rule` only sets options on an already-registered rule.

Notes:

- Register the plugin under `plugins: { local: { ... } }` and enable the rule via
  `rules`. The probe command does this through the ratchet config writer. Do not
  try to pass the rule through `--rule`; the plugin registration is what
  `--rule` cannot supply.
- For a type-aware rule, mirror the relevant project-service knobs from the
  owning `eslint-config/` module in the probe's `languageOptions` instead of
  the minimal parser above. Production code uses
  `eslint-config/code-quality-configs.js`; scripts, config files, and e2e tests
  use `eslint-config/script-configs.js`,
  `eslint-config/config-file-configs.js`, and `eslint-config/test-configs.js`.
- To see which config object in the *real* flat config owns a rule (severity and
  options as actually resolved), use
  `node_modules/.bin/eslint --print-config <file>` and read the merged `rules`.

If the probe command is not enough for an unusual parser experiment, use
`bun run lint:probe-rule -- --help` as the contract for the script path and keep
any temporary config untracked.

## Type-assertion boundary marker

`local/type-assertion-boundary` (`eslint-rules/type-assertion-boundary.js`) does
not accept a free-prose reason for a TypeScript cast. Outside test files
(`*.test`, `*.spec`, `*.test-helper`), every non-`as const` assertion needs a
machine-parseable marker:

```ts
const value = raw as Foo; // type-assertion-boundary: <category> - <reason>
```

The marker may sit on the same line after the cast, or on any line of the comment
block directly above the statement (one JSDoc `/** … */` block, or a contiguous
run of `//` lines with no gap). `as const` is always allowed and needs no marker.

The two placements have different scope. A **block above the statement** covers
every cast in that statement, so one marker justifies both casts in
`const pair = [a as number, b as number];` (the worked example below). A
**trailing same-line marker** covers only the nearest cast to its left, so on
`foo(x as A, y as B); // …marker…` the marker justifies `y as B` and `x as A`
still reports `missingBoundary`; give each same-line cast its own marker or move
the justification to a block above the statement.

`<category>` must be exactly one of the five values in `ALLOWED_CATEGORIES`
(`eslint-rules/type-assertion-boundary.js`); any other category — including a
hyphen-extended form such as `framework-legacy` — fails with `invalidCategory`,
and a marker with no reason after the `-` fails with `emptyReason`:

| Category    | Use when the cast crosses…                                                    |
| ----------- | ---------------------------------------------------------------------------- |
| `framework` | A framework/library type seam ESLint can't see through (handler/plugin types) |
| `json`      | A `JSON.parse` / serialized-payload boundary with no static shape             |
| `prisma`    | A Prisma client/result shape the generated types don't narrow                 |
| `test`      | A test-only boundary in a non-test file (fixtures, mocks wired into prod-ish code) |
| `interop`   | A runtime invariant TypeScript can't express (see example below)             |

`interop` is for cases where the value is provably correct at runtime but the type
system can't follow it — e.g. `Object.entries`/`Object.keys` always typing keys as
`string`, or narrowing a value through a runtime predicate that isn't a TS type
guard. Worked example (`packages/server/src/services/level-up/asi.ts`):

```ts
for (const [key, delta] of Object.entries(abilityDeltas)) {
  // type-assertion-boundary: interop - keys come from validateAsiChoice via Object.entries (which always types keys as `string`); the runtime invariant — `abilityDeltas` only contains AbilityScores keys mapped through ABILITY_ABBREVIATION_TO_KEY — isn't expressible to TS. The `as number` narrows the indexed-access union, which would otherwise include non-ability fields like `id`/`characterId` that the key set never reaches.
  const current = freshStats[key as keyof CharacterStats] as number;
}
```

Prefer rewriting to a typed source (Zod parse, Prisma `include`, framework handler
types) over adding a marker; the marker is for real boundaries, not a way to silence
the checker.

## Satisfying Core `complexity` In Production Dispatch

The core `complexity` rule (`error`, max 10 in `eslint-config/rule-groups.js`)
is intentionally `off` for unit tests (assertion-heavy callbacks and fakes fan
out optional-chains and dispatch without being a maintainability signal) but
stays enforced in production. When a central switch/dispatch in production code
grows past the threshold, prefer the blessed table-dispatch idiom over carving
logic into helpers purely to lower the count: a `satisfies Record<Id, Handler>`
lookup table plus a `ReadonlyMap.get()` early-return. See
`scripts/drift-ai/prototype-subcommands.ts` for the reference shape. This keeps
related branches in one readable table instead of scattering them to dodge the
metric.

When a new local rule becomes a normal-lint or ratchet responsibility, treat it
as a coverage change too. Update the affected file-family rows in the lint
coverage map and run the
[Coverage Map Gate](lint-ratchet-reference.md#coverage-map-gate). The gate catches stale
map rows, unknown ratchet ids, unaccounted tracked files, and full-mode ESLint
reach gaps before reviewers rely on a `local/*` rule for files ESLint does not
actually reach.
