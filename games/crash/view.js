// js/games/crash/view.js: vista del Crash. Dibuja SIEMPRE desde el estado público; el multiplicador sale de startedAt, growth y clock.now().
// Gráfico en Canvas (chart.js), multiplicador gigante, lista de jugadores con su color y botón grande de apostar/retirar.
// Usa GSAP global (window.gsap). Exporta mount(container, ctx) -> { update(state, info), destroy() }.
import { createChart } from './chart.js';
import { createAmountPicker } from '../amount.js';
import { multAt } from './logic.js';

const ERRORES = {
  ya_exploto: 'Ya explotó', no_en_juego: 'Todavía no está corriendo', sin_apuesta: 'No tenés apuesta en esta ronda', ya_retirado: 'Ya te retiraste',
  ya_apostaste: 'Ya apostaste en esta ronda', apuestas_cerradas: 'Apuestas cerradas', sin_fondos: 'El banco no alcanza',
  no_sentado: 'Tenés que sentarte primero', auto_invalido: 'Retiro automático inválido (de 1,01 a 1000)', nada_que_deshacer: 'No hay apuesta para cancelar',
};

function loadStyle(done) { // el CSS vive en la carpeta del juego
  let link = document.querySelector('link[data-cra-style]');
  if (!link) {
    link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href; link.dataset.craStyle = '1';
    document.head.appendChild(link);
  }
  if (link.sheet) done(); else { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); }
}

export function mount(container, ctx) {
  if (!window.gsap) throw new Error('El Crash necesita GSAP cargado como global (window.gsap) antes de montarse.');
  const { chips, audio, clock, fmt } = ctx;
  const quality = ctx.quality === 'baja' ? 'baja' : 'alta';
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduce = !!(mq && mq.matches);
  const onMq = () => { reduce = !!mq.matches; };
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);

  const root = document.createElement('section');
  root.className = 'game game--crash';
  root.style.visibility = 'hidden';
  root.innerHTML = `
    <div class="cra-hist"></div>
    <div class="cra-stage"><div class="cra-center"><div class="cra-mult">1.00x</div><div class="cra-sub"></div></div></div>
    <div class="cra-players"></div>
    <div class="cra-panel">
      <div class="cra-ctl"><input class="cra-auto" type="number" inputmode="decimal" step="0.1" min="1.01" placeholder="Retiro auto ×"></div>
      <button type="button" class="cra-go" disabled>...</button>
    </div>
    <div class="cra-notice"></div>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const histEl = $('.cra-hist'), stage = $('.cra-stage'), center = $('.cra-center'), multEl = $('.cra-mult'), subEl = $('.cra-sub');
  const playersEl = $('.cra-players'), autoEl = $('.cra-auto'), goBtn = $('.cra-go'), noticeEl = $('.cra-notice');
  gsap.set(noticeEl, { xPercent: -50 });

  const picker = createAmountPicker({ chips, fmt });
  $('.cra-ctl').prepend(picker.btn);
  root.appendChild(picker.pop);
  const chart = createChart({ quality });
  stage.insertBefore(chart.el, center);

  let S = null, I = null, prev = null, raf = 0, lastDraw = 0, tickKey = -1, lastSecs = -1, shakeUntil = 0;
  let rowsKey = '', histKey = '', goKey = '', act = null, busy = false, noticeCall = null;
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
    if (e === 'supera_maximo') return 'Máximo por ronda: ' + fmt(L.max);
    if (e === 'monto_invalido') return 'Mínimo por apuesta: ' + fmt(L.min);
    return ERRORES[e] || 'No se pudo completar la acción';
  };

  // ---- Lista de jugadores ----
  function renderRows() {
    const key = JSON.stringify([S.phase, S.round, S.bets, you()]);
    if (key === rowsKey) return;
    rowsKey = key;
    playersEl.textContent = '';
    const pids = Object.keys(S.bets);
    if (!pids.length) {
      const e = document.createElement('div'); e.className = 'cra-empty';
      e.textContent = S.phase === 'betting' ? 'Nadie apostó todavía' : 'Sin apuestas en esta ronda';
      playersEl.appendChild(e); return;
    }
    for (const pid of pids) {
      const b = S.bets[pid];
      const row = document.createElement('div');
      let cls = 'is-in', st = fmt(b.amount) + (b.auto ? ' · auto ' + b.auto.toFixed(2) + 'x' : '');
      if (b.cashedAt != null) { cls = 'is-cash'; st = '✓ ' + b.cashedAt.toFixed(2) + 'x +' + fmt(b.payout); }
      else if (S.phase === 'crashed') { cls = 'is-lost'; st = '✕ −' + fmt(b.amount); }
      else if (S.phase === 'running') st = 'adentro ' + fmt(b.amount);
      row.className = 'cra-row ' + cls + (pid === you() ? ' is-me' : '');
      row.dataset.pid = pid;
      const dot = document.createElement('i'); dot.className = 'cra-dot'; dot.style.background = colorOf(pid);
      const nm = document.createElement('span'); nm.className = 'cra-name'; nm.textContent = nameOf(pid);
      const sv = document.createElement('b'); sv.className = 'cra-st'; sv.textContent = st;
      row.append(dot, nm, sv);
      playersEl.appendChild(row);
    }
  }

  function disintegrate() { // las fichas de quien no se retiró se rompen en pedacitos
    if (reduce) return;
    playersEl.querySelectorAll('.cra-row.is-lost').forEach((row) => {
      const b = S.bets[row.dataset.pid];
      const n = quality === 'baja' ? 2 : 4;
      for (let i = 0; i < n; i++) {
        const bit = chips.stack(b.amount, { max: 1, size: 14, label: false });
        bit.classList.add('cra-bit'); bit.style.left = '40%'; bit.style.top = '3px';
        row.appendChild(bit);
        gsap.fromTo(bit, { x: 0, y: 0, opacity: 1, scale: 1, rotation: 0 },
          { x: (Math.random() - 0.5) * 70, y: 14 + Math.random() * 30, rotation: (Math.random() - 0.5) * 360, opacity: 0, scale: 0.3, duration: 0.6 + Math.random() * 0.4, ease: 'power2.in', onComplete: () => bit.remove() });
      }
    });
  }

  function renderHist() {
    const key = S.history.join(',');
    if (key === histKey) return;
    histKey = key; histEl.textContent = '';
    S.history.forEach((x) => {
      const p = document.createElement('span');
      p.className = 'cra-pill' + (x >= 10 ? ' is-high' : x >= 2 ? ' is-mid' : '');
      p.textContent = x.toFixed(2) + 'x';
      histEl.appendChild(p);
    });
  }

  // ---- Botón principal ----
  function panelModel(now) {
    const mine = S.bets[you()];
    if (S.phase === 'betting') {
      if (mine) return { act: 'cancel', text: 'Cancelar (' + fmt(mine.amount) + ')', cls: 'is-cancel' };
      return { act: 'bet', text: 'Apostar ' + fmt(picker.get() || 0), cls: '' };
    }
    if (S.phase === 'running') {
      if (!mine) return { act: null, text: 'Esperá la próxima ronda', cls: '' };
      if (mine.cashedAt != null) return { act: null, text: 'Retiraste ' + mine.cashedAt.toFixed(2) + 'x · +' + fmt(mine.payout), cls: '' };
      const m = multAt(S.growth, now - S.startedAt);
      return { act: 'cashout', text: 'Retirar ' + fmt(Math.floor(mine.amount * m + 1e-9)), cls: 'is-cash' };
    }
    if (!mine) return { act: null, text: 'Ya empieza otra ronda…', cls: '' };
    if (mine.cashedAt != null) return { act: null, text: 'Cobraste ' + fmt(mine.payout), cls: '' };
    return { act: null, text: 'Perdiste ' + fmt(mine.amount), cls: '' };
  }
  function renderPanel(now) {
    const mdl = panelModel(now);
    const key = mdl.act + '|' + mdl.text + '|' + mdl.cls;
    if (key !== goKey) {
      goKey = key; act = mdl.act;
      goBtn.textContent = mdl.text; goBtn.className = 'cra-go ' + mdl.cls; goBtn.disabled = !mdl.act;
    }
    const mine = S.bets[you()];
    autoEl.disabled = !!mine || S.phase !== 'betting';
    if (mine && mine.auto) autoEl.value = String(mine.auto);
    picker.btn.disabled = autoEl.disabled;
  }

  goBtn.addEventListener('click', async () => {
    if (!act || busy) return;
    busy = true;
    try {
      let action;
      if (act === 'bet') {
        const amount = picker.get();
        if (!amount) { notice('Elegí una ficha o escribí un monto'); return; }
        action = { type: 'bet', amount };
        if (autoEl.value.trim() !== '') {
          const a = Number(autoEl.value);
          if (!Number.isFinite(a) || a < 1.01) { notice(errText('auto_invalido')); return; }
          action.auto = a;
        }
      } else action = { type: act };
      const res = await ctx.send(action);
      if (!res || !res.ok) notice(errText(res && res.error));
      else if (act === 'bet') audio.play('chip-lay');
    } finally { busy = false; }
  });

  // ---- Eventos que se ven en vivo (no al entrar tarde) ----
  function onTransition() {
    const mine = S.bets[you()];
    if (prev && prev.round === S.round) {
      if (prev.mine && prev.mine.cashedAt == null && mine && mine.cashedAt != null) { // me retiré (a mano o automático)
        audio.play(mine.cashedAt >= 5 ? 'win-big' : 'win-small');
        if (!reduce && chips.bankEl && chips.bankEl()) chips.fly({ from: goBtn, to: chips.bankEl(), amount: mine.payout, count: 4, duration: 0.8 });
      }
      if (prev.phase === 'running' && S.phase === 'crashed') { // explotó
        chart.explode(); audio.play('crash-boom');
        if (!reduce) shakeUntil = clock.now() + 450;
        renderRows(); disintegrate();
        if (mine && mine.cashedAt == null) audio.play('lose');
      }
    }
    prev = { phase: S.phase, round: S.round, mine: mine ? { ...mine } : null };
  }

  // ---- Bucle de dibujo ----
  function frame_(ts) {
    raf = requestAnimationFrame(frame_);
    if (!S || document.hidden) return;
    const calm = S.phase === 'betting';
    if (ts - lastDraw < (reduce ? 200 : calm ? 33 : 0)) return;
    lastDraw = ts;
    const now = clock.now();
    let m = 1, t = 0;
    if (S.phase === 'running') { t = (now - S.startedAt) / 1000; m = multAt(S.growth, now - S.startedAt); }
    else if (S.phase === 'crashed') m = S.crashedAt;
    if (S.phase === 'betting') {
      const secs = Math.max(0, Math.ceil((S.phaseEndsAt - now) / 1000));
      multEl.textContent = secs + 's'; subEl.textContent = 'Apuestas abiertas'; multEl.style.color = '';
      if (secs <= 3 && secs >= 1 && secs !== lastSecs) audio.play('countdown-tick');
      lastSecs = secs; tickKey = -1;
    } else {
      multEl.textContent = m.toFixed(2) + 'x';
      multEl.style.color = S.phase === 'crashed' ? '' : m >= 10 ? '#F3D77A' : m >= 5 ? '#FF2BD6' : m >= 2 ? '#22E6FF' : '';
      subEl.textContent = S.phase === 'crashed' ? 'Explotó' : 'Subiendo';
      lastSecs = -1;
      if (S.phase === 'running') { // tic con tono creciente (escala logarítmica: ritmo parejo)
        const k = Math.floor(Math.log(Math.max(1, m)) * 40);
        if (k !== tickKey) { if (tickKey >= 0 && k > 0) audio.play('crash-tick', { rate: Math.min(3, 1 + Math.log2(m) * 0.3), volume: 0.4 }); tickKey = k; }
      }
    }
    center.classList.toggle('is-crash', S.phase === 'crashed');
    chart.draw({ phase: S.phase, t, growth: S.growth, crashedAt: S.crashedAt, time: now });
    renderPanel(now);
    if (now < shakeUntil) { const a = ((shakeUntil - now) / 450) * 7; stage.style.transform = `translate(${(Math.random() - 0.5) * a}px,${(Math.random() - 0.5) * a}px)`; }
    else if (stage.style.transform) stage.style.transform = '';
  }

  function onVis() { if (!document.hidden) { lastDraw = 0; tickKey = -1; } }
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => { if (stage.clientWidth) chart.resize(stage.clientWidth, stage.clientHeight); });
  ro.observe(stage);
  raf = requestAnimationFrame(frame_);
  loadStyle(() => { root.style.visibility = ''; chart.resize(stage.clientWidth, stage.clientHeight); });

  return {
    update(state, info) {
      S = state; I = info;
      if (!chart.el.width && stage.clientWidth) chart.resize(stage.clientWidth, stage.clientHeight);
      onTransition();
      renderRows(); renderHist();
      const mine = S.bets[you()];
      const L = S.limits || { min: 25, max: 20000 };
      picker.setLimits({ minBet: L.min, maxBet: L.max }, mine ? mine.amount : 0);
      renderPanel(clock.now());
    },
    destroy() {
      cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
      ro.disconnect(); if (noticeCall) noticeCall.kill();
      gsap.killTweensOf(noticeEl); picker.destroy(); chart.destroy(); root.remove();
    },
  };
}
