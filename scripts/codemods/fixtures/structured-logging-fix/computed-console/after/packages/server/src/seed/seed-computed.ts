import { createScriptLogger } from "../utils/script-logger.js";

const logger = createScriptLogger({ command: "seed-computed" });

export function run(): void {
  logger.warn({ event: "script.warning" }, "Missing optional data");
}
