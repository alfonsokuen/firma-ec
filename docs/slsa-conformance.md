# SLSA v1.0 Conformance Assessment — firma.ec

**Date:** 2026-05-10
**Spec:** [SLSA v1.0](https://slsa.dev/spec/v1.0/) (Build Track + Source Track)
**Public claim today (README transparency-report):** "SLSA L2 con elementos L3"
**Honesty target:** be precise about which requirements are met and which are gaps.

## TL;DR

| Track | Level achieved | Notes |
|---|---|---|
| Build | **L2 (verified) + 3/4 of L3 requirements** | Provenance is signed, non-falsifiable, service-generated (Sigstore + Rekor). Hardened-builder requirement borderline — GitHub-hosted runners are widely interpreted as L3-conformant when paired with `actions/attest-build-provenance`. |
| Source | **L2 (verified history + retained ≥18 months)** | Branch protection with required reviews would lift to L3 but is currently disabled. |

We deliberately do not claim L3 strict until the Source Track gap is closed and the Build Track is independently audited.

## Build Track

### L1 — Provenance exists ✅
- `actions/attest-build-provenance@v2` emits an in-toto attestation for every tagged release. Stored as a Sigstore bundle, indexed in Rekor.

### L2 — Provenance is signed and tied to a specific builder ✅
- Attestation signed by GitHub's OIDC identity (`https://token.actions.githubusercontent.com`). Signer subject identifies repo + workflow + ref.
- Verifiable via `cosign verify-blob --bundle=…sigstore.json` or `gh attestation verify`.

### L3 — Hardened build platform ⚠️ Partial

L3 requires that **the build platform itself is hardened**: isolated builds, ephemeral environments, no persistent state, no operator interference. Conformance assessment:

| Requirement | Status |
|---|---|
| Builds run in ephemeral, isolated environments | ✅ GitHub-hosted runners are ephemeral VMs |
| Build platform's provenance is non-falsifiable by tenants | ✅ Provenance is signed by GitHub's identity, not the workflow caller |
| Service generates the provenance (not the user) | ✅ `attest-build-provenance` runs as part of GitHub Actions, not as user code |
| Hardened against parallel-build interference | ✅ Each release runs in its own VM |
| **Builder is independently audited** | ⚠️ GitHub Actions has a SOC 2 Type 2 but no published independent SLSA L3 audit. Community consensus (slsa.dev FAQ) treats it as L3-eligible when using `attest-build-provenance`, but a stricter interpretation reserves L3 for fully isolated builders like the slsa-github-generator workflow with sigstore signing. |
| **Hermetic builds** (no network during build except pinned deps) | ❌ `pnpm install` accesses the npm registry. Could pin further with `pnpm install --offline` after a pre-fetch step. |
| **Parameterless builds** (no user input affects build) | ⚠️ The tag name affects the artifact name; otherwise the build is parameterless. |

**Decision:** Stay at "L2 verified, with L3 elements" until we either (a) migrate to `slsa-framework/slsa-github-generator` which is the canonical L3 reference, or (b) get an independent attestation that the current setup meets L3.

### L4 — Two-party review of build config + reproducible builds

Two-party review = Source Track requirement, not Build Track in SLSA v1.0. Reproducible builds is the build-config-track requirement at L4 — see [docs/reproducible-builds.md](./reproducible-builds.md).

## Source Track

| Requirement | Status |
|---|---|
| L1 — Source has a version-controlled history | ✅ Git, public mirrors on GitHub (idkmanager + alfonsokuen) |
| L2 — History authentication | ✅ Tags signed by Sigstore via release workflow; commits not yet GPG-signed |
| L3 — Verified history + two-person reviewed changes | ❌ Branch protection on `main` with required reviewer count ≥ 1 is currently **not enabled** |

### L3 source gap — what's missing

To lift the Source Track to L3 we need, on `idkmanager/firmar-ec` GitHub:

1. **Branch protection on `main`**:
   - Require pull request reviews before merging (at least 1 reviewer)
   - Dismiss stale approvals on push
   - Require status checks: CI + CodeQL + Lighthouse
   - Restrict force-push and direct push
2. **Two-party review policy**: 1 reviewer + the author (so commits authored by automation, like Renovate bumps, need a human reviewer)
3. **Audit the bypass list**: only emergency hotfix push for incident response, logged

These are repo settings, not workflow changes. They block `git push` for solo development; the firma.ec project so far has been single-maintainer (alfonso + Claude), so adopting this gate means committing to PR-based workflow for future contributions.

**Decision pending user**: do we adopt 2-reviewer review now, or wait until a second human maintainer joins the project? Without a second human reviewer available, the policy is theatre — every PR would self-approve via "I am also alfonso."

## What we do that goes BEYOND the minimum

- **SBOM (CycloneDX 1.6 + SPDX 2.3)** signed with cosign — SLSA does not require SBOMs, we ship two.
- **Rekor transparency log** for every artifact + SBOM + checksums — gives anyone the ability to detect tampering after the fact, not just verify the latest.
- **Public release notes auto-generated** — chain of custody from tag → release → published artifacts is fully observable.
- **Reproducible-builds quick wins** (2026-05-10) — `SOURCE_DATE_EPOCH` + deterministic `tar` + `gzip -n`. Verification pending, see [docs/reproducible-builds.md](./reproducible-builds.md).

## Verification (anyone can do this)

```bash
TAG=v0.7.0-rc1
COMMIT=9380db41291f2beadf2f3304cecf1d322963679f   # update per tag

# 1. Provenance attestation
gh attestation verify --owner idkmanager --signer-workflow .github/workflows/release.yml \
  https://github.com/idkmanager/firmar-ec/releases/download/$TAG/pwa.tar.gz

# 2. Cosign keyless verify
cosign verify-blob \
  --certificate https://github.com/idkmanager/firmar-ec/releases/download/$TAG/pwa.tar.gz.pem \
  --signature   https://github.com/idkmanager/firmar-ec/releases/download/$TAG/pwa.tar.gz.sig \
  --certificate-identity-regexp '^https://github.com/idkmanager/firmar-ec' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ./pwa.tar.gz

# 3. Rekor log lookup
rekor-cli search --sha $(sha256sum pwa.tar.gz | awk '{print $1}')
```

## Roadmap to L3 strict

1. **Source Track L3**: enable branch protection on `main` (waiting on second-maintainer decision).
2. **Build Track L3 strict**: migrate to `slsa-framework/slsa-github-generator` (canonical L3 reference workflow). Drop-in but requires reworking artifact subject paths.
3. **Build hermeticity**: pre-fetch deps in a separate hermetic step, `pnpm install --offline` in build step.
4. **Reproducibility verified**: see [docs/reproducible-builds.md](./reproducible-builds.md) roadmap items 1–5.
5. **Independent audit**: get a third-party attestation that the build platform setup meets L3 (e.g., via Sigstore audit, OpenSSF audit).

## What to write in marketing

✅ "SLSA Build L2 verified, with several L3 requirements met (signed provenance, ephemeral builder, Rekor transparency log)."
✅ "SLSA Source L2 (verified history). L3 source-track adoption pending."
✅ "Cosign keyless signatures + Rekor public transparency log on every release."
❌ "SLSA L3 certified" — until independent audit + branch protection.
❌ "Reproducible builds verified" — see [docs/reproducible-builds.md](./reproducible-builds.md); aspirational, quick wins applied.
