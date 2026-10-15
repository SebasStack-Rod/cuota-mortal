// js/games/roulette/view.js: vista de la ruleta. Dibuja SIEMPRE desde el estado público (no guarda verdad propia).
// Rueda en Canvas (wheel.js), mesa HTML (table.js) y efectos del resultado (effects.js). Usa GSAP global (window.gsap).
// Si alguien entra a mitad de ronda, todo se calcula con phaseEndsAt, spin.startedAt y clock.now().
// Exporta mount(container, ctx) -> { update(state, info), destroy() }.
import { colorOf, RESULT_MS } from './constants.js';
import { prepareSpin, ballPoseAt, wheelAngleAt, idleAngleAt, POCKET_ANGLE, R_REST } from './spinmath.js';
import { createWheel, WHEEL_FILL } from './wheel.js';
import { createTable } from './table.js';
import { createEffects } from './effects.js';
import { createAmountPicker } from '../amount.js';

const ERRORES = {
  sin_fondos: 'El banco no alcanza', apuestas_cerradas: 'Apuestas cerradas', monto_invalido: 'Monto inválido',
  no_sentado: 'Tenés que sentarte primero', demasiadas_fichas: 'Demasiadas fichas en esta ronda',
  demasiados_lugares: 'Demasiados lugares distintos', nada_que_deshacer: 'No hay nada para deshacer',
  sin_apuestas_previas: 'No hay apuestas anteriores', ya_apostaste: 'Ya apostaste en esta ronda',
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FRAME_URL = 'assets/ui/kenney-fantasy/default/border/panel-border-008.png';

function loadStyle(done) { // el CSS vive en la carpeta del juego; las imágenes se asignan desde JS (rutas relativas al sitio)
  let link = document.querySelector('link[data-rou-style]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.rouStyle = '1';
    document.head.appendChild(link);
  }
  if (link.sheet) done();
  else { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); }
}

export function mount(container, ctx) {
  if (!window.gsap) throw new Error('La ruleta necesita GSAP cargado como global (window.gsap) antes de montarse.');
  const { chips, audio, clock, fmt } = ctx;
  const quality = ctx.quality === 'baja' ? 'baja' : 'alta';
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduce = !!(mq && mq.matches);
  const onMq = () => { reduce = !!mq.matches; };
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);

  const root = document.createElement('section');
  root.className = 'game game--roulette';
  root.style.visibility = 'hidden'; // hasta que cargue el CSS
  root.innerHTML = `
    <div class="rou-carpet"></div>
    <div class="rou-hud">
      <div class="rou-minislot"></div>
      <div class="rou-history"></div>
      <div class="rou-timer"><div class="rou-timer-num">--</div><div class="rou-timer-lbl"></div><div class="rou-mybet"></div></div>
    </div>
    <div class="rou-tablezone"><div class="rou-felt"></div><div class="rou-frame"></div></div>
    <div class="rou-controls">
      <button type="button" class="rou-btn" data-act="undo">↶ Deshacer</button>
      <button type="button" class="rou-btn" data-act="clear">✕ Borrar</button>
      <button type="button" class="rou-btn" data-act="rebet">⟳ Repetir</button>
    </div>
    <div class="rou-wheelhost"></div>
    <div class="rou-layer"></div>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const hud = $('.rou-hud'), slot = $('.rou-minislot'), histEl = $('.rou-history'), timer = $('.rou-timer');
  const timerNum = $('.rou-timer-num'), timerLbl = $('.rou-timer-lbl'), myBetEl = $('.rou-mybet');
  const felt = $('.rou-felt'), frame = $('.rou-frame'), host = $('.rou-wheelhost'), layer = $('.rou-layer');

  // Adornos con imágenes (rutas relativas, sin barra inicial): alfombra oscura del tileset y marco dorado de Kenney.
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 40, 72, 32, 32, 0, 0, 32, 32);
      $('.rou-carpet').style.backgroundImage = `url(${c.toDataURL()})`;
    } catch (e) { /* sin alfombra: queda el color liso */ }
  };
  img.src = 'assets/tileset/tileset_1024x512.png';
  const maskVal = `url(${FRAME_URL}) 14 / 14px / 0 stretch`;
  if (window.CSS && (CSS.supports('-webkit-mask-box-image', maskVal) || CSS.supports('mask-border', maskVal))) {
    frame.style.setProperty('-webkit-mask-box-image', maskVal);
    frame.style.setProperty('mask-border', maskVal);
    frame.classList.add('is-masked');
  }

  const wheel = createWheel({ quality });
  host.appendChild(wheel.el);
  const table = createTable({ chips, fmt, onSpot });
  felt.appendChild(table.el);
  const picker = createAmountPicker({ chips, fmt }); // monto libre (o la ficha de la bandeja)
  $('.rou-controls').appendChild(picker.btn);
  root.appendChild(picker.pop);
  const effects = createEffects({ layer, root, table, chips, quality, getReduce: () => reduce });

  // ---- Estado ----
  let S = null, I = null, lastPhaseKey = null, firstSync = true, lastHist = '', chipSize = 24;
  let mode = 'mini', W = 0, H = 0, bigT = { x: 0, y: 0, s: 1 }, miniT = { x: 0, y: 0, s: 1 };
  let raf = 0, lastDraw = 0, lastSecs = -1, lastTimerKey = '';
  let prepKey = null, prep = null, snd = { key: null };
  const timers = [];

  const you = () => (I && I.you) || ctx.playerId;

  // ---- Medidas y posición de la rueda ----
  function layout() {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    W = w; H = h;
    const mini = clamp(Math.round(h * 0.095), 48, 84);
    root.style.setProperty('--rou-mini', mini + 'px');
    const diameter = Math.min(w - 12, h * 0.62);                // diámetro visible de la rueda grande
    const big = Math.round(diameter / WHEEL_FILL);               // lado del canvas
    wheel.resize(big);
    host.style.width = host.style.height = big + 'px';
    const rr = root.getBoundingClientRect(), sr = slot.getBoundingClientRect();
    const s = mini / (WHEEL_FILL * big);
    const cx = sr.left - rr.left + sr.width / 2, cy = sr.top - rr.top + sr.height / 2;
    miniT = { x: cx - (big * s) / 2, y: cy - (big * s) / 2, s };
    bigT = { x: (w - big) / 2, y: 6 - (big * (1 - WHEEL_FILL)) / 2, s: 1 };
    effects.setSignTop(bigT.y + big * (0.5 + WHEEL_FILL / 2) + 2);
    const row = table.rowHeight();
    root.style.setProperty('--rou-row', row.toFixed(1) + 'px');
    const size = clamp(Math.round(row * 0.85), 18, 40);
    const changed = size !== chipSize;
    chipSize = size;
    setWheelMode(mode, false);
    if (changed && S) syncBets(false);
  }

  function setWheelMode(m, animate) {
    mode = m;
    const t = m === 'big' ? bigT : miniT;
    hud.classList.toggle('is-hidden', m === 'big');
    if (!animate || reduce) gsap.set(host, { x: t.x, y: t.y, scale: t.s, transformOrigin: '0 0' });
    else gsap.to(host, { x: t.x, y: t.y, scale: t.s, transformOrigin: '0 0', duration: 0.7, ease: 'power3.inOut', overwrite: true });
  }

  // ---- Apuestas ----
  function errText(e) {
    const L = (S && S.limits) || { min: 25, max: 20000 };
    if (e === 'supera_maximo') return 'Máximo por ronda: ' + fmt(L.max);
    if (e === 'monto_invalido') return 'Mínimo por apuesta: ' + fmt(L.min);
    return ERRORES[e] || 'No se pudo completar la acción';
  }

  async function onSpot(spot, cellEl) {
    if (!S || S.phase !== 'betting') { effects.notice('Apuestas cerradas'); return; }
    const amount = picker.get();
    if (!amount) { effects.notice('Elegí una ficha o escribí un monto'); return; }
    const res = await ctx.send({ type: 'bet', spot, amount });
    if (!res || !res.ok) { effects.notice(errText(res && res.error)); return; }
    audio.play('chip-lay');
    if (!reduce) { // DECISIÓN: la bandeja de fichas está justo debajo del contenedor; la ficha sale de ahí
      const rr = root.getBoundingClientRect();
      chips.fly({ from: { x: rr.left + rr.width / 2, y: rr.bottom + 24 }, to: cellEl, amount, count: 1, duration: 0.35 });
    }
  }

  root.querySelectorAll('.rou-btn').forEach((b) => b.addEventListener('click', async () => {
    const res = await ctx.send({ type: b.dataset.act });
    if (!res || !res.ok) effects.notice(errText(res && res.error));
    else audio.play('chips-handle');
  }));

  function syncBets(animate) {
    table.setBets(S.bets || {}, (I && I.players) || {}, you(), chipSize, animate);
    const mine = (S.bets && S.bets[you()]) || {};
    const total = Object.values(mine).reduce((a, b) => a + b, 0);
    const L = S.limits || { min: 25, max: 20000 };
    picker.setLimits({ minBet: L.min, maxBet: L.max }, total);
    myBetEl.textContent = total ? fmt(total) + ' / ' + fmt(L.max) : 'máx ' + fmt(L.max);
  }

  function renderHistory() {
    const key = (S.history || []).join(',');
    if (key === lastHist) return;
    lastHist = key;
    histEl.textContent = '';
    (S.history || []).forEach((n, i) => {
      const b = document.createElement('span');
      b.className = 'rou-hball is-' + colorOf(n) + (i === 0 ? ' is-new' : '');
      b.textContent = String(n);
      histEl.appendChild(b);
    });
  }

  // ---- Fases ----
  function schedule(atMs, fn, elapsed) { // si ya pasó ese momento (entraste tarde) se aplica el estado final sin animar
    const d = atMs - elapsed;
    if (d <= 0) fn(true);
    else timers.push(gsap.delayedCall(d / 1000, () => fn(false)));
  }
  function clearTimers() { timers.forEach((t) => t.kill()); timers.length = 0; }
  function stopLoop() { if (snd.loop) { snd.loop.stop(); snd.loop = null; } }

  function onPhase(first) {
    clearTimers(); effects.reset(); stopLoop();
    if (S.phase === 'betting') {
      table.resetRound(); table.clearHighlight(); table.setMode('open');
      setWheelMode('mini', !first);
    } else if (S.phase === 'spinning') {
      table.setMode('dim'); table.clearHighlight();
      setWheelMode('big', !first);
    } else {
      table.setMode('closed');
      if (first) setWheelMode('big', false);
      runResult();
    }
  }

  function runResult() {
    const n = S.result;
    if (n == null) return;
    const elapsed = clock.now() - (S.phaseEndsAt - RESULT_MS);
    const mine = S.payouts && S.payouts[you()];
    schedule(0, (inst) => { effects.showSign(n, inst); table.highlight(n); }, elapsed);
    schedule(2300, (inst) => setWheelMode('mini', !inst), elapsed);
    schedule(2550, (inst) => effects.hideSign(inst), elapsed);
    schedule(2900, (inst) => {
      const had = effects.sweepLosers(n, inst);
      if (!inst && had && mine && mine.stake > 0 && mine.payout === 0) audio.play('lose');
    }, elapsed);
    schedule(3900, (inst) => {
      effects.payWinners(n, inst);
      if (!inst && mine && mine.payout > 0) audio.play(mine.payout >= mine.stake * 10 ? 'win-big' : 'win-small');
    }, elapsed);
  }

  // ---- Sonidos del giro (solo se disparan si se ve el momento, no al entrar tarde) ----
  function spinSounds(pose, tNow) {
    const sp = S.spin;
    if (snd.key !== sp.startedAt) {
      stopLoop();
      snd = { key: sp.startedAt, lastIdx: null, lastTick: 0, dropped: pose.phase !== 'track', loop: null };
      if (!reduce && (tNow - sp.startedAt) < 1200) snd.loop = audio.loop('roulette-wheel');
    }
    if (snd.loop && pose.phase === 'rest') stopLoop();
    if (!snd.dropped && pose.phase !== 'track') { snd.dropped = true; audio.play('roulette-ball-drop'); }
    if (pose.phase === 'drop') {
      const idx = Math.floor((pose.rel + Math.PI / 2) / POCKET_ANGLE + 0.5);
      if (snd.lastIdx !== null && idx !== snd.lastIdx && tNow - snd.lastTick > 45) {
        audio.play('roulette-ball-tick', { volume: 0.5 + 0.5 * (1 - pose.hop * 10) });
        snd.lastTick = tNow;
      }
      snd.lastIdx = idx;
    }
  }

  function updateTimer(nowMs) {
    const left = Math.max(0, S.phaseEndsAt - nowMs);
    let num = '', lbl = '', hot = false;
    if (S.phase === 'betting') {
      const secs = Math.ceil(left / 1000);
      num = String(secs); lbl = 'APOSTÁ'; hot = secs <= 5;
      if (hot && secs !== lastSecs && secs >= 1) audio.play('countdown-tick');
      lastSecs = secs;
    } else if (S.phase === 'spinning') { num = '··'; lbl = 'GIRANDO'; lastSecs = -1; }
    else { num = S.result == null ? '' : String(S.result); lbl = 'SALIÓ'; lastSecs = -1; }
    const key = num + '|' + lbl + '|' + hot;
    if (key === lastTimerKey) return;
    lastTimerKey = key;
    timerNum.textContent = num; timerLbl.textContent = lbl;
    timer.classList.toggle('is-hot', hot);
  }

  // ---- Bucle de dibujo ----
  function frame_(ts) {
    raf = requestAnimationFrame(frame_);
    if (!S || document.hidden) return;
    const inRound = (S.phase === 'spinning' || S.phase === 'result') && S.spin && S.result != null;
    const calm = mode === 'mini' && !inRound;
    const minGap = reduce ? 250 : calm ? (quality === 'baja' ? 66 : 33) : 0; // la rueda chiquita no necesita 60 fps
    if (ts - lastDraw < minGap) return;
    lastDraw = ts;
    const now = clock.now();
    updateTimer(now);
    let angle = S.spin ? wheelAngleAt(S.spin, now) : idleAngleAt(now);
    if (reduce && S.spin) angle = S.spin.wheelStartAngle;
    let ball = null, trail = null, glow = null;
    if (inRound) {
      const key = S.spin.startedAt + ':' + S.result;
      if (prepKey !== key) { prepKey = key; prep = prepareSpin(S.spin, S.result); }
      if (reduce) {
        if (S.phase === 'result') ball = { angle: angle + prep.target, r: R_REST, hop: 0, phase: 'rest' };
      } else {
        ball = ballPoseAt(prep, S.spin, now);
        spinSounds(ball, now);
        if (quality !== 'baja' && ball.phase !== 'rest') {
          trail = [];
          for (let k = 1; k <= 6; k++) trail.push(ballPoseAt(prep, S.spin, now - k * 3));
        }
      }
      if (S.phase === 'result') glow = { idx: prep.idx, a: 0.5 + 0.5 * Math.sin(now / 160) };
    }
    wheel.draw({ angle, ball, trail, glow, time: now });
  }

  function onVis() {
    if (document.hidden) stopLoop();
    else { snd.lastIdx = null; lastDraw = 0; }
  }
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  raf = requestAnimationFrame(frame_);
  loadStyle(() => { root.style.visibility = ''; layout(); }); // al final: usa wheel, table y effects, que ya existen

  return {
    update(state, info) {
      S = state; I = info;
      if (!W) layout();
      const key = state.phase + ':' + state.round;
      if (key !== lastPhaseKey) {
        const first = lastPhaseKey === null;
        lastPhaseKey = key;
        onPhase(first);
      }
      syncBets(!firstSync);
      firstSync = false;
      renderHistory();
      root.querySelectorAll('.rou-btn').forEach((b) => { b.disabled = state.phase !== 'betting'; });
    },
    destroy() {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
      ro.disconnect(); clearTimers(); stopLoop();
      gsap.killTweensOf(host);
      picker.destroy(); effects.destroy(); table.destroy(); wheel.destroy();
      root.remove();
    },
  };
}
