// js/ui/placeholder-view.js
// Vista de REEMPLAZO para un juego que todavía no existe (la IA 3 entrega js/games/<id>/view.js).
// Muestra el estado público de la mesa, las fichas elegidas y un botón para mandar una apuesta de prueba a la sesión.
// Cumple el contrato de vistas: export default { mount(contenedor, ctx), update(estado, info), destroy() }.

import { gameMeta } from './games-meta.js';

let box = null;
let off = null;

export default {
  mount(container, ctx) {
    box = document.createElement('div');
    box.className = 'placeholder-view';
    box.innerHTML = `
      <h2 class="placeholder-view__title"></h2>
      <p class="hint">Vista provisoria: la mesa real la entrega la IA 3.</p>
      <div class="placeholder-view__bet"></div>
      <button type="button" class="btn btn--gold btn--block placeholder-view__send">Apostar el monto elegido</button>
      <p class="placeholder-view__msg" role="status"></p>
      <pre class="placeholder-view__state" aria-label="Estado de la mesa"></pre>`;
    container.append(box);
    box.querySelector('.placeholder-view__title').textContent = gameMeta(ctx.gameId).name;
    const msg = box.querySelector('.placeholder-view__msg');
    const send = box.querySelector('.placeholder-view__send');

    const paintBet = () => {
      const amount = ctx.chips.selected();
      box.querySelector('.placeholder-view__bet').replaceChildren(ctx.chips.stack(amount, { max: 4, size: 40, label: true }));
      send.disabled = amount === 0;
    };
    const stopChips = ctx.chips.onChange(paintBet);
    paintBet();

    send.addEventListener('click', async () => {
      const amount = ctx.chips.selected();
      const res = await ctx.send({ type: 'bet', amount });
      msg.textContent = res.ok ? `Apuesta de ${ctx.fmt(amount)} enviada.` : `La sesión la rechazó: ${res.error}`;
    });
    const stopEvents = ctx.onEvent((e) => {
      if (e.name === 'bet_result' && e.data.playerId === ctx.playerId) {
        msg.textContent = e.data.payout > 0 ? `Ganaste ${ctx.fmt(e.data.payout)} (apostaste ${ctx.fmt(e.data.stake)}).` : `Perdiste ${ctx.fmt(e.data.stake)}.`;
      }
    });
    off = () => { stopChips(); stopEvents(); };
  },
  update(tableState, info) {
    if (!box) return;
    box.querySelector('.placeholder-view__state').textContent = JSON.stringify({ mesa: tableState, sentados: info.seats.length, banco: info.bank }, null, 1);
  },
  destroy() {
    if (off) off();
    if (box) box.remove();
    box = null; off = null;
  },
};
