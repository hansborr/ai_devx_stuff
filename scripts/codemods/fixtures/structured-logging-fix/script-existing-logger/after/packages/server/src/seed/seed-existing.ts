import { createScriptLogger } from "../utils/script-logger.js";

const logger = createScriptLogger({ command: "seed-existing" });

export function run(): void {
  logger.warn({ event: "script.warning" }, "Missing optional data");
}
