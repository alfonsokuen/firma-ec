/**
 * Regression test for the double-voice bug (clip + Web Speech TTS sounding
 * at once) in `voice.svelte.ts`.
 *
 * Root cause: `await el.play()` resolves as soon as the clip STARTS playing,
 * not when it ends. If a second `speak()` call arrives before the first
 * clip finishes (e.g. `bienvenida` immediately followed by
 * `speakAuto('cargar_pdf')` on step-1 mount), that second call runs
 * `stop()` → `audioEl.pause()`, which REJECTS the first `play()` promise
 * with an AbortError (this is real `<audio>` behaviour, reproduced here by
 * `FakeAudioElement`). The first call's `catch` used to fall through to
 * `ttsFallback(...)` for its OWN text — sounding at the same time as the
 * second call's clip. Two voices at once.
 *
 * Fix: a module-level `playGeneration` counter. `stop()` increments it;
 * `speak()` claims the newest generation on entry and re-checks it after
 * every `await`. A `speak()` call that has been superseded by a later one
 * exits silently — it never reaches `ttsFallback`.
 *
 * Run via the package-local Vitest config (needed to compile the `$state`
 * rune in `voice.svelte.ts` / `settings.svelte.ts` / `i18n.svelte.ts` — see
 * `apps/pwa/vitest.config.ts` for why this can't run under the shared root
 * config):
 *   pnpm --filter @firma-ec/pwa exec vitest run src/lib/guiado/voice.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fakes ────────────────────────────────────────────────────────────────

/**
 * Minimal `HTMLAudioElement` stand-in that reproduces the exact browser
 * behaviour the bug depends on: `play()` returns a promise that stays
 * pending until the test explicitly settles it (`resolveOldestPlay()`) or
 * `pause()` is called, which rejects the OLDEST still-pending `play()` with
 * an AbortError — exactly how a real `<audio>` element behaves when
 * `pause()` interrupts an in-flight `play()`.
 *
 * Deliberately NOT auto-resolving on a timer/microtask: doing so raced
 * unpredictably against the test's own `await`s (V8's exact microtask
 * ordering for chained `async`/`.then()` is an implementation detail, not
 * something a regression test should depend on). Explicit, test-driven
 * settlement makes the interleaving deterministic.
 */
class FakeAudioElement {
  src = '';
  preload = '';
  playCalls = 0;
  pauseCalls = 0;
  /**
   * When set, the *next* `play()` call rejects immediately with this error
   * instead of staying pending — models a genuine failure (bad format /
   * network / 404), not an interruption by a later `stop()`/`speak()`.
   */
  forceNextPlayError: Error | null = null;
  private pending: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

  addEventListener(_type: string, _cb: () => void): void {
    // 'ended' / 'error' listeners registered by getAudioEl(); unused here —
    // these tests exercise the play()-rejection path, not natural end-of-clip.
  }

  play(): Promise<void> {
    this.playCalls++;
    if (this.forceNextPlayError) {
      const err = this.forceNextPlayError;
      this.forceNextPlayError = null;
      return Promise.reject(err);
    }
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }

  pause(): void {
    this.pauseCalls++;
    const oldest = this.pending.shift();
    oldest?.reject(
      new DOMException('The play() request was interrupted by pause().', 'AbortError'),
    );
  }

  /** Test helper: settle the oldest still-pending `play()` as a success. */
  resolveOldestPlay(): void {
    const oldest = this.pending.shift();
    oldest?.resolve();
  }
}

class FakeSpeechSynthesis {
  speak = vi.fn();
  cancel = vi.fn();
  getVoices = vi.fn(() => []);
}

// ── Test setup ───────────────────────────────────────────────────────────

let fakeAudio: FakeAudioElement;
let fakeSpeechSynthesis: FakeSpeechSynthesis;

beforeEach(() => {
  vi.resetModules();
  fakeAudio = new FakeAudioElement();
  fakeSpeechSynthesis = new FakeSpeechSynthesis();

  vi.stubGlobal('window', globalThis);
  vi.stubGlobal(
    'Audio',
    vi.fn(() => fakeAudio),
  );
  vi.stubGlobal('speechSynthesis', fakeSpeechSynthesis);
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    vi.fn(function SpeechSynthesisUtterance(this: { text: string }, text: string) {
      this.text = text;
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        bienvenida: { file: 'bienvenida.mp3', hash: 'h1' },
        cargar_pdf: { file: 'cargar_pdf.mp3', hash: 'h2' },
      }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Flush microtasks until `predicate()` is true, or give up after `max` ticks. */
async function waitUntil(predicate: () => boolean, max = 50): Promise<void> {
  for (let i = 0; i < max && !predicate(); i++) {
    await Promise.resolve();
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('voice.svelte.ts — anti double-voice generation guard', () => {
  it('an interrupted speak() does NOT fall back to TTS (no second voice)', async () => {
    const { speak } = await import('./voice.svelte.ts');

    // "bienvenida" reaches play() — its promise stays pending until we
    // settle it explicitly (see FakeAudioElement doc above).
    const first = speak('bienvenida');
    await waitUntil(() => fakeAudio.playCalls === 1);

    // The next step's narration is requested before bienvenida's play()
    // settled — mirrors bienvenida → cargar_pdf on step-1 mount. This calls
    // stop() → pause(), which REJECTS bienvenida's still-pending play()
    // with an AbortError (the real trigger of the original bug).
    const second = speak('cargar_pdf');
    await waitUntil(() => fakeAudio.playCalls === 2);
    // Let cargar_pdf's clip "start playing" successfully.
    fakeAudio.resolveOldestPlay();

    await Promise.all([first, second]);

    // KEY ASSERTION: the interruption must never trigger a TTS fallback for
    // "bienvenida" — Web Speech must not have been invoked at all.
    expect(fakeSpeechSynthesis.speak).not.toHaveBeenCalled();
    // Exactly one pause() (bienvenida's play() being cut short) and two
    // play() calls (bienvenida, then cargar_pdf).
    expect(fakeAudio.pauseCalls).toBe(1);
    expect(fakeAudio.playCalls).toBe(2);
    // The last requested clip is the one left loaded/playing.
    expect(fakeAudio.src).toContain('cargar_pdf');
  });

  it('a genuine playback failure (no interruption) still falls back to TTS once', async () => {
    const { speak } = await import('./voice.svelte.ts');

    // Simulate a real failure: format/network/404 — NOT an interruption by
    // a subsequent stop()/speak(). Nothing else calls speak()/stop().
    fakeAudio.forceNextPlayError = new DOMException('Failed to load', 'NotSupportedError');

    await speak('bienvenida');

    expect(fakeSpeechSynthesis.speak).toHaveBeenCalledTimes(1);
  });

  it('stop() is idempotent and clears the speaking state', async () => {
    const { speak, stop, isSpeaking } = await import('./voice.svelte.ts');

    const pending = speak('bienvenida');
    await waitUntil(() => fakeAudio.playCalls === 1);
    fakeAudio.resolveOldestPlay();
    await pending;
    expect(isSpeaking()).toBe(true);

    stop();
    expect(isSpeaking()).toBe(false);
    stop(); // idempotent — no throw, state stays false
    expect(isSpeaking()).toBe(false);
  });
});
