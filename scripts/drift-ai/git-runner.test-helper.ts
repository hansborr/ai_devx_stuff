import type { GitRunner } from "./git-changed-scope.js";

// Shared GitRunner stub for the command-level drift-ai tests. The tests inject a
// fake GitRunner so repo-root resolution is deterministic; previously each file
// hand-rolled the same dispatcher (answer the looked-up args, else throw the
// standard "unexpected git invocation" error). This is the single source for
// that contract — the toplevel-response shape and the throw message — so a
// future change to how drift-ai shells out to git is reflected in one place.
//
// coldspots/hotspots intentionally keep their inline stubs: those parse a
// `--since=` window and branch on `-G`, which a flat Record<string, string>
// cannot model, so over-fitting the map onto them would lose coverage.

/**
 * Build the standard "unexpected git invocation" error used by GitRunner stubs.
 */
export function unexpectedGitInvocationError(args: readonly string[]): Error {
  return new Error(`unexpected git invocation: git ${args.join(" ")}`);
}

/**
 * Build a GitRunner that returns the mapped value for an exact `args.join(" ")`
 * key and throws the standard "unexpected git invocation" error on any miss.
 */
export function makeStubGit(responses: Record<string, string>): GitRunner {
  return (args) => {
    const key = args.join(" ");
    if (Object.prototype.hasOwnProperty.call(responses, key)) return responses[key] ?? "";
    throw unexpectedGitInvocationError(args);
  };
}

/**
 * The common rev-parse-only stub: resolves `rev-parse --show-toplevel` to the
 * given repo root and throws on anything else.
 */
export function currentRepoGit(repoRoot: string): GitRunner {
  return makeStubGit({ "rev-parse --show-toplevel": `${repoRoot}\n` });
}
