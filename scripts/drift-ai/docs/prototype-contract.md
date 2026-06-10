# Prototype Advisory Contract

`hotspots` and `coldspots` are advisory but already promoted: their lenses have
held up well enough to ship. The backlog also carries a **prototype lane** of
heavier, noisier lenses (deep clone detection, coverage correlation, feature-flag
reachability, ownership/orphaning archaeology, sibling-naming and
never-instantiated-class heuristics) that have **no field-calibrated precision
yet**. Those lenses must not look like findings, and a noisy or partial research
run must not look complete. The shared contract that enforces both lives in
[`prototype-advisory.ts`](../prototype-advisory.ts); every future prototype
subcommand builds its output through it rather than re-deriving the firewall.

The envelope is the promoted-advisory shape plus a prototype discriminant:

- top level is `{ "kind": "advisory", "lane": "prototype", ... }` — **never** a
  `findings` key, **never** `WARN`/`FIX:` language. The `kind: "advisory"` half is
  shared with hotspots/coldspots so existing readers already discount it; the
  `lane: "prototype"` half lets a consumer route the experimental rows separately.
  This `lane` marker lives **only** on the advisory envelope — it is deliberately
  not added to `DriftFinding`, whose stream stays reserved for promoted checks;
- `subcommand` names the requested prototype lens;
- `banner` is a mandatory candidate disclaimer (stronger than the hotspots/coldspots
  "areas to check" wording, because a prototype lens has no precision evidence yet);
- `prerequisites[]`, `caps[]`, and `degradations[]` carry the partial-run
  disclosure (below);
- `sections[]` each name a `candidateKind`, a `totalCandidates` count (the gate
  count **before** the display cap), the shown `entries`, and an `emptyReason`.
  Row content is lens-specific, but every row must name its provenance, raw
  scores/thresholds, and an inspect/repair next step — evidence, not a verdict.

Partial-run disclosure is the load-bearing rule, since a capped or degraded
prototype run is the common case:

- **Prerequisites.** A lens that needs a tool, artifact, or resolved graph lists
  each as a prerequisite; an unmet one renders `prerequisite <name>: unmet -- …`
  so a skipped check never reads as "checked and clear".
- **Caps and timeouts.** Each disclosed bound is a `cap`; when the run hits it the
  header shouts `cap <label>: HIT -- PARTIAL run: <stopped-after detail>`, so a
  truncated scan is never presented as exhaustive. A full-history prototype lens
  feeds its scanned-range / stopped-reason data (from the bounded collector,
  backlog task 38) into a `cap` here rather than inventing its own wording.
- **Truncation.** When a section shows fewer rows than qualified, the renderer
  appends `showing N of M candidates (K more; raise --top to see them)`.
- **Degradations.** A sub-feature that could not compute (e.g. line counts on a
  blobless clone) is listed as a `degraded:` line.

A prototype subcommand composes its text output from the shared header and section
frame (the header owns the banner/prerequisites/caps/degradations; each lens owns
only its per-row strings, which must stay evidence-shaped — no WARN/FIX):

```ts
const advisory = buildPrototypeAdvisory({
  subcommand,
  prerequisites,
  caps,
  degradations,
  sections,
});
const lines = formatPrototypeHeader(advisory);
for (const section of advisory.sections) {
  lines.push(""); // blank line between sections, as hotspots/coldspots do
  appendPrototypeSection(lines, section, (row) => [`${row.path}  score ${row.score}`]);
}
const text = lines.join("\n");
const json = formatPrototypeAdvisoryJson(advisory);
```

This is the **default route** for prototype rows (backlog task 39). Do not add a
`severity`, `lane`, or `experimental` field to `DriftFinding` to carry candidate
rows; keep them in this advisory envelope until a lens earns promotion.
