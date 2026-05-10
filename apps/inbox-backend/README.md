# @firma-ec/inbox-backend

WhatsApp inbox backend for firmar.ec (F3.5).

> **Status**: Batch 1 (Tasks 1–5) — scaffold only. Provisioning of DB, R2,
> Evolution instance is deferred to Batch 6/7 with explicit GATE.

## Architecture

- **Fastify 5** HTTP server (helmet, rate-limit, JWT)
- **Prisma 6** + **PostgreSQL** (Patroni HA cluster, via HAProxy at
  `postgres16_postgres:5432`)
- **Redis** DB 10 on the IDK Redis HA (DB 8 = microtk, 9 = chatwoot, 10 = us)
- **Cloudflare R2** for ciphertext PDF storage with 24h lifecycle
- **Argon2id** for OTP hashing
- **pino** with strict redaction (no PII to logs)

## Privacy claim

Phone numbers, OTPs, and derived AES keys never reach disk in plaintext:

| Field            | At rest                                              |
| ---------------- | ---------------------------------------------------- |
| Phone number     | HMAC-SHA256(phone, server_pepper) → `senderPhoneHash` |
| OTP              | Argon2id(otp, per-row salt) → `otpHash`              |
| PDF              | AES-GCM ciphertext in R2 (key derived from OTP)      |
| Derived AES key  | Never stored. Only first 4 bytes as `encryptedKeyHint` for fingerprint check. |

Logs use pino redaction; see [`src/logger.ts`](./src/logger.ts).

## Local dev

```bash
pnpm install
pnpm --filter @firma-ec/inbox-backend dev
```

Required envs (use a local Postgres + Redis for dev):

```
DATABASE_URL=postgresql://user:pw@localhost:5432/firmar_ec_inbox
REDIS_URL=redis://localhost:6379/10
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=firmar-ec-inbox
R2_ENDPOINT=https://<acct>.r2.cloudflarestorage.com
JWT_SECRET=<32+ chars>
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE=firmar-ec-inbox
```

## Provisioning (Batch 7 — GATED)

The DB and R2 bucket must be provisioned **manually** before deploy. Run each
step in these scripts deliberately, do NOT pipe into bash:

- [`scripts/provision-db.sh`](./scripts/provision-db.sh) — create
  `firmar_ec_inbox` DB in Patroni, enable extensions, run `prisma migrate
  deploy`.
- [`scripts/provision-r2.sh`](./scripts/provision-r2.sh) — create
  `firmar-ec-inbox` R2 bucket with 24h lifecycle and CORS for `app.firmar.ec`.

## Tests

```bash
pnpm --filter @firma-ec/inbox-backend test
```

Current Batch 1 tests:

- `tests/server.test.ts` — `/healthz`, `/readyz`, helmet headers
- `tests/redis.test.ts` — OTP store + rate limit helpers (ioredis-mock)

## Known gotchas

- **R2 + flexible checksums** (memory: `feedback_aws_sdk_s3_flexible_checksums_r2`):
  multipart > 1MB silently fails HTTP 422 unless
  `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED` is set. The R2 client in
  [`src/r2.ts`](./src/r2.ts) sets it both via env hoist and constructor opt.
- **Patroni HAProxy** (memory: `feedback_microtk_db_url_haproxy`): never
  hardcode `patroni2` in `DATABASE_URL`; always use `postgres16_postgres:5432`.
- **Docker secret + env split**: when adding S3-style envs to the Swarm stack
  (Batch 7), always set both `*_FILE` and the direct env (Medusa S3 trap).
