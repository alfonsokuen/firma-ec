/**
 * pathAlias.ts — puente de deep-links con path real → ruta del router hash.
 *
 * El router de la app es hash-based (`#/firmar`), pero los enlaces externos
 * suelen llegar como paths reales (p. ej. el header de la tienda enlaza
 * `https://app.firmar.ec/firmar/pdf?utm_source=tienda`). El fallback SPA del
 * servidor responde `index.html` para cualquier path, así que sin este puente
 * el visitante aterriza en la Home en vez de la pantalla que esperaba.
 *
 * Allowlist explícita: `/share` y `/handle-file` quedan fuera a propósito
 * (son entradas del sistema operativo con su propia lógica en el SW).
 */

const ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  // `/firmar`, `/firmar/pdf`, `/firmar/lo-que-sea` → asistente de firma.
  [/^\/firmar(\/|$)/, '/firmar'],
  [/^\/verificar(\/|$)/, '/verificar'],
  [/^\/validar-certificado(\/|$)/, '/validar-certificado'],
  [/^\/paranoia(\/|$)/, '/paranoia'],
  [/^\/(about|acerca)(\/|$)/, '/about'],
  [/^\/(configuracion|settings)(\/|$)/, '/configuracion'],
  [/^\/certificados\/comprar(\/|$)/, '/certificados/comprar'],
  [/^\/certificados(\/|$)/, '/certificados'],
];

/**
 * Devuelve la ruta hash equivalente a un path real, o null si el path no es
 * un alias conocido (raíz, `/share`, `/handle-file`, paths arbitrarios).
 */
export function resolvePathAlias(pathname: string): string | null {
  if (!pathname || pathname === '/') return null;
  const hit = ALIASES.find(([pattern]) => pattern.test(pathname));
  return hit ? hit[1] : null;
}

/**
 * Si la visita llegó con un path alias y sin ruta hash propia, reescribe la
 * URL a `/?query#/ruta` (conservando el query, p. ej. utm_*) antes de que el
 * router monte. `history.replaceState` no dispara `hashchange`, así que el
 * router simplemente lee la ruta correcta al arrancar. Fail-open: ante
 * cualquier error se monta la Home como hasta ahora.
 */
export function bridgePathToHash(loc: Location, hist: History): void {
  try {
    if (loc.hash.startsWith('#/')) return; // ya trae ruta propia: se respeta
    const alias = resolvePathAlias(loc.pathname);
    if (!alias) return;
    hist.replaceState(null, '', `/${loc.search}#${alias}`);
  } catch {
    /* fail-open: sin puente, la app monta la Home */
  }
}
