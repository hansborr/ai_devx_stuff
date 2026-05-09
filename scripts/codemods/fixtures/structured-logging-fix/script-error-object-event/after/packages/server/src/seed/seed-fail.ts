import { createScriptLogger } from "../utils/script-logger.js";

const logger = createScriptLogger({ command: "seed-fail" });

export function run(err: Error, code: string): void {
  logger.error({ event: "script.failure", ...{ err, code } }, "Seed failed");
  logger.error({ event: "seed.failure", err }, "Explicit failure");
}
