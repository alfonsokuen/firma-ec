/**
 * chain-intermediates-pool-homonimo.test.ts — 2026-08-23.
 *
 * El fix del 2026-08-05 (resolveIssuerCert) cubrió la resolución de homónimos
 * al buscar en el BUNDLE, pero los tres recorridos dejaron intacto el paso
 * "¿el emisor ya está en el pool?" con un `.find()` plano por subject DN:
 *
 *   - packages/signer/src/chainIntermediates.ts   (poolCerts)
 *   - packages/verifier/src/certCheck.ts          (pool)
 *   - packages/verifier/src/index.ts              (selectBridgingIntermediates)
 *
 * Caso real que lo dispara: un PDF re-firmado (o un .p12 viejo) que embebe
 * LAS DOS subCA homónimas de una renovación (estilo BCE 2011/2019). El pool
 * contiene ambas; `.find()` sigue la que esté primero en el orden de embebido
 * — si es la equivocada, el recorrido acaba en un emisor desconocido y marca
 * la cadena incompleta aunque el eslabón correcto esté AHÍ MISMO en el pool.
 *
 * Este test fija el escenario sobre la API pública del signer
 * (resolveSigningIntermediates) y exige que el resultado sea INDEPENDIENTE
 * del orden en que el .p12 embebió los homónimos.
 */

import { webcrypto } from 'node:crypto';
import type { TrustRoot } from '@firma-ec/tsl-ec';
import forge from 'node-forge';
import * as pkijs from 'pkijs';
import { beforeAll, describe, expect, it } from 'vitest';

import { resolveSigningIntermediates } from '../src/chainIntermediates.js';

beforeAll(() => {
  pkijs.setEngine(
    'node-webcrypto',
    new pkijs.CryptoEngine({ name: 'node-webcrypto', crypto: webcrypto as unknown as Crypto }),
  );
  if (!(globalThis as { crypto?: Crypto }).crypto) {
    (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
  }
});

const YEAR = 365 * 24 * 60 * 60 * 1000;

interface Gen {
  der: Uint8Array;
  keys: forge.pki.rsa.KeyPair;
  cert: forge.pki.Certificate;
}

/** Sin subjectKeyIdentifier/authorityKeyIdentifier a propósito: obliga a
 *  resolveIssuerCert a decidir por verificación criptográfica real, que es
 *  la rama que el `.find()` del pool nunca ejercitaba. */
function makeCert(opts: {
  cn: string;
  notBefore: Date;
  notAfter: Date;
  isCa: boolean;
  serial: string;
  issuer?: Gen;
}): Gen {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = opts.serial;
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;
  const attrs = [
    { name: 'commonName', value: opts.cn },
    { name: 'countryName', value: 'EC' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(opts.issuer ? opts.issuer.cert.subject.attributes : attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: opts.isCa } as forge.pki.CertificateExtension,
    (opts.isCa
      ? { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true }
      : {
          name: 'keyUsage',
          digitalSignature: true,
          nonRepudiation: true,
        }) as forge.pki.CertificateExtension,
  ]);
  cert.sign(opts.issuer ? opts.issuer.keys.privateKey : keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return { der: Uint8Array.from(der, (c) => c.charCodeAt(0)), keys, cert };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await webcrypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function asRoot(slug: string, gen: Gen): Promise<TrustRoot> {
  return {
    slug,
    commonName: gen.cert.subject.getField('CN')?.value ?? slug,
    orgName: `${slug} Org S.A.`,
    country: 'EC',
    pemContent: forge.pki.certificateToPem(gen.cert),
    fingerprintSha256: await sha256Hex(gen.der),
    validFrom: gen.cert.validity.notBefore.toISOString(),
    validUntil: gen.cert.validity.notAfter.toISOString(),
    isPlaceholder: false,
  };
}

describe('resolveSigningIntermediates — dos subCA homónimas DENTRO del pool embebido', () => {
  async function buildScenario() {
    const now = new Date();
    // Root VIVA — la única en la lista de anclas de confianza del test.
    const rootLive = makeCert({
      cn: 'Synthetic Root Live',
      notBefore: new Date(now.getTime() - 3 * YEAR),
      notAfter: new Date(now.getTime() + 10 * YEAR),
      isCa: true,
      serial: '01',
    });
    // Root VIEJA — emisora del homónimo equivocado; NO está en roots ni bundle.
    const rootOld = makeCert({
      cn: 'Synthetic Root Old',
      notBefore: new Date(now.getTime() - 15 * YEAR),
      notAfter: new Date(now.getTime() + 1 * YEAR),
      isCa: true,
      serial: '02',
    });
    // Las dos subCA comparten el MISMO subject DN (CN+C idénticos) pero
    // tienen claves distintas — la forma exacta de la renovación BCE.
    const subCaWrong = makeCert({
      cn: 'AC HOMONIMA SINTETICA',
      notBefore: new Date(now.getTime() - 12 * YEAR),
      notAfter: new Date(now.getTime() + 1 * YEAR),
      isCa: true,
      serial: '03',
      issuer: rootOld,
    });
    const subCaRight = makeCert({
      cn: 'AC HOMONIMA SINTETICA',
      notBefore: new Date(now.getTime() - 2 * YEAR),
      notAfter: new Date(now.getTime() + 5 * YEAR),
      isCa: true,
      serial: '04',
      issuer: rootLive,
    });
    const leaf = makeCert({
      cn: 'MARIA FIRMANTE POOL',
      notBefore: new Date(now.getTime() - 0.5 * YEAR),
      notAfter: new Date(now.getTime() + 1 * YEAR),
      isCa: false,
      serial: '0a2c',
      issuer: subCaRight,
    });
    const roots = [await asRoot('synthetic-root-live', rootLive)];
    return { subCaWrong, subCaRight, leaf, roots };
  }

  it('sigue la homónima que SÍ emitió la hoja aunque la equivocada venga primero', async () => {
    const { subCaWrong, subCaRight, leaf, roots } = await buildScenario();
    const resolved = await resolveSigningIntermediates(
      leaf.der,
      [subCaWrong.der, subCaRight.der], // la equivocada PRIMERO — orden adverso
      [], // bundle vacío: el eslabón correcto solo existe en el pool
      null, // sin AIA
      roots,
    );
    expect(resolved.complete).toBe(true);
    // Nada que añadir: el pool ya trae la cadena entera hasta la root viva.
    expect(resolved.ders).toHaveLength(2);
  });

  it('mismo resultado con el orden favorable (independencia del orden de embebido)', async () => {
    const { subCaWrong, subCaRight, leaf, roots } = await buildScenario();
    const resolved = await resolveSigningIntermediates(
      leaf.der,
      [subCaRight.der, subCaWrong.der],
      [],
      null,
      roots,
    );
    expect(resolved.complete).toBe(true);
    expect(resolved.ders).toHaveLength(2);
  });
});
