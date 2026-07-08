# Local ESLint Rules

Authoring conventions for rules in `eslint-rules/`.

For projects adapting the guidance pipeline to Biome, see
[Biome Lint Adoption](biome-lint-adoption.md). The portable part is the
metadata and `HarnessDiagnostics` envelope; the current discovery mechanism is
ESLint-specific.

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
- In the agent local-rule envelope, `bun run lint:agent:local-rules` and
  `bun run lint:agent:local-rules:changed` emit harness diagnostics for
  `local/*` findings and parser errors. `scripts/lint-agent.ts` maps ESLint
  errors to harness `block` findings and ESLint warnings to harness `warn`
  findings, then exits nonzero only when the envelope has blocking findings.
  Harness warnings are advisory and non-blocking in that envelope.

The distinction exists because normal ESLint is the enforcement floor, while
the agent envelope is a structured local-rule view for agents and hook
surfaces. It carries rule metadata, repair kind, and paired-guide context
without pretending to be full lint parity. Keep merge enforcement in normal
lint, ratchet, pre-commit, and CI. Use envelope warnings for useful agent
guidance that should not stop the local agent loop. If `lint-agent` ever becomes
a gate, add an explicit mode that fails warnings too instead of changing the
current advisory meaning silently.

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

`eslint-config/local-plugin.js` is the local registration point for this
contract. The message-guidance suite derives `ALL_LOCAL_RULES` from
`localPlugin.rules`, then checks each registered rule's `messageId` against the
guidance-shape or policy-shape expectations below.

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
2. Import and register the rule in `eslint-config/local-plugin.js`.
3. Use the guidance message shape, or add the rule's terse policy `messageId`
   to the policy-shape exemption set when that shape is intentional.
4. If the rule declares a `pairedGuide` (not `none`), inline a pointer to that
   guide in its message, or add the rule to the paired-guide exemption set in
   `eslint-rules/message-guidance.test.js` with a reason. The parity test
   enforces that every paired-guide rule either points at its guide or is
   exempted on purpose.
5. Run `bun run test:eslint-rules` and adjust until green.
6. Run `bun run docs:lint-guidance` if the generated local rule catalog changes.

A rule file that is not registered in `localPlugin.rules` fails the registry
completeness test and will not run in lint. Register new rules with their
implementation change so the convention tests cover their messages immediately.

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

`<category>` must be exactly one of the five values in `ALLOWED_CATEGORIES`
(`eslint-rules/type-assertion-boundary.js`); any other category fails with
`invalidCategory`, and a marker with no reason after the `-` fails with
`emptyReason`:

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
  // type-assertion-boundary: interop - keys come from validateAsiChoice via Object.entries (which always types keys as `string`); the runtime invariant isn't expressible to TS. The `as number` narrows the indexed-access union, which would otherwise include non-ability fields the key set never reaches.
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
[Coverage Map Gate](lint-ratchet.md#coverage-map-gate). The gate catches stale
map rows, unknown ratchet ids, unaccounted tracked files, and full-mode ESLint
reach gaps before reviewers rely on a `local/*` rule for files ESLint does not
actually reach.
