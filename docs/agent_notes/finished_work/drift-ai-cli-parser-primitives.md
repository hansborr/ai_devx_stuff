# drift:ai CLI parser primitives

Completed drift-ai review task 10.

`scripts/drift-ai/arg-readers.ts` now owns shared option-name parsing,
space/equals value reading, `--format` validation, and non-empty path validation.
The main `parseArgs` flow and subcommand `parseSubcommandArgs` flow remain
separate, but both use the same low-level readers.

No direct helper-only tests were added because the parser-level tests already
cover the public behavior: space and equals forms, missing values with usage,
empty path values, invalid formats, and boolean flags rejecting values.

Validation:

- `bash scripts/vitest.sh run --passWithNoTests --project=scripts scripts/drift-ai.test.ts scripts/drift-ai/subcommand-args.test.ts`
- `bash scripts/vitest.sh run --passWithNoTests --project=scripts scripts/drift-ai`
- `bunx eslint scripts/drift-ai/arg-readers.ts scripts/drift-ai/cli-args.ts scripts/drift-ai/subcommand-args.ts`
- `bun run drift:ai --scope current --root scripts/drift-ai --check all --format text`
- `FORCE_VERIFY=1 bun run verify:changed`
