#!/usr/bin/env bash
# The runtime import-cycle floor lane for the lint composites: drift:ai
# import-cycles over the whole working tree, failing only on runtime cycles
# (--fail-on-runtime-cycles); type-only cycles stay report-only evidence.
# Kept as its own script so the lint wrapper sandbox tests can stub the lane
# the same way they stub lint-config-sensors.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bun "$SCRIPT_DIR/drift-ai.ts" --scope current --check import-cycles --fail-on-runtime-cycles
