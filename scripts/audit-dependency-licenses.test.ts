import { describe, expect, it } from "vitest";

import {
  LICENSE_AUDIT_REMEDY,
  licenseValue,
  REVIEW_COPYLEFT_RE,
  STRONG_COPYLEFT_RE,
} from "./audit-dependency-licenses.js";

describe("license copyleft classification", () => {
  it.each(["AGPL-3.0-only", "GPL-3.0-or-later", "SSPL-1.0"])(
    "classifies %s as strong copyleft",
    (license) => {
      expect(STRONG_COPYLEFT_RE.test(license)).toBe(true);
      expect(REVIEW_COPYLEFT_RE.test(license)).toBe(false);
    },
  );

  it.each(["LGPL-3.0-only", "MPL-2.0", "EPL-2.0"])(
    "classifies %s as copyleft review",
    (license) => {
      expect(REVIEW_COPYLEFT_RE.test(license)).toBe(true);
      expect(STRONG_COPYLEFT_RE.test(license)).toBe(false);
    },
  );

  it.each(["MIT", "BSD-3-Clause", "ISC"])("does not classify %s as copyleft", (license) => {
    expect(STRONG_COPYLEFT_RE.test(license)).toBe(false);
    expect(REVIEW_COPYLEFT_RE.test(license)).toBe(false);
  });
});

describe("licenseValue", () => {
  it("joins SPDX array values with OR", () => {
    expect(licenseValue([{ type: "MIT" }, "Apache-2.0", { type: "BSD-3-Clause" }])).toBe(
      "MIT OR Apache-2.0 OR BSD-3-Clause",
    );
  });
});

describe("LICENSE_AUDIT_REMEDY", () => {
  it("points agents at the review decision record instead of an allowlist", () => {
    expect(LICENSE_AUDIT_REMEDY).toContain("docs/agent_notes/");
    expect(LICENSE_AUDIT_REMEDY).toContain("package, version, license, and rationale");
    expect(LICENSE_AUDIT_REMEDY).not.toContain("allowlist");
  });
});
