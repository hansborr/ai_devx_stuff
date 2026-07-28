import { describe, expect, it } from "vitest";

import { isObjectLike, isRecord } from "./records.js";

describe("isRecord", () => {
  it("accepts plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ key: "value" })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it("rejects arrays, null, and primitives", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([{ key: "value" }])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("text")).toBe(false);
    expect(isRecord(1)).toBe(false);
  });
});

describe("isObjectLike", () => {
  it("accepts plain objects", () => {
    expect(isObjectLike({})).toBe(true);
    expect(isObjectLike({ key: "value" })).toBe(true);
  });

  it("accepts arrays, unlike isRecord", () => {
    expect(isObjectLike([])).toBe(true);
    expect(isRecord([])).toBe(false);
  });

  it("rejects null and primitives", () => {
    expect(isObjectLike(null)).toBe(false);
    expect(isObjectLike(undefined)).toBe(false);
    expect(isObjectLike("text")).toBe(false);
    expect(isObjectLike(1)).toBe(false);
  });
});
