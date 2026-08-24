// @ts-check

/**
 * Guard direct and nested writes to Prisma delegates whose update/upsert
 * methods are concurrency-gated in
 * `packages/server/src/utils/prisma-types.ts`.
 *
 * This intentionally mirrors the current restricted-delegate surface instead
 * of banning every Prisma write. See `docs/CONCURRENCY.md` for why ordinary
 * create/delete paths and non-gated tables stay out of scope.
 *
 * `utils/*-mutations.ts` owns the `RawTxClient` boundary for one table, so its
 * direct writes are expected. Nested writes are not: reaching a gated table
 * through a non-gated parent leaves that helper's single-table boundary.
 *
 * `create` stays out of both analyzers on purpose: nested `stats: { create: … }`
 * is ordinary character creation, and the guarded mutators mirror the
 * restricted update/upsert surface only.
 */

import { createDirectAnalyzer } from "./concurrency-guard-direct.js";
import { DIRECT_WRITE_SUGGESTIONS } from "./concurrency-guard-graph.js";
import { createNestedAnalyzer } from "./concurrency-guard-nested.js";

/** @param {string} filename */
function normalizedFilename(filename) {
  return filename.replaceAll("\\", "/");
}

/** @param {string} filename */
function isMutationHelperPath(filename) {
  const normalized = normalizedFilename(filename);
  return /(?:^|\/)packages\/server\/src\/utils\/[^/]+-mutations\.ts$/u.test(normalized);
}

/** @param {string} filename */
function isTypeTestPath(filename) {
  return /(?:^|\/)packages\/server\/src\/utils\/__type-tests__\//u.test(
    normalizedFilename(filename),
  );
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct Prisma update/upsert calls on concurrency-gated delegates, and nested relation writes that reach them through a non-gated parent",
      principle:
        "Direct update/upsert writes to concurrency-gated delegates, and the same four operations reached through nested relations, must go through a documented helper boundary.",
      category: "behavior",
      pairedGuide: "docs/guides/add-race-sensitive-mutation.md",
      // The paired command is a read-only scanner. Both branches require a
      // human to choose the helper and transaction boundary.
      repairKind: "manual",
    },
    messages: {
      noDirectWrite:
        "Why: ADR-0007 requires direct {{delegate}}.{{method}} writes to use the race-sensitive helper boundary so concurrent writers cannot lose updates. How to fix: {{suggestion}} `bun run codemod:concurrency-guard -- <file>` can inventory related findings, but it does not rewrite them. See docs/guides/add-race-sensitive-mutation.md.",
      noNestedWrite:
        "Why: this nested `{{relation}}: {{{method}}: ...}` payload writes {{delegate}} through a non-gated parent delegate, skipping the CAS machinery ADR-0007 requires — and the branded delegate types cannot see it, because a nested write goes through the generated update-input type rather than the delegate. How to fix: Split the parent write and the gated write into separate statements. {{suggestion}} See docs/guides/add-race-sensitive-mutation.md.",
    },
    schema: [],
  },

  create(context) {
    if (isTypeTestPath(context.filename)) return {};

    const directAnalyzer = createDirectAnalyzer(context.sourceCode);
    const nestedAnalyzer = createNestedAnalyzer(context.sourceCode);
    const skipDirect = isMutationHelperPath(context.filename);

    return {
      VariableDeclarator(node) {
        directAnalyzer.recordAliases(node);
        nestedAnalyzer.recordAliases(node);
      },

      CallExpression(node) {
        const direct = skipDirect ? undefined : directAnalyzer.findWrites(node);
        if (direct !== undefined) {
          context.report({
            node: node.callee,
            messageId: "noDirectWrite",
            data: {
              delegate: direct.delegate,
              method: direct.method,
              suggestion:
                DIRECT_WRITE_SUGGESTIONS.get(direct.delegate) ?? "Use a documented helper.",
            },
          });
        }

        for (const target of nestedAnalyzer.findWrites(node)) {
          context.report({
            node: target.node,
            messageId: "noNestedWrite",
            data: {
              delegate: target.delegate,
              method: target.method,
              relation: target.relation,
              suggestion:
                DIRECT_WRITE_SUGGESTIONS.get(target.delegate) ?? "Use a documented helper.",
            },
          });
        }
      },
    };
  },
};
