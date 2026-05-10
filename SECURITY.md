# Security policy

> Política de divulgación responsable + instrucciones para verificar releases firmadas con Sigstore.

## Reportar vulnerabilidades

Canal privado preferido: **[GitHub Security Advisories](https://github.com/idkmanager/firma-ec/security/advisories/new)** (cifrado en tránsito, permite coordinar embargo).

Por favor incluye:

1. Descripción + impacto.
2. Pasos reproducibles (o PoC sanitizado).
3. Versión afectada — tag SemVer (`v0.X.Y-rcN`) o commit SHA.
4. Tu nombre/handle para créditos públicos (opcional).

**SLA**: respuesta en ≤48 horas. Coordinamos remediación + ventana de divulgación (típicamente 30–90 días según severidad CVSS).

Política completa también en [`/.well-known/security.txt`](https://firmar.ec/.well-known/security.txt) (RFC 9116).

## Verificar releases con Sigstore + Rekor

Cada release tag está firmada con `cosign sign-blob` (Sigstore keyless OIDC desde GitHub Actions) y registrada en el transparency log público de Rekor.

### Public key

```
https://firmar.ec/.well-known/cosign.pub
```

Mirror en repo: [`infra/cosign/cosign.pub`](infra/cosign/cosign.pub) (cuando se publique).

### Latest signed release

| Campo | Valor |
|---|---|
| Tag | `v0.7.0-rc1` |
| Tag SHA | `9380db41291f2beadf2f3304cecf1d322963679f` |
| Rekor tlog index | `1497932420` |
| Integrated time | `2026-05-10T19:02:23 UTC` |
| Sig file (base64) | `_backups/F7-deploy-2026-05-10-rc1/v0.7.0-rc1.sig` |
| Sigstore bundle | `_backups/F7-deploy-2026-05-10-rc1/v0.7.0-rc1.bundle` |

### Pasos de verificación

```bash
# 1. Fetch public key
curl -sf https://firmar.ec/.well-known/cosign.pub -o cosign.pub

# 2. Pin tag SHA
TAG=v0.7.0-rc1
TAG_SHA=$(git rev-parse "$TAG")
test "$TAG_SHA" = "9380db41291f2beadf2f3304cecf1d322963679f" || \
  { echo "Tag SHA mismatch — DO NOT trust"; exit 1; }

# 3. Verify signature against tag SHA via Rekor
cosign verify-blob \
  --key cosign.pub \
  --signature _backups/F7-deploy-2026-05-10-rc1/v0.7.0-rc1.sig \
  --bundle    _backups/F7-deploy-2026-05-10-rc1/v0.7.0-rc1.bundle \
  --rekor-url https://rekor.sigstore.dev \
  <(echo -n "$TAG_SHA")

# 4. Cross-check Rekor tlog (independiente)
rekor-cli get \
  --log-index 1497932420 \
  --rekor_server https://rekor.sigstore.dev
```

Si **cualquier paso falla**: no confíes en el artefacto. Abre un issue público con la salida exacta del comando que falló.

## Supply chain — estado real

Ver [`README.md` § Supply chain](README.md#supply-chain-slsa-l2-con-elementos-l3).

- SLSA: **L2 con elementos L3** (provenance firmada por release, runner hardened). L3 estricto pendiente: hosted platform aislado + two-person review automatizado + atestaciones JSON públicas.
- Reproducible builds: **roadmap**, no verificado externamente todavía.
- SBOM: CycloneDX 1.6 + SPDX 2.3 publicados por release.

## Auditorías externas vigentes

| Auditoría | Resultado | Última verificación |
|---|---|---|
| [Mozilla Observatory](https://developer.mozilla.org/en-US/observatory/analyze?host=firmar.ec) | **A+ 125/100** | 2026-05-08 |
| [SSL Labs](https://www.ssllabs.com/ssltest/analyze.html?d=firmar.ec) | **A+** | 2026-05-08 |
| [securityheaders.com](https://securityheaders.com/?q=https%3A%2F%2Ffirmar.ec) | **A+** | 2026-05-08 |
| [OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/idkmanager/firma-ec) | en monitoreo | rolling |

## Histórico

Ningún incidente reportado a la fecha. Cuando ocurra el primero, se publicará en esta sección con fecha, alcance, mitigación y lecciones.

---

Última actualización: **2026-05-10**.
