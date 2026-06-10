import * as actions from "./actions";

const scriptedActionName = "revealSecretDoor";
const reflectedActionNames: ReadonlyArray<keyof typeof actions> = [
  "revealSecretDoor",
  "stabilizeDyingAlly",
];
const reflectedHandlers = new Map<string, (context: string) => string>(
  reflectedActionNames.map((name) => [name, actions[name]]),
);

export function dispatchByStringKey(name: string, context: string): string {
  const handler = reflectedHandlers.get(name);
  if (typeof handler !== "function") return "missing";
  return handler(context);
}

export const scriptedReflectionResult = dispatchByStringKey(scriptedActionName, "north-wall");
