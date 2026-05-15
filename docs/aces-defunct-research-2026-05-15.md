# ACEs ARCOTEL marcadas `isDefunct` — Re-investigación 2026-05-15

Después de marcar 8 ACEs como `isDefunct: true` en v0.7.5 por aparente
falta de presencia pública, ronda de 8 búsquedas paralelas confirma que
**5 de 8 NO están defunct** — están activas vendiendo certificados al
público en 2026. Las otras 3 sí parecen dormant/defunct.

## Resumen

| Slug | Verdict | Sitio | Vende 2026 | Root accesible |
|---|---|---|---|---|
| `alpha-technologies` | **ACTIVE** | https://www.alphaside.com | Sí ($25/año) | No público — pedir `firmas@alphaside.com` |
| `appfirmas` | DORMANT | parked under Intuito | No | No |
| `corpnewbest` | **ACTIVE** | https://newsign.newbest.net | Sí (PrimeBest) | Root en FirmaEC trust lib (`minka.gob.ec/mintel/ge/firmaec/firmadigital-libreria` issue #76) |
| `darkcam` | DORMANT | sin sitio detectable | No | No (OID reconocido por FirmaEC pero sin storefront) |
| `firmasegura` | **ACTIVE** | https://firmaseguraec.com | Sí (resellers) | CRL/OCSP públicos en `crl.firmaseguraec.com`; DPC en sitio NO está firmada (Google Docs render) |
| `lazzate` | **ACTIVE** (marca eNext) | https://enext.ec | Sí ($11-52) | Intermediate Sub-CA1 descargable en `http://enext1.xyz/LazzateCA1/emisorCA1.crt`; Root **offline** por diseño (DPC §5.2) |
| `letmi` | **ACTIVE** | https://letmi.app | Sí ($10+ IVA) | DPC firmada por Uanataca (no por LetMi) — no sirve para extraer |
| `primecorelat` | DORMANT | https://primecore.lat (vivo) | No (sólo "Solicitar demo") | No (acreditados sep 2025, sin emisión pública aún) |

## Próximos pasos posibles

1. **Pedir el root directamente por correo** a las 5 ACTIVE
   (templates ya listos en `ace-root-cert-requests-2026-05-15.md`).
2. **Comprar un cert de cada una** (FirmaSegura $X, LetMi $10, Lazzate
   $11, Alpha Technologies $25, CorpNewBest $X) y extraer la cadena
   desde el .p12 emitido. Total ~$80 — la vía más rápida.
3. **Extraer del truststore FirmaEC** (`firmadigital-libreria` repo
   MinTEL/ARCOTEL en `minka.gob.ec`). Si la lib oficial las tiene
   bundled, resuelve las 5 ACTIVE en una sola operación.
4. **Esperar a encontrar un PDF firmado real** en circulación. Para
   FirmaSegura/Lazzate hay clientes con SRI; los certificados se ven
   en facturación electrónica.

## Reclasificación propuesta (no aplicada todavía)

- `isDefunct` actual cuenta como "no operativa" → excluye del banner.
- Si reclasificamos las 5 ACTIVE quitándoles `isDefunct`, el banner
  pasaría a "8 de 13 ACEs ARCOTEL activas con raíz real cargada", lo
  cual es **más preciso pero peor visualmente** (de "demo OFF" a
  "demo parcial" otra vez).
- Alternativa: mantener `isDefunct` y agregar campo `isActiveWithoutRoot`
  para auditoría sin afectar el contador del banner. Pendiente decisión.

## Datos rescatados durante la investigación

- **Lazzate Sub-CA1**: `lazzate-emisor.crt` descargada
  (Subject `Lazzate Emisor CA1`, Issuer `Lazzate Root CA1`, válida
  2023-11-10 → 2033-11-07). Root es offline.
- **PrimeCoreLat**: acreditación Resolución ARCOTEL-2025-0204 (sept 2025).
- **CorpNewBest**: roots ya están en FirmaEC trust library
  (`firmadigital-libreria` issue #76).
- **DarkCam**: OIDs reconocidos por FirmaEC v3.1.0+, pero sin storefront.
