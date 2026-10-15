// js/games/crash/chart.js: gráfico del Crash en Canvas 2D: ejes con cámara que se aleja, curva de neón (cian a magenta) con
// brillo, partículas en la punta, explosión y destello. Solo dibuja; el estado lo decide la lógica.
// Exporta createChart({ quality }) -> { el, resize(ancho, alto), draw(cuadro), explode(), destroy() }.
const TAU = Math.PI * 2;
const NICE = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

function niceStep(range, lines) {
  const raw = range / lines;
  return NICE.find((n) => n >= raw) || NICE[NICE.length - 1];
}

export function createChart({ quality = 'alta' } = {}) {
  const el = document.createElement('canvas');
  el.className = 'cra-canvas';
  const g = el.getContext('2d');
  const maxDpr = quality === 'baja' ? 1 : 2;
  let w = 0, h = 0, dpr = 1, particles = [], flash = 0, lastTime = 0, tip = { x: 0, y: 0 }, crashed = false;

  function resize(nw, nh) {
    w = Math.max(80, Math.round(nw)); h = Math.max(80, Math.round(nh));
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
    el.style.width = w + 'px'; el.style.height = h + 'px';
  }

  function spawn(x, y, vx, vy, life, size, color) { particles.push({ x, y, vx, vy, life, max: life, size, color }); }

  // cuadro = { phase, t (s desde que empezó), growth, crashedAt, time (ms) }
  function draw(f) {
    if (!w) return;
    const dt = Math.min(0.05, Math.max(0, (f.time - lastTime) / 1000)); lastTime = f.time;
    const running = f.phase === 'running', isCrash = f.phase === 'crashed';
    crashed = isCrash;
    const tEnd = isCrash ? Math.log(f.crashedAt) / f.growth : running ? f.t : 0;
    const mEnd = Math.exp(f.growth * tEnd);
    const tMax = Math.max(10, tEnd * 1.12), mMax = Math.max(2, mEnd * 1.15); // la cámara se aleja al subir
    const L = 38, R = 12, T = 12, B = 20, pw = w - L - R, ph = h - T - B;
    const X = (t) => L + (t / tMax) * pw;
    const Y = (m) => T + ph - ((m - 1) / (mMax - 1)) * ph;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '10px Rubik, system-ui, sans-serif'; g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = 'rgba(169,165,154,.8)'; g.lineWidth = 1; g.textAlign = 'right';
    const ys = niceStep(mMax - 1, 4);
    for (let v = 1; v <= mMax; v += ys) {
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
      g.fillText(v + 'x', L - 5, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const xs = niceStep(tMax, 5);
    for (let s = 0; s <= tMax; s += xs) {
      const x = Math.round(X(s)) + 0.5;
      g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
      g.fillText(s + 's', x, h - 6);
    }

    if (tEnd > 0) {
      const N = 90, pts = [];
      for (let i = 0; i <= N; i++) { const t = (tEnd * i) / N; pts.push([X(t), Y(Math.exp(f.growth * t))]); }
      tip = { x: pts[N][0], y: pts[N][1] };
      const grad = g.createLinearGradient(L, 0, tip.x, 0);
      if (isCrash) { grad.addColorStop(0, '#ff8a5e'); grad.addColorStop(1, '#ff4d5e'); }
      else { grad.addColorStop(0, '#22E6FF'); grad.addColorStop(1, '#FF2BD6'); }
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= N; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.lineTo(tip.x, T + ph); g.lineTo(L, T + ph); g.closePath();
      const fill = g.createLinearGradient(0, T, 0, T + ph);
      fill.addColorStop(0, isCrash ? 'rgba(255,77,94,.22)' : 'rgba(255,43,214,.20)'); fill.addColorStop(1, 'rgba(34,230,255,0)');
      g.fillStyle = fill; g.fill();
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= N; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.lineJoin = 'round'; g.lineCap = 'round';
      if (quality === 'baja') { g.strokeStyle = isCrash ? 'rgba(255,77,94,.2)' : 'rgba(255,43,214,.2)'; g.lineWidth = 11; g.stroke(); }
      else { g.shadowColor = isCrash ? '#ff4d5e' : '#FF2BD6'; g.shadowBlur = 18; }
      g.strokeStyle = grad; g.lineWidth = 4; g.stroke();
      g.shadowBlur = 0;
      if (running) { // punta brillante + estela de partículas
        const hg = g.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 16);
        hg.addColorStop(0, 'rgba(255,255,255,.95)'); hg.addColorStop(0.4, 'rgba(255,43,214,.6)'); hg.addColorStop(1, 'rgba(255,43,214,0)');
        g.fillStyle = hg; g.beginPath(); g.arc(tip.x, tip.y, 16, 0, TAU); g.fill();
        const n = quality === 'baja' ? (Math.random() < 0.4 ? 1 : 0) : 2;
        for (let i = 0; i < n; i++) spawn(tip.x, tip.y, -20 - Math.random() * 40, (Math.random() - 0.5) * 40, 0.5 + Math.random() * 0.4, 1.5 + Math.random() * 2, Math.random() < 0.5 ? '34,230,255' : '255,43,214');
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) { // partículas
      const p = particles[i];
      p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (crashed) p.vy += 220 * dt;
      g.fillStyle = `rgba(${p.color},${Math.max(0, p.life / p.max)})`;
      g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill();
    }
    if (flash > 0.01) {
      g.fillStyle = `rgba(255,255,255,${flash * 0.55})`; g.fillRect(0, 0, w, h);
      flash *= Math.pow(0.0008, dt);
    }
  }

  function explode() { // destello + ráfaga de partículas desde la punta
    flash = 1;
    const n = quality === 'baja' ? 24 : 70, cols = ['255,77,94', '255,176,32', '255,255,255'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = 40 + Math.random() * 220;
      spawn(tip.x, tip.y, Math.cos(a) * v, Math.sin(a) * v, 0.6 + Math.random() * 0.7, 1.5 + Math.random() * 3, cols[i % 3]);
    }
  }

  return { el, resize, draw, explode, destroy() { particles = []; el.width = el.height = 0; } };
}
