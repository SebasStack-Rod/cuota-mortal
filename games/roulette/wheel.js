// js/games/roulette/wheel.js: dibuja la rueda de la ruleta en Canvas 2D, todo por código (sin imágenes).
// Las capas fijas (madera, pista, deflectores) y la que gira (bolsillos, cono, torre) se pintan UNA vez en canvas
// fuera de pantalla; en cada cuadro solo se rota la capa que gira y se dibujan bola, destellos y brillo del bolsillo ganador.
// Exporta: WHEEL_FILL y createWheel({ quality }) -> { el, resize(lado), draw(cuadro), destroy() }.
import { WHEEL, colorOf } from './constants.js';
import { TAU, POCKET_ANGLE, pocketRel } from './spinmath.js';

export const WHEEL_FILL = 0.9; // la rueda ocupa el 90% del canvas; el resto es margen para la sombra sobre el paño

// Radios de cada zona, como fracción del radio de la rueda.
const RIM_IN = 0.925, TRACK_IN = 0.805, SLOPE_IN = 0.745, POCKET_IN = 0.5, NUM_R = 0.675;

function prng(seed) { // generador chico y repetible (para el veteado de la madera)
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
}

function makeLayer(side, dpr) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(side * dpr);
  cv.height = Math.round(side * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  return { cv, g };
}

function ring(g, cx, cy, rOut, rIn) {
  g.beginPath();
  g.arc(cx, cy, rOut, 0, TAU);
  g.arc(cx, cy, rIn, 0, TAU, true);
}

function goldGradient(g, x0, y0, x1, y1) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, '#7a5c14'); gr.addColorStop(0.3, '#f3d77a'); gr.addColorStop(0.55, '#d4af37'); gr.addColorStop(1, '#6b4f10');
  return gr;
}

// ---- Capa fija: sombra, madera, pista de la bola, rampa y deflectores ----
function buildBowl(side, dpr) {
  const { cv, g } = makeLayer(side, dpr);
  const C = side / 2, R = C * WHEEL_FILL;

  // sombra proyectada sobre el paño
  const sh = g.createRadialGradient(C, C + R * 0.07, R * 0.9, C, C + R * 0.07, R * 1.12);
  sh.addColorStop(0, 'rgba(0,0,0,.62)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.beginPath(); g.arc(C, C + R * 0.07, R * 1.12, 0, TAU); g.fill();

  // aro de madera barnizada (degradado cónico si el navegador lo soporta)
  let wood;
  if (g.createConicGradient) {
    wood = g.createConicGradient(-Math.PI * 0.75, C, C);
    [[0, '#6e3212'], [0.08, '#d38c4b'], [0.16, '#58260e'], [0.35, '#8c4a1e'], [0.5, '#45200b'], [0.58, '#c9803f'], [0.66, '#5c2a10'], [0.85, '#7e3e17'], [1, '#6e3212']]
      .forEach(([s, c]) => wood.addColorStop(s, c));
  } else {
    wood = g.createRadialGradient(C, C, R * RIM_IN, C, C, R);
    wood.addColorStop(0, '#5a2610'); wood.addColorStop(0.5, '#a05a28'); wood.addColorStop(1, '#4b2009');
  }
  ring(g, C, C, R, R * RIM_IN); g.fillStyle = wood; g.fill('evenodd');
  g.save(); ring(g, C, C, R, R * RIM_IN); g.clip('evenodd');
  const rnd = prng(11);
  for (let i = 0; i < 70; i++) { // veteado
    g.strokeStyle = rnd() < 0.5 ? 'rgba(0,0,0,.10)' : 'rgba(255,210,150,.07)';
    g.lineWidth = 0.5 + rnd() * 0.8;
    g.beginPath(); g.arc(C, C, R * (RIM_IN + rnd() * (1 - RIM_IN)), 0, TAU); g.stroke();
  }
  g.restore();
  g.lineWidth = R * 0.014; g.strokeStyle = goldGradient(g, C - R, C - R, C + R, C + R);
  g.beginPath(); g.arc(C, C, R * 0.993, 0, TAU); g.stroke();
  g.lineWidth = R * 0.012; g.beginPath(); g.arc(C, C, R * RIM_IN, 0, TAU); g.stroke();

  // pista de la bola: metal pulido
  const tr = g.createRadialGradient(C, C, R * TRACK_IN, C, C, R * RIM_IN);
  [[0, '#50545c'], [0.12, '#b8bec8'], [0.35, '#8a909b'], [0.5, '#dfe3ea'], [0.7, '#7c828d'], [0.9, '#c0c6d0'], [1, '#454850']]
    .forEach(([s, c]) => tr.addColorStop(s, c));
  ring(g, C, C, R * RIM_IN, R * TRACK_IN); g.fillStyle = tr; g.fill('evenodd');
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 0.7;
  for (const f of [0.84, 0.865, 0.89]) { g.beginPath(); g.arc(C, C, R * f, 0, TAU); g.stroke(); }

  // rampa hacia los bolsillos (luz afuera, sombra adentro)
  const sl = g.createRadialGradient(C, C, R * SLOPE_IN, C, C, R * TRACK_IN);
  sl.addColorStop(0, '#15161b'); sl.addColorStop(0.55, '#4a4e57'); sl.addColorStop(1, '#a3a9b4');
  ring(g, C, C, R * TRACK_IN, R * SLOPE_IN); g.fillStyle = sl; g.fill('evenodd');

  // 8 deflectores (rombos dorados) sobre la rampa
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + TAU / 16, L = R * 0.05, W = R * 0.024;
    g.save();
    g.translate(C + Math.cos(a) * R * 0.775, C + Math.sin(a) * R * 0.775); g.rotate(a);
    const diamond = (dx, dy) => { g.beginPath(); g.moveTo(-L + dx, dy); g.lineTo(dx, -W + dy); g.lineTo(L + dx, dy); g.lineTo(dx, W + dy); g.closePath(); };
    g.fillStyle = 'rgba(0,0,0,.4)'; diamond(1.5, 2); g.fill();
    const gr = g.createLinearGradient(-L, -W, L, W);
    gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#d4af37'); gr.addColorStop(1, '#6b4f10');
    g.fillStyle = gr; diamond(0, 0); g.fill();
    g.strokeStyle = 'rgba(60,40,5,.6)'; g.lineWidth = 0.6; g.stroke();
    g.restore();
  }
  return cv;
}

// ---- Capa que gira: bolsillos con números, separadores, cono y torre dorada ----
function buildHead(side, dpr) {
  const { cv, g } = makeLayer(side, dpr);
  const C = side / 2, R = C * WHEEL_FILL;
  const rOut = R * 0.74, rIn = R * POCKET_IN;

  g.fillStyle = '#0a0a10'; g.beginPath(); g.arc(C, C, R * SLOPE_IN, 0, TAU); g.fill();

  const grads = {};
  const mk = (name, a, b, c) => {
    const gr = g.createRadialGradient(C, C, rIn, C, C, rOut);
    gr.addColorStop(0, a); gr.addColorStop(0.55, b); gr.addColorStop(1, c); grads[name] = gr;
  };
  mk('red', '#6e0f12', '#c4262a', '#a01c20');
  mk('black', '#050507', '#262630', '#14141a');
  mk('green', '#054a25', '#10a052', '#0a7a3c');

  WHEEL.forEach((n, i) => { // bolsillos
    const a = pocketRel(i);
    g.beginPath(); g.arc(C, C, rOut, a - POCKET_ANGLE / 2, a + POCKET_ANGLE / 2);
    g.arc(C, C, rIn, a + POCKET_ANGLE / 2, a - POCKET_ANGLE / 2, true); g.closePath();
    g.fillStyle = grads[colorOf(n)]; g.fill();
  });
  for (let pass = 0; pass < 2; pass++) { // separadores dorados con filo claro
    g.strokeStyle = pass === 0 ? '#c9a63c' : 'rgba(255,243,176,.85)';
    g.lineWidth = pass === 0 ? R * 0.011 : R * 0.004;
    for (let i = 0; i < WHEEL.length; i++) {
      const b = pocketRel(i) - POCKET_ANGLE / 2;
      g.beginPath(); g.moveTo(C + Math.cos(b) * rIn, C + Math.sin(b) * rIn); g.lineTo(C + Math.cos(b) * rOut, C + Math.sin(b) * rOut); g.stroke();
    }
  }
  g.fillStyle = '#f5f1e6'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${Math.max(7, Math.round(R * 0.058))}px Rubik, system-ui, sans-serif`;
  WHEEL.forEach((n, i) => { // números impresos, con la base hacia el centro
    g.save(); g.translate(C, C); g.rotate(pocketRel(i) + Math.PI / 2);
    g.fillText(String(n), 0, -R * NUM_R); g.restore();
  });
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = R * 0.03; // fondo oscuro del bolsillo
  g.beginPath(); g.arc(C, C, rIn + R * 0.012, 0, TAU); g.stroke();
  g.lineWidth = R * 0.02; g.strokeStyle = goldGradient(g, C - R, C - R, C + R, C + R);
  g.beginPath(); g.arc(C, C, R * 0.742, 0, TAU); g.stroke();

  // cono central metálico
  const cone = g.createRadialGradient(C - R * 0.08, C - R * 0.1, R * 0.02, C, C, rIn);
  [[0, '#e6e9ef'], [0.25, '#9aa0ac'], [0.55, '#50545d'], [0.8, '#8c919c'], [0.93, '#2f3239'], [1, '#6c727d']]
    .forEach(([s, c]) => cone.addColorStop(s, c));
  g.fillStyle = cone; g.beginPath(); g.arc(C, C, rIn, 0, TAU); g.fill();
  g.strokeStyle = '#cfd4dc'; g.lineWidth = R * 0.018; g.beginPath(); g.arc(C, C, rIn, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(212,175,55,.75)'; g.lineWidth = R * 0.008;
  for (const f of [0.36, 0.3]) { g.beginPath(); g.arc(C, C, R * f, 0, TAU); g.stroke(); }

  for (let k = 0; k < 4; k++) { // torre: cuatro brazos dorados con bolita en la punta
    g.save(); g.translate(C, C); g.rotate(k * Math.PI / 2);
    const gr = g.createLinearGradient(0, -R * 0.03, 0, R * 0.03);
    gr.addColorStop(0, '#fff2b0'); gr.addColorStop(0.5, '#d4af37'); gr.addColorStop(1, '#6b4f10');
    g.fillStyle = gr; g.beginPath();
    g.moveTo(R * 0.08, -R * 0.03); g.lineTo(R * 0.41, -R * 0.016); g.lineTo(R * 0.41, R * 0.016); g.lineTo(R * 0.08, R * 0.03);
    g.closePath(); g.fill();
    const bl = g.createRadialGradient(R * 0.425, -R * 0.01, 0, R * 0.43, 0, R * 0.035);
    bl.addColorStop(0, '#fff6c8'); bl.addColorStop(0.6, '#d4af37'); bl.addColorStop(1, '#6b4f10');
    g.fillStyle = bl; g.beginPath(); g.arc(R * 0.43, 0, R * 0.035, 0, TAU); g.fill();
    g.restore();
  }
  const base = g.createRadialGradient(C, C, 0, C, C, R * 0.13);
  base.addColorStop(0, '#a07a1a'); base.addColorStop(1, '#4a3510');
  g.fillStyle = base; g.beginPath(); g.arc(C, C, R * 0.13, 0, TAU); g.fill();
  const dome = g.createRadialGradient(C - R * 0.035, C - R * 0.04, 0, C, C, R * 0.1);
  dome.addColorStop(0, '#fff6c8'); dome.addColorStop(0.4, '#e6c25a'); dome.addColorStop(0.8, '#a07a1a'); dome.addColorStop(1, '#5a4210');
  g.fillStyle = dome; g.beginPath(); g.arc(C, C, R * 0.1, 0, TAU); g.fill();
  g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(C - R * 0.02, C - R * 0.025, R * 0.022, 0, TAU); g.fill();
  return cv;
}

// ---- Capa fija encima de todo: reflejos del barniz y del vidrio ----
function buildGloss(side, dpr, quality) {
  const { cv, g } = makeLayer(side, dpr);
  const C = side / 2, R = C * WHEEL_FILL;
  g.save(); ring(g, C, C, R, R * RIM_IN); g.clip('evenodd');
  const gl = g.createLinearGradient(C - R, C - R, C + R * 0.3, C + R * 0.3);
  gl.addColorStop(0, 'rgba(255,255,255,.36)'); gl.addColorStop(0.35, 'rgba(255,255,255,.09)'); gl.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.fillStyle = gl; g.fillRect(0, 0, side, side); g.restore();
  if (quality === 'alta') {
    g.save(); g.beginPath(); g.arc(C, C, R * RIM_IN, 0, TAU); g.clip();
    const gl2 = g.createLinearGradient(C - R, C - R, C + R * 0.4, C + R * 0.4);
    gl2.addColorStop(0, 'rgba(255,255,255,.10)'); gl2.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = gl2; g.fillRect(0, 0, side, side); g.restore();
  }
  return cv;
}

export function createWheel({ quality = 'alta' } = {}) {
  const el = document.createElement('canvas');
  el.className = 'rou-wheel-canvas';
  const g = el.getContext('2d');
  const maxDpr = quality === 'baja' ? 1 : 2; // calidad baja: densidad de píxeles tope 1
  let side = 0, dpr = 1, C = 0, R = 0, bowl = null, head = null, gloss = null, dead = false;

  function rebuild() {
    bowl = buildBowl(side, dpr); head = buildHead(side, dpr); gloss = buildGloss(side, dpr, quality);
  }

  function resize(newSide) {
    const s = Math.max(60, Math.round(newSide));
    const d = Math.min(window.devicePixelRatio || 1, maxDpr);
    if (s === side && d === dpr) return;
    side = s; dpr = d; C = side / 2; R = C * WHEEL_FILL;
    el.width = Math.round(side * dpr); el.height = Math.round(side * dpr);
    el.style.width = side + 'px'; el.style.height = side + 'px';
    rebuild();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!dead && side) rebuild(); });
  }

  function drawBall(pose, alpha, trail) {
    const rb = R * 0.03 * (1 + pose.hop * 5);
    const x = C + Math.cos(pose.angle) * pose.r * R, y = C + Math.sin(pose.angle) * pose.r * R;
    if (trail) {
      g.globalAlpha = alpha; g.fillStyle = '#f2f4f8';
      g.beginPath(); g.arc(x, y, rb * 0.9, 0, TAU); g.fill(); g.globalAlpha = 1;
      return;
    }
    const off = rb * (0.45 + pose.hop * 14);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(x + off * 0.6, y + off, rb * 0.95, rb * 0.7, 0, 0, TAU); g.fill();
    const gr = g.createRadialGradient(x - rb * 0.35, y - rb * 0.4, rb * 0.1, x, y, rb);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#e9edf3'); gr.addColorStop(1, '#8f96a2');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rb, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 0.6; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x - rb * 0.3, y - rb * 0.35, rb * 0.22, 0, TAU); g.fill();
  }

  function drawGlow(idx, a) { // bolsillo ganador (se dibuja con el sistema de coordenadas de la rueda ya rotado)
    const c = pocketRel(idx);
    g.beginPath(); g.arc(0, 0, R * 0.745, c - POCKET_ANGLE / 2, c + POCKET_ANGLE / 2);
    g.arc(0, 0, R * POCKET_IN, c + POCKET_ANGLE / 2, c - POCKET_ANGLE / 2, true); g.closePath();
    g.fillStyle = `rgba(255,214,90,${0.25 + 0.35 * a})`; g.fill();
    g.lineWidth = R * 0.012; g.strokeStyle = `rgba(255,240,160,${0.5 + 0.5 * a})`; g.stroke();
    const px = Math.cos(c) * R * 0.62, py = Math.sin(c) * R * 0.62;
    const hg = g.createRadialGradient(px, py, 0, px, py, R * 0.22);
    hg.addColorStop(0, `rgba(255,226,120,${0.55 * a})`); hg.addColorStop(1, 'rgba(255,226,120,0)');
    g.fillStyle = hg; g.beginPath(); g.arc(px, py, R * 0.22, 0, TAU); g.fill();
  }

  // cuadro = { angle, ball, trail, glow: { idx, a } | null, time }
  function draw(f) {
    if (!bowl) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, el.width, el.height);
    g.drawImage(bowl, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.save(); g.translate(C, C); g.rotate(f.angle);
    g.drawImage(head, -C, -C, side, side);
    if (f.glow) drawGlow(f.glow.idx, f.glow.a);
    g.restore();

    // destello de la torre: 4 veces por vuelta, cuando un brazo pasa por la luz
    const fl = Math.pow(Math.max(0, Math.cos(f.angle * 4 + 0.6)), 8);
    if (fl > 0.02) {
      const fx = C - R * 0.03, fy = C - R * 0.04, rad = R * (quality === 'baja' ? 0.12 : 0.2);
      const fg = g.createRadialGradient(fx, fy, 0, fx, fy, rad);
      fg.addColorStop(0, `rgba(255,252,225,${0.9 * fl})`); fg.addColorStop(1, 'rgba(255,240,180,0)');
      g.fillStyle = fg; g.beginPath(); g.arc(fx, fy, rad, 0, TAU); g.fill();
      if (quality !== 'baja') {
        g.strokeStyle = `rgba(255,252,225,${0.8 * fl})`; g.lineWidth = 1; g.beginPath();
        g.moveTo(fx - rad * 0.9, fy); g.lineTo(fx + rad * 0.9, fy); g.moveTo(fx, fy - rad * 0.9); g.lineTo(fx, fy + rad * 0.9); g.stroke();
      }
    }
    if (quality !== 'baja') { // reflejos que se mueven despacio sobre la pista
      const a0 = -2.0 + 0.25 * Math.sin(f.time / 1900);
      g.lineCap = 'round'; g.lineWidth = R * 0.05;
      g.strokeStyle = 'rgba(255,255,255,.26)'; g.beginPath(); g.arc(C, C, R * 0.865, a0, a0 + 0.5); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(C, C, R * 0.865, a0 + Math.PI, a0 + Math.PI + 0.4); g.stroke();
      g.lineCap = 'butt';
    }
    if (f.ball) {
      if (f.trail && quality !== 'baja') f.trail.forEach((p, i) => drawBall(p, 0.13 * (1 - i / f.trail.length), true));
      drawBall(f.ball, 1, false);
    }
    g.drawImage(gloss, 0, 0, side, side);
  }

  function destroy() { dead = true; bowl = head = gloss = null; el.width = el.height = 0; }

  return { el, resize, draw, destroy, get side() { return side; } };
}
