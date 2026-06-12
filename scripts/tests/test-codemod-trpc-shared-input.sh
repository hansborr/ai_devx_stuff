#!/bin/bash
# Thin CLI smoke test for scripts/codemods/trpc-shared-input.ts.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEMOD="$REPO_ROOT/scripts/codemods/trpc-shared-input.ts"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

SANDBOX="$(mktemp -d /tmp/musi-codemod-trpc-shared-input-cli.XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/packages/server/src/routers" "$SANDBOX/packages/shared/src/schemas"
cat >"$SANDBOX/packages/server/src/routers/thing.ts" <<'TS'
import { z } from "zod";

import { protectedProcedure, router } from "../trpc/trpc.js";

export const thingRouter = router({
  create: protectedProcedure.input(z.object({ id: z.string() }).strict()).mutation(() => null),
});
TS

output="$(
  cd "$SANDBOX" && bun "$CODEMOD" "packages/server/src/routers/thing.ts"
)" || fail "input codemod CLI failed"

grep -qF "trpc-shared-input codemod: moved createInputSchema" <<< "$output" \
  || fail "input codemod CLI did not report moved schema: $output"
grep -qF "createInputSchema" "$SANDBOX/packages/server/src/routers/thing.ts" \
  || fail "input codemod CLI did not rewrite router"
grep -qF "export type CreateInput" "$SANDBOX/packages/shared/src/schemas/thing-inputs.ts" \
  || fail "input codemod CLI did not create shared input schema"

printf 'codemod trpc-shared-input CLI smoke passed\n'
