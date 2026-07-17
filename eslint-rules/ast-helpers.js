// @ts-check

/** @param {import('estree').ImportSpecifier} specifier */
export function importSpecifierName(specifier) {
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

/** @param {import('estree').MemberExpression} member */
export function staticPropertyName(member) {
  if (!member.computed && member.property.type === "Identifier") return member.property.name;
  if (
    member.computed &&
    member.property.type === "Literal" &&
    typeof member.property.value === "string"
  ) {
    return member.property.value;
  }
  return undefined;
}

/** @param {import('estree').Node} node */
export function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}
