#!/usr/bin/env bash
# F3.5 — Provision firmar_ec_inbox database in Patroni cluster.
#
# This script DOCUMENTS the steps. It does NOT execute them automatically.
# Run manually once during Batch 7 (infra GATE).
#
# Patroni HA cluster (per CLAUDE.md): postgres16_postgres:5432 → leader (HAProxy).
# DO NOT hardcode patroni2 — always go via HAProxy.

set -euo pipefail

cat <<'EOF'
=== F3.5 inbox-backend DB provisioning ===

STEP 1 — Connect to Patroni leader as superuser:

    docker exec -it patroni16_haproxy psql -h postgres16_postgres -U postgres

  Or, from a manager node with psql installed:

    PGPASSWORD=<superuser-pw> psql -h postgres16_postgres -U postgres -p 5432

STEP 2 — Create database + role:

    CREATE ROLE firmar_ec_inbox WITH LOGIN PASSWORD '<strong-password>';
    CREATE DATABASE firmar_ec_inbox OWNER firmar_ec_inbox;

STEP 3 — Connect to the new DB and enable extensions:

    \c firmar_ec_inbox

    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  (pgcrypto = SHA256/HMAC for phone-hash audit; uuid-ossp = optional, cuid is
  used for primary keys but uuid-ossp is cheap to keep available.)

STEP 4 — Grant schema privileges (public schema):

    GRANT ALL ON SCHEMA public TO firmar_ec_inbox;

STEP 5 — Store DATABASE_URL in SOPS vault:

    DATABASE_URL=postgresql://firmar_ec_inbox:<password>@postgres16_postgres:5432/firmar_ec_inbox?schema=public

  Add to ~/.claude/secrets/api-keys.sops.yaml under firmar_ec.inbox_backend.database_url

STEP 6 — Apply Prisma migrations:

    cd apps/inbox-backend
    DATABASE_URL='postgresql://...' pnpm prisma:migrate:deploy

STEP 7 — Verify:

    \c firmar_ec_inbox
    \dt
    -- expect: pending_pdfs

STEP 8 — Backup baseline before going live (Batch 7 gate):

    pg_dump -h postgres16_postgres -U firmar_ec_inbox firmar_ec_inbox \
      | gzip > /mnt/swarm-nfs/backups/firmar_ec_inbox-pre-launch-$(date +%Y%m%d).sql.gz

=== END ===

This script intentionally does NOT execute the above. Run each step manually
and verify before proceeding.
EOF
