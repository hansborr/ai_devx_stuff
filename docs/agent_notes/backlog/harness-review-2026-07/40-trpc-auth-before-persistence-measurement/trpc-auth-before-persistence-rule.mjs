// @ts-check

const DEFAULT_BOUNDARY_NAMES = [
  "assertCampaignMember",
  "assertCampaignDm",
  "fetchCampaignMembership",
  "assertCharacterOwner",
  "assertCharacterAccess",
  "assertCharacterOwnerOrAccess",
];

/**
 * @param {import("estree").Node} node
 * @returns {import("estree").Node}
 */
function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

/**
 * @param {import("estree").PrivateIdentifier | import("estree").Expression} property
 * @returns {string | undefined}
 */
function propertyName(property) {
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  return undefined;
}

/**
 * @param {import("estree").CallExpression} node
 * @returns {string | undefined}
 */
function callName(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type === "Identifier") return callee.name;
  if (callee.type !== "MemberExpression") return undefined;
  return propertyName(callee.property);
}

/**
 * @param {import("estree").Node | import("estree").SpreadElement | undefined} node
 * @returns {node is import("estree").FunctionExpression | import("estree").ArrowFunctionExpression}
 */
function isFunctionNode(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

/**
 * @param {import("estree").Node} node
 * @returns {boolean}
 */
function isQueryOrMutationCall(node) {
  if (node.type !== "CallExpression") return false;
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return false;
  const name = propertyName(callee.property);
  return name === "query" || name === "mutation";
}

/**
 * @param {import("estree").Node} node
 * @returns {boolean}
 */
function hasPrismaRoot(node) {
  const current = unwrapChain(node);
  if (current.type === "Identifier") return current.name === "prisma";
  if (current.type !== "MemberExpression") return false;

  const property = propertyName(current.property);
  if (
    property === "prisma" &&
    current.object.type === "Identifier" &&
    current.object.name === "ctx"
  ) {
    return true;
  }

  return hasPrismaRoot(current.object);
}

/**
 * @param {import("estree").CallExpression} node
 * @returns {boolean}
 */
function isPrismaCall(node) {
  const callee = unwrapChain(node.callee);
  return callee.type === "MemberExpression" && hasPrismaRoot(callee.object);
}

/**
 * @param {import("estree").Node | null | undefined} node
 * @returns {string | undefined}
 */
function keyName(node) {
  if (!node) return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

/**
 * @param {import("estree").Node} node
 * @returns {string}
 */
function procedureName(node) {
  let current = node;
  while (current.parent) {
    current = current.parent;
    if (current.type === "VariableDeclarator") {
      return keyName(current.id) ?? "<anonymous>";
    }
    if (current.type === "Property") {
      return keyName(current.key) ?? "<anonymous>";
    }
  }
  return "<anonymous>";
}

/**
 * @param {string} filename
 * @param {string} procedure
 * @returns {string}
 */
function allowlistKey(filename, procedure) {
  return `${filename}:${procedure}`;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Measurement-only prototype for tRPC auth helper calls before direct Prisma access",
    },
    messages: {
      prismaBeforeAuth:
        "Direct Prisma call appears before a recognized auth or sanctioned router boundary in procedure {{procedure}}.",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          boundaryNames: { type: "array", items: { type: "string" } },
          procedureAllowlist: { type: "array", items: { type: "string" } },
        },
      },
    ],
  },

  create(context) {
    const options = context.options[0] ?? {};
    const boundaryNames = new Set(options.boundaryNames ?? DEFAULT_BOUNDARY_NAMES);
    const procedureAllowlist = new Set(options.procedureAllowlist ?? []);
    const sourceCode = context.sourceCode;
    const filename = context.filename.replaceAll("\\", "/");

    /** @type {WeakMap<object, { seenBoundary: boolean, procedure: string, allowlisted: boolean }>} */
    const procedureCallbacks = new WeakMap();
    /** @type {Array<{ seenBoundary: boolean, procedure: string, allowlisted: boolean } | null>} */
    const functionStack = [];

    function activeState() {
      return functionStack.at(-1) ?? null;
    }

    function enterFunction(/** @type {import("estree").BaseFunction} */ node) {
      functionStack.push(procedureCallbacks.get(node) ?? null);
    }

    function exitFunction() {
      functionStack.pop();
    }

    return {
      CallExpression(node) {
        if (isQueryOrMutationCall(node)) {
          const callback = node.arguments.find(isFunctionNode);
          if (callback) {
            const procedure = procedureName(node);
            procedureCallbacks.set(callback, {
              seenBoundary: false,
              procedure,
              allowlisted: procedureAllowlist.has(allowlistKey(filename, procedure)),
            });
          }
        }

        const state = activeState();
        if (!state) return;

        const name = callName(node);
        if (name && boundaryNames.has(name)) {
          state.seenBoundary = true;
          return;
        }

        if (state.seenBoundary || state.allowlisted || !isPrismaCall(node)) return;

        context.report({
          node: node.callee,
          messageId: "prismaBeforeAuth",
          data: { procedure: state.procedure },
          loc: sourceCode.getLoc(node.callee),
        });
      },
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
    };
  },
};

export { DEFAULT_BOUNDARY_NAMES, allowlistKey };
export default rule;
