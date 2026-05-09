import { createScriptLogger } from "../utils/script-logger.js";

const logger = createScriptLogger({ command: "seed-thing" });
const rows = ["a", "b"];

export function seedThing(): void {
  logger.info({ event: "script.progress" }, "Seeding things...");
  logger.info({ event: "script.progress", count: rows.length }, "Seeded things");
}
