export function run(err: Error, code: string): void {
  console.error("Seed failed:", { err, code });
  console.error("Explicit failure:", { event: "seed.failure", err });
}
