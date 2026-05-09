import { createScriptLogger } from "../utils/script-logger.js";

const logger = createScriptLogger({ command: "seed-nested" });

export function run(): void {
  logger.info({ event: "script.progress" }, "Seeding nested...");

  function inner(): void {
    const logger = { info(_fields: Record<string, unknown>, _message?: string): void {} };
    logger.info({}, "already structured");
  }

  inner();
}
