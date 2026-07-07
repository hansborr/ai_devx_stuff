// @ts-check

/**
 * Socket listeners in React code must unregister the same event/handler pair
 * from the effect cleanup to avoid duplicate listeners after remounts.
 */

/** @typedef {{ node: import('estree').CallExpression, key: string | undefined, objectName: string }} OnCall */
/** @typedef {{ offKeys: Set<string>, removeAllListenerObjects: Set<string> }} CleanupCalls */
/** @typedef {{ onCalls: OnCall[], offKeys: Set<string>, removeAllListenerObjects: Set<string> }} EffectContext */
/** @typedef {{ effectContext: EffectContext | undefined, inCleanup: boolean, isEffectCallback: boolean, functionName: string | undefined, ownCleanupCalls: CleanupCalls, cleanupFunctionNames: Set<string>, namedFunctionCleanupCalls: Map<string, CleanupCalls> }} FunctionFrame */

/** @param {import('estree').Node} node */
function unwrapChain(node) {
  return node.type === "ChainExpression" ? node.expression : node;
}

/** @param {import('estree').PrivateIdentifier | import('estree').Expression} property */
function propertyName(property) {
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  return undefined;
}

/** @param {import('estree').Node | import('estree').SpreadElement | undefined} node */
function isFunctionNode(node) {
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression" ||
    node?.type === "FunctionDeclaration"
  );
}

const LIFECYCLE_HOOK_NAMES = new Set(["useEffect", "useLayoutEffect", "useCallback"]);

/** @param {import('estree').CallExpression} node */
function isListenerLifecycleCall(node) {
  const callee = unwrapChain(node.callee);
  if (callee.type === "Identifier") return LIFECYCLE_HOOK_NAMES.has(callee.name);
  if (callee.type !== "MemberExpression") return false;
  const name = propertyName(callee.property);
  return name ? LIFECYCLE_HOOK_NAMES.has(name) : false;
}

/** @param {import('estree').Node | import('estree').SpreadElement | undefined} node */
function stringLiteralValue(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type !== "TemplateLiteral" || node.expressions.length > 0) return undefined;
  return node.quasis[0]?.value.cooked ?? undefined;
}

/**
 * @param {import('estree').Node | import('estree').SpreadElement | undefined} node
 * @param {(name: string) => string | undefined} resolveConstString
 * @param {import('eslint').SourceCode} sourceCode
 */
function eventName(node, resolveConstString, sourceCode) {
  const literal = stringLiteralValue(node);
  if (literal) return literal;
  if (!node || node.type === "SpreadElement") return undefined;
  if (node.type === "Identifier") return resolveConstString(node.name);
  if (node.type === "MemberExpression") return sourceCode.getText(unwrapChain(node));
  return undefined;
}

/**
 * @param {import('estree').Node | import('estree').SpreadElement | undefined} node
 * @param {import('eslint').SourceCode} sourceCode
 */
function handlerName(node, sourceCode) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression") return sourceCode.getText(unwrapChain(node));
  return undefined;
}

function listenerKey(
  /** @type {string} */ objectName,
  /** @type {string} */ event,
  /** @type {string} */ handler,
) {
  return `${objectName}::${event}::${handler}`;
}

/** @param {import('estree').Node} node */
function socketObjectName(node) {
  const object = unwrapChain(node);
  if (object.type !== "Identifier") return undefined;
  return object.name.toLowerCase().includes("socket") ? object.name : undefined;
}

/** @param {import('estree').BaseFunction} node */
function functionName(node) {
  if (node.type === "FunctionDeclaration" && node.id?.type === "Identifier") return node.id.name;

  const parent = /** @type {import('estree').Node & { id?: import('estree').Pattern }} */ (
    node.parent
  );
  if (parent?.type === "VariableDeclarator" && parent.id?.type === "Identifier") {
    return parent.id.name;
  }

  return undefined;
}

function makeCleanupCalls() {
  return { offKeys: new Set(), removeAllListenerObjects: new Set() };
}

/** @param {CleanupCalls} target @param {CleanupCalls} source */
function addCleanupCalls(target, source) {
  for (const key of source.offKeys) target.offKeys.add(key);
  for (const objectName of source.removeAllListenerObjects) {
    target.removeAllListenerObjects.add(objectName);
  }
}

/**
 * @param {import('estree').CallExpression} node
 * @param {import('eslint').SourceCode} sourceCode
 * @param {(name: string) => string | undefined} resolveConstString
 */
function socketListenerCall(node, sourceCode, resolveConstString) {
  const callee = unwrapChain(node.callee);
  if (callee.type !== "MemberExpression") return undefined;

  const method = propertyName(callee.property);
  if (method !== "on" && method !== "off" && method !== "removeAllListeners") return undefined;

  const objectName = socketObjectName(callee.object);
  if (!objectName) return undefined;

  if (method === "removeAllListeners") {
    return { method, objectName, key: undefined };
  }

  const event = eventName(node.arguments[0], resolveConstString, sourceCode);
  const handler = handlerName(node.arguments[1], sourceCode);
  return {
    method,
    objectName,
    key: event && handler ? listenerKey(objectName, event, handler) : undefined,
  };
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Require socket.on listeners to be cleaned up from React effects",
      principle:
        "Client socket listeners must unregister the same event and handler from effect cleanup so remounts do not duplicate cache writes or notifications.",
      category: "behavior",
      pairedGuide: "docs/guides/add-client-feature-module-cache-socket.md",
      repairKind: "manual",
    },
    messages: {
      outsideEffect:
        "Why: Socket listeners registered outside a React effect or subscription callback can leak across remounts. How to fix: Move `socket.on` into `useEffect` or a useCallback subscription that returns matching `socket.off` cleanup.",
      missingCleanup:
        "Why: Socket listeners without matching `socket.off` cleanup leak across remounts and can duplicate cache writes. How to fix: Use a named handler and return an effect cleanup that calls `socket.off` with the same event and handler.",
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;
    /** @type {WeakSet<object>} */
    const lifecycleCallbacks = new WeakSet();
    /** @type {WeakSet<object>} */
    const cleanupCallbacks = new WeakSet();
    /** @type {Array<Map<string, string>>} */
    const constStringScopeStack = [new Map()];
    /** @type {FunctionFrame[]} */
    const functionStack = [];

    function currentFrame() {
      return functionStack.at(-1);
    }

    /** @param {OnCall} onCall @param {EffectContext} effectContext */
    function hasCleanupFor(onCall, effectContext) {
      if (onCall.key && effectContext.offKeys.has(onCall.key)) return true;
      return effectContext.removeAllListenerObjects.has(onCall.objectName);
    }

    /** @param {FunctionFrame | undefined} frame */
    function storeNamedFunctionCleanup(frame) {
      const parent = currentFrame();
      if (!frame?.functionName || !parent || parent.effectContext !== frame.effectContext) return;
      parent.namedFunctionCleanupCalls.set(frame.functionName, frame.ownCleanupCalls);
    }

    /** @param {FunctionFrame | undefined} frame */
    function reportMissingCleanups(frame) {
      if (!frame?.isEffectCallback || !frame.effectContext) return;

      for (const onCall of frame.effectContext.onCalls) {
        if (hasCleanupFor(onCall, frame.effectContext)) continue;
        context.report({ node: onCall.node.callee, messageId: "missingCleanup" });
      }
    }

    function enterFunction(/** @type {import('estree').BaseFunction} */ node) {
      const parent = currentFrame();
      const isEffectCallback = lifecycleCallbacks.has(node);
      const name = functionName(node);
      const effectContext = isEffectCallback
        ? { onCalls: [], offKeys: new Set(), removeAllListenerObjects: new Set() }
        : parent?.effectContext;
      functionStack.push({
        effectContext,
        inCleanup:
          parent?.inCleanup === true ||
          cleanupCallbacks.has(node) ||
          (name ? parent?.cleanupFunctionNames.has(name) === true : false),
        isEffectCallback,
        functionName: name,
        ownCleanupCalls: makeCleanupCalls(),
        cleanupFunctionNames: new Set(),
        namedFunctionCleanupCalls: new Map(),
      });
    }

    function exitFunction() {
      const frame = functionStack.pop();
      storeNamedFunctionCleanup(frame);
      reportMissingCleanups(frame);
    }

    function noteLifecycleCallback(/** @type {import('estree').CallExpression} */ node) {
      if (isListenerLifecycleCall(node) && isFunctionNode(node.arguments[0])) {
        lifecycleCallbacks.add(node.arguments[0]);
      }
    }

    /**
     * @param {import('estree').CallExpression} node
     * @param {{ method: string, key: string | undefined, objectName: string }} listenerCall
     */
    function handleSocketOn(node, listenerCall) {
      const frame = currentFrame();
      if (!frame?.effectContext) {
        context.report({ node: node.callee, messageId: "outsideEffect" });
        return;
      }

      if (!frame.inCleanup) {
        frame.effectContext.onCalls.push({
          node,
          key: listenerCall.key,
          objectName: listenerCall.objectName,
        });
      }
    }

    /** @param {{ method: string, key: string | undefined, objectName: string }} listenerCall */
    function handleSocketCleanup(listenerCall) {
      const frame = currentFrame();
      if (!frame?.effectContext) return;

      if (listenerCall.method === "removeAllListeners") {
        if (frame.inCleanup) {
          frame.effectContext.removeAllListenerObjects.add(listenerCall.objectName);
        } else {
          frame.ownCleanupCalls.removeAllListenerObjects.add(listenerCall.objectName);
        }
        return;
      }

      if (!listenerCall.key) return;

      if (frame.inCleanup) {
        frame.effectContext.offKeys.add(listenerCall.key);
      } else {
        frame.ownCleanupCalls.offKeys.add(listenerCall.key);
      }
    }

    /** @param {string} name */
    function resolveConstString(name) {
      for (const scope of constStringScopeStack.toReversed()) {
        const value = scope.get(name);
        if (value) return value;
      }
      return undefined;
    }

    /** @param {import('estree').VariableDeclarator} node */
    function noteConstString(node) {
      const parent = /** @type {import('estree').Node & { kind?: string }} */ (node.parent);
      if (parent?.type !== "VariableDeclaration" || parent.kind !== "const") return;
      if (node.id.type !== "Identifier") return;

      const value = stringLiteralValue(node.init ?? undefined);
      if (value) constStringScopeStack.at(-1)?.set(node.id.name, value);
    }

    function noteReturnedCleanup(/** @type {import('estree').ReturnStatement} */ node) {
      const frame = currentFrame();
      if (frame?.isEffectCallback !== true) return;

      if (isFunctionNode(node.argument)) {
        cleanupCallbacks.add(node.argument);
        return;
      }

      if (node.argument?.type !== "Identifier" || !frame.effectContext) return;

      frame.cleanupFunctionNames.add(node.argument.name);
      const cleanupCalls = frame.namedFunctionCleanupCalls.get(node.argument.name);
      if (cleanupCalls) {
        addCleanupCalls(frame.effectContext, cleanupCalls);
      }
    }

    return {
      BlockStatement() {
        constStringScopeStack.push(new Map());
      },
      "BlockStatement:exit"() {
        constStringScopeStack.pop();
      },
      CallExpression(node) {
        noteLifecycleCallback(node);

        const listenerCall = socketListenerCall(node, sourceCode, resolveConstString);
        if (!listenerCall) return;

        if (listenerCall.method === "on") {
          handleSocketOn(node, listenerCall);
          return;
        }

        handleSocketCleanup(listenerCall);
      },
      ReturnStatement: noteReturnedCleanup,
      VariableDeclarator: noteConstString,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
    };
  },
};
