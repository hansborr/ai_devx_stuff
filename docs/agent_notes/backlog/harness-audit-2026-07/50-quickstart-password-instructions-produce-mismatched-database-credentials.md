# 50 — Quickstart password instructions produce mismatched database credentials

Status: Done
Track: DOC (docs) · Priority: P1 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** The onboarding chain was re-read end to end: the README changes one password variable, Docker seeds from it, and Prisma connects through independently embedded URLs that retain the placeholder.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `README.md:31` — Quickstart tells newcomers to change `POSTGRES_PASSWORD` and `JWT_SECRET` without mentioning database URLs.
- `.env.example:9`, `.env.example:12`, and `.env.example:13` — `DATABASE_URL`, `TEST_DATABASE_URL`, and `E2E_DATABASE_URL` each embed the password independently.
- `docker-compose.yml:8` — PostgreSQL initialization consumes `POSTGRES_PASSWORD`.
- `packages/server/prisma.config.ts:10` — Prisma connects through `DATABASE_URL`.

Failure: Following the documented fresh-clone steps literally starts PostgreSQL with a new password and then makes `db:migrate` authenticate with the old placeholder, blocking Quickstart at step 4.

## Do

Tell users to replace the password in every database URL as well as `POSTGRES_PASSWORD`, or change the example configuration to derive URLs from one credential source. Keep Docker and Prisma instructions explicit.

## Verify

```
docker compose config && bun run --filter @musi/server prisma:generate
```

## Acceptance

- The Quickstart’s credential edit leaves Docker and all documented database URLs consistent.
- A reader can identify every password-bearing variable before migration.
