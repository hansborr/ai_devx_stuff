#!/bin/bash

# Shared display-only output filtering for known noisy third-party warnings.
# Keep raw log files unchanged; use this only before printing tails/summaries.

ai_filter_known_output_noise() {
  sed -E \
    -e '/DeprecationWarning: Calling client\.query\(\) when the client is already executing a query is deprecated and will be removed in pg@9\.0/d' \
    -e '/Use `node --trace-deprecation \.\.\.` to show where the warning was created/d' \
    -e "/Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set/d"
}
