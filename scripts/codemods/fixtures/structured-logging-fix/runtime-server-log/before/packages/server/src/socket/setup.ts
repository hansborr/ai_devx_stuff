export function setup(server: { log: { warn(fields: Record<string, unknown>, message?: string): void } }): void {
  console.warn("redis unavailable");
}
