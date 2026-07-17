export function usage(): string {
  return [
    "usage: bun scripts/lint-ratchet.ts [--update [--allow-worse --reason <why>] [--migration-reason <why>] [--retire-ratchet <id> [--accept-different-options --reason <why>]] | --check-baseline | --check-debt-accounting | --check-registry | --summary [--by-directory [depth]] | --trend [--since <date>] [--max <n>] [--all] | --zero-baseline | --report | --debt-log | --propose <ruleId> <glob...> | --edit-check-targets <relpath>... | --edit-check --targets-file <file> | --edit-ratchet-coverage <relpath>...]",
    "",
    "Default mode emits a harness-diagnostics envelope and fails on ratchet regressions or uncommitted improvements.",
    "--migration-reason <why> records why a changed ratchet metric is the right measure on the metric-migration debt-log entry; without it a lone --reason answers both the migration and any --allow-worse acceptance in the same update.",
    "--retire-ratchet <id> drops a zero-finding orphan baseline floor without --allow-worse and appends a non-debt retirement record, but only when normal lint now errors on the retired scope (proven promotion).",
    "--accept-different-options requires --retire-ratchet and --reason; it human-attests an all-error normal-lint replacement whose options differ, prints the option delta, and records the attestation.",
    "--summary prints committed baseline totals without running ESLint; add --by-directory [depth] to group remaining findings by directory. --trend reads committed baseline history and defaults to active ratchets; add --all for retired series too. It prints active/retired status plus first/last/min/max totals. --zero-baseline audits drained ratchets against normal ESLint; --check-debt-accounting compares baseline increases to same-range debt-log entries, with --staged for index blobs and --base-ref <ref> for a custom comparison branch; --report formats a diagnostics envelope from stdin; --debt-log renders accepted debt, retirements/removals, migrations, and coverage changes from committed history.",
    "--propose <ruleId> <glob...> runs one core or local rule as a dry run and prints the would-be ratchet baseline without touching the registry or committed baseline.",
    "--edit-check-targets lists matching minimal-TS ratchets for edited paths (no ESLint); --edit-check lints the targets in <file> and prints only fresh ratchet regressions, for the edit-time advisory hook.",
    "--edit-ratchet-coverage prints, per edited path, the committed-baseline ratchet rule ids tracking it (no ESLint), for the lint-coverage advisory hook.",
  ].join("\n");
}
