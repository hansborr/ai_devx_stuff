export function run(): void {
  console.log("Seeding nested...");

  function inner(): void {
    const logger = { info(_fields: Record<string, unknown>, _message?: string): void {} };
    logger.info({}, "already structured");
  }

  inner();
}
