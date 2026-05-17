# Leaf 19 Pass 1 inventory - eslint-plugin-import-x

Date: 2026-05-16
Branch: feat/lint-hardening-leaf-19 (no install committed; probe only)

## Plugin behavior

Probe installed `eslint-plugin-import-x@4.16.2` and enabled only
`import-x/no-extraneous-dependencies` with per-package `packageDir` blocks for
`packages/{shared,server,client}/src` plus `scripts/`.

The requested option names are valid in 4.16.2:

- `packageDir`: `string | string[]`
- `devDependencies`: `boolean | string[]`
- `includeInternal`: `boolean`
- `includeTypes`: `boolean`

Important behavior: `devDependencies` globs only decide whether an import from
that package's own `devDependencies` is allowed in matching files. They do not
make root-level devDependencies available to package source files. With
`packageDir` pointed at `packages/shared`, `packages/server`, or
`packages/client`, imports of root-only tools such as `vitest` and `prettier`
are reported as missing from the relevant package manifest.

One client finding showed the glob boundary too: `@testing-library/react` is in
`packages/client` devDependencies, but the importing file is a
`*.test-helper.ts` file rather than a `*.test.ts`/`*.spec.ts` file, so the rule
reported it as a devDependency used from non-dev source.

## Per-package finding counts

| package | finding count | dominant pattern |
| --- | ---: | --- |
| `packages/client` | 258 | 257 `vitest` imports in tests; 1 `@testing-library/react` import in a test helper outside the allowed dev glob |
| `packages/server` | 165 | 163 `vitest` imports in tests; 2 `prettier` imports in `src/seed` generators |
| `packages/shared` | 49 | 49 `vitest` imports in tests |
| total | 472 | Mostly root-only dev tooling imported from package source/test files |

Dependency totals:

| dependency | finding count | notes |
| --- | ---: | --- |
| `vitest` | 469 | Root devDependency only; not declared in package manifests |
| `prettier` | 2 | Root devDependency only; imported by server `src/seed` generator modules |
| `@testing-library/react` | 1 | Client devDependency, but imported by a `*.test-helper.ts` file outside the allowed devDependency globs |

## Sample findings

- `packages/client/src/components/app-header.test.tsx:4` - `vitest` missing
  from `packages/client/package.json`.
- `packages/client/src/hooks/canvas-input/use-canvas-input.test-helper.ts:1` -
  `@testing-library/react` is a client devDependency but the file is outside
  the configured test globs.
- `packages/server/src/app.test.ts:2` - `vitest` missing from
  `packages/server/package.json`.
- `packages/server/src/seed/generate-srd-rules-glossary.ts:12` - `prettier`
  missing from `packages/server/package.json`.
- `packages/server/src/seed/generate-srd-spells.ts:13` - `prettier` missing
  from `packages/server/package.json`.
- `packages/shared/src/dice/dice-notation.test.ts:1` - `vitest` missing from
  `packages/shared/package.json`.
- `packages/shared/src/rules/attack-damage.test.ts:1` - `vitest` missing from
  `packages/shared/package.json`.

## Verdict

Defer. The rule is viable, but the first probe is not a small cleanup slice:
472 findings exceed the Leaf 19 Pass 1 threshold. Most findings point at a
repo policy decision that package test/dev imports currently rely on root
devDependencies rather than package-local declarations.

No `eslint-plugin-import-x` install, lockfile change, or ESLint config change
is committed from this pass.

## Recommended Pass 2 approach

1. Decide whether package tests must declare direct test-runner/tooling
   devDependencies in each package manifest. If yes, add `vitest` to
   `packages/shared`, `packages/server`, and `packages/client` with the package
   manager, then re-probe.
2. Decide whether package-local test helper files should be allowed to import
   package devDependencies. If yes, add an explicit dev glob such as
   `**/*.test-helper.{ts,tsx}` rather than broadening source ignores.
3. Classify `packages/server/src/seed/*` as runtime source or dev tooling. If
   those generators remain under `src`, either declare `prettier` in the
   appropriate server manifest field or move the generators into a dev-tooling
   path covered by an explicit devDependency glob.
4. Re-run the same per-package `import-x/no-extraneous-dependencies` probe and
   fix any remaining non-tooling findings one import at a time.
5. Keep the manifest-policy script parked as a separate Leaf 19 slice.
