import { z } from "zod";

// Typed contract for the lint coverage-map policy manifest. The manifest — not
// `docs/generated/lint-coverage-map.md` — is the source of truth for which
// tracked files each coverage row claims and what it asserts about them; the
// Markdown document is rendered from it.
//
// Two invariants this schema exists to hold that the previous Markdown-parsing
// checker could only rediscover by re-reading its own output:
//
// - Membership is a list of explicit, repo-rooted minimatch globs resolved by
//   `tools/lint-ratchet/src/kernel/ratchet-globs.ts` (the same engine, with the
//   same `dot: true` option, that ESLint flat config and the ratchet registry
//   use). There is no base-directory grammar, no implicit `**/` prefixing, and
//   no duplicate-extension normalization: a glob means exactly what minimatch
//   says it means.
// - `normalLint.covered` and the `linted` status part encode the same fact, so
//   they are checked against each other here rather than by re-parsing two
//   Markdown cells.

const COVERAGE_STATUS_PARTS = [
  "linted",
  "ratcheted",
  "proposed",
  "pending-leaf",
  "excluded",
  "not-code",
] as const;

const coverageStatusPartSchema = z.enum(COVERAGE_STATUS_PARTS);

export type CoverageStatusPart = z.infer<typeof coverageStatusPartSchema>;

// `linted`/`ratcheted`/`proposed`/`pending-leaf` all describe a maintained lint
// target at some stage of adoption, so they compose; `excluded`/`not-code`
// describe a non-target. A row may not claim both families at once.
const CODE_STATUS_PARTS: ReadonlySet<CoverageStatusPart> = new Set([
  "linted",
  "ratcheted",
  "proposed",
  "pending-leaf",
]);

const coverageGlobSchema = z
  .string()
  .min(1)
  .refine(
    (glob) => !glob.startsWith("/") && !glob.startsWith("./") && !glob.split("/").includes(".."),
    "coverage-map globs are repo-rooted minimatch patterns: no leading `/` or `./`, no `..` segment",
  );

// Section heading depth in the rendered document: `##` for a top-level family,
// `###` for a sub-family under "Additional Script Families".
const TOP_LEVEL_HEADING = 2;
const SUB_HEADING = 3;

// The checker lexes ratchet claims out of the `ratchets` prose with
// `/ratchet\/[a-z0-9-]+/g` and validates every hit against the live registry. A
// reference that pattern cannot see is worse than a wrong one: it renders as a
// claim in the document and validates as no claim at all. These two patterns
// make that lex total — anything shaped like a ratchet reference must be a
// well-formed id, so the only way past the registry check is not to claim one.
const RATCHET_REFERENCE_PATTERN = /[a-z]*ratchet[a-z]*\/[\w/-]*/giu;
const WELL_FORMED_RATCHET_ID = /^ratchet\/[a-z0-9-]+$/u;

const coverageEntryIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "coverage-map entry ids are lowercase kebab-case");

const normalLintSchema = z
  .object({
    /** Whether `bun run lint` reaches these files under the strict project config. */
    covered: z.boolean(),
    /** Optional qualifier rendered parenthetically after `yes`/`no`. */
    note: z.string().min(1).optional(),
  })
  .strict();

// The entry-level invariants below are split out of `superRefine` so the
// callback stays under the shared complexity floor. They are typed structurally
// rather than against Zod internals: each one only reads a few asserted fields
// and reports through `addIssue`.
interface RefinableEntry {
  readonly id: string;
  readonly status: readonly CoverageStatusPart[];
  readonly normalLint: { readonly covered: boolean };
  readonly ratchets?: string | undefined;
  readonly files?: string | undefined;
  readonly filesCountNote?: string | undefined;
  readonly derived?: "drift-ai" | undefined;
}

interface RefinementIssueSink {
  readonly addIssue: (issue: { code: "custom"; path: PropertyKey[]; message: string }) => void;
}

function refineStatusVocabulary(entry: RefinableEntry, ctx: RefinementIssueSink): void {
  const claimsCode = entry.status.some((part) => CODE_STATUS_PARTS.has(part));
  const claimsNonCode = entry.status.some((part) => !CODE_STATUS_PARTS.has(part));
  if (claimsCode && claimsNonCode) {
    ctx.addIssue({
      code: "custom",
      path: ["status"],
      message: `entry \`${entry.id}\` mixes lint-target and non-lint-target status parts: ${entry.status.join(" + ")}`,
    });
  }
  if (entry.normalLint.covered !== entry.status.includes("linted")) {
    ctx.addIssue({
      code: "custom",
      path: ["normalLint", "covered"],
      message: `entry \`${entry.id}\` says normal lint ${entry.normalLint.covered ? "covers" : "does not cover"} it but its status is \`${entry.status.join(" + ")}\``,
    });
  }
}

function refineRatchetReferences(entry: RefinableEntry, ctx: RefinementIssueSink): void {
  for (const match of (entry.ratchets ?? "").matchAll(RATCHET_REFERENCE_PATTERN)) {
    if (WELL_FORMED_RATCHET_ID.test(match[0])) continue;
    ctx.addIssue({
      code: "custom",
      path: ["ratchets"],
      message: `entry \`${entry.id}\`: \`${match[0]}\` is not a well-formed \`ratchet/<id>\` reference, so the coverage check would silently read this row as claiming no ratchet`,
    });
  }
}

function refineDerivedSplit(entry: RefinableEntry, ctx: RefinementIssueSink): void {
  const isDerived = entry.derived !== undefined;
  if (isDerived && entry.filesCountNote !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["filesCountNote"],
      message: `entry \`${entry.id}\`: a \`derived\` row renders its own \`Files\` cell, so it cannot exempt itself from the count check`,
    });
  }
  for (const field of ["files", "ratchets"] as const) {
    if (isDerived !== (entry[field] === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `entry \`${entry.id}\`: \`${field}\` is asserted by hand-maintained rows and rendered for \`derived\` rows — exactly one must apply`,
      });
    }
  }
}

const coverageEntrySchema = z
  .object({
    /**
     * Stable identity for this row. Referenced by `--suggest` output and by
     * checker findings, so it must survive reordering and prose edits.
     */
    id: coverageEntryIdSchema,
    globs: z.array(coverageGlobSchema).min(1).readonly(),
    /** Prose appended after the rendered glob list, e.g. `(production, non-test)`. */
    pathNote: z.string().min(1).optional(),
    /** Asserted `Files` cell. Omitted for `derived` rows, which render their own. */
    files: z.string().min(1).optional(),
    /**
     * Why this row's `Files` cell is not the count of tracked files its globs
     * match. Manifest-only: the checker verifies the leading count against the
     * live tree for every row WITHOUT this note, so an entry opts out only by
     * writing down the reason. The two legitimate reasons today are a
     * deliberate subset (a sibling row owns the rest and rows carry no
     * `ignores`) and a narrative cell that is not a total at all.
     */
    filesCountNote: z.string().min(1).optional(),
    normalLint: normalLintSchema,
    /** Asserted `Existing ratchet/floor` prose. Omitted for `derived` rows. */
    ratchets: z.string().min(1).optional(),
    parser: z.string().min(1),
    proposed: z.string().min(1),
    status: z.array(coverageStatusPartSchema).min(1).readonly(),
    followUp: z.string().min(1),
    /**
     * Marks a row whose `Files` and `Existing ratchet/floor` cells are computed
     * at generation time from tracked files, proven ESLint reach, and live
     * ratchet membership instead of asserted here.
     */
    derived: z.literal("drift-ai").optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    refineStatusVocabulary(entry, ctx);
    refineRatchetReferences(entry, ctx);
    refineDerivedSplit(entry, ctx);
  });

export type CoverageEntry = z.infer<typeof coverageEntrySchema>;

const coverageGroupSchema = z
  .object({
    /** Prose emitted immediately above this table, e.g. an ownership caveat. */
    note: z.string().min(1).optional(),
    entries: z.array(coverageEntrySchema).min(1).readonly(),
  })
  .strict();

const coverageSectionSchema = z
  .object({
    heading: z.string().min(1),
    level: z.union([z.literal(TOP_LEVEL_HEADING), z.literal(SUB_HEADING)]),
    /** Markdown paragraphs emitted between the heading and the first table. */
    intro: z.string().min(1).optional(),
    /** A section may carry no table at all (a pure grouping heading). */
    groups: z.array(coverageGroupSchema).readonly(),
  })
  .strict();

export type CoverageSection = z.infer<typeof coverageSectionSchema>;

export const coverageManifestSchema = z
  .array(coverageSectionSchema)
  .min(1)
  .readonly()
  .superRefine((sections, ctx) => {
    const seen = new Set<string>();
    for (const section of sections) {
      for (const group of section.groups) {
        for (const entry of group.entries) {
          if (seen.has(entry.id)) {
            ctx.addIssue({
              code: "custom",
              message: `duplicate coverage-map entry id \`${entry.id}\``,
            });
          }
          seen.add(entry.id);
        }
      }
    }
  });
