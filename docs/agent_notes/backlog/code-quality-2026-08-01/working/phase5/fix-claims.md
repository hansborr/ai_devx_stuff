# Step-9 findings: contradicted independence claims

Ten leaves assert an independence they do not have. Each entry is the reviewing
seat verbatim.

## [P1] 127-public-harness-manifest-has-no-versioned.md:115

**Finding:** The proposed direction still requires the round-trip test to validate the raw live harness.controls.json, contradicting the new conditional instruction to validate the assembled manifest when leaf 178 moves lint-rule controls into a generated include. Following step 7 after 178 lands would omit that include from the round-trip and leave the component-level remedy only partially implemented.

**Evidence:** 127-public-harness-manifest-has-no-versioned.md:115-119 says to validate the live harness.controls.json, while :167-173 requires publishing and round-tripping the assembled contract including the generated lint-rule-controls include; 178-local-lint-rules-lack-one-canonical.md:55 makes the authored root file incomplete by merging that include in readHarnessManifest.

**Proposed remedy:** Replace step 7's opening with: "One round-trip test validating the assembled manifest returned by `readHarnessManifest` against the emitted schema via a generic validator (`ajv` devDep); this is currently equivalent to the live `harness.controls.json` value and must include leaf 178's generated lint-rule-controls include once that ownership seam exists."

## [P0] 119-migration-safety-validation-embeds-multiple.md:114

**Finding:** The proposed implementation still directs the new TypeScript core to use `harnessFindingSchema` from the shared-package source path, even though the newly added required sequencing says leaf 181 lands first and deletes that path.

**Evidence:** 119-migration-safety-validation-embeds-multiple.md:114-115 prescribes `packages/shared/src/schemas/harness-diagnostics.ts`, while :228-233 says to import from `@musi/harness-diagnostics/schema.js`, not that deleted path; 181-harness-diagnostics-live-application.md:81-88 explicitly deletes the old source and migrates importers.

**Proposed remedy:** Replace lines 114-115 with: `(d) two pure renderers over one ScanReport — renderHumanReport preserving the exact WARN:/INFO:/PASS: grammar, and toHarnessFindings typed against harnessFindingSchema imported from @musi/harness-diagnostics/schema.js;`

## [P1] 021-shared-production-builds-expose-colocated.md:155

**Finding:** Leaf 021 still claims it has no sequencing edges, but the graph gives it serialize and rebaseOn edges with leaf 025.

**Evidence:** 021-shared-production-builds-expose-colocated.md:155-156; 025-spellcastingts-contains-five-independently.md:216-220 requires serialization and second-landing reconciliation.

**Proposed remedy:** Replace leaf 021's no-edge sentence with the reciprocal serialization/rebase guidance for leaf 025.

## [P1] 029-one-metamagic-constant-controls-two.md:83

**Finding:** Leaf 029 says it has no sequencing edges and can land independently, but the graph requires serialization with leaf 221.

**Evidence:** 029-one-metamagic-constant-controls-two.md:83-84; 221-rename-metamagic-slot-terminology-to-options-known.md:55-59 says both edit sorcery-points.ts and must not run concurrently.

**Proposed remedy:** Replace leaf 029's independence sentence with reciprocal same-file serialization guidance for leaf 221.

## [P1] 043-encounter-detail-behavior-fragmented-across.md:131

**Finding:** Leaf 043 claims independence because no other leaf edits its files, while leaf 060 and the graph identify a shared edit to encounter-participants.tsx.

**Evidence:** 043-encounter-detail-behavior-fragmented-across.md:131-136; 060-participant-presentation-duplicated-between.md:72-75 requires the two leaves to be serialized.

**Proposed remedy:** Narrow leaf 043's independence statement and add its reciprocal serialization relation with leaf 060.

## [P1] 083-sole-progress-queue-mostly-stale-view.md:105

**Finding:** Leaf 083 says it has no sequencing dependencies, but the graph gives it a rebaseOn edge with leaf 084 for shared README wording.

**Evidence:** 083-sole-progress-queue-mostly-stale-view.md:105; 084-backlog-simultaneously-action-queue-evidence.md:143-147 requires the final README wording to reconcile both leaves' queue concepts.

**Proposed remedy:** Replace the absolute claim with reciprocal outcome-sensitive coordination guidance for leaf 084.

## [P1] 112-public-lint-ratchet-demo-asks-adopters.md:165

**Finding:** Leaf 112 says it is otherwise independent, but the graph requires serialization with leaf 090 over the demo README.

**Evidence:** 112-public-lint-ratchet-demo-asks-adopters.md:161-165; 090-lint-ratchet-newcomer-docs-omit-prerequisite.md:199-202 forbids concurrent edits to examples/lint-ratchet-demo/README.md.

**Proposed remedy:** Add leaf 090 to leaf 112's sequencing paragraph and narrow the remaining independence claim.

## [P1] 137-knip-check-reparses-same-cached-report.md:209

**Finding:** Leaf 137 says no other pack leaf is recorded as touching its files, but leaf 163 and the graph record serialize and rebaseOn relations over knip-runner.ts.

**Evidence:** 137-knip-check-reparses-same-cached-report.md:209-211; 163-ratchet-driven-file-boundaries-strand.md:103-106 explicitly identifies the shared file and second-landing rebase.

**Proposed remedy:** Replace leaf 137's no-recorded-overlap claim with reciprocal serialization and rebasing guidance for leaf 163.

## [P1] 180-homebrew-entry-type-vocabulary-enumerated.md:107

**Finding:** Leaf 180 claims no sequencing dependency, but the graph gives it a rebaseOn edge with leaf 095 involving entry-editor-registry.ts.

**Evidence:** 180-homebrew-entry-type-vocabulary-enumerated.md:107; 095-homebrew-module-index-sends-contributors.md:83-87 requires rechecking its recipe pointer against leaf 180's resulting registry.

**Proposed remedy:** Replace the absolute no-dependency sentence with reciprocal outcome-sensitive coordination for leaf 095.

## [P1] 181-harness-diagnostics-live-application.md:135

**Finding:** Leaf 181 still says there are no semantic ordering dependencies, but the graph now makes it a strict prerequisite of both leaves 080 and 119.

**Evidence:** 181-harness-diagnostics-live-application.md:135-143; 080-public-harness-copy-recipes-not-closed-over.md:161-166 and 119-migration-safety-validation-embeds-multiple.md:228-234 both require 181 to land first and consume its relocated package boundary.

**Proposed remedy:** Replace leaf 181's no-semantic-dependencies sentence with reciprocal prerequisite notes for leaves 080 and 119 while retaining its existing mechanical-conflict list.
