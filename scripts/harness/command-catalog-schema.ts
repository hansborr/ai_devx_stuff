// The manifest's root `commandCatalog` section: purpose lines for the package
// scripts no harness control declares.
//
// Its own module for the same reason verify-step-schema.ts is: a root section
// is domain data about the repository, not a description of how any one control
// is wired, and harness-manifest-schema.ts stays a readable inventory of the
// control kinds when each section owns its own shape.
//
// FIXTURE COPY CLOSURE: every reduced tree that copies harness-manifest-schema.ts
// copies this too (see scripts/tests/test-generate-harness-controls.sh and the
// generated harness-check fixture manifest). Keep it zod-plus-nothing.

import { z } from "zod";

// Kept strict — an unknown key here is a registration typo — but deliberately
// NOT cross-checked against package.json or against control coverage: "exactly
// one metadata source per script key" needs the live manifests, so that rule
// stays with harness:check (command-catalog.ts + registration-manifest-checks.ts)
// where the aggregated diagnostics are.
/**
 * What running a command does to the tree. Part of the manifest's JSON
 * vocabulary, so it lives with the contract rather than with the model that
 * consumes it (command-catalog.ts imports the TYPE only, which keeps this
 * zod module out of that model's runtime closure). What each value means is
 * written down once, in COMMAND_EFFECT_MEANINGS below.
 */
const COMMAND_EFFECTS = [
  "check",
  "repair",
  "generator",
  "ci-primitive",
  "lifecycle",
  "dev-utility",
] as const;

export type CommandEffect = (typeof COMMAND_EFFECTS)[number];

/**
 * One line per effect saying what running a command of that class does to your
 * tree. The single source of these meanings: the generated catalog page renders
 * this map as its Effect legend, so the vocabulary and its explanation cannot
 * drift apart, and the Record keying makes a new effect value fail to compile
 * until someone writes what it does.
 */
export const COMMAND_EFFECT_MEANINGS: Readonly<Record<CommandEffect, string>> = {
  check: "Reports or fails. Writes nothing you have to review.",
  repair: "Rewrites tracked files to fix what a check reports.",
  generator: "Rewrites a committed generated artifact from its source.",
  "ci-primitive": "A build/test/typecheck step the gates and CI compose from.",
  lifecycle: "Runs from a package-manager or git hook, not by hand.",
  "dev-utility": "Interactive or operator tooling. No gate depends on it.",
};

// Local copy of the manifest's non-blank string rule, stated as a regex rather
// than a refinement for the same reason it is there: a refinement is invisible
// to z.toJSONSchema, so the published schema would silently accept "".
const nonBlankString = z.string().regex(/\S/u, { message: "must be a non-empty string" });

export const commandCatalogSchema = z
  .array(
    z.strictObject({
      manifest: nonBlankString,
      script: nonBlankString,
      effect: z.enum(COMMAND_EFFECTS),
      purpose: nonBlankString,
      doc: nonBlankString.optional(),
    }),
  )
  .min(1)
  .meta({
    description:
      "Purpose lines for every package.json script across the tracked manifests that no single harness control speaks for. One entry per (manifest, script); a script exactly one control declares is documented by that control instead, and declaring both is rejected repo-side, while a script several controls declare requires an entry here because those controls are the rules it runs, not descriptions of the command.",
  });
