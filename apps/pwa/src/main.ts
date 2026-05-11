import 'virtual:uno.css';
import './styles/reset.css';
import './styles/tokens.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { initSwUpdate } from './lib/swUpdate.svelte.ts';

const target = document.getElementById('app');
if (!target) throw new Error('Mount target #app not found');

mount(App, { target });

// rc8: register the Service Worker manually so we can drive the
// "update available" toast (see lib/swUpdate.svelte.ts and
// ui/UpdateNotification.svelte). vite-plugin-pwa's auto registerSW.js is
// disabled via `injectRegister: null` in vite.config.ts.
initSwUpdate();
