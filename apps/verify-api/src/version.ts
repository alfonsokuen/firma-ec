/**
 * La version que la API declara de si misma.
 *
 * Se inyecta en tiempo de BUILD desde `apps/verify-api/package.json`
 * (`build.mjs` -> esbuild `define`), no se escribe a mano.
 *
 * Por que: el contrato OpenAPI llevaba la version como literal, con un
 * comentario pidiendo mantenerla en sync con el manifiesto. Fallo en el PRIMER
 * despliegue — la imagen etiquetada `0.2.0` sirve `info.version: "0.1.0"`, y
 * encima expone una ruta que en 0.1.0 no existia, asi que el artefacto no
 * corresponde a ningun commit. Una version que miente es peor que no publicarla:
 * un integrador la usa para decidir si le afecta un cambio.
 *
 * El bundle de runtime NO puede leer el manifiesto: la imagen final escribe un
 * package.json minimo con solo `{"type":"module"}`. De ahi que sea `define` y no
 * una lectura en arranque.
 */
declare const __API_VERSION__: string | undefined;

/**
 * `dev` cuando se corre desde fuente (vitest, tsx): ahi no hay build que
 * inyecte nada. El test del bundle construido es el que exige el valor real.
 */
export const API_VERSION: string =
  typeof __API_VERSION__ === 'string' && __API_VERSION__ !== '' ? __API_VERSION__ : 'dev';
