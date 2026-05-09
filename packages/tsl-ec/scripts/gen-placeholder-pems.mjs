#!/usr/bin/env node
/**
 * gen-placeholder-pems.mjs — Generate self-signed placeholder PEMs for ARCOTEL ECIs.
 *
 * Produces deterministic-shape (but freshly-keyed) self-signed certs in
 * packages/tsl-ec/src/roots/<slug>-2024.pem and prints a JS snippet with the
 * resulting SHA-256 fingerprints, ready to paste into roots.ts and build-json.ts.
 *
 * Resolves node-forge via packages/signer/node_modules (already installed).
 *
 * Usage: node packages/tsl-ec/scripts/gen-placeholder-pems.mjs [--all|--missing]
 *   --missing (default): only generate slugs whose PEM file does NOT yet exist
 *   --all: regenerate every slug (DESTRUCTIVE — invalidates existing fingerprints)
 *
 * Generated 2026-05-09 in support of TSL expansion 7→17 ARCOTEL roots.
 */

import { createRequire } from 'node:module';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const rootsDir = resolve(__dirname, '../src/roots');

// Resolve node-forge from signer's node_modules (already in deps).
const requireFromSigner = createRequire(resolve(repoRoot, 'packages/signer/package.json'));
const forge = requireFromSigner('node-forge');

const mode = process.argv.includes('--all') ? 'all' : 'missing';

/**
 * Full ARCOTEL accreditation list (17 entities, ordered as in the official ARCOTEL listing).
 * accepted_in_gob_ec: subset of 8 listed by the SRI for gob.ec proceedings.
 */
const SLOTS = [
  { slug: 'alpha-technologies',   commonName: 'Alpha Technologies Root CA',                orgName: 'Alpha Technologies Cia. Ltda.',                                                              country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.arcotel.gob.ec/' },
  { slug: 'anfac',                 commonName: 'ANFAC AC Ecuador Root CA',                  orgName: 'ANFAC Autoridad de Certificación Ecuador C.A.',                                              country: 'EC', acceptedGobEc: true,  repositoryUrl: 'https://www.anf.es/es/pki/' },
  { slug: 'appfirmas',             commonName: 'AppFirmas Root CA',                         orgName: 'AppFirmas S.A.',                                                                             country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.arcotel.gob.ec/' },
  { slug: 'argosdata',             commonName: 'ArgosData Root CA',                         orgName: 'ArgosData Certificación de Información y Servicios Relacionados S.A.S.',                     country: 'EC', acceptedGobEc: true,  repositoryUrl: 'https://www.arcotel.gob.ec/' },
  { slug: 'bce',                   commonName: 'BCE ECI Root CA',                           orgName: 'Banco Central del Ecuador',                                                                  country: 'EC', acceptedGobEc: true,  repositoryUrl: 'https://www.eci.bce.fin.ec/repositorio' },
  { slug: 'judicatura',            commonName: 'Consejo de la Judicatura ECI Root CA',      orgName: 'Consejo de la Judicatura',                                                                   country: 'EC', acceptedGobEc: true,  repositoryUrl: 'https://www.funcionjudicial.gob.ec/' },
  { slug: 'corpnewbest',           commonName: 'CorpNewBest Root CA',                       orgName: 'CorpNewBest Cia. Ltda.',                                                                     country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.arcotel.gob.ec/' },
  { slug: 'darkcam',               commonName: 'DarkCam Root CA',                           orgName: 'DarkCam S.A.',                                                                               country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.arcotel.gob.ec/' },
  { slug: 'datil',                 commonName: 'Datil Root CA',                             orgName: 'DatilMedia S.A.',                                                                            country: 'EC', acceptedGobEc: true,  repositoryUrl: 'https://datil.co/firma-electronica' },
  { slug: 'registro-civil',        commonName: 'Registro Civil ECI Root CA',                orgName: 'Dirección General de Registro Civil, Identificación y Cedulación',                          country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.registrocivil.gob.ec/' },
  { slug: 'eclipsesoft',           commonName: 'EclipSoft Root CA',                         orgName: 'EclipSoft S.A.',                                                                             country: 'EC', acceptedGobEc: true,  repositoryUrl: 'http://www.eclipsesoft.ec/repositorio/root.crt' },
  { slug: 'firmasegura',           commonName: 'FirmaSegura Root CA',                       orgName: 'FirmaSegura S.A.S.',                                                                         country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.firmasegura.ec/' },
  { slug: 'lazzate',               commonName: 'Lazzate Root CA',                           orgName: 'Lazzate Cia. Ltda.',                                                                         country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.arcotel.gob.ec/' },
  { slug: 'letmi',                 commonName: 'LetMi Ecuador Root CA',                     orgName: 'LetMi Ecuador S.A.',                                                                         country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.arcotel.gob.ec/' },
  { slug: 'primecorelat',          commonName: 'PrimeCoreLat Root CA',                      orgName: 'PrimeCoreLat S.A.S. B.I.C.',                                                                 country: 'EC', acceptedGobEc: false, repositoryUrl: 'https://www.arcotel.gob.ec/' },
  { slug: 'securitydata',          commonName: 'Security Data Root CA',                     orgName: 'Security Data Seguridad en Datos y Firma Digital S.A.',                                      country: 'EC', acceptedGobEc: true,  repositoryUrl: 'https://www.securitydata.net.ec/descargas' },
  { slug: 'uanataca',              commonName: 'UanaTaca Ecuador Root CA',                  orgName: 'UanaTaca Ecuador S.A.',                                                                      country: 'EC', acceptedGobEc: true,  repositoryUrl: 'https://www.uanataca.com/en/trustservice/pki/' },
];

function genCert(slot) {
  const { pki } = forge;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + Buffer.from(forge.random.getBytesSync(15), 'binary').toString('hex');

  const notBefore = new Date('2026-05-09T00:00:00Z');
  const notAfter = new Date('2028-05-08T23:59:59Z');
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;

  const attrs = [
    { name: 'countryName', value: slot.country },
    { name: 'organizationName', value: 'PLACEHOLDER ECI ' + slot.orgName.slice(0, 60) },
    { name: 'commonName', value: 'PLACEHOLDER-' + slot.slug + '-firmar.ec-2024' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const pem = pki.certificateToPem(cert);
  // Compute SHA-256 over the DER encoding (asn1.toDer of the cert structure).
  const der = Buffer.from(forge.asn1.toDer(pki.certificateToAsn1(cert)).getBytes(), 'binary');
  const fp = createHash('sha256').update(der).digest('hex');
  return { pem: pem.replace(/\r\n/g, '\n').trim() + '\n', fingerprint: fp };
}

const results = [];
for (const slot of SLOTS) {
  const pemPath = resolve(rootsDir, `${slot.slug}-2024.pem`);
  if (mode === 'missing' && existsSync(pemPath)) {
    // Read existing PEM, recompute fingerprint to capture in metadata snippet.
    const raw = readFileSync(pemPath, 'utf-8');
    const cleaned = raw.split('\n').filter((l) => !l.startsWith('#')).join('\n').trim();
    try {
      const cert = forge.pki.certificateFromPem(cleaned);
      const der = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
      const fp = createHash('sha256').update(der).digest('hex');
      results.push({ slug: slot.slug, fingerprint: fp, action: 'kept' });
      continue;
    } catch (e) {
      console.error(`Failed to parse existing ${slot.slug}: ${e.message} — regenerating`);
    }
  }

  const { pem, fingerprint } = genCert(slot);
  const header = [
    `# PLACEHOLDER — Replace with real ${slot.orgName} root certificate before production use`,
    `# Official URL to try: ${slot.repositoryUrl}`,
    `# Generated: 2026-05-09 (TSL expansion 7→17 ARCOTEL ECIs)`,
    `# Accepted in gob.ec (SRI procedures): ${slot.acceptedGobEc ? 'yes' : 'no'}`,
    `# See: https://www.arcotel.gob.ec/listado-de-las-entidades-de-certificacion-de-informacion-y-servicios-relacionados-acreditados-y-terceros-vinculados-debidamente-acreditadas/`,
    pem.trim(),
    '',
  ].join('\n');
  writeFileSync(pemPath, header, 'utf-8');
  results.push({ slug: slot.slug, fingerprint, action: 'generated' });
  console.log(`${slot.slug}: ${results[results.length - 1].action}  ${fingerprint}`);
}

// Emit JSON snippet with all fingerprints for easy copy-paste into TS sources.
const fpMap = Object.fromEntries(results.map((r) => [r.slug, r.fingerprint]));
const out = resolve(__dirname, 'fingerprints.generated.json');
writeFileSync(out, JSON.stringify(fpMap, null, 2) + '\n', 'utf-8');
console.log(`\nWrote ${out}`);
