// js/ui/tray.js
// Bandeja de apuesta: botón con el monto actual, editor de monto libre (deslizador, número exacto, Mín., Máx., + y -)
// y fila desplazable con las 17 fichas. Tocar una ficha pone su valor como monto; las que no entran (más que el banco o
// que el tope del día, o menos que el mínimo) se ven apagadas. Exporta mountTray(contenedor) -> { destroy, paint }.
// Todo alimenta chips.selected() a través de chips.select().

import { CHIP_VALUES, UNIT, chipUrl, fmt } from '../core/money.js';
import { chips } from './chips.js';
import { audio } from './audio.js';

export function mountTray(root) {
  const scroller = root.querySelector('.tray__scroll');
  const toggle = root.querySelector('#bet-toggle');
  const toggleValue = root.querySelector('#bet-toggle-value');
  const editor = root.querySelector('#bet-editor');
  const amountOut = root.querySelector('#bet-amount');
  const rangeEl = root.querySelector('#bet-range');
  const slider = root.querySelector('#bet-slider');
  const input = root.querySelector('#bet-input');
  const buttons = new Map();

  for (const value of CHIP_VALUES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tray__chip';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-label', `Ficha de ${fmt(value)}`);
    const img = document.createElement('img');
    img.src = chipUrl(value);
    img.alt = '';
    img.width = 52; img.height = 52;
    btn.append(img);
    btn.addEventListener('click', () => {
      if (!chips.affordable(value)) return;
      chips.select(value);
      audio.play('chip-lay', { volume: 0.7 });
    });
    scroller.append(btn);
    buttons.set(value, btn);
  }

  // Paso de los botones + y -: un 5% del tope, en múltiplos de $0,25
  const step = () => Math.max(25, Math.round(chips.limits().cap * 0.05 / 25) * 25);

  toggle.addEventListener('click', () => {
    editor.hidden = !editor.hidden;
    toggle.setAttribute('aria-expanded', String(!editor.hidden));
    paint();
  });
  slider.addEventListener('input', () => chips.select(Number(slider.value)));
  input.addEventListener('change', () => chips.select(Math.round(Number(input.value) * UNIT)));
  editor.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]');
    if (!q) return;
    const { min, cap } = chips.limits();
    const now = chips.selected() || min;
    const next = { min, max: cap, minus: now - step(), plus: now + step() }[q.dataset.q];
    chips.select(next);
    audio.play('chip-lay', { volume: 0.5 });
  });

  function paint() {
    const sel = chips.selected();
    const { min, cap } = chips.limits();
    for (const [value, btn] of buttons) {
      const off = !chips.affordable(value);
      btn.classList.toggle('is-off', off);
      btn.classList.toggle('is-selected', value === sel);
      btn.setAttribute('aria-selected', String(value === sel));
      btn.setAttribute('aria-disabled', String(off));
    }
    toggleValue.textContent = sel ? fmt(sel) : '—';
    amountOut.textContent = sel ? fmt(sel) : 'Sin fondos';
    rangeEl.textContent = cap >= min ? `Mínimo ${fmt(min)}, máximo ${fmt(cap)}` : 'El banco no alcanza para apostar';
    slider.min = String(min);
    slider.max = String(Math.max(min, cap));
    slider.value = String(sel || min);
    slider.disabled = cap < min;
    if (document.activeElement !== input) input.value = sel ? String(sel / UNIT) : '';
    input.min = String(min / UNIT);
    input.max = String(cap / UNIT);
    const current = buttons.get(sel);
    if (current && !root.hidden) {
      // Se centra la ficha elegida moviendo solo la bandeja (no la página)
      scroller.scrollTo({ left: current.offsetLeft - scroller.clientWidth / 2 + current.offsetWidth / 2, behavior: 'smooth' });
    }
  }

  const off = chips.onChange(paint);
  paint();
  return { destroy: off, paint };
}
