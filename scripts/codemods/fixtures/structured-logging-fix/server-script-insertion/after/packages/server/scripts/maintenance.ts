import { createScriptLogger } from "../src/utils/script-logger.js";

const logger = createScriptLogger({ command: "maintenance" });

export function run(): void {
  logger.warn({ event: "script.warning" }, "Maintenance warning");
}
