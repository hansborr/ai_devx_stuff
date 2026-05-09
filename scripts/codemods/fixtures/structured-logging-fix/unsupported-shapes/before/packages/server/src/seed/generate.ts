export function report(count: number, skills: unknown[], tools: unknown[]): void {
  console.log(`Generated ${count} rows`);
  console.log("Generated " + count);
  console.log("  Seeded", skills.length, "skills,", tools.length, "tools");
}
