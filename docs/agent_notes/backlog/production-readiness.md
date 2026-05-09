# Production Readiness

Parked. Infrastructure, monitoring, CI hardening, and deployment scope kept
here so it does not get re-derived from scratch when this becomes the active
track. Promote one milestone at a time into `in_progress/` and `NEXT.md`.

## Milestones

### Error Monitoring & Observability

- [ ] Error tracking service (Sentry or equivalent)
- [ ] Server-side error capture (unhandled exceptions, tRPC errors with context)
- [ ] Client-side error capture (React error boundary integration, unhandled promise rejections)
- [ ] Source maps uploaded to error tracker (server + client builds)
- [ ] Alert rules for error rate spikes
- [ ] Structured log shipping (pino JSON logs → aggregation service)

### CI/CD Hardening

- [x] E2E tests in GitHub Actions (Playwright with PostgreSQL service)
- [x] Test coverage thresholds enforced in CI (fail PR if coverage drops)
- [ ] Bundle size tracking (fail PR if bundle grows beyond threshold)
- [ ] Database migration safety checks (detect destructive migrations in PRs)
- [ ] Dependency vulnerability scanning (npm audit / Snyk)
- [ ] Branch protection rules enforced

### Docker Deployment

- [ ] Multi-stage Dockerfile for server (build → slim runtime with Prisma client)
- [ ] Multi-stage Dockerfile for client (build → nginx/static serve)
- [ ] Docker Compose production profile (server, client, PostgreSQL, Redis, object storage)
- [ ] Environment configuration (secrets via env vars, no .env in images)
- [ ] Health check endpoints wired to Docker healthcheck
- [ ] Graceful shutdown handling (SIGTERM, drain connections)
- [ ] Database migration on startup (prisma migrate deploy)

### Infrastructure Hardening

- [ ] Socket rate limiting backed by Redis (replace in-memory)
- [x] Socket inbound event payload validation (Zod schemas enforced in handlers)
- [ ] Database connection pooling configuration (PgBouncer or Prisma pool)
- [ ] Redis connection resilience (reconnect strategy, fallback behavior)
- [ ] Rate limiting tuning for production traffic patterns
- [ ] Database constraint cleanup (onDelete rules, missing indexes)

### Data Integrity

- [ ] Database backup strategy (pg_dump schedule or managed backup)
- [ ] Consolidation migration audit (verify all models have proper migrations)
- [ ] Foreign key cascade rules audit (prevent orphaned records)
- [ ] Database index audit (missing indexes on frequently queried FKs)

## Definition of Done

- Errors are captured and alertable before users report them
- E2E tests run in CI on every PR
- App deploys via `docker compose up` with zero manual steps
- Socket.io rate limiting is Redis-backed and per-event-type
- All inbound socket events are Zod-validated
- Database has proper constraints and indexes

## Key Technical Decisions

- **Docker target**: Multi-stage builds. Server runs Bun. Client is static files served by nginx.
- **Object storage**: MinIO for local dev / Docker Compose, S3-compatible for production (configured via env vars).
- **Error tracking**: Sentry is the default choice (free tier covers small projects, good source map support).
- **Migration safety**: `prisma migrate deploy` runs on container startup, not during build. Destructive migrations flagged in CI.
