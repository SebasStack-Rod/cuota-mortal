// js/ui/hud.js
// Barra superior (banco, cuota, día, cronómetro y barra de progreso) y barra inferior de la mesa (4 botones).
// Exporta mountHud({ serverNow, onAction }) -> { render(state), setVisible(bool), setBarVisible(bool), reset() }.
// El número del banco cuenta hacia arriba o abajo y, al cambiar, salen o entran fichas volando (chips.fly).

import { fmt } from '../core/money.js';
import { chips } from './chips.js';
import { limitsFor } from './limits.js';

const DANGER_MS = 30000;

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function mountHud({ serverNow = Date.now, onAction = () => {} } = {}) {
  const top = document.getElementById('hud-top');
  const bankStack = document.getElementById('hud-bank-stack');
  const bankVal = document.getElementById('hud-bank');
  const quotaVal = document.getElementById('hud-quota');
  const limitEl = document.getElementById('hud-limit');
  const dayEl = document.getElementById('hud-day');
  const timerEl = document.getElementById('hud-timer');
  const fill = document.getElementById('hud-fill');
  const progress = document.getElementById('hud-progress');
  const bar = document.getElementById('hud-bar');
  const tray = document.getElementById('tray');

  chips.registerBank(bankStack);

  let state = null;
  let shown = 0;                 // valor que se ve en pantalla mientras cuenta
  let prevBank = null;
  let lastFly = 0;
  let timerId = null;
  const counter = { v: 0 };

  function paintBankNumber(v) {
    shown = v;
    bankVal.textContent = fmt(Math.round(v));
  }

  function animateBank(to) {
    const g = window.gsap;
    if (!g) { paintBankNumber(to); return; }
    g.killTweensOf(counter);
    counter.v = shown;
    g.to(counter, { v: to, duration: 0.6, ease: 'power2.out', onUpdate: () => paintBankNumber(counter.v) });
  }

  function flyChange(delta) {
    const now = Date.now();
    if (Math.abs(delta) < 25 || now - lastFly < 350) return;   // no se satura la pantalla
    lastFly = now;
    const center = { x: window.innerWidth / 2, y: window.innerHeight * 0.55 };
    const count = Math.min(8, 2 + Math.floor(Math.log10(Math.abs(delta) / 100 + 1) * 3));
    if (delta > 0) chips.fly({ from: center, to: bankStack, amount: delta, count });
    else chips.fly({ from: bankStack, to: center, amount: -delta, count });
  }

  function remaining() {
    if (!state) return null;
    const end = state.phase === 'day' ? state.dayEndsAt : state.phase === 'shop' ? state.shopEndsAt : null;
    return end ? end - serverNow() : null;
  }

  function paintTimer() {
    const left = remaining();
    timerEl.textContent = left == null ? '--:--' : clock(left);
    const danger = !!state && state.phase === 'day' && left != null && left <= DANGER_MS && state.bank < state.quota;
    timerEl.classList.toggle('is-danger', danger);
    top.classList.toggle('is-danger', danger);
  }

  function render(next) {
    state = next;
    if (!state) return;
    const bank = state.bank;
    chips.setLimits(limitsFor(state));
    chips.setBank(bank);

    if (prevBank === null) { paintBankNumber(bank); }
    else if (bank !== prevBank) { animateBank(bank); flyChange(bank - prevBank); }
    if (prevBank === null || bank !== prevBank) {
      bankStack.replaceChildren(chips.stack(bank, { max: 3, size: 28, label: false, cols: 2 }));
    }
    prevBank = bank;

    // DECISIÓN: en la tienda se muestra la cuota del día siguiente (state.nextQuota, pedido de cambio 7) si la sesión la trae
    const quota = state.phase === 'shop' && state.nextQuota != null ? state.nextQuota : state.quota;
    quotaVal.textContent = fmt(quota);
    if (limitEl) limitEl.textContent = state.phase === 'day' ? `Apuesta máx. ${fmt(limitsFor(state).max)}` : '';
    dayEl.textContent = `Día ${state.day}/7`;
    const pct = quota > 0 ? Math.min(100, Math.round((bank / quota) * 100)) : 100;
    fill.style.width = pct + '%';
    fill.classList.toggle('is-covered', bank >= quota);
    progress.setAttribute('aria-valuenow', String(pct));
    progress.setAttribute('aria-valuetext', `El banco cubre el ${pct}% de la cuota`);
    paintTimer();
  }

  function setVisible(visible) {
    top.hidden = !visible;
    clearInterval(timerId);
    if (visible) timerId = setInterval(() => { if (!document.hidden) paintTimer(); }, 250);
  }

  function setBarVisible(visible) {
    bar.hidden = !visible;
    tray.hidden = !visible;
  }

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) onAction(btn.dataset.act);
  });

  // Al salir de la sala se olvida el banco anterior (para que la próxima sala no dispare fichas voladoras)
  function reset() { state = null; prevBank = null; }

  return { render, setVisible, setBarVisible, reset };
}
