import { createScriptLogger } from "../src/utils/script-logger.js";

const logger = createScriptLogger({ command: "seed" });

export function failSeed(error: unknown): void {
  logger.error({ event: "script.failure", err: error }, "Seed failed");
}
