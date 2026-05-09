export function run(): void {
  console.log("created");

  function inner(): void {
    const logger = { info(_fields: Record<string, unknown>, _message?: string): void {} };
    logger.info({}, "ready");
  }

  inner();
}
