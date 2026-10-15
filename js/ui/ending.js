// js/ui/ending.js
// Pantallas finales (fases 'gameover' y 'victory'): mismo diseño, distinto tono. Muestra el resultado de la partida,
// los rankings globales (session.fetchRankings) en tres solapas, y los botones Revancha (solo anfitrión) y Salir.
// Exporta mountEnding(raiz, { session, onLeave }) -> { render(state) }.

import { $, h } from './dom.js';
import { fmt } from '../core/money.js';
import { audio } from './audio.js';
import { prefs } from './prefs.js';

const MINUS = '\u2212';
const signed = (c) => (c > 0 ? '+' : c < 0 ? MINUS : '') + fmt(Math.abs(c));
const tone = (c) => (c > 0 ? 'is-win' : c < 0 ? 'is-loss' : '');
const TABS = [
  { id: 'topWinners', label: 'Más ganaron' },
  { id: 'blackSheep', label: 'Ovejas negras' },
  { id: 'bestRuns', label: 'Mejores partidas' },
];

export function mountEnding(root, { session, onLeave }) {
  const title = $('#end-title', root);
  const sub = $('#end-sub', root);
  const mine = $('#end-mine', root);
  const tabsEl = $('#end-tabs', root);
  const listEl = $('#end-list', root);
  const rematchBtn = $('#end-rematch', root);
  const waitEl = $('#end-wait', root);
  const confetti = $('#end-confetti', root);
  let phase = null;        // fase final que ya se presentó (para no repetir sonido ni pedir el ranking dos veces)
  let rankings = null;
  let tab = 'topWinners';
  let loadToken = 0;

  for (const t of TABS) {
    tabsEl.append(h('button', {
      type: 'button', class: 'seg__btn', 'data-tab': t.id, 'aria-pressed': String(t.id === tab),
      onclick: () => { tab = t.id; paintTabs(); paintList(); },
    }, t.label));
  }

  function paintTabs() {
    for (const b of tabsEl.children) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
  }

  function paintList() {
    if (!rankings) return;
    const rows = rankings[tab] || [];
    if (!rows.length) { listEl.replaceChildren(h('li', { class: 'hint' }, 'Todavía no hay datos.')); return; }
    listEl.replaceChildren(...rows.map((r, i) => {
      if (tab === 'bestRuns') {
        const date = new Date(r.endedAt).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
        return h('li', { class: 'rank-row' },
          h('span', { class: 'rank-row__pos' }, String(i + 1)),
          h('span', { class: 'rank-row__name' }, `Sala ${r.room}`, h('small', {}, `${r.days} días · ${date}`)),
          h('span', { class: 'rank-row__val is-win' }, fmt(r.finalBank)));
      }
      return h('li', { class: 'rank-row' },
        h('span', { class: 'rank-row__pos' }, String(i + 1)),
        h('span', { class: 'rank-row__name' }, r.name),
        h('span', { class: `rank-row__val ${tone(r.net)}` }, signed(r.net)));
    }));
  }

  async function loadRankings() {
    const my = ++loadToken;
    rankings = null;
    listEl.replaceChildren(h('li', { class: 'hint', role: 'status' }, 'Cargando rankings...'));
    try {
      const data = await session.fetchRankings();
      if (my !== loadToken) return;
      rankings = data;
      paintList();
    } catch (err) {
      if (my !== loadToken) return;
      listEl.replaceChildren(h('li', { class: 'rank-error' },
        h('p', { class: 'hint' }, 'No se pudieron cargar los rankings.'),
        h('button', { type: 'button', class: 'btn btn--small btn--ghost', onclick: loadRankings }, 'Reintentar')));
    }
  }

  function throwConfetti() {
    confetti.replaceChildren();
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || prefs.get('quality') === 'baja') return;
    const colors = ['#D4AF37', '#F4D77A', '#2EE59D', '#FF2BD6', '#27E7FF', '#F5F1E6'];
    for (let i = 0; i < 28; i++) {
      const p = h('i', { class: 'confetti' });
      p.style.setProperty('--x', `${Math.round(Math.random() * 100)}%`);
      p.style.setProperty('--d', `${(Math.random() * 1.2).toFixed(2)}s`);
      p.style.setProperty('--t', `${(2.6 + Math.random() * 1.6).toFixed(2)}s`);
      p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
      p.style.background = colors[i % colors.length];
      confetti.append(p);
    }
    setTimeout(() => confetti.replaceChildren(), 6000);
  }

  function render(state) {
    if (!state || (state.phase !== 'gameover' && state.phase !== 'victory')) {
      phase = null;
      loadToken++;
      return;
    }
    const won = state.phase === 'victory';
    root.classList.toggle('is-victory', won);
    root.classList.toggle('is-gameover', !won);
    title.textContent = won ? '¡Sobrevivieron!' : 'Deuda impaga';
    const short = Math.max(0, state.quota - state.bank);
    sub.textContent = won
      ? `Pagaron las ${state.day} cuotas. Banco final: ${fmt(state.bank)}.`
      : `Se cayó la cuota del día ${state.day}${short > 0 ? ` (faltaron ${fmt(short)})` : ''}. Pero el casino se acuerda de ustedes.`;

    const me = session.me();
    const p = me && state.players[me.id];
    if (p) {
      mine.hidden = false;
      mine.replaceChildren('Tu resultado: ', h('b', { class: tone(p.stats.net) }, signed(p.stats.net)));
    } else {
      mine.hidden = true;
    }

    const host = session.isHost();
    rematchBtn.hidden = !host;
    waitEl.hidden = host;
    if (phase !== state.phase) {
      phase = state.phase;
      rematchBtn.disabled = false;
      tab = 'topWinners';
      paintTabs();
      loadRankings();
      if (won) { audio.play('jackpot'); throwConfetti(); }
      else { audio.play('lose'); setTimeout(() => audio.play('bell'), 350); }
    }
  }

  rematchBtn.addEventListener('click', () => { rematchBtn.disabled = true; session.rematch(); });
  $('#end-leave', root).addEventListener('click', onLeave);

  return { render };
}
