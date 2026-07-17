// @ts-check

import { importSpecifierName, unwrapChain } from "./ast-helpers.js";
import { resolveDeclaredVariable, resolveIdentifierBinding } from "./binding-resolution.js";

const TRPC_CLIENT_FACTORY_NAMES = new Set(["createTRPCClient", "createTRPCProxyClient"]);
// Manually synchronized with tRPC-fetch wrapper exports from
// packages/client/src/lib/trpc.ts; update this list when wrappers are added or renamed.
const TRPC_FETCH_FUNCTION_NAMES = new Set(["fetchCurrentUser"]);

/**
 * @param {string | number | bigint | boolean | RegExp | null} source
 * @param {import('estree').ImportDeclarationSpecifier} specifier
 * @param {import('eslint').Scope.Variable} variable
 * @param {{ client: Set<import('eslint').Scope.Variable>; factory: Set<import('eslint').Scope.Variable>; fetch: Set<import('eslint').Scope.Variable> }} bindings
 */
export function registerTrpcImport(source, specifier, variable, bindings) {
  if (specifier.type !== "ImportSpecifier" || typeof source !== "string") return;
  const importedName = importSpecifierName(specifier);
  if (source === "@trpc/client" && TRPC_CLIENT_FACTORY_NAMES.has(importedName)) {
    bindings.factory.add(variable);
  }
  if (source !== "@/lib/trpc.js" && !source.endsWith("/lib/trpc.js")) return;
  if (importedName === "trpcClient") bindings.client.add(variable);
  if (importedName === "useTRPCClient") bindings.factory.add(variable);
  if (TRPC_FETCH_FUNCTION_NAMES.has(importedName)) bindings.fetch.add(variable);
}

/**
 * @param {import('estree').Expression} expression
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} clientBindings
 * @param {Set<import('eslint').Scope.Variable>} factoryBindings
 */
function hasTrpcClientProvenance(expression, sourceCode, clientBindings, factoryBindings) {
  const unwrapped = unwrapChain(expression);
  if (unwrapped.type === "Identifier") {
    const binding = resolveIdentifierBinding(sourceCode, unwrapped);
    return binding !== undefined && clientBindings.has(binding);
  }
  if (unwrapped.type === "MemberExpression") {
    return hasTrpcClientProvenance(unwrapped.object, sourceCode, clientBindings, factoryBindings);
  }
  if (unwrapped.type !== "CallExpression") return false;
  const callee = unwrapChain(unwrapped.callee);
  if (callee.type !== "Identifier") return false;
  const factory = resolveIdentifierBinding(sourceCode, callee);
  return factory !== undefined && factoryBindings.has(factory);
}

/**
 * @param {import('estree').BindingPattern} pattern
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} clientBindings
 */
function registerTrpcClientPattern(pattern, sourceCode, clientBindings) {
  if (pattern.type === "Identifier") {
    const variable = resolveDeclaredVariable(sourceCode.getScope(pattern), pattern);
    if (variable !== undefined) clientBindings.add(variable);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      registerTrpcClientPattern(
        property.type === "Property" ? property.value : property.argument,
        sourceCode,
        clientBindings,
      );
    }
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    registerTrpcClientPattern(pattern.left, sourceCode, clientBindings);
  }
}

/**
 * @param {import('estree').VariableDeclarator} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {Set<import('eslint').Scope.Variable>} clientBindings
 * @param {Set<import('eslint').Scope.Variable>} factoryBindings
 */
export function registerTrpcClientDeclaration(node, sourceCode, clientBindings, factoryBindings) {
  if (
    node.init !== null &&
    hasTrpcClientProvenance(node.init, sourceCode, clientBindings, factoryBindings)
  ) {
    registerTrpcClientPattern(node.id, sourceCode, clientBindings);
  }
}
