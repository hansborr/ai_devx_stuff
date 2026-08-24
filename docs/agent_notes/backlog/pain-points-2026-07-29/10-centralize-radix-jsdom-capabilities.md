# Centralize Radix JSDOM Capabilities

Status: Implemented
Date: 2026-07-29
Priority: P2
Size: S
Source: `test-fixtures-races-and-environment.md` — “Shared test state leaks
across files”

## Problem

Four client test files independently install the same missing
`HTMLElement.prototype` capabilities required by Radix Select:

- `packages/client/src/components/character-create/steps/background-step.test.tsx:29-46`
- `packages/client/src/components/homebrew/class/class-form-fields.test.tsx:23-40`
- `packages/client/src/components/homebrew/subclass/subclass-form-fields.test.tsx:20-37`
- `packages/client/src/components/sheet/add-item-dialog.test.tsx:19-36`

The blocks are global mutations installed in per-file `beforeAll` hooks. They
duplicate setup, depend on file ordering under the client's shared
`isolate:false` environment, and leave each new Radix test to rediscover the
same JSDOM gap. The central client setup already installs missing browser
capabilities in a defensive per-test block at
`packages/client/src/test/setup.ts:186-208`. The production split runner places
these files in the shuffled `--no-isolate` lane
(`scripts/client-test-isolation-runner.ts:73-92`); a live classifier run on
2026-07-29 classified all four as no-isolate and none as compatibility-lane
tests.

This is a narrow capability-fixture cleanup. It does not reopen the existing
client mock-isolation campaign or the unverified combat-store spy anecdote.

## Scope

- In `packages/client/src/test/setup.ts`, install
  `HTMLElement.prototype.hasPointerCapture`, `setPointerCapture`,
  `releasePointerCapture`, and `scrollIntoView` in the existing global
  `beforeEach` at `packages/client/src/test/setup.ts:186-208`. Define them with
  `configurable: true`; `hasPointerCapture` returns `false` and the other three
  return `undefined`. Re-define all four on every test so deletion or
  replacement by a previous test is repaired.
- Add `packages/client/src/test/setup.test.ts` as a compact restoration
  sentinel: deliberately delete/replace the four capabilities in one test and
  prove the next test begins with the Radix-facing behavior restored.
- Delete the local prototype blocks from
  `packages/client/src/components/character-create/steps/background-step.test.tsx:29-46`,
  `packages/client/src/components/homebrew/class/class-form-fields.test.tsx:23-40`,
  `packages/client/src/components/homebrew/subclass/subclass-form-fields.test.tsx:20-37`,
  and `packages/client/src/components/sheet/add-item-dialog.test.tsx:19-36`;
  remove only the now-unused `beforeAll` imports.
- Run the contract file and four consumers together under `--no-isolate
  --sequence.shuffle.files` with seeds 1, 2, and 3. Use the production project:
  `bash scripts/vitest.sh run --passWithNoTests --project=client --no-isolate
  --sequence.shuffle.files --sequence.seed=<seed> <five files>`.

## Acceptance

- All four current Radix test files pass without local prototype shims.
- A later no-isolate file cannot inherit missing capabilities because an
  earlier file removed them.
- The shared definitions match the minimal behavior the current tests need and
  do not emulate unrelated browser APIs.
- Focused shuffled runs at seeds 1, 2, and 3 are green without order-specific
  setup.
- `bun scripts/client-test-isolation-classifier.ts --json <four consumer files>`
  continues to report four no-isolate files and zero isolated files.

## Resolved decisions

- Restore the capabilities in the existing global `beforeEach`, not once at
  module load. The suite deliberately shares a module/global environment, and
  `packages/client/src/test/setup.ts:186-208` already uses per-test restoration
  because a peer may tear down shared browser globals. Four property definitions
  per test are negligible beside a JSDOM test render and make the recovery
  acceptance case enforceable.

## Open questions

None.
