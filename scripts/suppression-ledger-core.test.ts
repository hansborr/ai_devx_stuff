import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatSuppressionLedger } from "./suppression-ledger-baseline.js";
import {
  ESLINT_DISABLE_REGISTER,
  type RegisterRunner,
  runSuppressionLedgerCli,
  SUPPRESSION_REGISTER,
} from "./suppression-ledger-core.js";
import { suppressionEntriesFromDirectives } from "./suppression-ledger-identity.js";
import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";

const tmpRepo = registerTempRootCleanup();
const LEDGER = "suppression-ledger.json";

const ESLINT_EMISSION = [
  "#scope\tfull",
  "eslint-disable\tsrc/a.ts\t12\t// eslint-disable-next-line no-console -- debug",
].join("\n");
const SUPPRESSION_EMISSION = [
  "#scope\tfull",
  "ts-expect-error\tsrc/b.ts\t3\t// @ts-expect-error -- narrowing gap",
].join("\n");

interface RunnerScript {
  readonly identities: string;
  readonly exitCode?: number;
  readonly stderr?: string;
}

function runner(byScript: Readonly<Record<string, RunnerScript>>): {
  readonly run: RegisterRunner;
  readonly calls: { script: string; changedBase: string | undefined }[];
} {
  const calls: { script: string; changedBase: string | undefined }[] = [];
  const run: RegisterRunner = ({ script, changedBase }) => {
    calls.push({ script, changedBase });
    const scripted = byScript[script] ?? { identities: "#scope\tfull" };
    return Promise.resolve({
      exitCode: scripted.exitCode ?? 0,
      identities: scripted.identities,
      stderr: scripted.stderr ?? "",
    });
  };
  return { run, calls };
}

const CLEAN_RUNNER = {
  [ESLINT_DISABLE_REGISTER]: { identities: ESLINT_EMISSION },
  [SUPPRESSION_REGISTER]: { identities: SUPPRESSION_EMISSION },
};

function expectedLedgerText(): string {
  const entries = suppressionEntriesFromDirectives([
    {
      kind: "eslint-disable",
      path: "src/a.ts",
      line: 12,
      text: "// eslint-disable-next-line no-console -- debug",
    },
    {
      kind: "ts-expect-error",
      path: "src/b.ts",
      line: 3,
      text: "// @ts-expect-error -- narrowing gap",
    },
  ]);
  if (!entries.ok) throw new Error(entries.error);
  return formatSuppressionLedger(entries.value);
}

describe("runSuppressionLedgerCli --update", () => {
  it("writes both registers' identities into one ledger", async () => {
    const cwd = tmpRepo.makeTempRepo();
    const result = await runSuppressionLedgerCli({
      argv: ["--update"],
      cwd,
      runner: runner(CLEAN_RUNNER).run,
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(path.join(cwd, LEDGER), "utf8")).toBe(expectedLedgerText());
    expect(result.stdout).toContain("wrote suppression-ledger.json");
  });

  it("runs both registers in full mode", async () => {
    const spy = runner(CLEAN_RUNNER);
    await runSuppressionLedgerCli({
      argv: ["--update"],
      cwd: tmpRepo.makeTempRepo(),
      runner: spy.run,
    });

    expect(spy.calls).toStrictEqual([
      { script: ESLINT_DISABLE_REGISTER, changedBase: undefined },
      { script: SUPPRESSION_REGISTER, changedBase: undefined },
    ]);
  });

  it("refuses to regenerate from a narrowed scan", async () => {
    const result = await runSuppressionLedgerCli({
      argv: ["--update", "--changed"],
      cwd: tmpRepo.makeTempRepo(),
      runner: runner(CLEAN_RUNNER).run,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--update cannot be combined with --changed");
  });
});

describe("runSuppressionLedgerCli gate", () => {
  function repoWithLedger(text: string): string {
    const cwd = tmpRepo.makeTempRepo();
    writeFileSync(path.join(cwd, LEDGER), text);
    return cwd;
  }

  it("passes when the tree matches the committed ledger", async () => {
    const result = await runSuppressionLedgerCli({
      argv: [],
      cwd: repoWithLedger(expectedLedgerText()),
      runner: runner(CLEAN_RUNNER).run,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK: suppression identities match the ledger");
  });

  it("fails on a suppression that is not in the ledger", async () => {
    const result = await runSuppressionLedgerCli({
      argv: [],
      cwd: repoWithLedger(expectedLedgerText()),
      runner: runner({
        ...CLEAN_RUNNER,
        [ESLINT_DISABLE_REGISTER]: {
          identities: `${ESLINT_EMISSION}\neslint-disable\tsrc/c.ts\t4\t// eslint-disable-next-line eqeqeq -- new`,
        },
      }).run,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("added 1 new identity");
    expect(result.stdout).toContain("src/c.ts");
  });

  it("still gates when a register reports policy findings", async () => {
    const result = await runSuppressionLedgerCli({
      argv: [],
      cwd: repoWithLedger(expectedLedgerText()),
      runner: runner({
        ...CLEAN_RUNNER,
        [SUPPRESSION_REGISTER]: { identities: SUPPRESSION_EMISSION, exitCode: 1 },
      }).run,
    });

    expect(result.exitCode).toBe(0);
  });

  it("fails unchecked when a register cannot run at all", async () => {
    const result = await runSuppressionLedgerCli({
      argv: [],
      cwd: repoWithLedger(expectedLedgerText()),
      runner: runner({
        ...CLEAN_RUNNER,
        [SUPPRESSION_REGISTER]: {
          identities: "",
          exitCode: 2,
          stderr: "FAIL: not inside a git repository",
        },
      }).run,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("not inside a git repository");
  });

  // A register that learns a new spelling for a kind this module cannot key
  // must not silently drop that suppression out of the ledger's reach.
  it("fails unchecked when a register emits a directive identity cannot key", async () => {
    const result = await runSuppressionLedgerCli({
      argv: [],
      cwd: repoWithLedger(expectedLedgerText()),
      runner: runner({
        ...CLEAN_RUNNER,
        [ESLINT_DISABLE_REGISTER]: {
          identities: ["#scope\tfull", "eslint-disable\tsrc/a.ts\t12\t// eslint-disabled all"].join(
            "\n",
          ),
        },
      }).run,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("src/a.ts:12");
    expect(result.stdout).toContain("scripts/suppression-ledger-identity.ts");
  });

  it("reports a missing ledger with the command that creates it", async () => {
    const result = await runSuppressionLedgerCli({
      argv: [],
      cwd: tmpRepo.makeTempRepo(),
      runner: runner(CLEAN_RUNNER).run,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("suppression-ledger.ts --update");
  });

  it("forwards the changed base to both registers and scopes the gate to scanned paths", async () => {
    const spy = runner({
      [ESLINT_DISABLE_REGISTER]: {
        identities: ["#scope\tchanged", "#path\tsrc/a.ts"].join("\n"),
      },
      [SUPPRESSION_REGISTER]: { identities: ["#scope\tchanged", "#path\tsrc/a.ts"].join("\n") },
    });
    // The ledger still holds src/a.ts and src/b.ts identities, but neither file
    // was scanned for a.ts's directive and b.ts was not scanned at all: the
    // narrowed gate must not read those as removals.
    const result = await runSuppressionLedgerCli({
      argv: ["--changed", "origin/main"],
      cwd: repoWithLedger(expectedLedgerText()),
      runner: spy.run,
    });

    expect(spy.calls.map((call) => call.changedBase)).toStrictEqual(["origin/main", "origin/main"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("scope=src/a.ts");
    expect(result.stdout).toContain("dropped 1 ledger identity");
    expect(result.stdout).not.toContain("src/b.ts");
  });

  it("prints usage for --help and rejects an unknown flag", async () => {
    const cwd = tmpRepo.makeTempRepo();
    const help = await runSuppressionLedgerCli({ argv: ["--help"], cwd });
    const unknown = await runSuppressionLedgerCli({ argv: ["--nope"], cwd });

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("--update");
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stdout).toContain("Unknown argument: --nope");
  });
});
