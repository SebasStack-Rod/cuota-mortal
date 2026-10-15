// js/ui/shop.js
// Pantalla de la tienda (fase 'shop'): los 5 ítems con "Proponer", la votación en curso (Sí / No, cuántos votaron y
// cuenta regresiva), el inventario, los efectos activos y la cuota del día siguiente. La interfaz solo muestra y envía
// session.proposeItem / session.vote; la compra y el cobro los resuelve la sesión.
// Exporta mountShop(raiz, { session, screens }) -> { render(state) }.
// DECISIÓN: la cuota del día siguiente se lee de state.nextQuota (pedido de cambio 7). Si falta, no se muestra.

import { $, h } from './dom.js';
import { fmt } from '../core/money.js';
import { ITEM_LIST, itemMeta } from './items-meta.js';

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function mountShop(root, { session, screens }) {
  const bankEl = $('#shop-bank', root);
  const quotaRow = $('#shop-quota-row', root);
  const quotaEl = $('#shop-quota', root);
  const voteBox = $('#shop-vote', root);
  const itemsEl = $('#shop-items', root);
  const ownedEl = $('#shop-owned', root);
  let timer = null;
  let voteEndsAt = null;
  let voteTimeEl = null;

  function paintClock() {
    if (voteTimeEl && voteEndsAt) voteTimeEl.textContent = clock(voteEndsAt - session.serverNow());
  }

  function renderVote(state, me) {
    const v = state.vote;
    voteEndsAt = v ? v.endsAt : null;
    voteTimeEl = null;
    if (!v) { voteBox.hidden = true; voteBox.replaceChildren(); return; }
    const item = itemMeta(v.itemId);
    const proposer = state.players[v.proposedBy];
    const voters = Object.values(state.players).filter((p) => p.connected).length;
    const cast = v.yes.length + v.no.length;
    const mine = me ? (v.yes.includes(me.id) ? 'yes' : v.no.includes(me.id) ? 'no' : null) : null;
    voteTimeEl = h('span', { class: 'vote__time' }, clock(v.endsAt - session.serverNow()));
    const cantPay = state.bank < v.price;
    voteBox.hidden = false;
    const who = me && v.proposedBy === me.id ? 'Lo propusiste vos' : `Lo propuso ${proposer ? proposer.name : 'alguien'}`;
    voteBox.replaceChildren(...[
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Votación'),
        h('span', { class: 'vote__clock' }, 'Quedan ', voteTimeEl)),
      h('p', { class: 'vote__item' }, `${item.name} por ${fmt(v.price)}`),
      h('p', { class: 'hint' }, `${who}. ${item.desc}`),
      cantPay ? h('p', { class: 'vote__warn' }, 'El banco no alcanza hoy: la compra se va a caer.') : null,
      h('p', { class: 'vote__count', role: 'status' }, `Sí ${v.yes.length} · No ${v.no.length} · votaron ${cast} de ${voters}`),
      h('div', { class: 'vote__btns' },
        h('button', {
          type: 'button', class: 'btn btn--gold', disabled: !!mine || !me, 'aria-pressed': String(mine === 'yes'),
          onclick: () => session.vote(v.id, true),
        }, mine === 'yes' ? 'Votaste Sí' : 'Sí'),
        h('button', {
          type: 'button', class: 'btn btn--ghost', disabled: !!mine || !me, 'aria-pressed': String(mine === 'no'),
          onclick: () => session.vote(v.id, false),
        }, mine === 'no' ? 'Votaste No' : 'No')),
      mine ? h('p', { class: 'hint' }, 'Ya votaste. Esperá al resto del equipo.') : null,
    ].filter(Boolean));   // replaceChildren escribiría "null" como texto
  }

  function renderItems(state) {
    const voting = !!state.vote;
    itemsEl.replaceChildren(...ITEM_LIST.map((it) => {
      const own = (state.inventory && state.inventory[it.id]) || 0;
      const short = state.bank < it.price;
      let label = 'Proponer';
      if (voting) label = 'Hay votación';
      else if (short) label = 'No alcanza';
      return h('li', { class: `item${short ? ' is-short' : ''}` },
        h('div', { class: 'item__main' },
          h('div', { class: 'item__top' },
            h('span', { class: 'item__name' }, it.name),
            h('span', { class: 'item__price' }, fmt(it.price))),
          h('p', { class: 'item__desc' }, it.desc),
          own > 0 ? h('span', { class: 'tag tag--gold' }, `Tenés ${own}`) : null),
        h('button', {
          type: 'button', class: 'btn btn--small btn--ghost item__btn', disabled: voting || short,
          'aria-label': `Proponer ${it.name} por ${fmt(it.price)}`,
          onclick: () => session.proposeItem(it.id),
        }, label));
    }));
  }

  function renderOwned(state) {
    const inv = Object.entries(state.inventory || {}).filter(([, n]) => n > 0);
    const effects = state.effects || [];
    if (!inv.length && !effects.length) {
      ownedEl.replaceChildren(h('p', { class: 'hint' }, 'Todavía no compraron nada.'));
      return;
    }
    ownedEl.replaceChildren(...[
      inv.length ? h('ul', { class: 'owned__list' }, inv.map(([id, n]) => h('li', { class: 'tag tag--gold' }, `${itemMeta(id).name} ×${n}`))) : null,
      effects.length ? h('div', {},
        h('p', { class: 'field-label' }, 'Efectos activos'),
        h('ul', { class: 'owned__list' }, effects.map((e) => h('li', { class: 'tag' }, e.label)))) : null,
    ].filter(Boolean));
  }

  function render(state) {
    if (!state || state.phase !== 'shop') return;
    const me = session.me();
    bankEl.textContent = fmt(state.bank);
    quotaRow.hidden = state.nextQuota == null;
    if (state.nextQuota != null) quotaEl.textContent = fmt(state.nextQuota);
    renderVote(state, me);
    renderItems(state);
    renderOwned(state);
  }

  screens.onShow((name) => {
    clearInterval(timer);
    if (name === 'shop') {
      render(session.getState());
      timer = setInterval(paintClock, 250);
    }
  });

  return { render };
}
