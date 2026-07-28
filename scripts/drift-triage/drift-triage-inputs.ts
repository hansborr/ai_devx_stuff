import { createHash } from "node:crypto";

import { errorMessage } from "../lib/error-message.js";
import { DriftTriageError } from "./drift-triage-options.js";
import { type NamedTriageInput, parseTriageInput } from "./triage-report.js";

export type LoadedTriageInputs = {
  readonly inputs: readonly NamedTriageInput[];
  readonly inputHashes: readonly { readonly path: string; readonly sha256: string }[];
};

export function loadTriageInputs(
  paths: readonly string[],
  readFile: (filePath: string) => string,
): LoadedTriageInputs {
  const inputs: NamedTriageInput[] = [];
  const inputHashes: { path: string; sha256: string }[] = [];
  for (const path of paths) {
    const contents = readInput(path, readFile);
    inputs.push({ path, input: parseInput(path, contents) });
    inputHashes.push({ path, sha256: createHash("sha256").update(contents).digest("hex") });
  }
  return { inputs, inputHashes };
}

function readInput(path: string, readFile: (filePath: string) => string): string {
  try {
    return readFile(path);
  } catch (error) {
    throw new DriftTriageError(`${path}: could not read report: ${errorMessage(error)}`);
  }
}

function parseInput(path: string, contents: string): NamedTriageInput["input"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new DriftTriageError(`${path}: not valid JSON: ${errorMessage(error)}`);
  }
  try {
    return parseTriageInput(parsed);
  } catch (error) {
    throw new DriftTriageError(`${path}: ${errorMessage(error)}`);
  }
}
