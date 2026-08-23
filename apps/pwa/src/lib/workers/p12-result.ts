/**
 * p12-result.ts — construye la respuesta de `p12.worker` SIN la clave privada.
 *
 * SEGURIDAD (OWASP A02 / ASVS 8.2): la clave privada del .p12 no debe cruzar
 * nunca de vuelta al hilo principal. `parsePfx` devuelve el `ParsedPfx`
 * aumentado con el PKCS#8 DER en claro (`privateKeyPkcs8Der`); el hilo
 * principal sólo necesita los campos públicos del certificado (CN / emisor /
 * validez) para la vista previa del firmante.
 *
 * Por qué la clave no hace falta fuera del worker (verificado contra el código
 * de hoy, no sólo contra el diseño original):
 *   - `Firmar.svelte` guarda el resultado en `pfxParsed: ParsedPfx` y sólo lee
 *     `signingCert.{subjectCN,issuerCN,notBefore,notAfter}`.
 *   - La firma de un documento la hace `sign.worker.ts`, que re-parsea sus
 *     propios bytes + PIN dentro de su worker.
 *   - La firma por lotes la hace `sign-session.worker.ts`, que mantiene el
 *     `ParsedPfx` completo en el ÁMBITO DEL WORKER durante la sesión y lo pone
 *     a cero en `wipeSession()`; tampoco lo emite por `postMessage`.
 *   - `cert.worker.ts` ya documenta y respeta la misma regla.
 * Es decir: ningún consumidor del hilo principal la consume.
 *
 * Devolverla la retenía en el heap del hilo principal durante toda la sesión de
 * firma (minutos), al alcance de cualquier script de la página, contradiciendo
 * el modelo single-shot documentado en `p12.worker.ts`.
 */
import type { ParsedPfx } from '@firma-ec/signer';

/** `parsePfx` devuelve `ParsedPfx` aumentado con el PKCS#8 DER. */
export type ParsedPfxFull = ParsedPfx & { privateKeyPkcs8Der: ArrayBuffer };

/**
 * Despoja y pone a cero la clave privada antes de que el resultado salga del
 * worker.
 *
 * El despojo del campo es la mitigación que importa y ocurre SIEMPRE. El
 * borrado del buffer es defensa adicional dentro del worker (que además muere
 * justo después: `p12-bus.ts` es single-shot y llama `terminate()`), por eso no
 * se convierte en un error que rompa la firma si el firmante devolviera algún
 * día una forma no zeroizable.
 */
export function toPublicParsed(parsed: ParsedPfxFull): ParsedPfx {
  const der: unknown = parsed.privateKeyPkcs8Der;
  if (der instanceof ArrayBuffer) {
    if (der.byteLength > 0) new Uint8Array(der).fill(0);
  } else if (ArrayBuffer.isView(der)) {
    // Vista tipada: sólo los bytes que abarca, no todo el buffer subyacente
    // (que podría compartirse con datos ajenos).
    new Uint8Array(der.buffer, der.byteOffset, der.byteLength).fill(0);
  }
  const { privateKeyPkcs8Der: _omitted, ...pub } = parsed;
  void _omitted;
  return pub;
}
