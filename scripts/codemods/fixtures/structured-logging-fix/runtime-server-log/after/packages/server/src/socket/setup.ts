export function setup(server: { log: { warn(fields: Record<string, unknown>, message?: string): void } }): void {
  server.log.warn({}, "redis unavailable");
}
