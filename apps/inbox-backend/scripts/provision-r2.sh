#!/usr/bin/env bash
# F3.5 — Provision Cloudflare R2 bucket for firmar.ec inbox-backend.
#
# This script DOCUMENTS the steps. Run manually during Batch 7 (infra GATE).
# Privacy: PDFs uploaded here are ALREADY client-side encrypted (AES-GCM with
# OTP-derived key). R2 sees ciphertext only. Lifecycle policy 24h ensures
# even ciphertext is purged daily.

set -euo pipefail

cat <<'EOF'
=== F3.5 inbox-backend R2 provisioning ===

PREREQ — wrangler installed and authed against the IDK Cloudflare account:

    pnpm dlx wrangler@latest login
    # or use API token in CLOUDFLARE_API_TOKEN env

STEP 1 — Create bucket:

    pnpm dlx wrangler r2 bucket create firmar-ec-inbox

STEP 2 — Apply lifecycle (24h auto-delete on all objects):

    cat > /tmp/firmar-ec-inbox-lifecycle.json <<'JSON'
    {
      "rules": [
        {
          "id": "auto-delete-24h",
          "enabled": true,
          "conditions": { "prefix": "" },
          "deleteObjectsTransition": {
            "condition": { "type": "Age", "maxAge": 86400 }
          }
        }
      ]
    }
    JSON

    pnpm dlx wrangler r2 bucket lifecycle put firmar-ec-inbox \
      --file /tmp/firmar-ec-inbox-lifecycle.json

STEP 3 — Configure CORS (allow direct upload from PWA):

    cat > /tmp/firmar-ec-inbox-cors.json <<'JSON'
    [
      {
        "AllowedOrigins": ["https://app.firmar.ec", "https://firmar.ec"],
        "AllowedMethods": ["PUT", "GET", "HEAD"],
        "AllowedHeaders": ["*"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
      }
    ]
    JSON

    pnpm dlx wrangler r2 bucket cors put firmar-ec-inbox \
      --file /tmp/firmar-ec-inbox-cors.json

STEP 4 — Create scoped API token (R2 Object Read+Write on this bucket only):

    Cloudflare dashboard → R2 → Manage API Tokens → Create API token
      Permissions: Object Read & Write
      Bucket: firmar-ec-inbox (scoped, NOT account-wide)
      TTL: 1 year, rotation reminder calendar set

STEP 5 — Store credentials in SOPS vault:

    Add to ~/.claude/secrets/api-keys.sops.yaml under firmar_ec.inbox_backend:
      r2_account_id: <account>
      r2_access_key_id: <key>
      r2_secret_access_key: <secret>
      r2_bucket: firmar-ec-inbox
      r2_endpoint: https://<account>.r2.cloudflarestorage.com

STEP 6 — Smoke test from a manager node:

    AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED \
    aws --endpoint-url https://<account>.r2.cloudflarestorage.com \
        s3 cp /tmp/test.bin s3://firmar-ec-inbox/smoke-$(date +%s).bin

  ↳ MUST use AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED, otherwise multipart
    > 1MB will fail HTTP 422 silently (memory: aws-sdk-s3 ≥1.196 + R2 trap).

STEP 7 — Verify lifecycle visible:

    pnpm dlx wrangler r2 bucket lifecycle list firmar-ec-inbox

=== END ===

Do NOT execute this script — read it and run each step deliberately.
EOF
