// js/games/scratch/view.js: vista del Rasca y Gana (modo solo: muestra el boleto del propio jugador).
// Dibuja SIEMPRE desde el estado (celdas peek/reveal, open, phase). El boleto es una grilla de fichas con la capa plateada de cover.js encima.
// Flujo: elegís boleto -> buy; al empezar a rascar una celda se manda peek, al pasar del 60% reveal; "Rascar todo" manda revealAll.
// Usa GSAP global (window.gsap). Exporta mount(container, ctx) -> { update(state, info), destroy() }.
import { PRIZE_TABLE, SYMBOLS, TIERS, TIER_NAMES } from './logic.js';
import { createCover } from './cover.js';

const ERRORES = {
  boleto_en_curso: 'Terminá de rascar el boleto actual', sin_fondos: 'El banco no alcanza para este boleto', no_sentado: 'Tenés que sentarte primero',
  tier_invalido: 'Boleto inválido', celda_invalida: 'Celda inválida', sin_boleto: 'No hay boleto en curso',
  accion_invalida: 'Acción inválida', accion_desconocida: 'Acción desconocida',
};
const TIER_ORDER = ['bronce', 'plata', 'oro'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const chipSrc = (cents) => `assets/chips/chip_${cents / 100}.png`;

function loadStyle(done) {
  let link = document.querySelector('link[data-scr-style]');
  if (!link) {
    link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href; link.dataset.scrStyle = '1';
    document.head.appendChild(link);
  }
  if (link.sheet) done(); else { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); }
}

export function mount(container, ctx) {
  if (!window.gsap) throw new Error('El rasca y gana necesita GSAP cargado como global (window.gsap) antes de montarse.');
  const { chips, audio, fmt } = ctx;
  const quality = ctx.quality === 'baja' ? 'baja' : 'alta';

  const root = document.createElement('section');
  root.className = 'game game--scratch';
  root.style.visibility = 'hidden';
  root.innerHTML = `
    <div class="scr-tiers">${TIER_ORDER.map((t) => `<button type="button" class="scr-tier scr-t-${t}" data-tier="${t}"><b>${TIER_NAMES[t].toUpperCase()}</b><span>${fmt(TIERS[t])}</span></button>`).join('')}</div>
    <div class="scr-stage">
      <div class="scr-ticket scr-t-bronce">
        <div class="scr-head"><span class="scr-title">RASCA Y GANA</span><span class="scr-sub"></span></div>
        <div class="scr-board"><div class="scr-cells">${Array.from({ length: 9 }, () => '<div class="scr-cell"><img alt="" draggable="false"></div>').join('')}</div><div class="scr-flash"></div></div>
        <div class="scr-legend"></div>
      </div>
      <div class="scr-rain"></div>
    </div>
    <div class="scr-msg"></div>
    <div class="scr-ctl"><button type="button" class="scr-all">RASCAR TODO</button><button type="button" class="scr-buy">COMPRAR</button></div>
    <div class="scr-notice"></div>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const stage = $('.scr-stage'), ticket = $('.scr-ticket'), board = $('.scr-board'), cellsEl = $('.scr-cells'), flash = $('.scr-flash');
  const legend = $('.scr-legend'), subEl = $('.scr-sub'), rain = $('.scr-rain'), msgEl = $('.scr-msg');
  const allBtn = $('.scr-all'), buyBtn = $('.scr-buy'), noticeEl = $('.scr-notice');
  const tierBtns = [...root.querySelectorAll('.scr-tier')];
  const cellEls = [...root.querySelectorAll('.scr-cell')], imgEls = cellEls.map((c) => c.querySelector('img'));
  gsap.set(noticeEl, { xPercent: -50 });

  let S = null, selTier = 'bronce', curRound = null, celebrated = true, busy = false, noticeCall = null, celebrateCall = null;
  let msgKey = '', btnKey = '', legendKey = '', shownKey = '';
  const timers = [];

  const cover = createCover({
    quality,
    onPeek: (i) => send({ type: 'peek', cell: i }),
    onDone: (i) => { send({ type: 'reveal', cell: i }); audio.play('chip-lay', { volume: 0.45 }); },
  });
  board.insertBefore(cover.el, flash);

  function send(action) { return Promise.resolve(ctx.send(action)).catch(() => ({ ok: false })); }

  function notice(text) {
    if (noticeCall) noticeCall.kill();
    noticeEl.textContent = text; gsap.killTweensOf(noticeEl);
    gsap.fromTo(noticeEl, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.18 });
    noticeCall = gsap.delayedCall(2, () => gsap.to(noticeEl, { opacity: 0, duration: 0.3 }));
  }
  function errText(e) {
    const L = (S && S.limits) || { min: 25, max: 20000 };
    if (e === 'supera_maximo') return 'Máximo por boleto: ' + fmt(L.max);
    if (e === 'monto_invalido') return 'Mínimo por boleto: ' + fmt(L.min);
    return ERRORES[e] || 'No se pudo completar la acción';
  }

  // ---- Tamaño: el boleto se ajusta al alto libre ----
  function fit() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    const size = clamp(Math.min(W - 40, H - 108), 120, 380);
    board.style.width = board.style.height = Math.floor(size) + 'px';
    cover.resize(size);
    const g = cover.gap();
    cellsEl.style.gap = g + 'px';
  }

  function paintLegend(price) {
    const key = String(price);
    if (key === legendKey) return;
    legendKey = key;
    legend.innerHTML = PRIZE_TABLE.map((r) => `<div class="scr-lg"><img src="${chipSrc(SYMBOLS[r.symbol])}" alt=""><span>${fmt(price * r.mult)}</span></div>`).join('');
  }

  function paintTicket() {
    const t = (S && S.tier) || selTier;
    ticket.className = 'scr-ticket scr-t-' + t;
    subEl.textContent = TIER_NAMES[t].toUpperCase() + ' · ' + fmt(TIERS[t]);
    paintLegend(TIERS[t]);
  }

  // ---- Celebración al terminar de rascar ----
  function highlight() {
    cellEls.forEach((c, i) => c.classList.toggle('is-win', !!(S.winCells && S.winCells.includes(i))));
  }
  function celebrate() {
    celebrated = true; highlight();
    const win = S.prize, bet = S.price;
    if (!win) { audio.play('lose'); render(); return; }
    if (win <= bet) { audio.play('coin'); render(); return; }
    audio.play('bell'); audio.play(S.mult >= 10 ? 'win-big' : 'win-small');
    if (S.mult >= 200) audio.play('jackpot');
    flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on');
    const n = Math.round((S.mult >= 50 ? 26 : S.mult >= 10 ? 16 : 8) * (quality === 'baja' ? 0.5 : 1));
    const W = stage.clientWidth, H = stage.clientHeight;
    for (let i = 0; i < n; i++) { // lluvia de fichas
      const el = chips.stack(win, { max: 1, size: 26 + Math.round(Math.random() * 10), label: false });
      el.classList.add('scr-bit'); rain.appendChild(el);
      gsap.fromTo(el, { x: Math.random() * Math.max(40, W - 40), y: -50, rotation: 0, opacity: 1 },
        { y: H + 50, rotation: (Math.random() - 0.5) * 540, duration: 1.1 + Math.random() * 0.9, delay: Math.random() * 0.6, ease: 'power1.in', onComplete: () => el.remove() });
    }
    if (chips.bankEl && chips.bankEl()) {
      const r = board.getBoundingClientRect();
      timers.push(gsap.delayedCall(0.5, () => chips.fly({ from: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, to: chips.bankEl(), amount: win, count: 5, duration: 0.9 })));
    }
    render();
  }

  // ---- Estado -> pantalla ----
  function syncCells() {
    for (let i = 0; i < 9; i++) {
      const v = S.cells[i];
      const key = v == null ? '' : chipSrc(SYMBOLS[v]);
      if (imgEls[i].dataset.k !== key) { imgEls[i].dataset.k = key; if (key) imgEls[i].src = key; else imgEls[i].removeAttribute('src'); }
      imgEls[i].style.visibility = v == null ? 'hidden' : 'visible';
    }
  }

  function onRound() {
    const first = curRound === null;
    if (S.round !== curRound) {
      curRound = S.round;
      if (celebrateCall) { celebrateCall.kill(); celebrateCall = null; }
      cover.reset(); highlight();
      cellEls.forEach((c) => c.classList.remove('is-win'));
      if (first && S.phase !== 'idle') { // entré tarde: ya está como estaba, sin animar
        for (let i = 0; i < 9; i++) if (S.open[i]) cover.setCleared(i);
        celebrated = true; if (S.phase === 'done') highlight();
        return;
      }
      celebrated = S.phase === 'idle';
    }
    // celdas que el estado ya abrió y la capa todavía tapa (Rascar todo, timeout o levantarse): se limpian en cascada
    let k = 0;
    for (let i = 0; i < 9; i++) if (S.open[i] && !cover.isCleared(i)) { cover.clearCell(i, { delay: k * 70 }); k++; }
    if (S.phase === 'done' && !celebrated && !celebrateCall) {
      celebrateCall = gsap.delayedCall(Math.max(0, k - 1) * 0.07 + 0.4, () => { celebrateCall = null; celebrate(); });
    }
  }

  function render() {
    const live = S.phase === 'scratching';
    cover.setEnabled(live);
    const tier = S.tier || selTier;
    tierBtns.forEach((b) => { b.classList.toggle('is-on', b.dataset.tier === (live || S.phase === 'done' && !celebrated ? S.tier : selTier)); b.disabled = live; });
    let text = 'Elegí un boleto y rascá las fichas', cls = '';
    if (live) text = `Rascá las fichas: 3 iguales ganan  (${S.revealed}/9)`;
    else if (S.phase === 'done') {
      if (!celebrated) text = 'Rascando…';
      else if (S.prize > S.price) { text = `¡Ganaste ${fmt(S.prize)}!  ×${S.mult}`; cls = S.mult >= 200 ? 'is-win is-jackpot' : 'is-win'; }
      else if (S.prize === S.price) text = 'Recuperaste tu boleto';
      else text = 'Sin premio. ¡Probá otro!';
    }
    const mk = text + '|' + cls;
    if (mk !== msgKey) { msgKey = mk; msgEl.textContent = text; msgEl.className = 'scr-msg ' + cls; }
    const waiting = S.phase === 'done' && !celebrated;
    const bk = live + '|' + waiting + '|' + selTier + '|' + S.phase;
    if (bk !== btnKey) {
      btnKey = bk;
      buyBtn.disabled = live || waiting;
      buyBtn.textContent = live ? 'RASCANDO…' : `${S.phase === 'done' ? 'OTRO' : 'COMPRAR'} ${TIER_NAMES[selTier].toUpperCase()} ${fmt(TIERS[selTier])}`;
      allBtn.disabled = !live;
    }
    void tier;
  }

  tierBtns.forEach((b) => b.addEventListener('click', () => {
    if (!S || S.phase === 'scratching') return;
    selTier = b.dataset.tier; btnKey = ''; audio.play('ui-click');
    paintTicket(); render();
  }));

  buyBtn.addEventListener('click', async () => {
    if (busy || !S || S.phase === 'scratching') return;
    busy = true;
    try {
      const res = await ctx.send({ type: 'buy', tier: selTier });
      if (!res || !res.ok) notice(errText(res && res.error)); else audio.play('chips-handle');
    } finally { busy = false; }
  });
  allBtn.addEventListener('click', async () => {
    if (busy || !S || S.phase !== 'scratching') return;
    busy = true;
    try {
      const res = await ctx.send({ type: 'revealAll' });
      if (!res || !res.ok) notice(errText(res && res.error)); else audio.play('chips-stack', { volume: 0.5 });
    } finally { busy = false; }
  });

  const ro = new ResizeObserver(fit);
  ro.observe(stage);
  loadStyle(() => { root.style.visibility = ''; fit(); }); // al final de mount, con todo creado

  return {
    update(state) {
      S = state;
      if (S.tier && TIERS[S.tier] != null && curRound !== S.round) selTier = S.tier;
      if (!board.clientWidth) fit();
      onRound(); syncCells(); paintTicket(); render();
    },
    destroy() {
      ro.disconnect(); timers.forEach((t) => t.kill()); if (noticeCall) noticeCall.kill(); if (celebrateCall) celebrateCall.kill();
      gsap.killTweensOf(noticeEl); gsap.killTweensOf(rain.children); cover.destroy(); root.remove();
    },
  };
}
