// @ts-check

/**
 * Resolve the scope `Variable` that the given declaration identifier defines by
 * searching the identifier's scope and its ancestors. Scope analysis records a
 * variable in the scope where it is declared, which may be an ancestor of the
 * scope `getScope` returns for the identifier node.
 *
 * @param {import('eslint').Scope.Scope | null} scope
 * @param {import('estree').Identifier} identifier
 * @returns {import('eslint').Scope.Variable | undefined}
 */
export function resolveDeclaredVariable(scope, identifier) {
  for (let current = scope; current !== null; current = current.upper) {
    const variable = current.variables.find((candidate) =>
      candidate.identifiers.includes(identifier),
    );
    if (variable !== undefined) return variable;
  }
  return undefined;
}

/**
 * Resolve the scope `Variable` referenced by an identifier expression. If the
 * identifier is itself a declaration identifier, return the declared variable.
 *
 * @param {import('eslint').SourceCode} sourceCode
 * @param {import('estree').Identifier} identifier
 * @returns {import('eslint').Scope.Variable | undefined}
 */
export function resolveIdentifierBinding(sourceCode, identifier) {
  const scope = sourceCode.getScope(identifier);

  for (let current = scope; current !== null; current = current.upper) {
    const reference = current.references.find((candidate) => candidate.identifier === identifier);
    if (reference?.resolved !== null && reference?.resolved !== undefined) {
      return reference.resolved;
    }
  }

  return resolveDeclaredVariable(scope, identifier);
}
