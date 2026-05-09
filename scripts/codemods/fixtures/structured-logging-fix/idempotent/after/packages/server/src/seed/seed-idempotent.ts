import { createScriptLogger } from "../utils/script-logger.js";

const logger = createScriptLogger({ command: "seed-idempotent" });

export function run(): void {
  logger.info({ event: "script.progress" }, "Done");
}
