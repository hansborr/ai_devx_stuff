import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { locatorFailure } from "./adr-check-locators.js";
import { type AdrRecord, discoverAdrs, SUPERSEDED } from "./adr-check-parse.js";

const ACTIVE_ROOTS = ["eslint-rules", "eslint.config.js", "eslint-config", "scripts", "packages"];
const ACTIVE_SOURCE = /\.(?:[cm]?[jt]sx?|sh)$/;
const EXCLUDED_SOURCE =
  /(?:^|\/)(?:fixtures?|generated|tests?)(?:\/|$)|\.(?:test|spec)\.|\.generated\./;
const ADR_REFERENCE_CANDIDATE = /ADR-\d+(?!\d)/g;
const VALID_ADR_REFERENCE = /^ADR-\d{4}$/;

export interface AdrCheckResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly failures: readonly string[];
}

function walkFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    walkFiles(resolve(path, entry.name)),
  );
}

function activeReferences(root: string): { readonly id: string; readonly file: string }[] {
  return ACTIVE_ROOTS.flatMap((entry) => walkFiles(resolve(root, entry)))
    .filter(
      (path) => ACTIVE_SOURCE.test(path) && !EXCLUDED_SOURCE.test(path.slice(root.length + 1)),
    )
    .flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(ADR_REFERENCE_CANDIDATE)].map((match) => ({
        id: match[0],
        file: path.slice(root.length + 1),
      })),
    );
}

function indexRecords(records: readonly AdrRecord[], failures: string[]): Map<string, AdrRecord> {
  const byId = new Map<string, AdrRecord>();
  for (const record of records) {
    if (byId.has(record.id)) {
      failures.push(
        `${record.file}: duplicate ADR id ${record.id}; assign a permanent unique number`,
      );
    } else {
      byId.set(record.id, record);
    }
    if (SUPERSEDED.exec(record.status)?.[1] === record.id) {
      failures.push(
        `${record.file}: ${record.id} cannot supersede itself; name a different target`,
      );
    }
  }
  return byId;
}

function validateLocators(root: string, records: readonly AdrRecord[], failures: string[]): void {
  for (const record of records) {
    for (const locator of record.locators) {
      const failure = locatorFailure(root, locator);
      if (failure !== undefined) {
        failures.push(
          `${record.id} ${record.file}: locator '${locator}' ${failure}; repair the locator or restore its gate`,
        );
      }
    }
  }
}

function validateSupersession(
  records: readonly AdrRecord[],
  byId: ReadonlyMap<string, AdrRecord>,
  failures: string[],
): void {
  for (const record of records) {
    const target = SUPERSEDED.exec(record.status)?.[1];
    if (target !== undefined && !byId.has(target)) {
      failures.push(
        `${record.file}: superseding target ${target} does not exist; add it or correct status`,
      );
    }
  }
}

function validateReferences(
  root: string,
  byId: ReadonlyMap<string, AdrRecord>,
  failures: string[],
): void {
  for (const reference of activeReferences(root)) {
    if (!VALID_ADR_REFERENCE.test(reference.id)) {
      failures.push(
        `${reference.file}: invalid active reference ${reference.id}; use ADR- followed by exactly four digits`,
      );
      continue;
    }
    const record = byId.get(reference.id);
    if (record === undefined) {
      failures.push(
        `${reference.file}: active reference ${reference.id} does not resolve; add the ADR or correct the gate message`,
      );
    } else if (SUPERSEDED.test(record.status)) {
      failures.push(
        `${reference.file}: active gate references superseded ${reference.id}; point it at the replacement ADR`,
      );
    }
  }
}

export function runAdrCheck({
  cwd = process.cwd(),
}: { readonly cwd?: string } = {}): AdrCheckResult {
  const root = resolve(cwd);
  const failures: string[] = [];
  const records = discoverAdrs(root, failures);
  const byId = indexRecords(records, failures);
  validateLocators(root, records, failures);
  validateSupersession(records, byId, failures);
  validateReferences(root, byId, failures);
  const uniqueFailures = [...new Set(failures)].sort();
  if (uniqueFailures.length > 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${uniqueFailures.join("\n")}\n`,
      failures: uniqueFailures,
    };
  }
  const locatorCount = records.reduce((count, record) => count + record.locators.length, 0);
  return {
    exitCode: 0,
    stdout: `adr:check OK — ${String(records.length)} ADR(s), ${String(locatorCount)} gate locator(s) checked.\n`,
    stderr: "",
    failures: [],
  };
}

const invokedPath = process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (fileURLToPath(import.meta.url) === invokedPath) {
  const result = runAdrCheck();
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
