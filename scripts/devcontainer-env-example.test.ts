import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadServerEnv, MIN_JWT_SECRET_LENGTH } from "../packages/server/src/config/env.js";

const ENV_EXAMPLE_PATH = path.resolve(__dirname, "../.devcontainer/.env.example");

function readJwtSecret(): string {
  const contents = readFileSync(ENV_EXAMPLE_PATH, "utf8");
  const match = contents.match(/^JWT_SECRET=(.*)$/m);
  if (match === null) {
    throw new Error(`No JWT_SECRET line found in ${ENV_EXAMPLE_PATH}`);
  }
  return match[1] ?? "";
}

describe(".devcontainer/.env.example JWT_SECRET", () => {
  it("ships a placeholder long enough to pass the server's enforced minimum", () => {
    // Guards against the template silently diverging from env.ts so an unedited
    // copy boots instead of crashing on the JWT_SECRET length refine.
    expect(readJwtSecret().length).toBeGreaterThanOrEqual(MIN_JWT_SECRET_LENGTH);
  });

  it("ships a secret on the server's production denylist so a leaked copy is rejected", () => {
    // Defense-in-depth: a >=32-char placeholder passes the length refine, so on
    // its own it would be accepted as the real signing secret if a copy reached
    // production. The shipped value must ALSO be denylisted. This asserts the
    // file content (not just env.ts) keeps that invariant. The surrounding env
    // is otherwise production-valid so the only failure is the JWT_SECRET refine.
    expect(() =>
      loadServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@db.example.com:5432/app",
        CORS_ORIGIN: "https://app.example.com",
        JWT_SECRET: readJwtSecret(),
      }),
    ).toThrow(/JWT_SECRET/);
  });
});
