# 19 — Make the porting-knob list greppable and verifiable

Status: Done
Track: T (tooling) · Priority: P3 · Size: M

## Evidence (verified 2026-07-11; adversarial triage 2026-07-11 confirmed all citations at HEAD and narrowed scope; re-verify before implementing)

This repo is meant as a public harness-engineering reference; the mechanisms
are portable but their repo-specific knobs are scattered:

- `scripts/ai-hooks/README.md:146` ("Porting This") — already *enumerates*
  the sharp edges (`/workspace` fallbacks, `/tmp/musi-*` state roots,
  `MUSI_*`/`AI_*` env prefixes, the `bun run` assumption, the `policy.sh`
  wrapped-script whitelist, the `protected-files.sh` table) but the list is
  prose: nothing checks it against the code, so it can rot silently.
- Triage correction: several of these are not strictly hardcoded — they are
  env-overridable `${VAR:-default}` assignments (`AI_STATE_ROOT` at
  `scripts/ai-hooks/cache.sh:13`, `AI_RESULT_COMMAND_TMP_PREFIX` at
  `scripts/ai-hooks/common.sh:338`, sweep prefixes at `cache.sh:60`). The
  copier's problem is *discoverability* of the full knob set, not
  overridability.
- `scripts/harness/generate-verify-steps.ts:25` — `CONSUMERS` table. This is
  already a clearly-marked const at the top of the one generator; it needs a
  marker, not relocation.
- `scripts/test-changed.sh:155-234` — full-suite classifiers hardcode this
  repo's layout (`packages/{shared,server,client}`, `eslint-rules/*`,
  `eslint-config/*`, `tsconfig.scripts.json`). Triage correction: these case
  patterns are routing *semantics* a copier must rewrite for their own repo;
  lifting them into a data table relocates, not reduces, the work.
- `scripts/git/restore-generated-baseline-stage.sh:31-40` — hardcodes exactly
  three baseline filenames (small allowlist; candidate for leaf 12's
  policy-as-data treatment or a marker).

## Do

Land after leaves 05 and 12 shrink the scattered set. Then, instead of a
repo-wide config-indirection layer (original framing; rejected in triage as
churn), make the existing "Porting This" checklist verifiable:

1. Consolidate the shell-side repo-specific defaults that are already
   scattered across `common.sh`/`cache.sh` (`/workspace` fallback,
   `/tmp/musi-*` state roots and sweep prefixes) into one clearly-marked
   block near the top of `common.sh`. Every hook already sources it, so this
   adds no new dependency and no behavior change.
2. Adopt a short greppable marker comment (e.g. `# porting-knob: <name>` /
   `// porting-knob: <name>`) on knobs that should stay where they are: the
   `CONSUMERS` table, the `test-changed.sh` classifiers, the baseline
   allowlist, the `policy.sh` wrapped-script list, the `protected-files.sh`
   table.
3. Add a cheap parity check (README "Porting This" bullet set vs. grep of
   the marker) to `harness:check` or a scripts test, following the existing
   parity-gate precedent (cf. leaf 06).

Explicit non-goals: do not parameterize the `MUSI_*`/`AI_*` env-var prefixes
(indirection on variable names is worse than a copier's global rename); do
not convert the `test-changed.sh` classifier logic into data; do not move
the `CONSUMERS` table out of its generator.

## Verify

```
bun run harness:check
bun run verify:changed
```

## Acceptance

`grep -rn "porting-knob"` finds every repo-specific assumption a copier must
retarget; the README "Porting This" list is parity-checked against the
markers so it cannot rot; shell-side defaults live in one marked block in
`common.sh`; no behavior change.
