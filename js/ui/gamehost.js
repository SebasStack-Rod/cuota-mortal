// js/ui/gamehost.js
// Anfitrión de vistas de juego (sección 6 del contrato): carga js/games/<id>/view.js (de la IA 3) o, si no existe o falla,
// la vista provisoria; arma el ctx (playerId, send, chips, audio, clock, fmt, quality, onEvent) y le pasa el estado público
// de la mesa en cada cambio. Exporta mountGame(gameId, contenedor) -> { update(state), destroy() } y createGameHost(contenedor)
// -> { render(state), destroy() }, que monta y desmonta solo cuando cambia el asiento de la persona.

import { session } from '../net/index.js';
import { chips } from './chips.js';
import { audio } from './audio.js';
import { prefs } from './prefs.js';
import { fmt } from '../core/money.js';

// Las vistas de js/games/<id>/view.js exportan `mount(container, ctx)` (export con nombre) que devuelve { update, destroy }.
// El anfitrión trabaja con la forma { mount, update, destroy }; este adaptador acepta las dos formas:
//   a) export default { mount, update, destroy }
//   b) export function mount(container, ctx) -> { update(state, info), destroy() }
function adaptView(mod) {
  if (mod && mod.default && typeof mod.default.mount === 'function') return mod.default;
  if (mod && typeof mod.mount === 'function') {
    let inst = null;
    return {
      mount(container, ctx) { inst = mod.mount(container, ctx); },
      update(state, info) { if (inst && inst.update) inst.update(state, info); },
      destroy() { if (inst && inst.destroy) inst.destroy(); inst = null; },
    };
  }
  return null;
}

// Las vistas reales usan GSAP como global. Si el <script defer> del CDN todavía no terminó (o falló), se espera y se prueba con un CDN de respaldo.
const GSAP_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
  'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js',
];
let gsapPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => { el.remove(); reject(new Error('no cargó ' + src)); };
    document.head.appendChild(el);
  });
}
function ensureGsap() {
  if (window.gsap) return Promise.resolve(true);
  if (!gsapPromise) {
    gsapPromise = (async () => {
      // 1) esperar un momento al <script> original de index.html
      for (let i = 0; i < 20 && !window.gsap; i++) await new Promise((r) => setTimeout(r, 100));
      // 2) CDNs de respaldo
      for (const url of GSAP_URLS) {
        if (window.gsap) break;
        try { await loadScript(url); } catch (err) { console.warn('[gamehost]', err.message); }
      }
      if (!window.gsap) gsapPromise = null;   // permitir reintento en el próximo montaje
      return !!window.gsap;
    })();
  }
  return gsapPromise;
}

let lastFallbackReason = '';

async function loadPlaceholder(reason) {
  lastFallbackReason = reason ? String((reason && reason.message) || reason) : '';
  return (await import('./placeholder-view.js')).default;
}

async function loadView(gameId) {
  try {
    if (!(await ensureGsap())) throw new Error('GSAP (window.gsap) no se pudo cargar: revisá la conexión o el bloqueador de contenido');
    const view = adaptView(await import(`../games/${gameId}/view.js`));
    if (view) return view;
    console.error(`[gamehost] js/games/${gameId}/view.js no exporta mount(container, ctx)`);
    return loadPlaceholder(`js/games/${gameId}/view.js no exporta mount(container, ctx)`);
  } catch (err) {
    // Si el archivo existe pero falla (import roto, error de sintaxis, 404), que se vea en la consola y en la vista provisoria
    console.error(`[gamehost] no se pudo cargar js/games/${gameId}/view.js:`, err);
    return loadPlaceholder(err);
  }
}

// Estado público de la mesa: compartida = tables[id]; solitaria = tables[id][mi id]
function tableState(state, gameId, meId) {
  const table = state.tables[gameId] || {};
  return ['slots', 'scratch'].includes(gameId) ? table[meId] || {} : table;
}

function buildInfo(state, gameId, me) {
  const players = {};
  for (const p of Object.values(state.players)) players[p.id] = { name: p.name, color: p.color, connected: p.connected };
  return {
    you: me,
    players,
    seats: Object.values(state.players).filter((p) => p.seat === gameId).map((p) => p.id),
    bank: state.bank,
    serverNow: session.serverNow(),
  };
}

export async function mountGame(gameId, container) {
  const me = session.me();
  const offs = [];
  const ctx = {
    gameId,
    playerId: me.id,
    send: (action) => session.sendGameAction(gameId, action),
    chips,
    audio,
    clock: { now: () => session.serverNow() },
    fmt,
    get quality() { return prefs.get('quality'); },
    onEvent(cb) {
      const off = session.on('tableEvent', (e) => { if (e.gameId === gameId) cb(e); });
      offs.push(off);
      return off;
    },
  };
  container.replaceChildren();
  let view = await loadView(gameId);
  ctx.fallbackReason = lastFallbackReason;
  lastFallbackReason = '';
  try {
    view.mount(container, ctx);
  } catch (err) {
    // La vista real falló al montarse (p. ej. GSAP no cargó): se muestra el error y se cae a la provisoria
    console.error(`[gamehost] falló el montaje de la vista de ${gameId}:`, err);
    container.replaceChildren();
    view = await loadPlaceholder(err);
    ctx.fallbackReason = lastFallbackReason;
    view.mount(container, ctx);
  }
  let alive = true;
  const api = {
    update(state) {
      if (!alive || !state) return;
      const ts = tableState(state, gameId, me.id);
      if (!ts || !Object.keys(ts).length) return;   // la mesa todavía no publicó su estado: nada que dibujar
      try {
        view.update(ts, buildInfo(state, gameId, me));
      } catch (err) {
        console.error(`[gamehost] error al actualizar la vista de ${gameId}:`, err);
      }
    },
    destroy() {
      if (!alive) return;
      alive = false;
      offs.forEach((off) => off());
      view.destroy();
      container.replaceChildren();
    },
  };
  api.update(session.getState());
  return api;
}

export function createGameHost(container) {
  let mounted = null;      // { gameId, api }
  let pending = null;      // juego que se está cargando
  const seatOf = (state) => {
    const me = state && session.me();
    return me && state.players[me.id] ? state.players[me.id].seat : null;
  };

  async function render(state) {
    const gameId = state && state.phase === 'day' ? seatOf(state) : null;
    if (mounted && mounted.gameId === gameId) { mounted.api.update(state); return; }
    if (mounted) { mounted.api.destroy(); mounted = null; }
    pending = gameId;
    if (!gameId) return;
    const api = await mountGame(gameId, container);
    if (pending !== gameId) { api.destroy(); return; }   // mientras cargaba, la persona ya cambió de mesa
    mounted = { gameId, api };
  }
  return { render, destroy: () => { pending = null; if (mounted) mounted.api.destroy(); mounted = null; } };
}
