// js/ui/lobby.js
// Sala de espera: código de sala (copiar y compartir), lista de jugadores con color y conexión,
// duración del día (solo el anfitrión la cambia) y botón Empezar. Exporta mountLobby(raiz, deps) -> { render(state) }.
// DECISIÓN: la duración elegida se lee de state.dayMs (campo que pido en el PEDIDO DE CAMBIO AL CONTRATO).

import { $, h, clear } from './dom.js';
import { fit } from './fit.js';

const MAX_PLAYERS = 8;
const DAY_OPTIONS = [60000, 180000, 300000, 480000];   // 1, 3, 5 y 8 minutos
const DEFAULT_DAY_MS = 300000;

export function mountLobby(root, { session, screens, onLeave }) {
  const codeEl = $('#lobby-code', root);
  const copyBtn = $('#lobby-copy', root);
  const shareBtn = $('#lobby-share', root);
  const copyMsg = $('#lobby-copy-msg', root);
  const listEl = $('#lobby-players', root);
  const countEl = $('#lobby-count', root);
  const hintEl = $('#lobby-hint', root);
  const daylenPanel = $('#lobby-daylen-panel', root);
  const daylenEl = $('#lobby-daylen', root);
  const daylenGuest = $('#lobby-daylen-guest', root);
  const startBtn = $('#lobby-start', root);
  const waitEl = $('#lobby-wait', root);
  let localDayMs = DEFAULT_DAY_MS;
  let copyTimer = null;

  const minutes = (ms) => `${Math.round(ms / 60000)} min`;

  // Botones de duración del día
  for (const ms of DAY_OPTIONS) {
    daylenEl.append(h('button', {
      type: 'button', class: 'seg__btn', 'data-ms': ms, 'aria-pressed': 'false',
      onclick: () => { localDayMs = ms; session.setDayLength(ms); paintDayLength(ms); },
    }, minutes(ms)));
  }

  function paintDayLength(ms) {
    for (const btn of daylenEl.children) btn.setAttribute('aria-pressed', String(Number(btn.dataset.ms) === ms));
  }

  function swatch(color) {
    const el = h('span', { class: 'swatch', 'aria-hidden': 'true' });
    el.style.setProperty('--c', color);
    return el;
  }

  function playerRow(p, state, meId) {
    const tags = [];
    if (p.id === state.hostId) tags.push(h('span', { class: 'tag tag--gold' }, 'Anfitrión'));
    if (!p.connected) tags.push(h('span', { class: 'tag tag--off' }, 'Sin conexión'));
    return h('li', { class: `player${p.connected ? '' : ' is-off'}${p.id === meId ? ' is-me' : ''}` },
      swatch(p.color),
      h('div', { class: 'player__main' },
        h('span', { class: 'player__name' }, p.name, p.id === meId ? h('span', { class: 'player__you' }, ' (vos)') : null),
        tags.length ? h('span', { class: 'player__tags' }, tags) : null));
  }

  function render(state) {
    if (!state || state.phase !== 'lobby') return;
    const me = session.me();
    const host = session.isHost();
    const players = Object.values(state.players).sort((a, b) => a.joinedAt - b.joinedAt);

    if (codeEl.textContent !== state.roomCode) {
      codeEl.textContent = state.roomCode;
      codeEl.setAttribute('aria-label', 'Código de sala: ' + state.roomCode.split('').join(' '));
      fit(codeEl);
    }

    clear(listEl);
    for (const p of players) listEl.append(playerRow(p, state, me && me.id));
    countEl.textContent = `${players.length}/${MAX_PLAYERS}`;
    hintEl.hidden = players.length > 1;
    hintEl.textContent = 'Compartí el código para que se sumen tus amigos. Con 1 solo jugador también podés probar.';

    // Duración del día: el anfitrión la elige, los demás la ven (si el estado la trae)
    const dayMs = state.dayMs || localDayMs;
    paintDayLength(dayMs);
    daylenEl.hidden = !host;
    daylenGuest.hidden = host || !state.dayMs;
    daylenGuest.textContent = `Cada día dura ${minutes(dayMs)}.`;
    daylenPanel.hidden = !host && !state.dayMs;
    $('#lobby-daylen-label', root).hidden = !host;

    startBtn.hidden = !host;
    waitEl.hidden = host;
    if (!host) {
      const hostName = state.players[state.hostId] ? state.players[state.hostId].name : 'el anfitrión';
      waitEl.textContent = `Esperando a que ${hostName} empiece…`;
    }
  }

  // ---- Copiar y compartir ----
  function copyFallback(text) {
    const area = h('textarea', { readonly: '', style: 'position:fixed;opacity:0;top:0;left:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    try { document.execCommand('copy'); } catch (err) { console.warn('[lobby] no se pudo copiar', err); }
    area.remove();
  }

  async function copyCode() {
    const state = session.getState();
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.roomCode);
    } catch (err) {
      copyFallback(state.roomCode);
    }
    copyBtn.textContent = '¡Copiado!';
    copyMsg.textContent = 'Código copiado';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyBtn.textContent = 'Copiar'; copyMsg.textContent = ''; }, 1600);
  }

  copyBtn.addEventListener('click', copyCode);

  if (navigator.share) {
    shareBtn.hidden = false;
    shareBtn.addEventListener('click', () => {
      const state = session.getState();
      if (!state) return;
      navigator.share({
        title: 'Cuota Mortal',
        text: `Sumate a mi casino. Código de sala: ${state.roomCode}`,
        url: location.href.split('#')[0].split('?')[0],
      }).catch(() => { /* la persona cerró el menú de compartir: no pasa nada */ });
    });
  }

  startBtn.addEventListener('click', () => session.startGame());
  $('#lobby-leave', root).addEventListener('click', onLeave);

  screens.onShow((name) => { if (name === 'lobby') render(session.getState()); });

  return { render };
}
