// @ts-check

import path from "node:path";

/**
 * Flags a per-file `vi.mock("<module>", factory)` whose factory is byte-identical
 * (ignoring comments and whitespace) to the factory `packages/client/src/test/setup.ts`
 * already registers centrally for that module. Such a mock is pure redundancy and,
 * under `isolate: false`, silently re-pins the file to the slow isolated test lane.
 *
 * Bespoke per-file factories (anything NOT byte-identical) are intentionally left
 * alone: they are legitimate overrides, and the split test runner routes them to the
 * isolated lane by design. The canonical factories below are kept in lockstep with
 * setup.ts by the sibling `no-redundant-central-mock.test.js` drift guard, which
 * parses setup.ts and fails if the two ever diverge.
 */

/**
 * Strip comments and collapse whitespace so the comparison is byte-identity of the
 * factory's meaningful source, not its formatting.
 *
 * Regex-based comment stripping is NOT string-aware, so it must only be used on the
 * trusted, comment-free {@link CANONICAL_FACTORY_SOURCES} strings (and the byte-equal
 * factories the drift guard extracts from setup.ts). For an untrusted per-file factory
 * use {@link normalizeFactoryNode}, which strips comments via the parser's comment tokens
 * — a `//` or block-comment sequence inside a string/template literal (e.g. a URL
 * `"http://…"`) would otherwise be deleted here, which can both miss a real duplicate
 * AND, worse, collapse a bespoke override onto the canonical text so the autofixer
 * deletes a legitimate, behaviour-bearing mock.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeFactorySource(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/\/\/[^\n]*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Normalize a per-file factory NODE for comparison. Drops comments using the parser's
 * comment tokens (NOT a regex over source text, which is blind to string/template
 * literals), then collapses whitespace — matching {@link normalizeFactorySource}'s
 * output for the comment-free canonical strings while never corrupting a literal that
 * merely contains comment-like character sequences.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Node & { range: [number, number] }} node
 * @returns {string}
 */
function normalizeFactoryNode(sourceCode, node) {
  const [nodeStart, nodeEnd] = node.range;
  const text = sourceCode.getText();
  let result = "";
  let cursor = nodeStart;
  // getCommentsInside returns the node's comment tokens in source order, so a single
  // forward walk replacing each comment span with a space is sufficient.
  for (const comment of sourceCode.getCommentsInside(node)) {
    const [commentStart, commentEnd] = comment.range;
    result += `${text.slice(cursor, commentStart)} `;
    cursor = commentEnd;
  }
  result += text.slice(cursor, nodeEnd);
  return result.replace(/\s+/gu, " ").trim();
}

/**
 * Central module specifier -> the exact factory `setup.ts` registers for it. Hardcoded
 * because an ESLint rule cannot parse the TypeScript setup file at load time; the
 * sibling test's drift guard fails if these and setup.ts ever diverge.
 */
export const CANONICAL_FACTORY_SOURCES = {
  "@/lib/trpc.js": `async () => {
    const { buildLazyMockTRPCModule } = await import("@/test/mock-trpc.js");
    const { sharedMockTRPCHolder } = await import("@/test/mock-trpc-control.js");
    return buildLazyMockTRPCModule(sharedMockTRPCHolder);
  }`,
  "react-hot-toast": `async () => await import("@/test/mock-react-hot-toast.js")`,
  "react-konva": `async () => (await import("@/test/mock-react-konva.js")).default`,
  "@/components/ui/scroll-area.js": `async () => await import("@/test/mock-scroll-area.js")`,
  "@/hooks/use-socket.js": `async () => await import("@/test/mock-use-socket.js")`,
  "@/hooks/use-auth.js": `async () => await import("@/test/mock-use-auth.js")`,
  "@/lib/roll-toast.js": `async () => await import("@/test/mock-roll-toast.js")`,
  "@/hooks/realtime-invalidation.js": `async () =>
    (await import("@/test/mock-realtime-invalidation.js")).buildMockRealtimeInvalidation()`,
  "@/lib/query-invalidation.js": `async () =>
    (await import("@/test/mock-query-invalidation.js")).buildMockQueryInvalidation()`,
  "@/components/campaign/tokens/map-token-mutations.js": `async () =>
    (await import("@/test/mock-map-token-mutations.js")).buildMockMapTokenMutations()`,
  "@/lib/token-store.js": `async () =>
    (await import("@/test/mock-token-store.js")).buildMockTokenStore()`,
  "@/lib/download-json.js": `async () =>
    (await import("@/test/mock-download-json.js")).buildMockDownloadJson()`,
  "@/hooks/use-campaign-presence.js": `async () =>
    (await import("@/test/mock-use-campaign-presence.js")).buildMockUseCampaignPresence()`,
  "@/hooks/use-srd-lookups.js": `async () =>
    (await import("@/test/mock-use-srd-lookups.js")).buildMockUseSrdLookups()`,
  "@/hooks/use-ability-roll.js": `async () =>
    (await import("@/test/mock-use-ability-roll.js")).buildMockUseAbilityRoll()`,
  "@/hooks/use-weapon-roll.js": `async () =>
    (await import("@/test/mock-use-weapon-roll.js")).buildMockUseWeaponRoll()`,
  "@/hooks/vtt-drawer/use-monster-hp-update.js": `async () =>
    (await import("@/test/mock-use-monster-hp-update.js")).buildMockUseMonsterHpUpdate()`,
  "@/hooks/vtt-drawer/use-weapon-attack.js": `async () =>
    (await import("@/test/mock-use-weapon-attack.js")).buildMockUseWeaponAttack()`,
  "@/hooks/vtt-drawer/use-feature-use.js": `async () =>
    (await import("@/test/mock-use-feature-use.js")).buildMockUseFeatureUse()`,
  "@/hooks/character-sheet/use-inventory.js": `async () =>
    (await import("@/test/mock-use-inventory.js")).buildMockUseInventory()`,
  "@/hooks/use-background-image.js": `async () =>
    (await import("@/test/mock-use-background-image.js")).buildMockUseBackgroundImage()`,
  "@tanstack/react-router": `async (importOriginal) => {
    const actual = await importOriginal<typeof ReactRouter>();
    const mock = await import("@/test/mock-react-router.js");
    return {
      ...actual,
      Link: mock.Link,
      Navigate: mock.Navigate,
      useNavigate: mock.useNavigate,
      useParams: mock.useParams,
      useSearch: mock.useSearch,
      useLocation: mock.useLocation,
    };
  }`,
};

const CANONICAL_NORMALIZED = new Map(
  Object.entries(CANONICAL_FACTORY_SOURCES).map(([moduleName, source]) => [
    moduleName,
    normalizeFactorySource(source),
  ]),
);

/**
 * @param {string} specifier
 * @returns {string}
 */
function withJsExtension(specifier) {
  return path.posix.extname(specifier) === "" ? `${specifier}.js` : specifier;
}

/**
 * @param {string} file
 * @returns {string}
 */
function normalizePath(file) {
  return file.split(path.sep).join("/");
}

/**
 * @param {string} resolvedPath
 * @returns {string | undefined}
 */
function clientAliasForResolvedPath(resolvedPath) {
  const marker = "packages/client/src/";
  const index = resolvedPath.indexOf(marker);
  if (index === -1) return undefined;
  return `@/${resolvedPath.slice(index + marker.length)}`;
}

/**
 * Resolve common equivalent client specifiers to the canonical setup.ts key.
 * This intentionally stays narrow: it only normalizes exact setup keys,
 * extensionless `@/` imports, and relative imports inside packages/client/src.
 *
 * @param {string} rawSpecifier
 * @param {string} filename
 * @returns {string | undefined}
 */
function canonicalModuleKey(rawSpecifier, filename) {
  for (const candidate of [rawSpecifier, withJsExtension(rawSpecifier)]) {
    if (CANONICAL_NORMALIZED.has(candidate)) return candidate;
  }

  if (rawSpecifier.startsWith("@/")) {
    const aliasCandidate = withJsExtension(rawSpecifier);
    return CANONICAL_NORMALIZED.has(aliasCandidate) ? aliasCandidate : undefined;
  }

  if (!rawSpecifier.startsWith(".")) return undefined;
  const normalizedFilename = normalizePath(filename);
  const resolvedPath = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalizedFilename), rawSpecifier),
  );
  const alias = clientAliasForResolvedPath(resolvedPath);
  if (alias === undefined) return undefined;
  const relativeCandidate = withJsExtension(alias);
  return CANONICAL_NORMALIZED.has(relativeCandidate) ? relativeCandidate : undefined;
}

/**
 * @param {import('estree').Node} node
 * @returns {import('estree').Node}
 */
function unwrapExpression(node) {
  let current =
    /** @type {import('estree').Node & { type: string; expression?: import('estree').Node }} */ (
      node
    );
  while (current.type === "TSNonNullExpression" && current.expression !== undefined) {
    current =
      /** @type {import('estree').Node & { type: string; expression?: import('estree').Node }} */ (
        current.expression
      );
  }
  return current;
}

/**
 * @param {import('estree').CallExpression} node
 * @returns {boolean}
 */
function isViMockCall(node) {
  const callee = node.callee;
  if (callee.type === "ChainExpression") return false;
  if (callee.type !== "MemberExpression") return false;
  const object = unwrapExpression(callee.object);
  return (
    object.type === "Identifier" &&
    object.name === "vi" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "mock"
  );
}

/**
 * Walk a matched `vi.mock` call out to the statement to delete. An optional call
 * (`vi?.mock(...)`) is wrapped in a ChainExpression, so without this hop the
 * fixer would stop at the inner call and leave an orphan trailing `;` behind.
 *
 * @param {import('eslint').Rule.Node} node
 * @returns {import('eslint').Rule.Node}
 */
function statementToRemove(node) {
  let statement = node;
  if (statement.parent?.type === "ChainExpression") statement = statement.parent;
  if (statement.parent?.type === "ExpressionStatement") statement = statement.parent;
  return statement;
}

/**
 * Advance past an optional CRLF or LF line terminator at `index`.
 *
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
function skipLineTerminator(text, index) {
  let end = index;
  if (text[end] === "\r") end += 1;
  if (text[end] === "\n") end += 1;
  return end;
}

/**
 * Compute the character range to delete for a standalone statement so the
 * removal leaves no dangling whitespace or blank line. Swallows the statement's
 * own indentation, any trailing same-line whitespace, and its line terminator
 * (CRLF or LF). Only same-line whitespace is consumed, and trailing whitespace
 * only when it runs all the way to the line ending (or EOF), so a statement
 * sharing its line with other code is never over-deleted.
 *
 * @param {string} text
 * @param {[number, number]} range
 * @returns {[number, number]}
 */
function removalRange(text, [rangeStart, rangeEnd]) {
  let start = rangeStart;
  while (start > 0 && (text[start - 1] === " " || text[start - 1] === "\t")) {
    start -= 1;
  }
  let lookahead = rangeEnd;
  while (text[lookahead] === " " || text[lookahead] === "\t") lookahead += 1;
  const trailingRunsToLineEnd =
    lookahead === text.length || text[lookahead] === "\r" || text[lookahead] === "\n";
  const end = trailingRunsToLineEnd ? skipLineTerminator(text, lookahead) : rangeEnd;
  return [start, end];
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow per-file vi.mock factories that duplicate the central mock registered in setup.ts",
      principle:
        "A byte-identical per-file vi.mock of a centrally-mocked module is dead weight and, under isolate:false, silently demotes the file to the slow isolated test lane with no other signal.",
      category: "maintainability",
      pairedGuide: "none",
      repairKind: "autofix",
    },
    fixable: "code",
    messages: {
      redundant:
        "Why: setup.ts already centrally mocks {{moduleName}}, so this byte-identical per-file vi.mock is redundant and silently re-pins the file to the slow isolated test lane. How to fix: Remove this vi.mock call (autofixable) and use the @/test/mock-*-control helpers to configure per-test behaviour instead.",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        if (!isViMockCall(node)) return;
        const [moduleArg, factoryArg] = node.arguments;
        if (factoryArg === undefined) return;
        if (moduleArg?.type !== "Literal" || typeof moduleArg.value !== "string") return;
        const moduleKey = canonicalModuleKey(moduleArg.value, context.filename);
        if (moduleKey === undefined) return;
        const canonical = CANONICAL_NORMALIZED.get(moduleKey);
        if (canonical === undefined) return;
        if (normalizeFactoryNode(sourceCode, factoryArg) !== canonical) return;

        const statement = statementToRemove(node);
        const moduleName = moduleKey;
        // Only a standalone `vi.mock(...)` expression statement can be deleted
        // wholesale. If the call is nested in another construct (e.g.
        // `const m = vi.mock(...)`), statementToRemove() can only reach the call
        // or its ChainExpression wrapper, not a removable statement; deleting
        // just that range would leave invalid syntax behind (`const m = ;`), so
        // report without a fixer in that case.
        const isRemovableStatement = statement.type === "ExpressionStatement";
        context.report({
          node,
          messageId: "redundant",
          data: { moduleName },
          fix: isRemovableStatement
            ? (fixer) => fixer.removeRange(removalRange(sourceCode.getText(), statement.range))
            : null,
        });
      },
    };
  },
};
