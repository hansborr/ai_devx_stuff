export function run(ctx: { logger?: { info(fields: Record<string, unknown>, message?: string): void } }): void {
  ctx.logger?.info({ thingId: "thing-1" }, "created");
}
