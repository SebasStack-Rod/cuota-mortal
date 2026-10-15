// js/ui/bar-sheets.js
// Las tres hojas de la barra inferior de la mesa: Cambiar de juego, Ganancias y Equipo. Usan openSheet (sheets.js)
// y se repintan solas cuando cambia el estado de la sala mientras están abiertas.
// Exporta mountBarSheets({ session, onSwitching }) -> { open('switch' | 'profit' | 'team') }.

import { h } from './dom.js';
import { fmt } from '../core/money.js';
import { openSheet } from './sheets.js';
import { GAME_LIST, gameMeta } from './games-meta.js';

const MINUS = '\u2212';

function dot(color) {
  const el = h('i', { class: 'zone__dot', 'aria-hidden': 'true' });
  el.style.background = color;
  return el;
}

function swatch(color) {
  const el = h('span', { class: 'swatch', 'aria-hidden': 'true' });
  el.style.setProperty('--c', color);
  return el;
}

const signed = (cents) => (cents > 0 ? '+' : cents < 0 ? MINUS : '') + fmt(Math.abs(cents));
const tone = (cents) => (cents > 0 ? 'is-win' : cents < 0 ? 'is-loss' : '');

export function mountBarSheets({ session, onSwitching = () => {} }) {
  // Abre una hoja cuyo cuerpo se vuelve a armar en cada cambio de estado
  function liveSheet({ title, build }) {
    const body = h('div', { class: 'bar-sheet' });
    let off = () => {};
    const api = openSheet({ title, body, onClose: () => off() });
    const paint = () => {
      const state = session.getState();
      if (!state) { api.close(); return; }
      body.replaceChildren(...build(state, api).filter(Boolean));   // replaceChildren escribiría "null" como texto
    };
    off = session.on('state', paint);
    paint();
    return api;
  }

  // ---------- Cambiar de juego ----------
  function openSwitch() {
    liveSheet({
      title: 'Cambiar de juego',
      build(state, api) {
        const me = session.me();
        const mySeat = me && state.players[me.id] ? state.players[me.id].seat : null;
        const canMove = state.phase === 'day';
        const items = GAME_LIST.map((g) => {
          const sitting = Object.values(state.players).filter((p) => p.seat === g.id);
          const here = g.id === mySeat;
          const count = sitting.length ? `${sitting.length} sentado${sitting.length > 1 ? 's' : ''}` : 'Nadie sentado';
          return h('li', { class: `switch-row${here ? ' is-here' : ''}` },
            h('div', { class: 'switch-row__main' },
              h('span', { class: 'switch-row__name' }, g.name),
              h('span', { class: 'switch-row__count' }, h('span', { class: 'switch-row__dots' }, sitting.map((p) => dot(p.color))), count)),
            h('button', {
              type: 'button', class: `btn btn--small ${here ? 'btn--ghost' : 'btn--gold'}`,
              disabled: here || !canMove,
              'aria-label': here ? `${g.name}, ya estás acá` : `Ir a ${g.name}`,
              onclick: () => { api.close(); goTo(g.id); },
            }, here ? 'Acá estás' : 'Ir'));
        });
        const note = canMove ? null : h('p', { class: 'hint' }, 'Solo se puede cambiar de mesa mientras dura el día.');
        return [h('ul', { class: 'switch-list' }, items), note];
      },
    });
  }

  // Levantarse y sentarse en otra mesa; main.js no cambia de pantalla mientras tanto (evita un parpadeo por el salón)
  function goTo(gameId) {
    onSwitching(gameId);
    session.standUp();
    session.sitAt(gameId);
  }

  // ---------- Ganancias ----------
  function openProfit() {
    liveSheet({
      title: 'Ganancias',
      build(state) {
        const me = session.me();
        const p = me && state.players[me.id];
        if (!p || p.stats.rounds === 0) return [h('p', { class: 'hint hint--big' }, 'Todavía no apostaste en esta partida.')];
        const s = p.stats;
        const streak = s.streak > 0 ? `+${s.streak}` : s.streak < 0 ? `${MINUS}${Math.abs(s.streak)}` : '0';
        const cell = (label, value, cls = '') => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', { class: cls }, value));
        return [
          h('p', { class: `profit-net ${tone(s.net)}`, role: 'status' },
            h('span', { class: 'profit-net__label' }, 'Resultado total'), signed(s.net)),
          h('dl', { class: 'stats' },
            cell('Apostado', fmt(s.bet)),
            cell('Cobrado', fmt(s.won)),
            cell('Racha', streak, s.streak > 0 ? 'is-win' : s.streak < 0 ? 'is-loss' : ''),
            cell('Rondas', String(s.rounds)),
            cell('Mejor ganancia', s.bestWin > 0 ? fmt(s.bestWin) : '-', s.bestWin > 0 ? 'is-win' : ''),
            // DECISIÓN: worstLoss llega en positivo (pedido de cambio 4); se muestra con signo menos
            cell('Peor pérdida', s.worstLoss > 0 ? `${MINUS}${fmt(s.worstLoss)}` : '-', s.worstLoss > 0 ? 'is-loss' : '')),
        ];
      },
    });
  }

  // ---------- Equipo ----------
  function openTeam() {
    liveSheet({
      title: 'Equipo',
      build(state) {
        const me = session.me();
        const t = state.titles || {};
        const players = Object.values(state.players).sort((a, b) => b.stats.net - a.stats.net || a.joinedAt - b.joinedAt);
        const rows = players.map((p) => {
          const tags = [];
          if (p.id === state.hostId) tags.push(h('span', { class: 'tag tag--gold' }, 'Anfitrión'));
          if (!p.connected) tags.push(h('span', { class: 'tag tag--off' }, 'Sin conexión'));
          // Si la misma persona tiene los dos títulos (sala de 1), se muestra uno solo: el de quien más ganó
          const isTop = t.topWinner === p.id && p.stats.net > 0;
          const isSheep = t.blackSheep === p.id && p.stats.net < 0 && !isTop;
          if (isTop) tags.push(h('span', { class: 'tag tag--win' }, 'Quien más ganó'));
          if (isSheep) tags.push(h('span', { class: 'tag tag--sheep' }, 'La oveja negra'));
          const where = p.seat ? `En ${gameMeta(p.seat).name}` : state.phase === 'day' ? 'En el salón' : null;
          return h('li', { class: `player team-row${p.connected ? '' : ' is-off'}${me && p.id === me.id ? ' is-me' : ''}` },
            swatch(p.color),
            h('div', { class: 'player__main' },
              h('span', { class: 'player__name' }, p.name, me && p.id === me.id ? h('span', { class: 'player__you' }, ' (vos)') : null),
              where ? h('span', { class: 'team-row__where' }, where) : null,
              tags.length ? h('span', { class: 'player__tags' }, tags) : null),
            h('span', { class: `team-row__net ${tone(p.stats.net)}` }, signed(p.stats.net)));
        });
        return [h('ul', { class: 'team-list' }, rows)];
      },
    });
  }

  return {
    open(act) {
      if (act === 'switch') openSwitch();
      else if (act === 'profit') openProfit();
      else if (act === 'team') openTeam();
    },
  };
}
