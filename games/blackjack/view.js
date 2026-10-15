// js/games/blackjack/view.js: vista del Blackjack. Dibuja SIEMPRE desde el estado público. Mesa semicircular: banca arriba con el zapato,
// los demás jugadores en arco, la mano propia grande abajo con un anillo de tiempo, y los botones según la fase. Las cartas salen del zapato
// de a una (el estado trae dealStartedAt y dealStepMs) y la carta oculta de la banca se da vuelta en 3D (CSS). GSAP global solo para
// vuelos de cartas y avisos. Exporta mount(container, ctx).
import { createHand, watchCrop } from './hand.js';
import { createAmountPicker } from '../amount.js';
import { PLAY_MS, BETTING_MS } from './logic.js';

const ERRORES = {
  apuestas_cerradas: 'Apuestas cerradas', sin_fondos: 'El banco no alcanza', no_sentado: 'Tenés que sentarte primero',
  ya_apostaste: 'Ya apostaste en esta ronda', nada_que_deshacer: 'No hay apuesta para cancelar', fuera_de_turno: 'Ahora no se puede jugar',
  sin_mano: 'No estás en esta ronda', mano_cerrada: 'Tu mano ya terminó', no_puede_doblar: 'Solo podés doblar con tus dos primeras cartas',
};
const TXT = { blackjack: 'BLACKJACK', win: 'GANASTE', push: 'EMPATE', lose: 'PERDISTE', bust: 'TE PASASTE' };

function loadStyle(done) {
  let link = document.querySelector('link[data-bj-style]');
  if (!link) {
    link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href; link.dataset.bjStyle = '1';
    document.head.appendChild(link);
  }
  if (link.sheet) done(); else { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); }
}

export function mount(container, ctx) {
  if (!window.gsap) throw new Error('El Blackjack necesita GSAP cargado como global (window.gsap) antes de montarse.');
  const { chips, audio, clock, fmt } = ctx;
  const root = document.createElement('section');
  root.className = 'game game--bj';
  root.style.visibility = 'hidden';
  root.innerHTML = `
    <div class="bj-top"><div class="bj-dealer"><div class="bj-lbl">BANCA</div></div>
      <div class="bj-shoe"><i></i><i></i><i></i><b>312</b></div></div>
    <div class="bj-rule">Blackjack paga 3 a 2 · la banca se planta en 17</div>
    <div class="bj-seats"></div>
    <div class="bj-me"><div class="bj-banner"></div><div class="bj-myhand"></div>
      <div class="bj-ring"><svg viewBox="0 0 44 44"><circle class="bj-ring-bg" cx="22" cy="22" r="19"/><circle class="bj-ring-fg" cx="22" cy="22" r="19"/></svg><b></b></div>
      <div class="bj-mybet"></div></div>
    <div class="bj-panel">
      <div class="bj-row bj-row--bet"><button type="button" class="bj-go">Apostar</button><button type="button" class="bj-cancel" hidden>↶ Cancelar</button></div>
      <div class="bj-row bj-row--play" hidden><button type="button" class="bj-hit">Pedir</button><button type="button" class="bj-stand">Plantarme</button><button type="button" class="bj-double">Doblar</button></div>
      <div class="bj-row bj-row--wait" hidden><span class="bj-status"></span></div>
    </div>
    <div class="bj-notice"></div>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const dealerBox = $('.bj-dealer'), shoeEl = $('.bj-shoe'), shoeNum = $('.bj-shoe b'), seatsEl = $('.bj-seats'), meBox = $('.bj-me');
  const bannerEl = $('.bj-banner'), ringEl = $('.bj-ring'), ringFg = $('.bj-ring-fg'), ringTxt = $('.bj-ring b'), mybetEl = $('.bj-mybet');
  const rowBet = $('.bj-row--bet'), rowPlay = $('.bj-row--play'), rowWait = $('.bj-row--wait'), statusEl = $('.bj-status'), noticeEl = $('.bj-notice');
  const goBtn = $('.bj-go'), cancelBtn = $('.bj-cancel'), hitBtn = $('.bj-hit'), standBtn = $('.bj-stand'), dblBtn = $('.bj-double');
  gsap.set(noticeEl, { xPercent: -50 });
  const CIRC = 2 * Math.PI * 19; ringFg.style.strokeDasharray = String(CIRC);

  const measure = watchCrop(root);
  const hopts = { measure, onDeal: (d) => { gsap.delayedCall(d, () => audio.play('card-slide')); }, onFlip: () => audio.play('card-place') };
  const dealerHand = createHand({ size: 'mid', ...hopts }); dealerBox.appendChild(dealerHand.el);
  const myHand = createHand({ size: 'big', ...hopts }); $('.bj-myhand').appendChild(myHand.el);
  const picker = createAmountPicker({ chips, fmt });
  rowBet.prepend(picker.btn); root.appendChild(picker.pop);

  let S = null, I = null, prev = null, liveNow = false, raf = 0, busy = false, noticeCall = null, lastSecs = -1, layoutKey = '';
  const seats = new Map(); // pid -> { el, hand, nameEl, totEl }
  const calls = [];
  const you = () => (I && I.you) || ctx.playerId;
  const nameOf = (pid) => (I && I.players && I.players[pid] && I.players[pid].name) || pid;
  const colorOf = (pid) => (I && I.players && I.players[pid] && I.players[pid].color) || '#F5F1E6';

  function notice(text) {
    if (noticeCall) noticeCall.kill();
    noticeEl.textContent = text; gsap.killTweensOf(noticeEl);
    gsap.fromTo(noticeEl, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.18 });
    noticeCall = gsap.delayedCall(1.9, () => gsap.to(noticeEl, { opacity: 0, duration: 0.3 }));
  }
  const errText = (e) => {
    const L = (S && S.limits) || { min: 25, max: 20000 };
    if (e === 'supera_maximo') return 'Máximo por mano: ' + fmt(L.max) + (S && S.phase === 'playing' ? ' (doblar cuenta doble)' : '');
    if (e === 'monto_invalido') return 'Mínimo por apuesta: ' + fmt(L.min);
    return ERRORES[e] || 'No se pudo completar la acción';
  };
  const send = async (action) => {
    if (busy) return null;
    busy = true;
    try { const r = await ctx.send(action); if (!r || !r.ok) notice(errText(r && r.error)); return r; } finally { busy = false; }
  };

  // Etiqueta de una mano: total, BLACKJACK o PASADO
  function tagOf(h) {
    if (!h) return { t: '', c: '' };
    if (h.status === 'blackjack') return { t: 'BLACKJACK', c: 'is-bj' };
    if (h.status === 'bust') return { t: 'PASADO ' + h.total, c: 'is-bust' };
    return { t: (h.soft && h.total < 21 ? h.total - 10 + '/' : '') + h.total + (h.doubled ? ' · x2' : ''), c: h.status === 'stand' ? 'is-stand' : '' };
  }
  function dealDelays(pidIndex, n, isDealer) { // segundos hasta que sale cada una de las dos primeras cartas
    if (!S.dealStartedAt) return [];
    const step = S.dealStepMs || 280;
    return [0, 1].map((c) => Math.max(0, (S.dealStartedAt + (c * (n + 1) + (isDealer ? n : pidIndex)) * step - clock.now()) / 1000));
  }

  function renderDealer() {
    const live = S.phase === 'dealing' || liveNow;
    dealerHand.set(S.dealer.cards, { animate: live, from: shoeEl, delays: dealDelays(0, S.order.length, true) });
    const t = S.phase === 'dealing' ? { t: '', c: '' } : S.dealer.status === 'blackjack' ? { t: 'BLACKJACK', c: 'is-bj' } : S.dealer.status === 'bust' ? { t: 'PASADO ' + S.dealer.total, c: 'is-bust' } : { t: S.dealer.total != null ? String(S.dealer.total) : '', c: '' };
    dealerHand.tag.textContent = t.t; dealerHand.tag.className = 'bj-tag ' + t.c;
  }

  function renderMe() {
    const me = you(), h = S.hands[me], live = S.phase === 'dealing' || liveNow;
    const idx = S.order.indexOf(me);
    myHand.set(h ? h.cards : [], { animate: live, from: shoeEl, delays: h ? dealDelays(idx, S.order.length, false) : [] });
    const t = S.phase === 'dealing' ? { t: '', c: '' } : tagOf(h);
    myHand.tag.textContent = t.t; myHand.tag.className = 'bj-tag ' + t.c;
    const bet = h ? h.bet : S.bets[me];
    const key = String(bet || 0);
    if (mybetEl.dataset.k !== key) {
      mybetEl.dataset.k = key; mybetEl.textContent = '';
      if (bet) { mybetEl.appendChild(chips.stack(bet, { max: 3, size: 26, label: false })); const a = document.createElement('b'); a.textContent = fmt(bet); mybetEl.appendChild(a); }
    }
    const r = S.results[me];
    if (r) {
      const net = r.payout - r.stake;
      bannerEl.textContent = TXT[r.outcome] + (net > 0 ? ' +' + fmt(net) : net < 0 ? ' −' + fmt(-net) : '');
      bannerEl.className = 'bj-banner is-on ' + (net > 0 ? 'is-win' : net < 0 ? 'is-loss' : 'is-even');
    } else { bannerEl.className = 'bj-banner'; bannerEl.textContent = ''; }
  }

  function renderSeats() {
    const me = you(), pids = [...new Set([...S.order, ...Object.keys(S.bets)])].filter((p) => p !== me);
    for (const [pid, s] of seats) if (!pids.includes(pid)) { s.hand.clear(); s.el.remove(); seats.delete(pid); }
    pids.forEach((pid, i) => {
      let s = seats.get(pid);
      if (!s) {
        const el = document.createElement('div'); el.className = 'bj-seat';
        const hand = createHand({ size: 'small', ...hopts });
        const nameEl = document.createElement('span'); nameEl.className = 'bj-sname';
        el.append(hand.el, nameEl); seatsEl.appendChild(el);
        s = { el, hand, nameEl }; seats.set(pid, s);
      }
      const h = S.hands[pid], live = S.phase === 'dealing' || liveNow, idx = S.order.indexOf(pid);
      s.hand.set(h ? h.cards : [], { animate: live, from: shoeEl, delays: h ? dealDelays(idx, S.order.length, false) : [] });
      const r = S.results[pid];
      let t = { t: '', c: '' };
      if (r) { const net = r.payout - r.stake; t = { t: net > 0 ? '+' + fmt(net) : net < 0 ? '−' + fmt(-net) : '±' + fmt(0), c: net > 0 ? 'is-win' : net < 0 ? 'is-loss' : '' }; }
      else if (!h) t = { t: fmt(S.bets[pid] || 0), c: 'is-bet' };
      else if (S.phase !== 'dealing') t = tagOf(h);
      s.hand.tag.textContent = t.t; s.hand.tag.className = 'bj-tag ' + t.c;
      s.nameEl.textContent = nameOf(pid); s.nameEl.style.color = colorOf(pid);
      s.el.dataset.i = String(i);
    });
    layoutSeats();
  }
  function layoutSeats() {
    const n = seats.size, W = seatsEl.clientWidth, H = seatsEl.clientHeight;
    const key = [n, W, H, [...seats.keys()].join()].join();
    if (key === layoutKey || !W) return;
    layoutKey = key;
    let i = 0;
    for (const s of seats.values()) {
      const sw = s.el.offsetWidth || 70, sh = s.el.offsetHeight || 70;
      const a = n === 1 ? Math.PI / 2 : Math.PI * (0.1 + 0.8 * (i / (n - 1)));
      const x = W / 2 - Math.cos(a) * (W / 2 - sw / 2 - 2) - sw / 2;
      const y = Math.max(0, (H - sh) * (0.05 + 0.95 * Math.sin(a)));
      s.el.style.left = x.toFixed(1) + 'px'; s.el.style.top = y.toFixed(1) + 'px'; i++;
    }
  }

  function renderPanel() {
    const me = you(), h = S.hands[me], betting = S.phase === 'betting', myBet = S.bets[me];
    const playing = S.phase === 'playing' && h && h.status === 'playing';
    rowBet.hidden = !betting; rowPlay.hidden = !playing; rowWait.hidden = betting || playing;
    const L = S.limits || { min: 25, max: 20000 };
    picker.setLimits({ minBet: L.min, maxBet: L.max }, 0);
    picker.btn.disabled = !betting || !!myBet;
    goBtn.hidden = !!myBet; cancelBtn.hidden = !myBet;
    if (playing) dblBtn.disabled = !(h.cards.length === 2 && !h.doubled);
    if (rowWait.hidden) return;
    const left = Math.max(0, Math.ceil((S.phaseEndsAt - clock.now()) / 1000));
    statusEl.textContent = S.phase === 'dealing' ? 'Repartiendo…' : S.phase === 'dealer' ? 'Juega la banca…' : S.phase === 'settle' ? 'Próxima ronda en ' + left + ' s'
      : h ? (h.status === 'bust' ? 'Te pasaste' : h.status === 'blackjack' ? '¡Blackjack!' : 'Esperando a los demás…') : 'Mirando esta ronda';
  }

  goBtn.addEventListener('click', async () => {
    if (!S || busy) return;
    const amount = picker.get();
    if (!amount) { notice('Elegí una ficha o escribí un monto'); return; }
    const r = await send({ type: 'bet', amount });
    if (r && r.ok) { audio.play('chip-lay'); if (chips.bankEl && chips.bankEl()) chips.fly({ from: chips.bankEl(), to: meBox, amount, count: 2, duration: 0.35 }); }
  });
  cancelBtn.addEventListener('click', async () => { const r = await send({ type: 'undo' }); if (r && r.ok) audio.play('chips-handle'); });
  hitBtn.addEventListener('click', () => send({ type: 'hit' }));
  standBtn.addEventListener('click', () => send({ type: 'stand' }));
  dblBtn.addEventListener('click', async () => { const r = await send({ type: 'double' }); if (r && r.ok) audio.play('chip-lay'); });

  function onTransition() {
    if (prev && prev.round === S.round) {
      if (prev.phase === 'dealer' && S.phase === 'settle') {
        const r = S.results[you()];
        if (r) {
          audio.play(r.outcome === 'blackjack' ? 'win-big' : r.payout > r.stake ? 'win-small' : r.payout === r.stake ? 'chips-handle' : 'lose');
          if (r.payout > 0 && chips.bankEl && chips.bankEl() && chips.fly) chips.fly({ from: meBox, to: chips.bankEl(), amount: r.payout, count: 4, duration: 0.8 });
        }
      }
    }
    if (prev && S.shoe.left > prev.shoeLeft) { audio.play('card-shuffle'); gsap.fromTo(shoeEl, { x: -4 }, { x: 0, duration: 0.4 }); }
    prev = { phase: S.phase, round: S.round, shoeLeft: S.shoe.left };
  }

  function frame_() {
    raf = requestAnimationFrame(frame_);
    if (!S || !S.hands || document.hidden) return;
    const now = clock.now(), h = S.hands[you()];
    let left = -1, dur = 1;
    if (S.phase === 'betting') { left = S.phaseEndsAt - now; dur = BETTING_MS; }
    else if (S.phase === 'playing' && h && h.status === 'playing' && h.endsAt) { left = h.endsAt - now; dur = PLAY_MS; }
    if (left < 0) { ringEl.classList.remove('is-on'); lastSecs = -1; }
    else {
      const secs = Math.ceil(left / 1000);
      ringEl.classList.add('is-on'); ringEl.classList.toggle('is-low', secs <= 3);
      ringFg.style.strokeDashoffset = String((CIRC * (1 - Math.min(1, left / dur))).toFixed(1));
      ringTxt.textContent = String(secs);
      if (secs <= 3 && secs >= 1 && secs !== lastSecs) audio.play('countdown-tick');
      lastSecs = secs;
    }
    const lbl = 'Apostar' + (picker.get() ? ' ' + fmt(picker.get()) : '');
    if (goBtn.textContent !== lbl) goBtn.textContent = lbl;
    if (S.phase === 'settle') renderPanel();
  }
  const ro = new ResizeObserver(() => {
    root.style.setProperty('--u', String(Math.min(1.1, Math.max(0.62, root.clientHeight / 600)).toFixed(3)));
    layoutKey = ''; layoutSeats();
  });
  ro.observe(root);
  raf = requestAnimationFrame(frame_);
  loadStyle(() => { root.style.visibility = ''; layoutKey = ''; layoutSeats(); });

  return {
    update(state, info) {
      if (!state || !state.shoe || !state.hands || !state.dealer) return;   // estado incompleto: se espera al siguiente
      S = state; I = info; liveNow = prev !== null; // la primera vez (entrar tarde) no se anima
      onTransition();
      shoeNum.textContent = String(S.shoe.left);
      renderDealer(); renderMe(); renderSeats(); renderPanel();
    },
    destroy() {
      cancelAnimationFrame(raf); ro.disconnect(); calls.forEach((c) => c && c.kill && c.kill());
      if (noticeCall) noticeCall.kill();
      gsap.killTweensOf(noticeEl); picker.destroy(); root.remove();
    },
  };
}
