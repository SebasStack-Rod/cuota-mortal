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

async function loadPlaceholder() {
  return (await import('./placeholder-view.js')).default;
}

async function loadView(gameId) {
  try {
    const view = adaptView(await import(`../games/${gameId}/view.js`));
    if (view) return view;
    console.error(`[gamehost] js/games/${gameId}/view.js no exporta mount(container, ctx)`);
  } catch (err) {
    // Si el archivo existe pero falla (import roto, error de sintaxis), que se vea en la consola
    console.error(`[gamehost] no se pudo cargar js/games/${gameId}/view.js:`, err);
  }
  return loadPlaceholder();
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
  try {
    view.mount(container, ctx);
  } catch (err) {
    // La vista real falló al montarse (p. ej. GSAP no cargó): se muestra el error y se cae a la provisoria
    console.error(`[gamehost] falló el montaje de la vista de ${gameId}:`, err);
    container.replaceChildren();
    view = await loadPlaceholder();
    view.mount(container, ctx);
  }
  let alive = true;
  const api = {
    update(state) {
      if (!alive || !state) return;
      view.update(tableState(state, gameId, me.id), buildInfo(state, gameId, me));
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
