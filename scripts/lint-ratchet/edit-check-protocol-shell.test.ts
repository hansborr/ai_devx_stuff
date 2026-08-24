import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { EDIT_CHECK_ROW_LAYOUTS } from "@musi/lint-ratchet/governance/edit-check-protocol.js";
import { describe, expect, it } from "vitest";

// The shell contract is hand-written, so this test is the drift detector:
// EDIT_CHECK_ROW_LAYOUTS renders the statements scripts/ai-hooks/
// edit-check-protocol.sh must contain, and the file's code lines must be
// exactly those. Comparing whole statements (not just the variable names)
// keeps the separator and here-string operand under the same check as the
// field list — a reader that decodes the wrong argument with the wrong
// separator breaks every hook exactly as loudly as a renamed field.
//
// Change the table first; the failure diff is the line to write.
const SHELL_PATH = "../ai-hooks/edit-check-protocol.sh";

// Which reader decodes which row kind, and how it is invoked.
// `ratchet-regression-check.sh` reads both result kinds with the
// regression-shaped reader, so `checked` has no reader of its own (see the
// prefix invariant below). That reader takes its separator as `$1` because the
// caller substitutes a non-whitespace one to keep an empty `line` column.
const SHELL_READERS = [
  {
    functionName: "edit_check_read_target_row",
    variablePrefix: "EDIT_CHECK_TARGET_ROW",
    layout: EDIT_CHECK_ROW_LAYOUTS.target,
    separator: String.raw`$'\t'`,
    row: '"$1"',
    trailingSink: false,
  },
  {
    functionName: "edit_check_read_result_row",
    variablePrefix: "EDIT_CHECK_RESULT",
    layout: EDIT_CHECK_ROW_LAYOUTS.regression,
    separator: '"$1"',
    row: '"$2"',
    trailingSink: true,
  },
  {
    functionName: "edit_check_read_ratchet_covered_row",
    variablePrefix: "EDIT_CHECK_RATCHET_COVERED_ROW",
    layout: EDIT_CHECK_ROW_LAYOUTS["ratchet-covered"],
    separator: String.raw`$'\t'`,
    row: '"$1"',
    trailingSink: false,
  },
] as const;

// camelCase field and dashed kind names become the shell's SNAKE_CASE tokens.
function shellToken(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/gu, "$1_$2")
    .replaceAll("-", "_")
    .toUpperCase();
}

function layoutStatements(): readonly string[] {
  return Object.values(EDIT_CHECK_ROW_LAYOUTS).flatMap((layout) => {
    const prefix = `EDIT_CHECK_${shellToken(layout.kind)}`;
    const fields: readonly string[] = layout.fields;
    const minimum = layout.fieldCount - layout.acceptedOptionalTrailingFields.length;
    return [
      `${prefix}_KIND='${layout.kind}'`,
      `${prefix}_FIELDS=(${fields.map((field) => `'${field}'`).join(" ")})`,
      `${prefix}_FIELD_COUNT=${String(layout.fieldCount)}`,
      `${prefix}_MIN_FIELD_COUNT=${String(minimum)}`,
    ];
  });
}

function readerStatements(): readonly string[] {
  return SHELL_READERS.flatMap((reader) => {
    const fields: readonly string[] = reader.layout.fields;
    const variables = fields.map((field) => `${reader.variablePrefix}_${shellToken(field)}`);
    // The result reader adds a trailing sink so a future extra column lands
    // there instead of in the last real field.
    if (reader.trailingSink) variables.push(`${reader.variablePrefix}_EXTRA`);
    return [
      `${reader.functionName}() {`,
      `IFS=${reader.separator} read -r ${variables.join(" ")} <<< ${reader.row}`,
      "}",
    ];
  });
}

// Comments and blank lines are prose; indentation is style. Everything else in
// the file is a statement this test owns.
function shellStatements(): readonly string[] {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), SHELL_PATH), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

describe("edit-check-protocol.sh parity with EDIT_CHECK_ROW_LAYOUTS", () => {
  it("contains exactly the constants and readers the layout table renders", () => {
    expect(shellStatements()).toEqual([...layoutStatements(), ...readerStatements()]);
  });

  it("keeps the checked layout an exact prefix of the shared result reader", () => {
    const { checked, regression } = EDIT_CHECK_ROW_LAYOUTS;
    const fields: readonly string[] = checked.fields;
    // `kind` is the hook's dispatch column and `path` its bucket key, so the
    // shared reader is only safe while checked rows carry both in the
    // regression layout's leading positions.
    expect(fields).toContain("kind");
    expect(fields).toContain("path");
    expect(fields.every((field, index) => regression.fields[index] === field)).toBe(true);
  });
});
