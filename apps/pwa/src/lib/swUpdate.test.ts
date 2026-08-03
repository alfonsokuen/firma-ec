/**
 * swUpdate — la recarga por actualización del SW es RETENIBLE (defecto D1).
 *
 * `sw.ts` hace `skipWaiting()` + `clients.claim()` a propósito (arreglo de un
 * cuelgue en móvil en producción; ver `sw.ts:49-65`), así que un despliegue
 * nuestro activa el SW nuevo solo y dispara `controllerchange`. Este módulo
 * recargaba la página ahí, sin preguntar. Con un documento la ventana son
 * segundos; con una firma por lotes son 10-25 minutos y la recarga tira el PIN,
 * la sesión del worker y todos los PDFs ya firmados — viven solo en memoria.
 *
 * Estos tests montan un `window`/`navigator.serviceWorker` mínimo (el entorno de
 * vitest aquí es `node`, no hay DOM) y afirman lo único que importa: con una
 * retención activa NADIE recarga, y al soltarla la recarga se OFRECE
 * (`reloadPending`), no se ejecuta.
 *
 * ⚠️ Cada test importa el módulo DE NUEVO (`vi.resetModules()`): `swUpdate.svelte.ts`
 * guarda estado a nivel de módulo a propósito (`registration`, `applyingUpdate`,
 * el contador de retenciones) e `initSwUpdate` es idempotente, así que compartir
 * la instancia entre tests hace que el segundo no registre listeners y pase por
 * la razón equivocada.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listeners = Map<string, (() => void)[]>;

interface Harness {
  reload: ReturnType<typeof vi.fn>;
  fireControllerChange: () => void;
  fireLoad: () => Promise<void>;
  fireVisible: () => void;
  updateCalls: () => number;
}

const originalDescriptors = {
  window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
};

function addTo(map: Listeners) {
  return (type: string, fn: () => void): void => {
    const list = map.get(type) ?? [];
    list.push(fn);
    map.set(type, list);
  };
}

function fireOn(map: Listeners, type: string): void {
  for (const fn of [...(map.get(type) ?? [])]) fn();
}

function installDom(): Harness {
  const reload = vi.fn();
  const swListeners: Listeners = new Map();
  const windowListeners: Listeners = new Map();
  const documentListeners: Listeners = new Map();
  let updateCalls = 0;

  const registration = {
    waiting: null,
    installing: null,
    addEventListener: (): void => {},
    update: (): Promise<void> => {
      updateCalls += 1;
      return Promise.resolve();
    },
  };

  const values = {
    window: { location: { reload }, addEventListener: addTo(windowListeners) },
    navigator: {
      serviceWorker: {
        controller: {},
        addEventListener: addTo(swListeners),
        register: (): Promise<unknown> => Promise.resolve(registration),
      },
    },
    document: { visibilityState: 'visible', addEventListener: addTo(documentListeners) },
  };
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  return {
    reload,
    fireControllerChange: () => fireOn(swListeners, 'controllerchange'),
    fireLoad: async () => {
      fireOn(windowListeners, 'load');
      // `register()` resuelve en microtareas; el `.then` instala el resto.
      await Promise.resolve();
      await Promise.resolve();
    },
    fireVisible: () => fireOn(documentListeners, 'visibilitychange'),
    updateCalls: () => updateCalls,
  };
}

function restoreDom(): void {
  for (const [name, descriptor] of Object.entries(originalDescriptors)) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}

/** Instancia limpia del módulo, con `initSwUpdate()` ya ejecutado. */
async function loadInitialised(): Promise<typeof import('./swUpdate.svelte')> {
  vi.resetModules();
  const mod = await import('./swUpdate.svelte');
  mod.initSwUpdate();
  return mod;
}

let dom: Harness;

beforeEach(() => {
  vi.useFakeTimers();
  dom = installDom();
});

afterEach(() => {
  vi.useRealTimers();
  restoreDom();
  vi.restoreAllMocks();
});

describe('D1 — un despliegue no puede recargar encima de un lote en curso', () => {
  it('con retención activa, controllerchange NO recarga: deja la recarga ofrecida', async () => {
    const { holdReload, isReloadHeld, swUpdate } = await loadInitialised();

    holdReload();
    expect(isReloadHeld()).toBe(true);

    dom.fireControllerChange();

    expect(dom.reload).not.toHaveBeenCalled();
    expect(swUpdate.reloadPending).toBe(true);
  });

  it('al soltar la retención la recarga se OFRECE, no se ejecuta', async () => {
    const { holdReload, releaseReload, isReloadHeld, swUpdate } = await loadInitialised();

    holdReload();
    dom.fireControllerChange();
    releaseReload();
    vi.advanceTimersByTime(60_000);

    expect(isReloadHeld()).toBe(false);
    expect(dom.reload).not.toHaveBeenCalled();
    expect(swUpdate.reloadPending).toBe(true);
  });

  it('sin retención, controllerchange sigue recargando exactamente una vez', async () => {
    await loadInitialised();

    dom.fireControllerChange();
    dom.fireControllerChange();

    expect(dom.reload).toHaveBeenCalledTimes(1);
  });

  it('la retención es reentrante: dos trabajos solapados exigen dos liberaciones', async () => {
    const { holdReload, releaseReload, isReloadHeld } = await loadInitialised();

    holdReload();
    holdReload();
    releaseReload();

    dom.fireControllerChange();
    expect(dom.reload).not.toHaveBeenCalled();
    expect(isReloadHeld()).toBe(true);

    releaseReload();
    expect(isReloadHeld()).toBe(false);
  });

  it('la recarga de respaldo de applyUpdate también respeta la retención', async () => {
    const { applyUpdate, holdReload, swUpdate } = await loadInitialised();

    applyUpdate(); // sin retención todavía: arma el temporizador de respaldo
    holdReload(); // el lote arranca durante esos 3 s
    vi.advanceTimersByTime(10_000);

    expect(dom.reload).not.toHaveBeenCalled();
    expect(swUpdate.reloadPending).toBe(true);
  });

  it('sin retención, la recarga de respaldo de applyUpdate SÍ recarga', async () => {
    const { applyUpdate } = await loadInitialised();

    applyUpdate();
    vi.advanceTimersByTime(10_000);

    expect(dom.reload).toHaveBeenCalledTimes(1);
  });

  it('applyUpdate con retención activa no hace nada salvo dejar la recarga ofrecida', async () => {
    const { applyUpdate, holdReload, swUpdate } = await loadInitialised();

    holdReload();
    applyUpdate();
    vi.advanceTimersByTime(10_000);

    expect(dom.reload).not.toHaveBeenCalled();
    expect(swUpdate.reloadPending).toBe(true);
  });

  it('mientras hay retención no se sondea el SW (encontrarlo equivale a que tome el control)', async () => {
    const { holdReload, releaseReload } = await loadInitialised();
    await dom.fireLoad();

    holdReload();
    dom.fireVisible();
    expect(dom.updateCalls()).toBe(0);

    releaseReload();
    dom.fireVisible();
    expect(dom.updateCalls()).toBe(1);
  });
});
