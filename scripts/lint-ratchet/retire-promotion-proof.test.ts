import {
  type OrphanRetireScope,
  proveOrphanPromotedToNormalError,
} from "@musi/lint-ratchet/governance/retire-promotion-proof.js";
import type { NormalLintFileStatus } from "@musi/lint-ratchet/governance/zero-baseline.js";
import type { LintRatchetConfig } from "@musi/lint-ratchet/kernel/config-types.js";
import { describe, expect, it } from "vitest";

const scope: OrphanRetireScope = {
  id: "ratchet/old-promoted",
  ruleId: "no-debugger",
  files: ["packages/**/*.ts"],
  ignores: ["**/*.test.ts"],
  ruleOptions: [],
};

const tracked = [
  "packages/server/src/a.ts",
  "packages/server/src/b.ts",
  "packages/server/src/a.test.ts",
  "scripts/other.ts",
];

function statusMap(byPath: Record<string, NormalLintFileStatus>) {
  return (_ratchet: LintRatchetConfig, path: string): Promise<NormalLintFileStatus> =>
    Promise.resolve(byPath[path] ?? "off");
}

describe("proveOrphanPromotedToNormalError", () => {
  it("proves promotion when every matched file errors under normal lint", async () => {
    const proof = await proveOrphanPromotedToNormalError(
      scope,
      tracked,
      statusMap({
        "packages/server/src/a.ts": "error",
        "packages/server/src/b.ts": "error",
      }),
    );
    expect(proof.normalError).toBe(true);
    expect(proof.matchedFileCount).toBe(2);
    expect(proof.normalLintStatus).toBe("normal-error");
  });

  it("does not prove promotion when a matched file is not at error", async () => {
    const proof = await proveOrphanPromotedToNormalError(
      scope,
      tracked,
      statusMap({
        "packages/server/src/a.ts": "error",
        "packages/server/src/b.ts": "warn",
      }),
    );
    expect(proof.normalError).toBe(false);
    expect(proof.normalLintStatus).toBe("mixed");
  });

  it("accepts all-error different options only with explicit attestation", async () => {
    const statuses = statusMap({
      "packages/server/src/a.ts": "error-different-options",
      "packages/server/src/b.ts": "error-different-options",
    });

    await expect(proveOrphanPromotedToNormalError(scope, tracked, statuses)).resolves.toMatchObject(
      {
        normalError: false,
        normalLintStatus: "normal-error-different-options",
      },
    );
    await expect(
      proveOrphanPromotedToNormalError(scope, tracked, statuses, true),
    ).resolves.toMatchObject({
      normalError: true,
      normalLintStatus: "normal-error-different-options",
    });
  });

  it("never proves promotion for an empty scope", async () => {
    const proof = await proveOrphanPromotedToNormalError(
      { ...scope, files: ["packages/none/**/*.ts"] },
      tracked,
      statusMap({}),
    );
    expect(proof.normalError).toBe(false);
    expect(proof.matchedFileCount).toBe(0);
    expect(proof.normalLintStatus).toBe("empty-scope");
  });
});
