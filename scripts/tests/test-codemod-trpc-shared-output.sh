#!/bin/bash
# smoke-order: 140
# smoke-subjects: scripts/codemods/trpc-shared-output-candidates.ts
# smoke-subjects: scripts/codemods/trpc-shared-output.ts
# smoke-subjects: scripts/codemods/lib/
# smoke-subjects: scripts/tests/test-codemod-trpc-shared-output.sh
# smoke-subjects: package.json
# smoke-subjects: tsconfig.scripts.json
# Thin CLI smoke test for scripts/codemods/trpc-shared-output.ts.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEMOD="$REPO_ROOT/scripts/codemods/trpc-shared-output.ts"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

SANDBOX="$(mktemp -d /tmp/musi-codemod-trpc-shared-output-cli.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/packages/server/src/routers" "$SANDBOX/packages/shared/src/schemas"
cat >"$SANDBOX/packages/server/src/routers/thing.ts" <<'TS'
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure.output(z.object({ success: z.boolean() })).mutation(() => null),
});
TS

output="$(
  cd "$SANDBOX" && bun "$CODEMOD" "packages/server/src/routers/thing.ts"
)" || fail "output codemod CLI failed"

grep -qF "trpc-shared-output codemod: moved createOutputSchema" <<< "$output" \
  || fail "output codemod CLI did not report moved schema: $output"
grep -qF "createOutputSchema" "$SANDBOX/packages/server/src/routers/thing.ts" \
  || fail "output codemod CLI did not rewrite router"
grep -qF "export type CreateOutput" "$SANDBOX/packages/shared/src/schemas/thing.ts" \
  || fail "output codemod CLI did not create shared output schema"

printf 'codemod trpc-shared-output CLI smoke passed\n'
