/**
 * resume.ts — modo guiado, "retomar donde ibas" (F3 pulido).
 *
 * Persistencia MÍNIMA y segura: SOLO el número de paso alcanzado. JAMÁS el
 * PDF, el .p12 ni el PIN — esos nunca tocan localStorage (Constitución
 * Art. 2 + plan §6 F3, tabla de riesgos "Seguridad (.p12/PIN)"). Como el
 * documento y el certificado no se recuerdan entre sesiones, "retomar" no
 * puede saltar el flujo ni las validaciones: es un mensaje cálido de
 * continuidad (ver el aviso `guided.resume.*` en Firmar.svelte), no un
 * estado simulado.
 */
const KEY = 'fec.guided.step.v1';

/** Último paso alcanzado en una sesión guiada previa, o null si no hay nada
 *  guardado / el valor es inválido / localStorage no está disponible. */
export function getSavedStep(): number | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Guarda SOLO el número de paso. Best-effort — falla en silencio (quota /
 *  modo privado) porque es una comodidad de UX, no un requisito. */
export function saveStep(step: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, String(step));
  } catch {
    // Quota / private mode — silent, non-critical UX affordance.
  }
}

/** Limpia el paso guardado: al terminar de firmar o al "Empezar de nuevo". */
export function clearSavedStep(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
