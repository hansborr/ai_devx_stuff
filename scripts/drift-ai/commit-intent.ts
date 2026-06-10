export type CommitIntentCategory =
  | "fix"
  | "refactor"
  | "scaffold"
  | "generated"
  | "update"
  | "unknown";

export type CommitIntentClassification = {
  readonly category: CommitIntentCategory;
  readonly subject: string;
  readonly trailerHints: readonly string[];
};

export type CommitIntentOverlay = {
  readonly category: CommitIntentCategory;
  readonly subjects: readonly string[];
  readonly trailerHints: readonly string[];
};

type CategoryDefinition = {
  readonly category: Exclude<CommitIntentCategory, "unknown">;
  readonly subjectPatterns: readonly RegExp[];
};

const CATEGORY_DEFINITIONS = [
  {
    category: "generated",
    subjectPatterns: [
      /\b(?:auto[- ]?generated|generated|regenerate(?:d|s)?|code[- ]?gen)\b/iu,
      /\bgenerate(?:d|s)?\s+(?:client|types?|schemas?|fixtures?|snapshots?|lockfiles?)\b/iu,
    ],
  },
  {
    category: "fix",
    subjectPatterns: [
      /\b(?:fix(?:e[sd])?|bugfix|hotfix|repair(?:ed|s)?|resolve(?:d|s)?|revert(?:ed|s|ing)?|regression)\b/iu,
    ],
  },
  {
    category: "refactor",
    subjectPatterns: [
      /\b(?:refactor(?:ed|s|ing)?|cleanup|clean up|rename(?:d|s)?|extract(?:ed|s)?|move(?:d|s)?|splits?|simplif(?:y|ied|ies))\b/iu,
    ],
  },
  {
    category: "scaffold",
    subjectPatterns: [
      /\b(?:scaffold(?:ed|s)?|skeleton|stub(?:bed|s)?|bootstrap(?:ped|s)?|initial|init|setup|set up|wire(?:d|s)?)\b/iu,
      /\badd(?:ed|s)?\s+(?:initial|starter|stub|scaffold|skeleton)\b/iu,
    ],
  },
  {
    category: "update",
    subjectPatterns: [
      /\b(?:update(?:d|s)?|upgrade(?:d|s)?|bump(?:ed|s)?|refresh(?:ed|es)?|sync(?:ed|s)?|revise(?:d|s)?|adjust(?:ed|s)?|tune(?:d|s)?|deps?|dependencies)\b/iu,
    ],
  },
] as const satisfies readonly CategoryDefinition[];

const GENERATED_TRAILER_HINT =
  /^\s*(?:generated-by|auto-generated-by|codegen|source-generated):\s*\S/iu;

export function classifyCommitIntent(
  input: string | { readonly subject: string; readonly trailers?: readonly string[] },
): CommitIntentClassification {
  const subject = typeof input === "string" ? input : input.subject;
  const trailers = typeof input === "string" ? [] : (input.trailers ?? []);
  const trailerHints = trailers.filter((trailer) => GENERATED_TRAILER_HINT.test(trailer));
  if (trailerHints.length > 0) return { category: "generated", subject, trailerHints };

  for (const definition of CATEGORY_DEFINITIONS) {
    if (definition.subjectPatterns.some((pattern) => pattern.test(subject))) {
      return { category: definition.category, subject, trailerHints };
    }
  }
  return { category: "unknown", subject, trailerHints };
}

export function buildCommitIntentOverlay(subjects: readonly string[]): CommitIntentOverlay[] {
  const groups = new Map<CommitIntentCategory, { subjects: string[]; trailerHints: string[] }>();
  for (const subject of subjects) {
    const classified = classifyCommitIntent(subject);
    const group = groups.get(classified.category);
    if (group === undefined) {
      groups.set(classified.category, {
        subjects: [classified.subject],
        trailerHints: [...classified.trailerHints],
      });
      continue;
    }
    group.subjects.push(classified.subject);
    group.trailerHints.push(...classified.trailerHints);
  }
  return [...groups.entries()].map(([category, group]) => ({
    category,
    subjects: group.subjects,
    trailerHints: group.trailerHints,
  }));
}

export function formatCommitIntentOverlay(overlays: readonly CommitIntentOverlay[]): string {
  if (overlays.length === 0) return "none";
  return overlays.map(formatOverlay).join(", ");
}

function formatOverlay(overlay: CommitIntentOverlay): string {
  const subjects = overlay.subjects.map(quote).join("; ");
  const trailerHints =
    overlay.trailerHints.length === 0
      ? ""
      : `; trailers ${overlay.trailerHints.map(quote).join("; ")}`;
  return `${overlay.category} (${subjects}${trailerHints})`;
}

function quote(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}
