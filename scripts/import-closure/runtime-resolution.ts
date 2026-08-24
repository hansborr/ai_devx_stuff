import { extname, resolve } from "node:path";

/**
 * Extensions the walker resolves. The seed and the fixture entry scripts are
 * plain TypeScript/JavaScript, so this is the set they actually use rather than
 * everything Bun can load: an unlisted extension fails to resolve, which fails
 * the walk closed.
 */
export const sourceResolutionExtensions = [".ts", ".tsx", ".js", ".mjs", ".json"] as const;

/** Data modules: hashed as inputs, never parsed for further imports. */
const terminalExtensions: ReadonlySet<string> = new Set([".json"]);

/**
 * Traversal is decided by the file extension alone. Bun's loader taxonomy
 * (`with { type: "..." }` overrides, the executable/terminal loader split) is
 * deliberately not modelled: the only attribute the policy accepts is
 * `with { type: "json" }` on a `.json` specifier, which the extension already
 * classifies.
 */
export const runtimeFileShouldBeTraversed = (
  extension: string,
  consumerTerminal: boolean,
  alreadyTraversed: boolean,
): boolean => !consumerTerminal && !alreadyTraversed && !terminalExtensions.has(extension);

export const runtimeResolutionCandidates = (base: string): readonly string[] => {
  const extension = extname(base);
  // TypeScript sources are imported through their compiled `.js` specifier.
  if (extension === ".js") {
    const stem = base.slice(0, -extension.length);
    return [base, `${stem}.ts`, `${stem}.tsx`];
  }
  if (extension !== "") return [base];
  return [
    ...sourceResolutionExtensions.map((candidateExtension) => `${base}${candidateExtension}`),
    ...sourceResolutionExtensions.map((candidateExtension) =>
      resolve(base, `index${candidateExtension}`),
    ),
  ];
};
