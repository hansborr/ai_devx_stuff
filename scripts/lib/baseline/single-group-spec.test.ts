import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  BaselineEntry,
  BaselineMetricSpec,
} from "@musi/lint-ratchet/kernel/entry-baseline.js";
import {
  formatGroupedBaseline,
  parseGroupedBaseline,
} from "@musi/lint-ratchet/kernel/group-baseline.js";
import { singleGroupSpec } from "@musi/lint-ratchet/kernel/single-group-spec.js";
import { describe, expect, it } from "vitest";

import { maxLinesExceptionsSpec } from "../../max-lines-exceptions-core.js";
import { knipUnusedExportsSpec } from "../../sensor-knip-unused-exports-baseline.js";
import { nearDuplicatesSpec } from "../../sensor-near-duplicates-baseline.js";
import { suppressionLedgerSpec } from "../../suppression-ledger-baseline.js";

const repoRoot = resolve(import.meta.dirname, "../../..");

function expectGoldenRoundTrip<Entry extends BaselineEntry>(
  path: string,
  spec: BaselineMetricSpec<Entry>,
): void {
  const committed = readFileSync(resolve(repoRoot, path), "utf8");
  const groupedSpec = singleGroupSpec(spec);
  const parsed = parseGroupedBaseline(groupedSpec, committed);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(formatGroupedBaseline(groupedSpec, parsed.value)).toBe(committed);
}

describe("singleGroupSpec committed-baseline golden files", () => {
  it("round-trips the knip baseline through the grouped codec", () => {
    expect.hasAssertions();
    expectGoldenRoundTrip("sensor-knip-unused-exports.baseline.json", knipUnusedExportsSpec);
  });

  it("round-trips the max-lines baseline through the grouped codec", () => {
    expect.hasAssertions();
    expectGoldenRoundTrip(
      "eslint-config/max-lines-exceptions.baseline.json",
      maxLinesExceptionsSpec,
    );
  });

  it("round-trips the near-duplicates baseline through the grouped codec", () => {
    expect.hasAssertions();
    expectGoldenRoundTrip("sensor-near-duplicates.baseline.json", nearDuplicatesSpec);
  });

  it("round-trips the suppression ledger through the grouped codec", () => {
    expect.hasAssertions();
    expectGoldenRoundTrip("suppression-ledger.json", suppressionLedgerSpec);
  });
});
