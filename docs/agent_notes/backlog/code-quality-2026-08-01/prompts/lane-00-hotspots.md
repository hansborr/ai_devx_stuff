# Lane 00 — hotspot mapping (Phase 1)

Status: Dispatch material — not a schedulable note

This lane runs **before** the area sweeps and produces a hotspot map, not
findings. It dispatches **standalone**: TEMPLATE.md is *not* prepended, and
the finding-contract JSON does not apply — this is a metrics task, not a
findings sweep.

Every drift-ai row below is **evidence for ranking sweep attention, never a
defect to report**. All commands were verified against this checkout on
2026-08-01; if one errors anyway, read `scripts/drift-ai/README.md` and
`scripts/drift-ai/docs/prototype-subcommands.md` before changing flags — do
not guess.

**Setup.** Run everything from the repo root. Create one scratch directory
outside the repo (`SCRATCH="$(mktemp -d)"`) and give every `--output` an
absolute path under it — drift-ai output inside the repo is gitignored
packet noise. Reference those absolute paths in your report.

**Task.**

1. **Main sweep — every implemented check, whole tree** (~30 s; roots come
   from the repo's `drift-ai.config.json`):

   ```sh
   bun run drift:ai -- --scope current --check all --format json \
     --output "$SCRATCH/drift-report.json"
   ```

   Expect ~2,000 findings dominated by `duplicate-literals`. Do not read
   this JSON directly — step 5 compacts it; the raw file is for follow-up
   depth on specific clusters only. The `suppressions` check skipping in
   `current` scope is expected, not an error.

2. **Git-history lenses** (advisory subcommands; default windows are fine):

   ```sh
   bun run drift:ai -- hotspots --lens all --format json --output "$SCRATCH/hotspots.json"
   bun run drift:ai -- coldspots --lens all --format json --output "$SCRATCH/coldspots.json"
   ```

3. **Dolos fragment-clone candidates** (optional engine, provisioned
   per-checkout under gitignored `.tools/` — the binary is *not* on PATH,
   so the `--dolos-bin` override is required). Run once per configured root
   so the 2,000-file cap never silently truncates a whole-tree run
   (~30 s per root):

   ```sh
   for root in packages/shared/src packages/server/src packages/client/src scripts eslint-rules; do
     bun run drift:ai -- dolos-candidates --root "$root" --top 40 \
       --dolos-bin /workspace/.tools/dolos/node_modules/.bin/dolos \
       --format json --output "$SCRATCH/dolos-${root//\//_}.json"
   done
   ```

   A `cap reported pairs: HIT` header means that run is partial — use pair
   *density per directory* as the signal, not the pair list as a census.
   High-similarity pairs among Zod schema files are expected boilerplate;
   weigh clusters that are *not* explained by schema shape.

4. **Semgrep community-rule candidates** (optional engine, provisioned
   per-checkout: pinned semgrep 1.165.0 auto-resolves from
   `.tools/semgrep/.venv`; the GitLab SAST community rules and their
   license consent are declared in the checkout-local manifest — no extra
   flags needed). Scans all config roots; allow several minutes:

   ```sh
   bun run drift:ai -- semgrep-candidates \
     --rule-source-manifest .tools/semgrep/gitlab-rules.json \
     --format json --output "$SCRATCH/semgrep.json"
   ```

   These rules are security-shaped, and this audit excludes security
   review: use match *density* per rule and directory as a hotspot signal
   only. If an individual match looks like a genuine bug, add a one-line
   entry to a "suspected bugs" section of your report (the orchestrator
   routes it to the bugs handoff) and move on — do not develop it.

5. **Compact steps 1, 3, and 4 with the purpose-built reducer** before
   reading any of them — `drift:triage` merges overlapping evidence and
   defers known noise (test-only rows, type-only cycles, unranked repeated
   literals) with counted reasons, turning ~2,100 raw rows into a ranked
   queue of ~300 items:

   ```sh
   bun run drift:triage -- --output "$SCRATCH/triage.txt" \
     "$SCRATCH/drift-report.json" "$SCRATCH/semgrep.json" "$SCRATCH"/dolos-*.json
   ```

   Read `$SCRATCH/triage.txt` as your primary drift-ai evidence: the
   review queue is ranked, and the "deferred by policy" counts are
   themselves a density signal (e.g. which areas pile up deferred
   literals — rerun with `--include-literals` only if that looks
   load-bearing). Valid inputs are drift reports and semgrep/dolos
   advisory JSON only; `hotspots.json`/`coldspots.json` are *not*
   accepted — read those two directly, they are already compact ranked
   lenses. Go back to the raw step-1/3/4 JSON only to deepen a specific
   cluster the queue surfaced.

6. **Cheap repo-metric signals:** files changed most since the prior
   audit's pin (`git log {{PRIOR_AUDIT_SHA}}..{{AUDIT_TARGET_SHA}}
   --name-only`), longest source files per package, densest
   lint-suppression/type-assertion-marker files, largest test files,
   TODO/FIXME density.

7. **Synthesize** a ranked hotspot report: which directories/modules
   deserve extra wave-1/wave-2 sweep attention and why, each with the
   signal(s) that put it there. Note where drift-ai, Dolos/Semgrep, and
   the cheap metrics disagree.

**Output.** Your final response IS the deliverable — write no files inside
the repo. Respond with a markdown report (not the JSON contract): ranked
hotspots with signals, a short "signals tried that produced nothing"
section, and the "suspected bugs" section if step 4 produced any, citing
the absolute `$SCRATCH` paths for anything worth re-reading.
