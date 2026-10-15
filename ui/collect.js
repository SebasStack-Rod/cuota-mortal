// js/ui/collect.js
// Pantalla del cobro (fase 'collect'): el Prestamista pide la cuota del día, las fichas vuelan del banco hacia él
// y se anuncia "Cuota pagada" o "Cuota impaga". Con calidad Baja o movimiento reducido no hay fichas voladoras:
// solo texto y sonido. La escena corre una vez por día aunque llegue más de un estado durante el cobro.
// Exporta mountCollect(raiz) -> { render(state) }.
// DECISIÓN: el Prestamista es un dibujo SVG propio (index.html), porque en los assets no hay personaje.

import { $, h } from './dom.js';
import { fmt } from '../core/money.js';
import { audio } from './audio.js';
import { chips } from './chips.js';
import { prefs } from './prefs.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MINUS = '\u2212';

export function mountCollect(root) {
  const lender = $('#collect-lender', root);
  const says = $('#collect-says', root);
  const card = $('#collect-card', root);
  const verdict = $('#collect-verdict', root);
  const detail = $('#collect-detail', root);
  const dayBox = $('#collect-day', root);
  let playedDay = null;   // día cuya escena ya se mostró
  let token = 0;          // invalida una escena en curso si cambia la fase

  function paintDay(state) {
    const sm = state.summary;
    if (!sm) { dayBox.hidden = true; return; }
    const delta = sm.bankDelta;
    const nameOf = (id, sign) => {
      const p = id && state.players[id];
      const net = p && sm.perPlayer[id] ? sm.perPlayer[id].net : 0;
      return p && net * sign > 0 ? p.name : null;
    };
    const top = nameOf(sm.topWinner, 1);
    const sheep = nameOf(sm.blackSheep, -1);
    const lines = [h('li', {}, delta === 0 ? 'El banco quedó igual que al empezar el día.'
      : `El equipo ${delta > 0 ? 'ganó' : 'perdió'} ${fmt(Math.abs(delta))} en el día.`)];
    if (top) lines.push(h('li', {}, 'Quien más ganó: ', h('b', {}, top)));
    if (sheep) lines.push(h('li', {}, 'La oveja negra: ', h('b', {}, sheep)));
    dayBox.hidden = false;
    dayBox.replaceChildren(h('h2', { class: 'panel-title' }, `Resumen del día ${sm.day}`), h('ul', { class: 'collect-day__list' }, lines));
  }

  async function play(state) {
    const my = ++token;
    const c = state.collect;
    playedDay = state.day;
    lender.className = 'lender';
    verdict.textContent = '';
    detail.textContent = '';
    card.classList.remove('is-paid', 'is-unpaid');
    says.textContent = `Día ${state.day}. Vengo por mis ${fmt(c.amount)}.`;
    audio.play('chips-handle', { volume: 0.5 });

    const pause = wait(1300);
    const motion = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) && prefs.get('quality') !== 'baja';
    const fly = c.paid && motion
      ? chips.fly({ from: chips.bankEl(), to: lender, amount: c.amount, count: 8, duration: 0.9 })
      : Promise.resolve();
    await Promise.all([pause, fly]);
    if (my !== token) return;   // cambió la fase mientras tanto

    lender.classList.add(c.paid ? 'is-paid' : 'is-unpaid');
    card.classList.add(c.paid ? 'is-paid' : 'is-unpaid');
    if (c.paid) {
      verdict.textContent = 'Cuota pagada';
      detail.textContent = `Les quedan ${fmt(c.bankAfter)} en el banco.`;
      says.textContent = 'Un placer hacer negocios.';
      audio.play('win-small');
    } else {
      verdict.textContent = 'Cuota impaga';
      detail.textContent = `Faltaron ${fmt(c.amount - state.bank)}. El Prestamista no perdona.`;
      says.textContent = 'Entonces me cobro otra cosa.';
      audio.play('lose');
      await wait(350);
      if (my === token) audio.play('bell');
    }
  }

  function render(state) {
    if (!state || state.phase !== 'collect' || !state.collect) {
      token++;                 // corta la escena; la próxima vez que haya cobro se vuelve a mostrar
      if (!state || state.phase !== 'collect') playedDay = null;
      return;
    }
    paintDay(state);
    if (playedDay !== state.day) play(state);
  }

  return { render };
}
