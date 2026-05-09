import { existsSync, readFileSync } from "node:fs";

import type { JsonRecord } from "./types.js";

export function readJsonObject(filePath: string): JsonRecord {
  if (!existsSync(filePath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) return {};
  return parsed;
}

export function recordProperty(record: JsonRecord, key: string): JsonRecord | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}

export function arrayProperty(record: JsonRecord, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}

export function stringProperty(record: JsonRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
