# firmar.ec vs FirmaEC (MINTEL)

> Comparación honesta entre dos firmadores ecuatorianos. **Ambos son open-source, ambos son legítimos, ambos son complementarios.**

## Hechos base

| | firmar.ec | FirmaEC (MINTEL) |
|---|---|---|
| Operador | IDKmanager (taller privado, Ecuador) | Ministerio de Telecomunicaciones (MINTEL) |
| Tipo | PWA (web app instalable) | Aplicación desktop Java |
| Plataforma | Cualquier OS con browser moderno (incl. iOS/Android) | Windows / macOS / Linux con JRE |
| Instalación | Cero — visita la URL | Descarga + Java runtime + driver del token |
| Licencia | AGPL-3.0 | OSS publicada en [MINKA gob.ec](https://minka.gob.ec/mintel/ge/firmaec) (verificar términos exactos en el portal) |
| Soporte oficial | Comunidad / IDKmanager (operador) | MINTEL (Ministerio) |

## Capacidades técnicas

| Capacidad | firmar.ec | FirmaEC (MINTEL) |
|---|---|---|
| Firma PDF (PAdES) | ✅ | ✅ |
| Firma XML (XAdES) | ❌ — usa FirmaEC para SRI | ✅ |
| Firma archivo arbitrario (CAdES) | ❌ | ✅ |
| Perfil PAdES B-B | ✅ | ✅ |
| Perfil PAdES **B-T** (TSA RFC 3161) | ✅ FreeTSA por defecto | Verificar con MINTEL |
| Perfil PAdES **B-LT** (DSS + OCSP + CRL) | ✅ | Verificar con MINTEL |
| Perfil PAdES **B-LTA** (document timestamp) | ✅ | Verificar con MINTEL |
| Firma con `.p12` (PKCS#12) | ✅ | ✅ |
| Firma con token USB físico (PKCS#11) | ❌ (WebUSB en evaluación) | ✅ |
| Firma en lote (muchos PDFs) | ⚠️ Uno a uno | ✅ |
| Verificación offline | ✅ TSL local 17 ACEs | ✅ |
| Multi-firmante con flujo | ⏳ Roadmap F8 | Verificar con MINTEL |
| `.p12` sube al servidor | ❌ **NUNCA** — todo client-side WebCrypto | ❌ N/A (es desktop) |

## Operación y privacidad

| | firmar.ec | FirmaEC |
|---|---|---|
| Modelo de despliegue | PWA servida desde Cloudflare Tunnel → Swarm Ecuador | Binario que el usuario descarga e instala |
| Funciona en máquina restringida (sin admin) | ✅ | ❌ Requiere instalar Java + driver |
| Funciona en móvil/tablet | ✅ | ❌ |
| Funciona 100% offline | Verificación sí; firma recomienda online por TSA | ✅ |
| Auditas el bundle servido | ✅ Sí, abierto + reproducible builds en roadmap | ✅ Si los binarios publicados son reproducibles (verificar) |
| Telemetría | Ninguna | Verificar con MINTEL |

## Cuándo usar cada uno

### Usa **FirmaEC (MINTEL)** si...

- Firmas **comprobantes electrónicos del SRI** (XAdES — `firmar.ec` no lo soporta hoy).
- Operas dentro de **Quipux** con flujos pre-definidos del Ministerio.
- Tienes un **token criptográfico USB** físico (BCE, Security Data hardware).
- Necesitas **firma en lote** masiva.
- Operas **completamente offline** sin posibilidad de TSA online.
- Necesitas el respaldo institucional gov.ec para auditorías formales.

### Usa **firmar.ec** si...

- Necesitas firmar un PDF **rápido** sin instalar nada.
- Estás en una **máquina restringida** (corporativa, hotel, cibercafé).
- Quieres firmar desde **móvil o tablet**.
- Tu contraparte necesita **verificar** sin instalar software.
- Tu organización tiene **políticas LOPDP estrictas** y quiere evidencia técnica de que la llave nunca sale del dispositivo (modo paranoia + DevTools).
- Necesitas perfiles **PAdES B-T / B-LT / B-LTA** (validez a largo plazo).
- Eres dev/auditor y quieres **leer el código** que procesa tu cert.

## Compatibilidad cruzada

Ambos firmadores siguen **ETSI EN 319 142-1 (PAdES)**. Una firma generada por firmar.ec **debe ser verificable** por FirmaEC, Adobe Reader, Foxit y el validador Minka del MINTEL — y viceversa.

Si encuentras un caso de incompatibilidad, abre un issue con el PDF de muestra (sanitizado) y los logs del verificador.

## Filosofía

FirmaEC fue creada como **infraestructura pública**. firmar.ec se construye con la misma intención de **bien común**: open-source, sin fines de lucro, complementando lo que el sector público ofrece. Una herramienta crítica de soberanía digital con un único proveedor (público o privado) es un riesgo sistémico — **es bueno que ambas existan**.

## Política de transparencia

- Si MINTEL publica una versión actualizada de FirmaEC con perfiles LT/LTA/TSA u otras features, **actualizar esta comparativa**.
- Si firmar.ec añade Quipux compat / SRI XAdES / multi-firma, **actualizar también**.
- Cualquier dato marcado "verificar con MINTEL" debe sustituirse por evidencia concreta cuando se obtenga.

## Recursos

- [FirmaEC oficial — minka.gob.ec](https://minka.gob.ec/mintel/ge/firmaec)
- [Validador Minka del MINTEL](https://minka.gob.ec)
- [firmar.ec en GitHub](https://github.com/idkmanager/firmar-ec)
- [firmar.ec en Gitea (primario)](https://git.idkmanager.com/alfonso/firmar-ec)

---

Última actualización: **2026-05-10**.
