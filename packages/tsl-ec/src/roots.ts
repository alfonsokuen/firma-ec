/**
 * roots.ts — Trust anchors for the 7 ARCOTEL-accredited ECIs.
 *
 * PEM content is imported as raw text via Vite's `?raw` suffix.
 * In Node/Vitest, the `?raw` suffix is handled by the vitest config's
 * asset transform. In build-json.ts (plain Node), PEMs are read directly
 * with fs.readFileSync so no `?raw` is needed there.
 *
 * STATUS as of 2026-05-08:
 *   ALL 7 slots are PLACEHOLDERS — automated fetch from public ECI repositories
 *   failed for all entities (DNS not resolvable, 401/403/404 HTTP errors, or
 *   cert-like URLs returning HTML). See each entry's `notes` for details.
 *   Replace PEM files before enabling signature chain validation in production.
 */

import type { TrustRoot } from './index.ts';

// PEM imports — Vite resolves these as raw strings at bundle time.
// build-json.ts reads them via readFileSync instead (no bundler).
import bcePem from './roots/bce-2024.pem?raw';
import securitydataPem from './roots/securitydata-2024.pem?raw';
import anfacPem from './roots/anfac-2024.pem?raw';
import uanatacaPem from './roots/uanataca-2024.pem?raw';
import lazzatePem from './roots/lazzate-2024.pem?raw';
import eclipsesoftPem from './roots/eclipsesoft-2024.pem?raw';
import datilPem from './roots/datil-2024.pem?raw';

export const roots: TrustRoot[] = [
  {
    slug: 'bce',
    commonName: 'BCE ECI Root CA',
    orgName: 'Banco Central del Ecuador — Entidad de Certificación de Información',
    country: 'EC',
    pemContent: bcePem,
    // PLACEHOLDER fingerprint — will change when real cert replaces this slot
    fingerprintSha256: 'bbba03d4bca802640c99e5cb004d5f6d223b82ebb98efe99c61cb3813c69f596',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://www.eci.bce.fin.ec/repositorio',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: eci.bce.fin.ec DNS not resolvable from build host. ' +
      'Try: http://www.eci.bce.fin.ec/aia/eciroot.crt or https://www.eci.bce.fin.ec/repositorio from an EC network.',
  },
  {
    slug: 'securitydata',
    commonName: 'Security Data Root CA',
    orgName: 'Security Data Seguridad en Datos y Firma Digital S.A.',
    country: 'EC',
    pemContent: securitydataPem,
    fingerprintSha256: '3c3782f493d83cedd1452e9a9f6d7bfc404873e12f446f91b1470f8f27e63e03',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://www.securitydata.net.ec/descargas',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: /repositorio/root.crt and all known WP-content ' +
      'paths return 404. Site is live (securitydata.net.ec) but root PEM not publicly exposed at standard paths. ' +
      'Contact Security Data (+593 2 392 2169) for repositorio URL.',
  },
  {
    slug: 'anfac',
    commonName: 'ANF Global Root CA',
    orgName: 'ANF Autoridad de Certificación (Spain, accredited EC)',
    country: 'ES',
    pemContent: anfacPem,
    fingerprintSha256: 'c364f61aade5b398d841c4880951dd1d4e5c9165695304b4a10d1ad5d80da4e7',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://www.anf.es/es/pki/',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: crl.anf.es returns 401; anf.es WP-content paths ' +
      'return 403; repo.anf.es DNS not resolvable. ANF Global Root CA is in CCADB — ' +
      'retrieve from https://ccadb.my.salesforce-sites.com/mozilla/IncludedCACertificateReport or anf.es/repositorio.',
  },
  {
    slug: 'uanataca',
    commonName: 'Uanataca Root CA',
    orgName: 'Uanataca S.A. (Spain/Ecuador)',
    country: 'ES',
    pemContent: uanatacaPem,
    fingerprintSha256: '0ba205e2d2e321f9cfb1000d65635a5c11bae8f04684aa9b8312230aa8efbc38',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://www.uanataca.com/en/trustservice/pki/',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: all cert-like URLs at uanataca.com redirect to ' +
      '48KB HTML homepage; no downloadable PEM link found by parsing HTML. ' +
      'Try https://www.uanataca.com/public/pki/ manually or contact Uanataca support.',
  },
  {
    slug: 'lazzate',
    commonName: 'Lazzate Root CA',
    orgName: 'Lazzate EC (entity identity unclear)',
    country: 'EC',
    pemContent: lazzatePem,
    fingerprintSha256: 'aa7582d07e2c3be3701f48d0a92179355f3487169bf43c6fbec280d1830fc7c5',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'http://www.lazzate.com/repositorio/root.crt',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: lazzate.com/repositorio returns 404; ' +
      'lazzate.com resolves to Comune di Lazzate (Italian municipality), not an Ecuadorian ECI. ' +
      'ARCOTEL registry may contain the correct domain — verify at https://www.arcotel.gob.ec.',
  },
  {
    slug: 'eclipsesoft',
    commonName: 'Eclipse Soft Root CA',
    orgName: 'Eclipse Soft S.A. Ecuador',
    country: 'EC',
    pemContent: eclipsesoftPem,
    fingerprintSha256: '641b9b2cfe567248cf6e6f7c650b8d7b7eae6b808b15b2748b58f65eb2ba5157',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'http://www.eclipsesoft.ec/repositorio/root.crt',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: eclipsesoft.ec DNS not resolvable from build host. ' +
      'Domain may be inactive or moved. Check ARCOTEL ECI registry for current repositorio URL.',
  },
  {
    slug: 'datil',
    commonName: 'Datil Root CA',
    orgName: 'Datil Co. Ecuador',
    country: 'EC',
    pemContent: datilPem,
    fingerprintSha256: 'e2885381a7fb682d106dd7d7a3b35d40a6d34669b558bb9225fa4aacffdb5b4a',
    validFrom: '2026-05-09',
    validUntil: '2028-05-08',
    isPlaceholder: true,
    repositoryUrl: 'https://datil.co/firma-electronica',
    notes:
      'Placeholder generated 2026-05-08. Fetch failed: datil.co/repositorio/root.crt returns 404; ' +
      'firma-electronica page returns 404. Datil may have restructured their PKI or discontinued ECI operations. ' +
      'Verify at https://www.arcotel.gob.ec/servicios/firma-electronica/ whether Datil is still accredited.',
  },
];
