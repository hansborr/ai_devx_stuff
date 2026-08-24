# 81. The lint-ratchet adoption docs teach the retired copy-set architecture alongside the landed package-plus-adapter seam, down to a file that no longer exists

Status: Landed on fix/cq-081
Theme: Docs teach the landed architecture · Area: docs · Severity: high · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet adoption guide is the primary copyability artifact for the
packaged engine — the document an external adopter follows to get
`tools/lint-ratchet/` running in their own repository. It cannot currently be
followed end to end, because it is two architectures spliced together.

Tier 1 opens correctly: the engine is a self-contained package, copy the whole
directory, bind it with a thin adapter you write, no copy manifest. But the same
Tier-1 intro claims the runner "still emits a `HarnessDiagnostics` JSON
envelope" — which is Musi's adapter-owned envelope, explicitly *outside* the
package — and the "What to change" checklist then orders the adopter to delete,
stub, or rewrite imports in `scripts/lint-ratchet/registry-builders.ts`,
`scripts/lib/lint-rule-docs.ts`, and `scripts/harness/harness-diagnostics-output.ts`.
Those files exist only in Musi's tree. A package-copy adopter never obtains
them; the instructions are leftovers from the pre-seam era when adoption meant
copying a manifest-enumerated set of `scripts/` files. The companion reference
guide compounds it: it points readers at `scripts/lint-ratchet/ratchet-globs.ts`,
a file that does not exist anywhere in the repo (the matcher lives inside the
package now), and its CI advice cross-links "the manifest's
`runtimeFiles`/`expandDirectories`" — a concept the adoption guide itself says
was retired.

For a repository whose stated purpose is being a public harness-engineering
reference, this misleads exactly its core audience: an adopter either wastes
time hunting for files they were never given, or reconstructs the retired
copy-set architecture the package seam was built to eliminate. Nothing else
tracks this debt — the seam work closed with the implementation landed and no
documentation residue recorded.

## Evidence

- `docs/guides/lint-ratchet-adoption.md:65-68` — Tier-1 intro: "The runner
  still emits a `HarnessDiagnostics` JSON envelope for machine-readable
  failures." The package says the opposite: `tools/lint-ratchet/README.md:19-22`
  — "The repo adapter — registry data, path/context construction, harness
  wiring, CLI composition, and the harness-diagnostics envelope render — stays
  outside the package."
- `docs/guides/lint-ratchet-adoption.md:72-79` — the same section's "What to
  copy" table gets it right: self-contained package, adapter renders "whatever
  result envelope your CI wants". The intro and the table contradict each other
  within the same Tier-1 subsection.
- `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:1-7` — the demo
  entrypoint's header: it "renders its OWN tiny result envelope — deliberately a
  different shape from the Musi diagnostics envelope — to prove the engine
  dictates neither the CLI surface nor the output format."
- `docs/guides/lint-ratchet-adoption.md:191-193` — "What to change" step 3:
  "Delete or stub `scripts/lint-ratchet/registry-builders.ts`". The file exists
  (`scripts/lint-ratchet/registry-builders.ts`) but only in Musi's tree — a
  package-copy adopter never possesses it.
- `docs/guides/lint-ratchet-adoption.md:195-229` — step 4 mandates a
  same-export stub of `scripts/lib/lint-rule-docs.ts`, including a full fenced
  stub implementation (`:201-229`). The demo ratchets a local rule
  (`local/no-console-log`, `examples/lint-ratchet-demo/scripts/lint-ratchet.ts:41`)
  with **zero** references to `lint-rule-docs` anywhere under
  `examples/lint-ratchet-demo/` (measured: grep returns nothing), so the stub
  is not merely optional for package adopters — the framing is wrong.
- `docs/guides/lint-ratchet-adoption.md:231-238` — step 5 orders an import-path
  rewrite across "the copied set" including
  `scripts/harness/harness-diagnostics-output.ts`, another Musi-only file.
- `docs/guides/lint-ratchet-reference.md:191` and `:202` — the reference
  attributes glob matching to "the shared `ratchet-globs.ts` matcher" and cites
  `scripts/lint-ratchet/ratchet-globs.ts`. That path does not exist at the pin.
  The matcher's real home is the package export
  `@musi/lint-ratchet/kernel/ratchet-globs.js`
  (`tools/lint-ratchet/package.json:43`, `tools/lint-ratchet/README.md:64`).
- `docs/guides/lint-ratchet-reference.md:321-331` — the CI path-filter bullet
  requires covering "the dynamically expanded ratchet runtime set described
  under the manifest's `runtimeFiles`/`expandDirectories`" and links
  `lint-ratchet-adoption.md#what-to-copy` (`:323-325`). The linked section says
  the engine "no longer ships a copy manifest"
  (`docs/guides/lint-ratchet-adoption.md:82-83`); the anchor still resolves, so
  a link checker will never flag it.
- `tools/lint-ratchet/test/package-structure.test.ts:68-73` — the boundary
  invariant: "has no imports that reach outside the package", violations pinned
  to `[]`. This is why edits to Musi `scripts/` files can never be part of a
  package adoption.
- Measured sweep: `grep -n 'scripts/lint-ratchet/\|scripts/lib/' docs/guides/lint-ratchet*.md`
  returns 15 hits. Three are coherent references to the demo's own adapter
  files (`lint-ratchet-adoption.md:78`, `:160`, `lint-ratchet.md:39` — the
  demo's `scripts/lint-ratchet/adapter.ts` exists); the other 12 reference
  Musi's `scripts/` tree, of which four are the stale copy-set instructions
  above and the rest describe Musi's adapter without saying so.

## Proposed direction

Anchor the rewrite on the three artifacts verified as authoritative:
`tools/lint-ratchet/package.json#exports` plus the README exports inventory
(`tools/lint-ratchet/README.md:35-104`), the boundary invariant pinned by
`tools/lint-ratchet/test/package-structure.test.ts`, and the
`examples/lint-ratchet-demo` adapter. Docs-only M change, landable as a small
number of conventional commits (adoption Tier 1, reference, coherence sweep).

1. **`docs/guides/lint-ratchet-adoption.md` Tier 1, intro (`:64-68`).** The
   engine does not emit `HarnessDiagnostics`; envelope rendering is
   adapter-owned. The citable proof is the demo entrypoint's header comment
   (renders its own deliberately different shape) plus
   `tools/lint-ratchet/README.md:19-22`. Musi's `scripts/lint-ratchet/`
   diagnostics are one example adapter, not part of the copy.
2. **Same file, "What to change" steps 3-5 (`:191-238`).** Replace the
   delete/stub-Musi-files instructions (registry-builders, the fenced
   `lint-rule-docs` stub, the harness-diagnostics import rewrite touching
   `scripts/harness/harness-diagnostics-output.ts`) with what the demo actually
   requires: author an `adapter.ts` (context/binding/registry via
   `createLintRatchetEngineContext` — exported from
   `@musi/lint-ratchet/kernel/engine-context.js` — plus a
   `LintRatchetConfig[]` registry) and an entry CLI that composes the package's
   governance operations and renders the adopter's own result envelope. A
   package-copy adopter never possesses those Musi `scripts/` files, so
   instructions to edit them are incoherent. Phrase the deletions carefully:
   `registry-builders.ts`, `lint-rule-docs.ts`, and
   `harness-diagnostics-output.ts` all still exist in Musi's tree — the defect
   is that adopters never obtain them, not that they are missing.
3. **`docs/guides/lint-ratchet-reference.md`.** Repoint `:191` and `:202` from
   the nonexistent `scripts/lint-ratchet/ratchet-globs.ts` to
   `@musi/lint-ratchet/kernel/ratchet-globs.js`. Rewrite the CI trigger-union
   bullet (`:321-331`) in package+adapter vocabulary — `tools/lint-ratchet/**`,
   the adopter's adapter/registry files, eslint config and `eslint-rules/**`,
   dependency manifests, parser tsconfigs — and delete the
   `runtimeFiles`/`expandDirectories` manifest cross-link entirely. Fixing only
   the link target is insufficient: the concept it names is retired, and
   because the `#what-to-copy` anchor still resolves, no link checker will
   force the issue — it must be fixed by rewrite.
4. **Coherence sweep.** Run
   `grep -n 'scripts/lint-ratchet/\|scripts/lib/' docs/guides/lint-ratchet*.md`
   and reclassify each remaining hit as one of: Musi-adapter example (keep, but
   label it as Musi's adapter — e.g. the reference's local-rule-docs stub
   guidance at `:210-224` and the `report.ts`
   `LINT_RATCHET_REPORT_ARTIFACT_URL_ENV` note at `:228-233`), stale copy-set
   instruction (delete), or genuinely adopter-required (restate in
   package/adapter terms). References to the *demo's* `scripts/lint-ratchet/`
   files (`lint-ratchet-adoption.md:78`, `:160`, `lint-ratchet.md:39`) are
   already coherent and stay.

## Scope / caveats

- **Out of scope: any code or test change.** `tools/lint-ratchet/README.md` and
  `test/package-structure.test.ts` stay untouched — they are the authority the
  rewrite is anchored to, not part of the fix.
- The adoption guide's already-correct statements — the "no copy manifest"
  passage (`lint-ratchet-adoption.md:72-86`), Tier 2, and the
  config-surface-manifest section — stay as-is except where the step-4 sweep
  hits them (e.g. the Tier-2 "Custom guidance" table row at `:344` names
  `scripts/lib/lint-rule-docs.ts`; relabel, don't delete).
- **Path-fabrication risk.** Delegate-authored doc rewrites fabricate or
  misstate paths — every path and export cited in the rewritten text must be
  existence-checked and cross-checked against
  `tools/lint-ratchet/package.json#exports` and the demo, or the fix
  reintroduces the same class of defect it removes.
- **Over-deletion risk.** `lint-ratchet-reference.md` doubles as Musi's own
  internals doc: `scripts/` references that legitimately describe the Musi
  adapter (`:87`, `:219`, `:224`, `:231`, `:577`, `:631`,
  `lint-ratchet.md:306`) must be relabeled as Musi's adapter, not removed, or
  operator docs break.
- **Anchor breakage.** Section restructuring can break inbound anchors:
  `lint-ratchet-reference.md:325` links `lint-ratchet-adoption.md#what-to-copy`,
  and `lint-ratchet.md:85` / `:439` link
  `lint-ratchet-adoption.md#what-to-copy-for-tests`. Re-verify all cross-doc
  anchors after the edit.
- **Sequencing (soft, no hard edges).**
  [067-lint-ratchet-acceptance-fixtures-emit-321.md](./067-lint-ratchet-acceptance-fixtures-emit-321.md)
  and
  [068-one-lint-ratchet-acceptance-suite-serializes.md](./068-one-lint-ratchet-acceptance-suite-serializes.md)
  fix code in `scripts/lint-ratchet/output.test.ts`, and
  [124-ratchet-cli-has-no-authoritative-command.md](./124-ratchet-cli-has-no-authoritative-command.md)
  catalogs the Musi ratchet CLI — all touch the adapter code these docs will
  merely reference as an example. If 124 lands first and reshapes the CLI
  surface, spot-check the rewritten example labels; neither direction blocks
  the other.
- **Prior pack.** The 2026-07-25 pack's
  [36-lint-ratchet-vocabulary.md](../code-quality-2026-07-25/36-lint-ratchet-vocabulary.md)
  built on the already-landed package seam and closed its scheduled kernel-vocabulary work (H22/H23 landed) with no
  documentation residue tracked; it governs the implementation, not these
  guides. This leaf is the only record of the doc debt.
- No verify gates beyond lint/format apply to these files.
