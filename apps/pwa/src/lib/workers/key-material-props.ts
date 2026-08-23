/**
 * key-material-props.ts — nombres de propiedad que delatan material de clave
 * viajando por `postMessage`.
 *
 * Existe para que los detectores de fuga no se dupliquen ni se desincronicen.
 * Había dos listas: la de `sign-session-bus.test.ts` (`FORBIDDEN_KEYS`) y otra,
 * más pobre, en los detectores del .p12 — que además sólo escaneaban
 * `ArrayBuffer`/vistas y por eso eran CIEGOS a una clave en forma de string: los
 * componentes privados de un JWK (`d`, `p`, `q`, `dp`, `dq`, `qi`) son strings
 * base64url, no bytes. Una fuga por esa vía dejaba los detectores en verde.
 */

/**
 * Propiedades que nunca deben aparecer en un mensaje, en ningún nivel.
 *
 * `d`/`p`/`q`/`dp`/`dq`/`qi` son los componentes privados de un JWK RSA/EC. Son
 * nombres cortos y genéricos a propósito: el precio de un posible falso
 * positivo es un test rojo que se lee en un minuto; el de un falso negativo es
 * la clave privada del firmante en el heap de la página.
 */
export const KEY_MATERIAL_PROPS: readonly string[] = [
  'privateKeyPkcs8Der',
  'privateKey',
  'pkcs8',
  'cryptoKey',
  'd',
  'p',
  'q',
  'dp',
  'dq',
  'qi',
];

/**
 * `privateKeyJwk` no se puede prohibir por nombre: el tipo `ParsedPfx` exige el
 * campo y el worker lo emite normalizado. Se vigila por FORMA — sólo se admiten
 * estas claves dentro. Cualquier otra (incluida `k`, el material simétrico de un
 * JWK `oct`, demasiado genérica para prohibirla por nombre en todo el mensaje)
 * significa que el JWK dejó de ser el esqueleto público.
 */
export const JWK_PROP = 'privateKeyJwk';

/** Único miembro admitido dentro de `privateKeyJwk` (ver `p12-result.ts`). */
export const JWK_PUBLIC_PROPS: readonly string[] = ['kty'];
