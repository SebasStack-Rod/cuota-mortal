// js/games/scratch/cover.js: capa plateada rascable del boleto (Canvas 2D, textura metálica generada por código).
// Se rasca con destination-out al arrastrar; saltan escamas; al pasar del 60% de una celda se limpia sola y avisa con onDone(i).
// Exporta createCover({ quality, onPeek, onDone }) -> { el, resize(size), reset(), setEnabled(b), clearCell(i, opts), setCleared(i), isCleared(i), cellRect(i), burst(i), destroy() }.
const COLS = 3, CELLS = 9, THRESHOLD = 0.6;

export function createCover({ quality = 'alta', onPeek = () => {}, onDone = () => {} } = {}) {
  const maxDpr = quality === 'baja' ? 1 : 2;
  const el = document.createElement('div');
  el.className = 'scr-cover';
  const cv = document.createElement('canvas'), fx = document.createElement('canvas');
  cv.className = 'scr-cv'; fx.className = 'scr-fx';
  el.append(cv, fx);
  const cx = cv.getContext('2d', { willReadFrequently: true }), fc = fx.getContext('2d');

  let S = 0, dpr = 1, gap = 0, cell = 0, tex = null;
  let enabled = false, down = false, last = null, raf = 0, lastCheck = 0;
  const cleared = new Array(CELLS).fill(false), peeked = new Array(CELLS).fill(false), pending = new Set();
  const fades = new Map();      // i -> { t0, dur, done }
  let flakes = [];
  const maxFlakes = quality === 'baja' ? 36 : 110;
  const timers = new Set();

  const pos = (i) => ({ x: (i % COLS) * (cell + gap), y: Math.floor(i / COLS) * (cell + gap) });
  const cellAt = (x, y) => {
    const step = cell + gap, col = Math.floor(x / step), row = Math.floor(y / step);
    if (col < 0 || col >= COLS || row < 0 || row >= COLS) return -1;
    return (x - col * step <= cell && y - row * step <= cell) ? row * COLS + col : -1;
  };
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };

  // Textura de metal cepillado de UNA celda (se dibuja una vez por tamaño y se estampa en las 9).
  function makeTexture(w) {
    const t = document.createElement('canvas'); t.width = t.height = w;
    const c = t.getContext('2d'), R = w * 0.1;
    rr(c, 0, 0, w, w, R); c.clip();
    const g = c.createLinearGradient(0, 0, w, w);
    [[0, '#8b949f'], [0.22, '#dde3ea'], [0.45, '#a4adb8'], [0.7, '#eef2f6'], [1, '#868f9a']].forEach(([p, col]) => g.addColorStop(p, col));
    c.fillStyle = g; c.fillRect(0, 0, w, w);
    for (let y = 0; y < w; y += 1) { // vetas horizontales
      const a = Math.random();
      c.fillStyle = a < 0.5 ? `rgba(255,255,255,${(a * 0.22).toFixed(3)})` : `rgba(40,50,60,${((a - 0.5) * 0.2).toFixed(3)})`;
      c.fillRect(0, y, w, 1);
    }
    const dots = Math.round((w * w) / (quality === 'baja' ? 40 : 16));
    for (let k = 0; k < dots; k++) { // granulado
      c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.28)' : 'rgba(30,40,50,.22)';
      c.fillRect(Math.random() * w, Math.random() * w, 1 + Math.random(), 1);
    }
    const e = c.createRadialGradient(w / 2 - w * 0.05, w / 2 - w * 0.05, w * 0.02, w / 2, w / 2, w * 0.26); // emblema en relieve
    e.addColorStop(0, '#f4f7fa'); e.addColorStop(1, '#9099a4');
    c.beginPath(); c.arc(w / 2, w / 2, w * 0.24, 0, Math.PI * 2); c.fillStyle = e; c.fill();
    c.lineWidth = Math.max(1.5, w * 0.025); c.strokeStyle = 'rgba(60,70,82,.55)'; c.stroke();
    c.font = `700 ${Math.round(w * 0.3)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,.7)'; c.fillText('?', w / 2 + 1, w / 2 + 2);
    c.fillStyle = 'rgba(66,76,90,.9)'; c.fillText('?', w / 2, w / 2 + 1);
    rr(c, w * 0.02, w * 0.02, w * 0.96, w * 0.96, R); // bisel
    c.lineWidth = Math.max(1.5, w * 0.03); c.strokeStyle = 'rgba(255,255,255,.55)'; c.stroke();
    return t;
  }

  function paintCell(i) {
    const { x, y } = pos(i);
    cx.globalCompositeOperation = 'source-over';
    cx.drawImage(tex, Math.round(x * dpr), Math.round(y * dpr));
  }

  function eraseCell(i) {
    const { x, y } = pos(i);
    cx.globalCompositeOperation = 'source-over';
    cx.clearRect(Math.floor(x * dpr) - 1, Math.floor(y * dpr) - 1, Math.ceil(cell * dpr) + 3, Math.ceil(cell * dpr) + 3);
  }

  function coverage(i) {
    const { x, y } = pos(i), w = Math.max(1, Math.round(cell * dpr));
    const d = cx.getImageData(Math.round(x * dpr), Math.round(y * dpr), w, w).data;
    let clear = 0, total = 0;
    for (let py = 0; py < w; py += 3) for (let px = 0; px < w; px += 3) { total++; if (d[(py * w + px) * 4 + 3] < 40) clear++; }
    return total ? clear / total : 0;
  }

  function startFade(i, delay = 0, dur = 260) {
    if (cleared[i] || fades.has(i)) return;
    fades.set(i, { t0: performance.now() + delay, dur, prev: 0 });
    cleared[i] = true; pending.delete(i);
    wake();
  }

  function spawn(x, y, n, spread = 1) {
    if (reducedMotion()) return;
    for (let k = 0; k < n && flakes.length < maxFlakes; k++) {
      const a = Math.random() * Math.PI * 2, v = (0.4 + Math.random() * 1.6) * spread * cell * 0.018;
      flakes.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - cell * 0.012, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, s: Math.max(2, cell * (0.03 + Math.random() * 0.035)), t0: performance.now(), life: 520 + Math.random() * 380, tone: Math.random() < 0.5 ? '#c9d0d8' : '#8f98a3' });
    }
    wake();
  }
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reducedMotion = () => !!(mq && mq.matches);

  function wake() { if (!raf) raf = requestAnimationFrame(loop); }
  function loop(ts) {
    raf = 0;
    const now = performance.now();
    for (const [i, f] of fades) { // celdas que se limpian solas (desvanecido)
      if (now < f.t0) continue;
      const p = Math.min(1, (now - f.t0) / f.dur), prev = f.prev;
      if (p >= 1) { eraseCell(i); fades.delete(i); continue; }
      const { x, y } = pos(i);
      cx.globalCompositeOperation = 'destination-out'; cx.globalAlpha = Math.min(1, (p - prev) / (1 - prev));
      cx.fillStyle = '#000'; cx.fillRect(Math.floor(x * dpr), Math.floor(y * dpr), Math.ceil(cell * dpr) + 1, Math.ceil(cell * dpr) + 1);
      cx.globalAlpha = 1; cx.globalCompositeOperation = 'source-over'; f.prev = p;
    }
    fc.clearRect(0, 0, fx.width, fx.height);
    flakes = flakes.filter((f) => now - f.t0 < f.life);
    for (const f of flakes) {
      const age = (now - f.t0) / f.life;
      f.vy += cell * 0.0009; f.x += f.vx; f.y += f.vy; f.r += f.vr;
      fc.save(); fc.translate(f.x * dpr, f.y * dpr); fc.rotate(f.r); fc.globalAlpha = 1 - age * age;
      fc.fillStyle = f.tone; fc.fillRect(-f.s * dpr / 2, -f.s * dpr / 4, f.s * dpr, f.s * dpr / 2); fc.restore();
    }
    if (fades.size || flakes.length) raf = requestAnimationFrame(loop);
  }

  function point(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (S / r.width), y: (e.clientY - r.top) * (S / r.height) };
  }

  function check() {
    lastCheck = performance.now();
    for (const i of [...pending]) {
      if (cleared[i]) { pending.delete(i); continue; }
      if (coverage(i) >= THRESHOLD) { startFade(i); onDone(i); }
    }
  }

  function touchCell(i) {
    if (i < 0 || cleared[i]) return;
    if (!peeked[i]) { peeked[i] = true; onPeek(i); }
    pending.add(i);
  }

  function scratch(a, b) {
    cx.globalCompositeOperation = 'destination-out';
    cx.lineCap = 'round'; cx.lineJoin = 'round'; cx.lineWidth = cell * 0.27 * dpr; cx.strokeStyle = '#000';
    cx.beginPath(); cx.moveTo(a.x * dpr, a.y * dpr); cx.lineTo(b.x * dpr + 0.01, b.y * dpr); cx.stroke();
    cx.globalCompositeOperation = 'source-over';
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    [a, mid, b].forEach((p) => touchCell(cellAt(p.x, p.y)));
    if (cellAt(b.x, b.y) >= 0) spawn(b.x, b.y, Math.min(4, 1 + Math.floor(dist / 6)));
  }

  const onDown = (e) => {
    if (!enabled) return;
    down = true; last = point(e);
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* sin captura, sigue andando */ }
    scratch(last, last); e.preventDefault();
  };
  const onMove = (e) => {
    if (!down || !enabled) return;
    const p = point(e); scratch(last, p); last = p;
    if (performance.now() - lastCheck > 90) check();
    e.preventDefault();
  };
  const onUp = () => { if (!down) return; down = false; last = null; check(); };
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onUp);

  function resize(size) {
    size = Math.max(60, Math.floor(size));
    const d = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (size === S && d === dpr && tex) return;
    S = size; dpr = d; gap = Math.max(3, Math.round(S * 0.03)); cell = (S - 2 * gap) / COLS;
    el.style.width = el.style.height = S + 'px';
    cv.width = fx.width = Math.round(S * dpr); cv.height = fx.height = Math.round(S * dpr);
    tex = makeTexture(Math.max(8, Math.round(cell * dpr)));
    for (let i = 0; i < CELLS; i++) if (!cleared[i]) paintCell(i);
  }

  return {
    el,
    resize,
    gap: () => gap,
    cellRect: (i) => ({ ...pos(i), size: cell }),
    isCleared: (i) => cleared[i],
    setEnabled(b) { enabled = !!b; el.classList.toggle('is-live', enabled); },
    reset() { // boleto nuevo: las 9 celdas vuelven a taparse
      fades.clear(); flakes = []; pending.clear();
      for (let i = 0; i < CELLS; i++) { cleared[i] = false; peeked[i] = false; if (tex) { eraseCell(i); paintCell(i); } }
      fc.clearRect(0, 0, fx.width, fx.height);
    },
    setCleared(i) { cleared[i] = true; peeked[i] = true; fades.delete(i); pending.delete(i); if (tex) eraseCell(i); },
    clearCell(i, { delay = 0, dur = 260 } = {}) { peeked[i] = true; startFade(i, delay, dur); const { x, y } = pos(i); const id = setTimeout(() => { timers.delete(id); spawn(x + cell / 2, y + cell / 2, quality === 'baja' ? 5 : 12, 1.4); }, delay); timers.add(id); },
    destroy() { timers.forEach(clearTimeout); timers.clear(); cancelAnimationFrame(raf); raf = 0; fades.clear(); flakes = []; cv.removeEventListener('pointerdown', onDown); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerup', onUp); cv.removeEventListener('pointercancel', onUp); el.remove(); },
  };
}
