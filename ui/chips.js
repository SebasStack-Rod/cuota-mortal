// js/ui/chips.js
// Sistema de fichas (sección 7 del contrato). Exporta chips con: selected(), onChange(cb), stack(monto, opts),
// (selected() ahora puede ser cualquier monto libre dentro de los límites del día, no solo una ficha)
// fly({from, to, amount, count, duration}) y bankEl(). Extras para el HUD: setBank, select, affordable, registerBank.
// Las fichas voladoras usan GSAP (se carga en index.html). Si GSAP no está, fly() resuelve al instante.

import { CHIP_VALUES, chipUrl, breakdown, fmt } from '../core/money.js';
import { audio } from './audio.js';
import { prefs } from './prefs.js';

let bank = 0;
let limits = { min: 25, max: Infinity };   // límites de apuesta del día (los pone el HUD con setLimits)
let selected = 0;
let bankNode = null;
let layer = null;
const subs = new Set();

function notify() {
  for (const cb of [...subs]) cb(chips.selected());
}

// Lo máximo que se puede apostar ahora: el menor entre el banco y el tope del día
const cap = () => Math.min(bank, limits.max);

// Si el monto elegido ya no entra, baja a la ficha más grande que sí entra (o a ninguno)
function fixSelection() {
  const top = cap();
  if (selected >= limits.min && selected <= top) return;
  const ok = CHIP_VALUES.filter((v) => v >= limits.min && v <= top);
  const preferred = ok.includes(100) ? 100 : ok[ok.length - 1];   // DECISIÓN: de entrada se elige la ficha de $1
  selected = selected ? ok[ok.length - 1] || 0 : preferred || 0;
}

function pointOf(target) {
  if (target && typeof target.x === 'number') return { x: target.x, y: target.y };
  const r = target.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function getLayer() {
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  return layer;
}

// Lista de valores de ficha para volar: reparte "count" fichas entre las denominaciones del monto
function flyValues(amount, count) {
  const parts = amount > 0 ? breakdown(amount) : [{ value: 100, count: count }];
  const out = [];
  let i = 0;
  while (out.length < count && i < 500) {
    for (const p of parts) if (out.length < count && p.count > Math.floor(i / parts.length)) out.push(p.value);
    i++;
  }
  return out.length ? out : [100];
}

function stack(amount, { max = 6, size = 44, label = true, cols: maxCols = 4 } = {}) {
  const root = document.createElement('div');
  root.className = 'chip-stack';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', fmt(amount));
  const cols = document.createElement('div');
  cols.className = 'chip-stack__cols';
  const step = Math.max(3, Math.round(size * 0.16));
  // Hasta maxCols denominaciones (las más grandes, 4 por defecto); el número exacto va en la etiqueta
  for (const { value, count } of breakdown(amount).slice(0, maxCols)) {
    const shown = Math.min(count, max);
    const col = document.createElement('div');
    col.className = 'chip-stack__col';
    col.style.width = size + 'px';
    col.style.height = size + (shown - 1) * step + 'px';
    col.style.marginLeft = Math.round(-size * 0.2) + 'px';
    for (let i = 0; i < shown; i++) {
      const img = document.createElement('img');
      img.src = chipUrl(value);
      img.alt = '';
      img.width = size; img.height = size;
      img.style.bottom = i * step + 'px';
      col.append(img);
    }
    if (count > max) {
      const more = document.createElement('span');
      more.className = 'chip-stack__more';
      more.textContent = '+' + (count - max);
      col.append(more);
    }
    cols.append(col);
  }
  root.append(cols);
  if (label) {
    const l = document.createElement('span');
    l.className = 'chip-stack__label';
    l.textContent = fmt(amount);
    root.append(l);
  }
  return root;
}

function fly({ from, to, amount = 0, count = 8, duration = 0.9 } = {}) {
  const g = window.gsap;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!g || reduce || !from || !to || document.hidden) return Promise.resolve();
  let n = Math.max(1, count);
  if (prefs.get('quality') === 'baja') n = Math.min(n, 3);   // celulares viejos: menos fichas
  const values = flyValues(amount, n);
  const parent = getLayer();
  audio.play('chips-handle', { volume: 0.7 });

  return new Promise((resolve) => {
    let done = 0;
    values.forEach((value, i) => {
      const a = pointOf(from);
      const b = pointOf(to);
      const mid = { x: (a.x + b.x) / 2 + (Math.random() - 0.5) * 90, y: Math.min(a.y, b.y) - 50 - Math.random() * 70 };
      const el = document.createElement('img');
      el.src = chipUrl(value);
      el.alt = '';
      el.className = 'fx-chip';
      parent.append(el);
      const spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360);
      const p = { t: 0 };
      const place = () => {
        const t = p.t, u = 1 - t;
        const x = u * u * a.x + 2 * u * t * mid.x + t * t * b.x;   // curva de Bézier cuadrática
        const y = u * u * a.y + 2 * u * t * mid.y + t * t * b.y;
        const s = 1 + 0.3 * Math.sin(Math.PI * t);
        el.style.transform = `translate3d(${x - 17}px, ${y - 17}px, 0) rotate(${spin * t}deg) scale(${s})`;
      };
      place();
      g.to(p, {
        t: 1, duration, delay: i * 0.06, ease: 'power2.inOut', onUpdate: place,
        onComplete() {
          if (i % 2 === 0) audio.play('chip-lay', { volume: 0.6 });
          // rebote corto al llegar y desaparece
          const bounce = { k: 0 };
          g.to(bounce, {
            k: 1, duration: 0.16, ease: 'none',
            onUpdate() { el.style.transform = `translate3d(${b.x - 17}px, ${b.y - 17}px, 0) rotate(${spin}deg) scale(${1 + 0.25 * Math.sin(Math.PI * bounce.k)})`; },
            onComplete() { el.remove(); if (++done === values.length) resolve(); },
          });
        },
      });
    });
  });
}

export const chips = {
  // Monto elegido en centavos: puede ser una ficha o cualquier cantidad entre el mínimo y el tope (0 si ninguno entra)
  selected: () => (selected >= limits.min && selected <= cap() ? selected : 0),
  onChange(cb) { subs.add(cb); return () => subs.delete(cb); },
  stack,
  fly,
  bankEl: () => bankNode,
  // Extras (los usan el HUD y la bandeja)
  registerBank(el) { bankNode = el; },
  setBank(cents) { bank = Math.max(0, Math.round(cents)); fixSelection(); notify(); },
  setLimits({ min, max }) { limits = { min, max }; fixSelection(); notify(); },
  limits: () => ({ min: limits.min, max: limits.max, cap: cap() }),
  // Acepta cualquier monto (múltiplo de $0,25) dentro de los límites; lo que se pase se ajusta al rango
  select(cents) {
    const top = cap();
    if (top < limits.min) return;
    const rounded = Math.round(cents / 25) * 25;
    selected = Math.min(top, Math.max(limits.min, rounded));
    notify();
  },
  affordable: (value) => value >= limits.min && value <= cap(),
};
