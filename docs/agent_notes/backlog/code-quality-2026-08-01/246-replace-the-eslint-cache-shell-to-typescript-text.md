# 246. Replace the ESLint cache shell-to-TypeScript text protocol with one typed cache plan

Status: Landed on fix/cq-170
Theme: Give ESLint cache policy a typed reusable boundary · Area: harness · Severity: low · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: medium

## Problem

ESLint cache identity determines whether rule, configuration, dependency, and
type-graph changes invalidate diagnostics for otherwise unchanged files. That
policy has one implementation, but it is trapped inside sourced shell:
fingerprinting crosses a temporary file and embedded Node heredoc, preparation
returns through ambient globals, and the TypeScript lint agent constructs Bash
source text and reconstructs an argument array from newline-delimited stdout.

The compiler therefore cannot connect either consumer to the cache result's
shape. A new argument, reordered field, unexpected output line, or quoting
change can break the boundary independently of the cache policy. The lint
agent does degrade to an uncached run on detectable failures, but maintaining
that defensive parser is additional work around a contract TypeScript could
represent directly.

## Evidence

- `scripts/lib/eslint-main-cache.sh:60-117` — fingerprinting copies the
  NUL-delimited path list into a temporary file and passes it to an embedded
  Node heredoc that hashes each path and its contents.
- `scripts/lib/eslint-main-cache.sh:148-187` — preparation, stale-directory
  pruning, and argument selection communicate through
  `MUSI_ESLINT_MAIN_CACHE_DIR` and `MUSI_ESLINT_MAIN_CACHE_ARGS` rather than a
  returned value.
- `scripts/lint-agent.ts:38-72` — the TypeScript consumer builds Bash source
  that sources the shell library, splits stdout by newline, and validates only
  that the first recovered argument is `--cache` before forwarding the rest.
- `scripts/lib/eslint-main-cache.sh:18-53` — the identity currently includes
  TypeScript sources and build metadata, ESLint configuration and local rules,
  workspace package manifests, and `bun.lock`, while pruning generated and
  transient directories from discovery.
- `scripts/tests/test-lint-changed.sh:332-450` — shell smoke coverage pins
  invalidation for source and declaration changes, `tsconfig.tsbuildinfo`,
  local rule/config changes, workspace manifests, and the lockfile.
- `scripts/tests/test-lint-changed.sh:498-561` — the same smoke preserves
  absolute keyed cache locations, stale-identity pruning, coexistence of four
  partition entries, and trailing-slash normalization.
- `scripts/tests/test-lint-agent.sh:529-593` — lint-agent coverage proves that
  a non-linted type-graph change moves the cache identity and prunes its stale
  sibling, but it exercises that contract through the shell boundary.

## Proposed direction

Create one importable TypeScript cache-plan module under `scripts/lib/`. Give
it an explicit input containing the repository root, optional configured cache
root, and optional validated partition key, and return a typed result
containing the selected identity directory and exact ESLint argument vector.

Move deterministic identity discovery, content hashing, cache-root
normalization, cache-location selection, and stale-identity pruning behind
that module. Preserve the current input set and byte-sensitive behavior,
including NUL-safe path handling, deterministic missing-file hashing, absolute
cache locations, the unkeyed `.eslintcache`, keyed
`<partition>.eslintcache` entries, and `--cache-strategy content`.

Have `lint-agent.ts` import the module and consume its typed result directly.
Delete its constructed Bash, stdout splitting, and first-token protocol check.
Wrap the import, preparation, and result validation in the existing
correctness-first boundary: any failure must still log the uncached-run
diagnostic and return no cache arguments.

Keep `eslint-main.sh` on a thin shell adapter over the same TypeScript owner.
The adapter may retain genuinely shell-specific process and argv glue, but it
must not duplicate fingerprint, pruning, key, or location policy. Its process
boundary must preserve argument boundaries and validate the complete result;
do not replace the current newline protocol with another unchecked textual
record or expose a second policy implementation.

Port the focused cache-policy cases to TypeScript unit coverage before removing
the shell implementation. Retain shell smoke coverage for the adapter and
partitioned runner, and extend the lint-agent smoke with preparation-failure
and malformed-result cases proving that ESLint still runs without cache
arguments. Keep the existing identity-change, pruning, keyed-location,
trailing-slash, newline-path, and missing-path cases as behavior-preservation
checks across the extraction.

## Scope / caveats

- Preserve every current cache identity input, exclusion, root override,
  location spelling, partition key restriction, pruning rule, and
  `content` strategy. This proposal changes ownership and transport, not cache
  invalidation policy.
- Lint-agent's fallback is binding: preparation, filesystem, import, or result
  failures must never make it use an uncertain cache or prevent the uncached
  lint run.
- Do not retain parallel Bash and TypeScript implementations or introduce
  parity tests whose purpose is to maintain both indefinitely. Shell remains
  only where process orchestration genuinely requires it.
- [29-bash-to-ts-cores.md](../code-quality-2026-07-25/29-bash-to-ts-cores.md)
  (CQ25-124) supplies the measured Bash-facade/TypeScript-core precedent. It
  does not cover ESLint cache identity, pruning, keyed locations, or argument
  transport; this leaf applies that boundary without reopening the broader
  Bash-to-TypeScript ruling.
- Keep this work separate from
  [141-latest-log-discovery-mirrors-verify-state.md](./141-latest-log-discovery-mirrors-verify-state.md).
  That leaf removes a duplicated verify-state derivation while preserving
  frequent shell-owned hook primitives; this leaf owns the distinct ESLint
  cache plan and its two consumers.
