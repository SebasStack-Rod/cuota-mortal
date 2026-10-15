// dev/sandbox-ctx.js: piezas falsas (mocks) de lo que en el juego real hacen IA 1 y IA 2, solo para probar juegos solos.
// Exporta mulberry32, fmt, makeTray (bandeja de fichas + API `chips` de la sección 7) y makeAudio (registra los sonidos).
// Las funciones de dinero son copia de la sección 3 del contrato (js/core/money.js).
export const UNIT = 100;
export const CHIP_VALUES = [25, 50, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];
export const fmt = (cents) => {
  const v = cents / UNIT;
  return '$' + v.toLocaleString('es-AR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
};
export const chipUrl = (cents) => `assets/chips/chip_${cents / UNIT}.png`;
export function breakdown(cents) {
  const out = []; let rest = Math.round(cents);
  for (let i = CHIP_VALUES.length - 1; i >= 0; i--) {
    const n = Math.floor(rest / CHIP_VALUES[i]);
    if (n > 0) { out.push({ value: CHIP_VALUES[i], count: n }); rest -= n * CHIP_VALUES[i]; }
  }
  return out;
}

export function mulberry32(a) { // RNG con semilla: misma semilla, misma partida
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeAudio(onSound) {
  return {
    play(name, opts) { onSound(name, opts); },
    loop(name) { onSound(name + ' (loop)'); return { stop() { onSound(name + ' (stop)'); } }; },
  };
}

// Bandeja simple y la API `chips`. getBank() devuelve el banco; ignoreBank() permite elegir fichas mayores (para probar sin_fondos).
export function makeTray(trayEl, bankElRef, getBank, ignoreBank) {
  const values = [25, 100, 500, 2500, 10000, 50000];
  let chosen = 100;
  const listeners = new Set();
  trayEl.textContent = '';
  const btns = values.map((v) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sb-chip'; b.title = fmt(v);
    b.innerHTML = `<img src="${chipUrl(v)}" alt="${fmt(v)}"><span>${fmt(v)}</span>`;
    b.addEventListener('click', () => { chosen = v; paint(); listeners.forEach((f) => f(chips.selected())); });
    trayEl.appendChild(b);
    return [v, b];
  });
  const paint = () => btns.forEach(([v, b]) => b.classList.toggle('is-on', v === chosen));
  paint();

  function stack(amount, { max = 6, size = 44, label = true } = {}) {
    const box = document.createElement('div');
    box.className = 'sb-stack';
    const list = [];
    for (const { value, count } of breakdown(amount)) for (let i = 0; i < count && list.length < max; i++) list.push(value);
    box.style.width = size + 'px'; box.style.height = size + Math.min(list.length - 1, 5) * 3 + 'px';
    list.slice().reverse().forEach((v, i) => {
      const im = document.createElement('img');
      im.src = chipUrl(v); im.style.cssText = `width:${size}px;height:${size}px;bottom:${i * 3}px`;
      box.appendChild(im);
    });
    if (label) { const t = document.createElement('em'); t.textContent = fmt(amount); box.appendChild(t); }
    return box;
  }

  function point(t) {
    if (t && t.getBoundingClientRect) { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    return t;
  }

  const chips = {
    selected() {
      if (ignoreBank()) return chosen;
      const bank = getBank();
      if (chosen <= bank) return chosen;
      const fit = values.filter((v) => v <= bank).pop();
      return fit || 0;
    },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    stack,
    // duration en SEGUNDOS (como GSAP)
    fly({ from, to, amount, count = 3, duration = 0.8 }) {
      const a = point(from), b = point(to);
      if (!a || !b) return Promise.resolve();
      const top = (breakdown(amount)[0] || { value: 100 }).value;
      const jobs = [];
      for (let i = 0; i < count; i++) {
        const im = document.createElement('img');
        im.src = chipUrl(top); im.className = 'sb-fly';
        document.body.appendChild(im);
        jobs.push(new Promise((res) => {
          gsap.fromTo(im, { x: a.x - 14, y: a.y - 14, scale: 1, opacity: 1 },
            { x: b.x - 14, y: b.y - 14, scale: 0.7, duration, delay: i * 0.08, ease: 'power2.inOut', onComplete: () => { im.remove(); res(); } });
        }));
      }
      return Promise.all(jobs).then(() => {});
    },
    bankEl: () => bankElRef(),
  };
  return chips;
}
