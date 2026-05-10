#!/usr/bin/env bash
# Fetch the FreeTSA root cert (cacert.pem) and print its SHA-256 fingerprint.
# Run this when rotating the embedded trust root, or to verify the shipped PEM
# matches the upstream source. Update src/manifest.ts with the new fingerprint.
set -euo pipefail

DEST="$(dirname "$0")/../src/roots/freetsa.pem"
URL="https://freetsa.org/files/cacert.pem"

echo "Fetching $URL..."
curl -fsSL --max-time 30 "$URL" -o "$DEST"
echo "Saved to: $DEST"
echo "SHA-256: $(sha256sum "$DEST" | awk '{print $1}')"
