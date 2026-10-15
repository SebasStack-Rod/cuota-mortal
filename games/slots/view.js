// js/games/slots/view.js: vista de la tragamonedas (modo solo: muestra la máquina del propio jugador).
// Dibuja SIEMPRE desde el estado: la posición de cada rodillo sale de prev, reels, spinStartedAt, spinEndsAt y clock.now(),
// así que quien entra a mitad de un giro ve el momento correcto. Usa GSAP global (window.gsap).
// Exporta mount(container, ctx) -> { update(state, info), destroy() }.
import { STRIP, STOP_GAP_MS, computeRtp } from './logic.js';
import { createMachine, SW, SH } from './machine.js';
import { createAmountPicker } from '../amount.js';

const ERRORES = {
  girando: 'Ya está girando', sin_fondos: 'El banco no alcanza', no_sentado: 'Tenés que sentarte primero',
  accion_invalida: 'Acción inválida', accion_desconocida: 'Acción desconocida',
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mod = (a, m) => ((a % m) + m) % m;

function loadStyle(done) {
  let link = document.querySelector('link[data-slt-style]');
  if (!link) {
    link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href; link.dataset.sltStyle = '1';
    document.head.appendChild(link);
  }
  if (link.sheet) done(); else { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); }
}

export function mount(container, ctx) {
  if (!window.gsap) throw new Error('La tragamonedas necesita GSAP cargado como global (window.gsap) antes de montarse.');
  const { chips, audio, clock, fmt } = ctx;
  const quality = ctx.quality === 'baja' ? 'baja' : 'alta';
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduce = !!(mq && mq.matches);
  const onMq = () => { reduce = !!mq.matches; };
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);

  const root = document.createElement('section');
  root.className = 'game game--slots';
  root.style.visibility = 'hidden';
  root.innerHTML = `
    <div class="slt-wrap"><div class="slt-rain"></div><div class="slt-pay"></div></div>
    <div class="slt-msg"></div>
    <div class="slt-ctl"><button type="button" class="slt-info" aria-label="Tabla de pagos">i</button><button type="button" class="slt-go">GIRAR</button></div>
    <div class="slt-notice"></div>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const wrap = $('.slt-wrap'), rain = $('.slt-rain'), pay = $('.slt-pay'), msgEl = $('.slt-msg'), goBtn = $('.slt-go'), infoBtn = $('.slt-info'), noticeEl = $('.slt-notice');
  gsap.set(noticeEl, { xPercent: -50 });

  const machine = createMachine({ quality });
  wrap.insertBefore(machine.el, rain);
  const picker = createAmountPicker({ chips, fmt });
  $('.slt-ctl').insertBefore(picker.btn, goBtn);
  root.appendChild(picker.pop);

  const sym = (n) => `<img src="assets/slots/pixel-fantasy/slot-symbol${n}.png" alt="">`;
  pay.innerHTML = `<h4>TABLA DE PAGOS (línea central)</h4>
    <div class="row">${sym(1)}${sym(1)}${sym(1)}<b>×50</b></div>
    <div class="row">${sym(3)}${sym(3)}${sym(3)}<b>×20</b></div>
    <div class="row">${sym(4)}${sym(4)}${sym(4)}<b>×10</b></div>
    <div class="row">${sym(2)}${sym(2)}${sym(2)}<b>×6</b></div>
    <div class="row">${sym(2)}${sym(2)}<span>y cualquier cosa</span><b>×2</b></div>
    <div class="row">${sym(2)}<span>primero, sin cereza al lado</span><b>×1</b></div>
    <div class="note">El número es lo que te devuelven por cada $1 apostado (×1 devuelve tu apuesta). A la larga la máquina devuelve cerca del ${(computeRtp() * 100).toFixed(0)}%. Tocá en cualquier lugar para cerrar.</div>`;
  infoBtn.addEventListener('click', () => pay.classList.toggle('is-open'));
  pay.addEventListener('click', () => pay.classList.remove('is-open'));

  let S = null, I = null, prev = null, raf = 0, lastDraw = 0, leverTimer = 0, noticeCall = null, msgKey = '', goKey = '', busy = false;
  let stopped = [true, true, true], stopRound = -1;
  let W = 0, H = 0;
  const timers = [];

  function fit() {
    W = wrap.clientWidth; H = wrap.clientHeight;
    if (!W || !H) return;
    const s = Math.min(W / SW, H / SH);
    machine.el.style.transform = `translate(${(W - SW * s) / 2}px,${(H - SH * s) / 2}px) scale(${s})`;
  }

  function notice(text) {
    if (noticeCall) noticeCall.kill();
    noticeEl.textContent = text; gsap.killTweensOf(noticeEl);
    gsap.fromTo(noticeEl, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.18 });
    noticeCall = gsap.delayedCall(1.9, () => gsap.to(noticeEl, { opacity: 0, duration: 0.3 }));
  }
  function errText(e) {
    const L = (S && S.limits) || { min: 25, max: 20000 };
    if (e === 'supera_maximo') return 'Máximo por giro: ' + fmt(L.max);
    if (e === 'monto_invalido') return 'Mínimo por giro: ' + fmt(L.min);
    return ERRORES[e] || 'No se pudo girar';
  }

  function pull() { // la palanca baja y sube
    if (reduce) return;
    machine.lever(true);
    clearTimeout(leverTimer);
    leverTimer = setTimeout(() => machine.lever(false), 320);
  }

  // Posición de un rodillo (en paradas, con decimales) y su velocidad, en función del tiempo.
  function reelPos(k, now) {
    const L = STRIP.length;
    if (S.phase === 'idle' || S.spinStartedAt == null) return { pos: S.reels[k], speed: 0, u: 1 };
    if (reduce) return { pos: S.phase === 'spinning' ? S.prev[k] : S.reels[k], speed: 0, u: S.phase === 'spinning' ? 0 : 1 };
    const t0 = S.spinStartedAt, tStop = S.spinEndsAt - (2 - k) * STOP_GAP_MS;
    const u = clamp((now - t0) / (tStop - t0), 0, 1);
    const D = (1 + k) * L + mod(S.prev[k] - S.reels[k], L);
    let pos = S.prev[k] - D * (1 - Math.pow(1 - u, 4));
    if (u > 0.88) pos -= 0.14 * Math.sin(Math.PI * ((u - 0.88) / 0.12)); // pequeño rebote al frenar
    return { pos, speed: u >= 1 ? 0 : (D * 4 * Math.pow(1 - u, 3)) / ((tStop - t0) / 1000), u };
  }

  function winInfo() {
    if (S.phase !== 'result' || !S.lastWin || S.lastWin <= 0) return null;
    return { count: S.lastMult >= 6 ? 3 : S.lastMult === 2 ? 2 : 1 };
  }

  // ---- Premio en vivo ----
  function showWin() {
    const mult = S.lastMult, win = S.lastWin, bet = S.amount;
    if (!win) return;
    if (win <= bet) { audio.play('coin'); return; } // 1x: devuelve la apuesta
    audio.play('bell');
    audio.play(mult >= 10 ? 'win-big' : 'win-small');
    if (mult === 50) audio.play('jackpot');
    if (reduce) return;
    const n = (mult === 50 ? 28 : mult >= 10 ? 16 : 8) * (quality === 'baja' ? 0.5 : 1);
    for (let i = 0; i < n; i++) { // lluvia de fichas
      const el = chips.stack(win, { max: 1, size: 26 + Math.round(Math.random() * 10), label: false });
      el.classList.add('slt-bit'); rain.appendChild(el);
      gsap.fromTo(el, { x: Math.random() * Math.max(40, W - 40), y: -50, rotation: 0, opacity: 1 },
        { y: H + 50, rotation: (Math.random() - 0.5) * 540, duration: 1.1 + Math.random() * 0.9, delay: Math.random() * 0.6, ease: 'power1.in', onComplete: () => el.remove() });
    }
    if (chips.bankEl && chips.bankEl()) {
      const r = machine.el.getBoundingClientRect();
      timers.push(gsap.delayedCall(0.5, () => chips.fly({ from: { x: r.left + r.width / 2, y: r.top + r.height * 0.55 }, to: chips.bankEl(), amount: win, count: 5, duration: 0.9 })));
    }
  }

  function onTransition() {
    const now = clock.now();
    if (stopRound !== S.round) { // un giro nuevo: ¿lo vimos empezar o entramos tarde?
      stopRound = S.round;
      const live = S.phase === 'spinning' && now - S.spinStartedAt < 800;
      stopped = live ? [false, false, false] : [true, true, true];
      if (live) { audio.play('slot-spin'); if (!prev || prev.round !== S.round) pull(); }
      if (S.phase === 'spinning' && !live) {
        for (let k = 0; k < 3; k++) stopped[k] = now >= S.spinEndsAt - (2 - k) * STOP_GAP_MS;
      }
    }
    if (prev && prev.round === S.round && prev.phase === 'spinning' && S.phase === 'result') showWin();
    prev = { phase: S.phase, round: S.round };
  }

  // ---- Textos y botón ----
  function render() {
    let text = 'Elegí tu apuesta y tirá de la palanca', cls = '';
    if (S.phase === 'spinning') text = 'Girando…';
    else if (S.phase === 'result') {
      if (S.lastWin > S.amount) { text = `¡Ganaste ${fmt(S.lastWin)}!  ×${S.lastMult}`; cls = S.lastMult === 50 ? 'is-win is-jackpot' : 'is-win'; }
      else if (S.lastWin === S.amount && S.lastWin > 0) text = 'Recuperaste tu apuesta';
      else text = 'Sin premio. ¡Probá de nuevo!';
    }
    const mk = text + '|' + cls;
    if (mk !== msgKey) { msgKey = mk; msgEl.textContent = text; msgEl.className = 'slt-msg ' + cls; }
    const spinning = S.phase === 'spinning';
    const amount = picker.get();
    const gk = spinning + '|' + amount;
    if (gk !== goKey) {
      goKey = gk; goBtn.disabled = spinning || !amount;
      goBtn.textContent = spinning ? 'GIRANDO…' : amount ? 'GIRAR ' + fmt(amount) : 'ELEGÍ FICHA';
    }
    picker.btn.disabled = spinning;
  }

  goBtn.addEventListener('click', async () => {
    if (busy || !S || S.phase === 'spinning') return;
    const amount = picker.get();
    if (!amount) { notice('Elegí una ficha o escribí un monto'); return; }
    busy = true;
    try {
      const res = await ctx.send({ type: 'spin', amount });
      if (!res || !res.ok) notice(errText(res && res.error));
      else { audio.play('chips-handle'); pull(); }
    } finally { busy = false; }
  });

  // ---- Bucle de dibujo ----
  function frame_(ts) {
    raf = requestAnimationFrame(frame_);
    if (!S || document.hidden) return;
    const animating = S.phase !== 'idle';
    if (!animating && ts - lastDraw < 33) return;
    lastDraw = ts;
    const now = clock.now();
    const rp = [0, 1, 2].map((k) => reelPos(k, now));
    for (let k = 0; k < 3; k++) { // sonido al frenar cada rodillo (solo si lo vimos frenar)
      if (!stopped[k] && rp[k].u >= 1) { stopped[k] = true; audio.play('slot-stop', { rate: 1 + k * 0.08 }); }
    }
    machine.drawReels(rp.map((r) => r.pos), rp.map((r) => r.speed));
    const win = winInfo();
    machine.drawFx({ time: now, win, bulbs: win || S.phase === 'spinning' ? 'all' : 'chase' });
    render();
  }

  function onVis() { if (!document.hidden) lastDraw = 0; }
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(fit);
  ro.observe(wrap);
  raf = requestAnimationFrame(frame_);
  loadStyle(() => { root.style.visibility = ''; fit(); });

  return {
    update(state, info) {
      S = state; I = info;
      if (!W) fit();
      onTransition();
      const L = S.limits || { min: 25, max: 20000 };
      picker.setLimits({ minBet: L.min, maxBet: L.max }, 0);
      render();
    },
    destroy() {
      cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
      ro.disconnect(); clearTimeout(leverTimer); timers.forEach((t) => t.kill()); if (noticeCall) noticeCall.kill();
      gsap.killTweensOf(noticeEl); picker.destroy(); machine.destroy(); root.remove();
    },
  };
}
