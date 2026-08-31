# drift:ai Musi integration

The surfaces that exist only because drift:ai lives in Musi. None of this
applies to a foreign target repo — see
[portability-contract.md](portability-contract.md) for what is portable.

## Musi-only subcommands

`harness-freshness` is intentionally Musi-specific. It checks
`docs/ai-harness.md` against `docs/guides`, so it remains a separate subcommand
and is not part of the portable default check surface. The underlying function
already accepts `harnessPath` and `guidesDir` options if another repo ever needs
to call it directly, but no portable CLI flags are wired for that layout today.
Like `hotspots`, it runs on the shared subcommand arg parser, so it honors
`--format text|json` and `--output`.

## Musi-only `HarnessDiagnostics` sidecar

Set `HARNESS_DIAGNOSTICS_OUTPUT=<path>` and drift:ai also writes a shared
`HarnessDiagnostics` envelope to that path. This is opt-in and **Musi-only**: it
exists so the broader harness (`harness:audit`, fusion lanes) can consume drift
results without parsing the text report or the drift-specific JSON.

```sh
HARNESS_DIAGNOSTICS_OUTPUT=reports/drift-diagnostics.json bun run drift:ai
```

How it differs from `--format json`:

- `--format json` is the **portable** report surface: the full `DriftReport`
  (scope, enabled/skipped checks, every finding) for any target repo. The sidecar
  is a **projection** onto the shared schema — drift findings become `warn`
  entries, skipped checks become `info` entries (so an absent check is never read
  as a clean pass), and enabled-but-clean checks emit nothing.
- The sidecar's `control` ids resolve in Musi's `harness.controls.json`, so it is
  meaningless against a foreign target; for foreign repos use `--format json`.
- On a successful write, native stdout and any `--output` / `--chunk-dir` files
  are unchanged; the sidecar is written in addition to them. An unset or empty
  value writes nothing. An unwritable path or a failed schema validation is a
  CLI/tool error (exit `2`), never a drift finding: the run then reports that
  tool error (so a stdout-bound report is replaced by the error message, while
  any `--output` / `--chunk-dir` files written before the failure survive). The
  report-only exit contract (`0`, or `1` only under `--fail-on-findings` /
  `--fail-on-runtime-cycles`) is otherwise preserved.
