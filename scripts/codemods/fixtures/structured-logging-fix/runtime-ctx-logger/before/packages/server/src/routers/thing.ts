export function run(ctx: { logger?: { info(fields: Record<string, unknown>, message?: string): void } }): void {
  console.log("created", { thingId: "thing-1" });
}
