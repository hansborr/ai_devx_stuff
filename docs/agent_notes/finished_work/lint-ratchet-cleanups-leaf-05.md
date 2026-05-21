# Leaf 05 Ratchet Cleanup Batch

Resolved on 2026-05-19.

The only applicable code cleanup was `parseBaselineTest`: the parser now uses
parsed/narrowed locals for rule id, mode, target, metric, config hash, and the
optional rule-source hash instead of repeating validation conditions in the
return guard.

Audit dispositions:

- Failure label before exit code 1 was already done; default regressions print
  `lint:ratchet FAIL`.
- Usage/config exit-code 2 smoke cases were already covered for unknown args,
  invalid mode combinations, `--allow-worse` outside update mode, missing
  reason, and blank reason cases.
- `minDefined` and `CACHE_HASH_PREFIX_LENGTH` were already present.
- Structural baseline JSON mutations already use `bun -e` JSON parsing and
  stringifying; no `perl` JSON mutation remains.
- The old PR 4 in-progress plan was already gone; durable PR 4 notes remain in
  `finished_work/`.
- Verify-wrapper descriptions already mention `lint:ratchet` in the manifest
  and generated harness controls doc.
- Cache sweeping was skipped per the Leaf 05 scope guard. Existing prior
  `sweepStaleCacheSiblings` support was left untouched; this leaf made no cache
  behavior change.

