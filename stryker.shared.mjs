// Explicit plugin list: Bun's hoisted node_modules layout breaks Stryker's
// default auto-discovery (it scans from @stryker-mutator/core's own tree).
const plugins = ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"];
const reporters = ["clear-text", "progress", "html", "json"];
const thresholds = {
  high: 80,
  low: 60,
  break: null,
};

/**
 * The only keys a lane may supply. Everything else in the returned config is a
 * shared invariant (plugins, concurrency, checkers, reporters, thresholds) that
 * lanes deliberately cannot override.
 *
 * @typedef {object} StrykerLaneOptions
 * @property {string} tsconfigFile package tsconfig the typescript-checker runs against
 * @property {string} reportDir directory the incremental file and both report files are written under
 * @property {string[]} mutate Stryker mutate globs for this lane
 * @property {Record<string, unknown>} vitest vitest-runner options (configFile, dir, related)
 * @property {string[]} [ignorePatterns] extra sandbox-copy exclusions
 * @property {boolean} [inPlace] mutate the live worktree instead of a copied sandbox
 */
const REQUIRED_LANE_OPTIONS = ["mutate", "reportDir", "tsconfigFile", "vitest"];
const OPTIONAL_LANE_OPTIONS = ["ignorePatterns", "inPlace"];

/**
 * Fail closed on lane options this factory cannot honour.
 *
 * The per-lane inline configs this factory replaced passed their whole object
 * to Stryker, whose own options validator warns on unrecognised keys. A plain
 * destructure would swallow that signal: a typo'd `reportsDir` leaves
 * `reportDir` undefined and silently writes `undefined/stryker-incremental.json`,
 * and a typo'd `ignorePatterns` silently reinstates the `.tools` sandbox-copy
 * failure the option exists to prevent. These files are Espree-linted with no
 * checkJs, so nothing else catches either mistake. Throwing is strictly louder
 * than the warning it replaces, and unlike passing overrides through it also
 * keeps a lane from quietly reopening a shared invariant.
 *
 * @param {Record<string, unknown>} options the raw lane options as written by the caller
 * @param {string[]} unexpectedKeys keys left over after the known options are destructured
 * @returns {void}
 */
function assertLaneOptions(options, unexpectedKeys) {
  const known = [...REQUIRED_LANE_OPTIONS, ...OPTIONAL_LANE_OPTIONS].join(", ");
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `createStrykerConfig received unknown option(s): ${unexpectedKeys.join(", ")}. ` +
        `Known lane options are: ${known}. Fix the spelling, or — if the lane genuinely ` +
        `needs a new Stryker setting — add it to createStrykerConfig in stryker.shared.mjs ` +
        `so every lane shares one definition of it.`,
    );
  }
  const missing = REQUIRED_LANE_OPTIONS.filter((key) => options[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `createStrykerConfig is missing required option(s): ${missing.join(", ")}. ` +
        `Every lane must supply: ${REQUIRED_LANE_OPTIONS.join(", ")}.`,
    );
  }
}

/**
 * @param {StrykerLaneOptions} options per-lane inputs
 * @returns {Record<string, unknown>} a complete Stryker configuration for one lane
 */
function createStrykerConfig(options) {
  const { ignorePatterns, inPlace, mutate, reportDir, tsconfigFile, vitest, ...unexpected } =
    options;
  assertLaneOptions(options, Object.keys(unexpected).sort());

  return {
    plugins,
    testRunner: "vitest",
    checkers: ["typescript"],
    tsconfigFile,
    concurrency: 1,
    ...(ignorePatterns === undefined ? {} : { ignorePatterns }),
    ...(inPlace === undefined ? {} : { inPlace }),
    incremental: true,
    incrementalFile: `${reportDir}/stryker-incremental.json`,
    vitest,
    mutate,
    reporters,
    htmlReporter: {
      fileName: `${reportDir}/index.html`,
    },
    jsonReporter: {
      fileName: `${reportDir}/mutation.json`,
    },
    thresholds,
  };
}

export { createStrykerConfig };
