import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { describe, expect, it } from "vitest";

import corpus from "./fixtures/verify-metadata-core-corpus.json";
import {
  EXIT_INVALID_ARGUMENT,
  EXIT_INVALID_FINGERPRINT,
  EXIT_MALFORMED_JSON,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_USAGE,
  runVerifyMetadataCoreCli,
  subcommandReadsStdin,
} from "./verify-metadata-core.js";

interface CorpusCase {
  readonly name: string;
  readonly argv: readonly string[];
  readonly stdin: string;
  readonly expectExitCode: number;
  readonly expectStdout: string;
}

const runCorpusCase = (corpusCase: CorpusCase): void => {
  const result = runVerifyMetadataCoreCli({
    argv: corpusCase.argv,
    stdin: corpusCase.stdin,
  });
  expect(result.exitCode, corpusCase.name).toBe(corpusCase.expectExitCode);
  expect(result.stdout, corpusCase.name).toBe(corpusCase.expectStdout);
  if (result.exitCode !== EXIT_OK) {
    expect(result.stderr, corpusCase.name).not.toBe("");
  }
};

describe("verify-metadata-core corpus", () => {
  it("matches every captured legacy-parity expectation", () => {
    expect(corpus.legacyParity.length).toBeGreaterThan(0);
    for (const corpusCase of corpus.legacyParity) runCorpusCase(corpusCase);
  });

  it("applies every recorded defect fix, each documenting the legacy behavior it replaces", () => {
    expect(corpus.defectFixes.length).toBeGreaterThan(0);
    for (const corpusCase of corpus.defectFixes) {
      expect(corpusCase.legacyBehavior).not.toBe("");
      runCorpusCase(corpusCase);
    }
  });

  it("round-trips: wrapper-meta output satisfies wrapper-fragment/string-field/int-field/restamp", () => {
    const wrapperCase = corpus.legacyParity.find(
      (candidate) => candidate.argv[0] === "wrapper-meta" && candidate.expectExitCode === EXIT_OK,
    );
    if (wrapperCase === undefined) throw new Error("missing passing wrapper-meta corpus case");
    const wrapperDocument = runVerifyMetadataCoreCli({
      argv: wrapperCase.argv,
      stdin: "",
    }).stdout;

    const mode = runVerifyMetadataCoreCli({
      argv: ["string-field", "mode"],
      stdin: wrapperDocument,
    });
    expect(mode.stdout).toBe("parallel-verify\n");
    const exitCode = runVerifyMetadataCoreCli({
      argv: ["int-field", "exit_code"],
      stdin: wrapperDocument,
    });
    expect(exitCode.stdout).toBe("0\n");

    const combined = runVerifyMetadataCoreCli({
      argv: ["combine", "parallel-verify", "2026-07-19T12:00:00+00:00"],
      stdin: wrapperDocument,
    });
    const fragment = runVerifyMetadataCoreCli({
      argv: ["wrapper-fragment"],
      stdin: combined.stdout,
    });
    expect(fragment.exitCode).toBe(EXIT_OK);
    expect(fragment.stdout).toBe(wrapperDocument);

    const restamped = runVerifyMetadataCoreCli({
      argv: [
        "restamp-wrapper",
        "merge-head",
        "2222222222222222222222222222222222222222222222222222222222222222",
        "1784463300",
        "2026-07-19T12:15:00+00:00",
      ],
      stdin: wrapperDocument,
    });
    expect(restamped.exitCode).toBe(EXIT_OK);
    expect(
      runVerifyMetadataCoreCli({ argv: ["string-field", "head"], stdin: restamped.stdout }).stdout,
    ).toBe("merge-head\n");
  });

  it("classifies argv-only subcommands as never reading stdin", () => {
    // The writer shims redirect stdin from /dev/null, but the codec must not
    // rely on that: a subcommand wrongly classified as stdin-consuming would
    // block on the caller's TTY in any spawn that misses the redirect.
    for (const name of ["step-meta", "wrapper-meta", "shortcircuit-meta"]) {
      expect(subcommandReadsStdin(name), name).toBe(false);
    }
    const stdinConsumers = ["wrapper-fragment", "string-field", "int-field", "restamp-wrapper"];
    for (const name of [...stdinConsumers, "combine"]) {
      expect(subcommandReadsStdin(name), name).toBe(true);
    }
    expect(subcommandReadsStdin("no-such-subcommand")).toBe(false);
  });

  it("fails closed on usage errors with the distinct usage exit code", () => {
    expect(runVerifyMetadataCoreCli({ argv: [], stdin: "" }).exitCode).toBe(EXIT_USAGE);
    expect(runVerifyMetadataCoreCli({ argv: ["no-such"], stdin: "" }).exitCode).toBe(EXIT_USAGE);
    expect(runVerifyMetadataCoreCli({ argv: ["string-field"], stdin: "{}" }).exitCode).toBe(
      EXIT_USAGE,
    );
    expect(runVerifyMetadataCoreCli({ argv: ["step-meta", "only-name"], stdin: "" }).exitCode).toBe(
      EXIT_USAGE,
    );
  });

  it("distinguishes malformed-JSON refusals from verdict refusals", () => {
    expect(runVerifyMetadataCoreCli({ argv: ["wrapper-fragment"], stdin: "{oops" }).exitCode).toBe(
      EXIT_MALFORMED_JSON,
    );
    // The bash shims map these two codes to distinct legacy warn messages, so
    // pin invalid-argument and invalid-fingerprint refusals to their codes.
    expect(
      runVerifyMetadataCoreCli({
        argv: ["shortcircuit-meta", "bad mode!", "h", "1".repeat(64), "verify", "T"],
        stdin: "",
      }).exitCode,
    ).toBe(EXIT_INVALID_ARGUMENT);
    expect(
      runVerifyMetadataCoreCli({
        argv: ["shortcircuit-meta", "precommit-marker", "h", "nope", "verify", "T"],
        stdin: "",
      }).exitCode,
    ).toBe(EXIT_INVALID_FINGERPRINT);
    const refusal = runVerifyMetadataCoreCli({
      argv: [
        "restamp-wrapper",
        "h",
        "1111111111111111111111111111111111111111111111111111111111111111",
        "1784463300",
        "2026-07-19T12:15:00+00:00",
      ],
      stdin: '{"mode":"serial-verify","exit_code":1}',
    });
    expect(refusal.exitCode).toBe(EXIT_REFUSED);
  });
});

describe("verify-metadata-core entrypoint", () => {
  const spawnCore = (argv: readonly string[], stdin: string): SpawnSyncReturns<string> => {
    const result = spawnSync(
      "bun",
      ["--config=/dev/null", "scripts/lib/verify-metadata-core.ts", ...argv],
      { cwd: process.cwd(), encoding: "utf8", input: stdin },
    );
    if (result.error !== undefined) throw result.error;
    return result;
  };

  it("serves a corpus case end-to-end over stdin/stdout with the recorded exit code", () => {
    const [firstParityCase] = corpus.legacyParity;
    if (firstParityCase === undefined) throw new Error("empty legacy-parity corpus");
    const result = spawnCore(firstParityCase.argv, firstParityCase.stdin);
    expect(result.status).toBe(firstParityCase.expectExitCode);
    expect(result.stdout).toBe(firstParityCase.expectStdout);
  });

  it("reports usage errors through the process exit code", () => {
    const result = spawnCore(["no-such-subcommand"], "");
    expect(result.status).toBe(EXIT_USAGE);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unsupported subcommand");
  });
});
