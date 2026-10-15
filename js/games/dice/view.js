// js/games/dice/view.js: vista de los Dados (más o menos de 7). Dibuja SIEMPRE desde el estado público: la posición de los dados sale de
// rolledAt y clock.now() (roll.js), así que quien entra a mitad de la tirada ve el punto exacto. Tres zonas de apuesta, historial de sumas,
// lista de jugadores y botón de dados cargados (reroll). Usa GSAP global solo para avisos y sonidos diferidos. Exporta mount(container, ctx).
import { createDiceStage, hitTimes } from './roll.js';
import { createAmountPicker } from '../amount.js';
import { spotWins, spotMult, BETTING_MS, ROLLING_MS, RESULT_MS } from './logic.js';

const ERRORES = {
  apuestas_cerradas: 'Apuestas cerradas', sin_fondos: 'El banco no alcanza', no_sentado: 'Tenés que sentarte primero',
  lugar_invalido: 'Esa zona no existe', demasiadas_fichas: 'Demasiadas fichas en esta ronda', nada_que_deshacer: 'No hay apuesta para deshacer',
  fuera_de_resultado: 'Solo se puede relanzar con el resultado a la vista', sin_apuestas: 'No tenés apuestas en esta ronda',
  sin_dados_cargados: 'No tenés dados cargados', ya_relanzaste: 'Ya relanzaste en esta ronda',
  nada_que_relanzar: 'No tenés nada que relanzar',
};
const SPOT_UI = { under: { t: 'MENOS DE 7', s: '2 a 6' }, seven: { t: 'SIETE', s: 'solo el 7' }, over: { t: 'MÁS DE 7', s: '8 a 12' } };
const ORDER = ['under', 'seven', 'over'];
const mulTxt = (m) => String(m).replace('.', ',') + 'x';
const catOf = (sum) => (sum < 7 ? 'under' : sum > 7 ? 'over' : 'seven');
const REROLL_SPEED = 1.6;

function loadStyle(done) { // el CSS vive en la carpeta del juego
  let link = document.querySelector('link[data-dic-style]');
  if (!link) {
    link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href; link.dataset.dicStyle = '1';
    document.head.appendChild(link);
  }
  if (link.sheet) done(); else { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); }
}

export function mount(container, ctx) {
  if (!window.gsap) throw new Error('Los Dados necesitan GSAP cargado como global (window.gsap) antes de montarse.');
  const { chips, audio, clock, fmt } = ctx;
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduce = !!(mq && mq.matches);
  const onMq = () => { reduce = !!mq.matches; };
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);

  const root = document.createElement('section');
  root.className = 'game game--dice';
  root.style.visibility = 'hidden';
  root.innerHTML = `
    <div class="dic-hist"></div>
    <div class="dic-felt">
      <div class="dic-bar"><i></i></div>
      <div class="dic-center"><div class="dic-big"></div><div class="dic-sub"></div><div class="dic-me"></div></div>
      <div class="dic-area"><div class="dic-mine"><span class="dic-mine-lbl">Tus dados</span><span class="dic-mine-sum"></span></div></div>
    </div>
    <div class="dic-zones">${ORDER.map((sp) => `<button type="button" class="dic-zone dic-zone--${sp}" data-spot="${sp}">
      <b class="dic-zt">${SPOT_UI[sp].t}</b><span class="dic-zs">${SPOT_UI[sp].s} · paga ${mulTxt(spotMult(sp))}</span>
      <span class="dic-stacks"></span><em class="dic-za"></em></button>`).join('')}</div>
    <div class="dic-players"></div>
    <div class="dic-panel"><button type="button" class="dic-undo" disabled>↶ Deshacer</button><button type="button" class="dic-reroll" hidden>🎲 Relanzar</button></div>
    <div class="dic-notice"></div>`;
  container.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const histEl = $('.dic-hist'), felt = $('.dic-felt'), barEl = $('.dic-bar i'), area = $('.dic-area');
  const bigEl = $('.dic-big'), subEl = $('.dic-sub'), meEl = $('.dic-me'), mineBox = $('.dic-mine'), mineSum = $('.dic-mine-sum');
  const playersEl = $('.dic-players'), undoBtn = $('.dic-undo'), rerollBtn = $('.dic-reroll'), noticeEl = $('.dic-notice');
  const zones = ORDER.map((sp) => root.querySelector(`.dic-zone--${sp}`));
  gsap.set(noticeEl, { xPercent: -50 });

  const picker = createAmountPicker({ chips, fmt });
  $('.dic-panel').prepend(picker.btn);
  root.appendChild(picker.pop);
  const stage = createDiceStage({});
  area.insertBefore(stage.el, mineBox);
  const mineStage = createDiceStage({ small: true, speed: REROLL_SPEED });
  mineBox.insertBefore(mineStage.el, mineSum);
  stage.hide(); mineStage.hide();

  let S = null, I = null, prev = null, raf = 0, noticeCall = null, busy = false;
  let histKey = '', zonesKey = '', rowsKey = '', btnKey = '', centerKey = '', lastSecs = -1, restRound = -1, mineRestKey = '';
  const calls = [];
  const you = () => (I && I.you) || ctx.playerId;
  const nameOf = (pid) => (I && I.players && I.players[pid] && I.players[pid].name) || pid;
  const colorOf = (pid) => (I && I.players && I.players[pid] && I.players[pid].color) || '#F5F1E6';
  const sumOf = (d) => d[0] + d[1];
  const later = (sec, fn) => { if (sec >= 0) calls.push(gsap.delayedCall(sec, fn)); };

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
  const send = async (action) => {
    if (busy) return null;
    busy = true;
    try { const res = await ctx.send(action); if (!res || !res.ok) notice(errText(res && res.error)); return res; } finally { busy = false; }
  };

  const myTotal = () => Object.values(S.bets[you()] || {}).reduce((s, v) => s + v, 0);
  const myDice = () => (S.rerolls && S.rerolls[you()] ? S.rerolls[you()].dice : S.dice);
  function canReroll() {
    if (!S || S.phase !== 'result' || !S.dice || !S.bets[you()] || (S.rerolls && S.rerolls[you()])) return false;
    if (I && Number.isFinite(I.rerolls) && I.rerolls <= 0) return false; // PEDIDO DE CAMBIO: info.rerolls = relanzamientos disponibles (si no viene, se muestra igual)
    const sum = sumOf(S.dice);
    return Object.keys(S.bets[you()]).some((sp) => !spotWins(sp, sum));
  }

  // ---- Historial ----
  function renderHist() {
    const key = S.history.join(',');
    if (key === histKey) return;
    histKey = key; histEl.textContent = '';
    if (!S.history.length) { const e = document.createElement('span'); e.className = 'dic-empty'; e.textContent = 'Todavía no se tiró'; histEl.appendChild(e); return; }
    S.history.forEach((n) => {
      const p = document.createElement('span');
      p.className = 'dic-pill is-' + catOf(n); p.textContent = String(n);
      histEl.appendChild(p);
    });
  }

  // ---- Zonas de apuesta con las fichas de cada jugador ----
  function renderZones() {
    const sum = S.phase === 'result' && S.dice ? sumOf(S.dice) : null;
    const key = JSON.stringify([S.bets, you(), S.phase, sum, S.round]);
    if (key === zonesKey) return;
    zonesKey = key;
    zones.forEach((z, i) => {
      const sp = ORDER[i];
      const stacksEl = z.querySelector('.dic-stacks'); stacksEl.textContent = '';
      const pids = Object.keys(S.bets).filter((pid) => S.bets[pid][sp]);
      pids.slice(0, 8).forEach((pid) => {
        const wrap = document.createElement('span');
        wrap.className = 'dic-stk' + (pid === you() ? ' is-mine' : '');
        wrap.style.setProperty('--pc', colorOf(pid));
        wrap.appendChild(chips.stack(S.bets[pid][sp], { max: 3, size: 24, label: false }));
        stacksEl.appendChild(wrap);
      });
      if (pids.length > 8) { const m = document.createElement('span'); m.className = 'dic-more'; m.textContent = '+' + (pids.length - 8); stacksEl.appendChild(m); }
      const mine = (S.bets[you()] || {})[sp];
      z.querySelector('.dic-za').textContent = mine ? 'Tu apuesta: ' + fmt(mine) : '';
      z.classList.toggle('is-mine', !!mine);
      z.classList.toggle('is-win', sum != null && spotWins(sp, sum));
      z.classList.toggle('is-dim', sum != null && !spotWins(sp, sum));
      z.disabled = S.phase !== 'betting';
    });
  }

  // ---- Lista de jugadores ----
  function renderRows() {
    const key = JSON.stringify([S.bets, S.payouts, S.rerolls && Object.keys(S.rerolls), S.phase, S.round, you()]);
    if (key === rowsKey) return;
    rowsKey = key; playersEl.textContent = '';
    const pids = [...new Set([...Object.keys(S.bets), ...Object.keys(S.payouts || {})])];
    if (!pids.length) {
      const e = document.createElement('div'); e.className = 'dic-empty';
      e.textContent = S.phase === 'betting' ? 'Nadie apostó todavía' : 'Sin apuestas en esta ronda';
      playersEl.appendChild(e); return;
    }
    for (const pid of pids) {
      const tot = Object.values(S.bets[pid] || {}).reduce((s, v) => s + v, 0);
      const pay = S.payouts && S.payouts[pid];
      let cls = 'is-in', st = fmt(tot || (pay ? pay.stake : 0));
      if (S.phase === 'result' && pay) {
        const net = pay.payout - pay.stake;
        cls = net > 0 ? 'is-win' : net < 0 ? 'is-loss' : 'is-even';
        st = (net > 0 ? '+' : net < 0 ? '−' : '±') + fmt(Math.abs(net));
      }
      const row = document.createElement('div');
      row.className = 'dic-row ' + cls + (pid === you() ? ' is-me' : '');
      const dot = document.createElement('i'); dot.className = 'dic-dot'; dot.style.background = colorOf(pid);
      const nm = document.createElement('span'); nm.className = 'dic-name'; nm.textContent = nameOf(pid) + (S.rerolls && S.rerolls[pid] ? ' 🎲' : '');
      const sv = document.createElement('b'); sv.className = 'dic-st'; sv.textContent = st;
      row.append(dot, nm, sv); playersEl.appendChild(row);
    }
  }

  // ---- Botones ----
  function renderButtons() {
    const mine = !!S.bets[you()], betting = S.phase === 'betting', rr = canReroll();
    const key = [mine, betting, rr].join();
    if (key !== btnKey) { btnKey = key; undoBtn.disabled = !(betting && mine); rerollBtn.hidden = !rr; picker.btn.disabled = !betting; }
    const L = S.limits || { min: 25, max: 20000 };
    picker.setLimits({ minBet: L.min, maxBet: L.max }, myTotal());
  }
  zones.forEach((z) => z.addEventListener('click', async () => {
    if (!S || busy) return;
    if (S.phase !== 'betting') { notice(errText('apuestas_cerradas')); return; }
    const amount = picker.get();
    if (!amount) { notice('Elegí una ficha o escribí un monto'); return; }
    const res = await send({ type: 'bet', spot: z.dataset.spot, amount });
    if (res && res.ok) {
      audio.play('chip-lay');
      if (!reduce && chips.bankEl && chips.bankEl()) chips.fly({ from: chips.bankEl(), to: z, amount, count: 2, duration: 0.35 });
    }
  }));
  undoBtn.addEventListener('click', async () => { const r = await send({ type: 'undo' }); if (r && r.ok) audio.play('chips-handle'); });
  rerollBtn.addEventListener('click', () => send({ type: 'reroll' }));

  // ---- Sonidos y eventos que se ven en vivo (no al entrar tarde) ----
  function rollSounds() {
    const el = Math.max(0, clock.now() - S.rolledAt) / 1000;
    audio.play('dice-shake');
    later(0.35 - el, () => audio.play('dice-throw'));
    [0, 1].forEach((i) => hitTimes(i).slice(0, 3).forEach((t, k) => later(t - el, () => audio.play('die-throw', { volume: [0.6, 0.35, 0.2][k] }))));
  }
  function rerollSounds() {
    audio.play('dice-shake');
    hitTimes(0).slice(0, 3).forEach((t, k) => later(t / REROLL_SPEED, () => audio.play('die-throw', { volume: [0.6, 0.35, 0.2][k] })));
  }
  function announce(delay) { // gané o perdí: se dice cuando la tirada ya se vio
    const go = () => {
      const p = S && S.phase === 'result' && S.payouts && S.payouts[you()];
      if (!p) return;
      audio.play(p.payout === 0 ? 'lose' : p.payout >= p.stake * 5 ? 'win-big' : 'win-small');
    };
    if (delay > 0) later(delay, go); else go();
  }
  function onTransition() {
    const me = you(), pay = S.payouts && S.payouts[me], rr = S.rerolls && S.rerolls[me];
    if (prev && prev.round === S.round) {
      if (prev.phase === 'betting' && S.phase === 'rolling') rollSounds();
      if (prev.phase === 'rolling' && S.phase === 'result') announce(0);
      if (!prev.rr && rr) { rerollSounds(); announce(1.5); }
    } else if (prev && prev.phase === 'result' && prev.pay && prev.pay.payout > 0 && !reduce && chips.bankEl && chips.bankEl()) {
      chips.fly({ from: felt, to: chips.bankEl(), amount: prev.pay.payout, count: 4, duration: 0.8 }); // el crédito llega al empezar la ronda nueva
    }
    prev = { phase: S.phase, round: S.round, pay: pay ? { ...pay } : null, rr: !!rr };
  }

  // ---- Bucle de dibujo ----
  function setCenter(big, sub, me, tone) {
    const key = [big, sub, me, tone].join('|');
    if (key === centerKey) return;
    centerKey = key; bigEl.textContent = big; subEl.textContent = sub; meEl.textContent = me;
    bigEl.className = 'dic-big' + (tone ? ' is-' + tone : ''); meEl.className = 'dic-me' + (me && me[0] === '+' ? ' is-win' : me ? ' is-loss' : '');
  }
  function frame_() {
    raf = requestAnimationFrame(frame_);
    if (!S || document.hidden) return;
    const now = clock.now();
    const dur = S.phase === 'betting' ? BETTING_MS : S.phase === 'rolling' ? ROLLING_MS : RESULT_MS;
    const left = S.phaseEndsAt ? Math.max(0, S.phaseEndsAt - now) : dur;
    barEl.style.transform = `scaleX(${Math.min(1, left / dur).toFixed(3)})`;
    barEl.className = S.phase;
    if (S.phase === 'betting') {
      const secs = Math.max(0, Math.ceil(left / 1000));
      setCenter(String(secs), 'Apuestas abiertas', '', '');
      if (secs <= 3 && secs >= 1 && secs !== lastSecs) audio.play('countdown-tick');
      lastSecs = secs;
      stage.hide(); mineStage.hide(); mineBox.classList.remove('is-on'); restRound = -1; mineRestKey = '';
      return;
    }
    lastSecs = -1;
    const t = (now - S.rolledAt) / 1000;
    if (S.phase === 'rolling') {
      if (reduce) stage.rest(S.dice); else stage.draw(t, S.dice);
      setCenter('…', 'Tirando los dados', '', '');
      return;
    }
    // result: dados quietos y suma a la vista
    if (restRound !== S.round) { if (t < ROLLING_MS / 1000 + 0.2 && !reduce) stage.draw(t, S.dice); else { stage.rest(S.dice); restRound = S.round; } }
    const sum = sumOf(S.dice), cat = catOf(sum);
    const p = S.payouts && S.payouts[you()];
    let me = '';
    if (p) { const net = p.payout - p.stake; me = net > 0 ? '+' + fmt(net) : net < 0 ? '−' + fmt(-net) : '±' + fmt(0); }
    const rolling = S.rerolls && S.rerolls[you()] && (now - S.rerolls[you()].at) / 1000 * REROLL_SPEED < 3;
    setCenter(String(sum), SPOT_UI[cat].t, rolling ? '' : me, cat);
    const rr = S.rerolls && S.rerolls[you()];
    mineBox.classList.toggle('is-on', !!rr);
    if (rr) {
      const tr = (now - rr.at) / 1000;
      if (tr * REROLL_SPEED < 3 && !reduce) mineStage.draw(tr, rr.dice);
      else if (mineRestKey !== String(rr.at)) { mineStage.rest(rr.dice); mineRestKey = String(rr.at); }
      mineSum.textContent = rolling ? '' : '= ' + sumOf(rr.dice);
    }
  }
  const ro = new ResizeObserver(() => { stage.resize(area.clientWidth, area.clientHeight); mineStage.resize(mineBox.clientWidth * 0.5, 44); restRound = -1; mineRestKey = ''; });
  ro.observe(area);
  raf = requestAnimationFrame(frame_);
  loadStyle(() => { root.style.visibility = ''; stage.resize(area.clientWidth, area.clientHeight); mineStage.resize(mineBox.clientWidth * 0.5, 44); });

  return {
    update(state, info) {
      S = state; I = info;
      onTransition();
      renderHist(); renderZones(); renderRows(); renderButtons();
    },
    destroy() {
      cancelAnimationFrame(raf);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
      ro.disconnect(); calls.forEach((c) => c && c.kill && c.kill());
      if (noticeCall) noticeCall.kill();
      gsap.killTweensOf(noticeEl); picker.destroy(); stage.destroy(); mineStage.destroy(); root.remove();
    },
  };
}
