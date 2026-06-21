import 'virtual:uno.css';
import './styles/reset.css';
import './styles/tokens.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { initSwUpdate } from './lib/swUpdate.svelte.ts';
import { isHandoffActive } from './lib/handoff';

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');

// Handoff instances (e.g. firma.idkmanager.com) are a one-shot signing surface,
// NOT the real app. VITE_REDIRECT_HOME is set ONLY on those deploys: any visit
// that is NOT the signing handoff bounces to the canonical app, so the only
// firmar.ec a visitor can install/keep is the real one. The public app leaves
// VITE_REDIRECT_HOME unset → never redirects (behavior unchanged).
const redirectHome = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[
  'VITE_REDIRECT_HOME'
];
let bounceToCanonical = false;
if (redirectHome) {
  try {
    bounceToCanonical = !isHandoffActive();
  } catch {
    bounceToCanonical = false; // on any doubt, never redirect (don't break signing)
  }
}

if (bounceToCanonical && redirectHome) {
  window.location.replace(redirectHome);
} else {
  mount(App, { target });

  // rc8: register the Service Worker manually so we can drive the
  // "update available" toast (see lib/swUpdate.svelte.ts and
  // ui/UpdateNotification.svelte). vite-plugin-pwa's auto registerSW.js is
  // disabled via `injectRegister: null` in vite.config.ts.
  initSwUpdate();
}
