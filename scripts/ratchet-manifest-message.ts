export function formatMissingRatchetManifestMessage(ratchetId: string): string {
  return (
    `ratchet ${ratchetId} is not declared in the manifest as kind: "ratchet". ` +
    'Next steps: (1) add a kind: "ratchet" entry to harness.controls.json, ' +
    "(2) run bun run docs:harness-controls to regenerate the docs, " +
    "(3) update scripts/test-harness-check.sh fixture if the smoke fixture " +
    "copies live ratchets."
  );
}
