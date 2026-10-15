// js/ui/salon.js
// Salón del casino: una escena de píxeles (canvas de 176x256 escalada con números enteros) con alfombra, mesas,
// tragamonedas animadas y una pantalla de Crash, más 6 zonas tocables con cartel de neón y puntos de colores de quienes
// están sentados. Tocar una zona abre una hoja con el juego y el botón "Sentarme".
// Exporta mountSalon(raiz, { session, screens, prefs }) -> { render(state) }. Con calidad Baja o movimiento reducido se dibuja una sola vez.

import { fmt } from '../core/money.js';
import { limitsFor } from './limits.js';
import { openSheet } from './sheets.js';
import { GAME_LIST, gameMeta } from './games-meta.js';
import { TILESET_URL, SLOT_SHEETS, PIECES, SLOT_FRAME, SCENE, PLACEMENTS, SLOTS, SCREEN, ZONES } from './floorplan.js';

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { console.warn('[salon] no se pudo cargar', url); resolve(null); };
    img.src = url;
  });
}

export function mountSalon(root, { session, screens, prefs }) {
  const stage = root.querySelector('#salon-stage');
  const canvas = root.querySelector('#salon-canvas');
  const zonesEl = root.querySelector('#salon-zones');
  const area = root.querySelector('#salon-area');
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  let tileset = null;
  let slotSheets = [];
  let raf = 0;
  let lastDraw = 0;
  let state = null;
  const zoneEls = new Map();

  // ---------- Dibujo ----------
  function piece(name, x, y) {
    const p = PIECES[name];
    if (tileset) g.drawImage(tileset, p.sx, p.sy, p.sw, p.sh, x, y, p.sw, p.sh);
  }

  function drawScreen(t) {
    const { x, y, w, h } = SCREEN;
    g.fillStyle = '#D4AF37'; g.fillRect(x, y, w, h);
    g.fillStyle = '#7A5C12'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
    const ix = x + 3, iy = y + 3, iw = w - 6, ih = h - 6;
    g.fillStyle = '#06121A'; g.fillRect(ix, iy, iw, ih);
    g.fillStyle = 'rgba(34, 230, 255, 0.12)';
    for (let i = 1; i < 4; i++) g.fillRect(ix, iy + Math.round((ih / 4) * i), iw, 1);
    for (let i = 1; i < 8; i++) g.fillRect(ix + Math.round((iw / 8) * i), iy, 1, ih);
    // Curva exponencial que sube y "explota" cada 7 s
    const cycle = (t / 1000) % 7;
    const crashed = cycle > 6;
    const progress = Math.min(1, cycle / 6);
    g.fillStyle = crashed ? '#FF4D5E' : '#2EE59D';
    const cols = Math.floor(iw * progress);
    for (let i = 0; i < cols; i++) {
      const n = i / iw;
      const v = (Math.exp(3.2 * n) - 1) / (Math.exp(3.2) - 1);
      g.fillRect(ix + i, iy + ih - 2 - Math.round(v * (ih - 6)), 2, 2);
    }
    if (crashed && Math.floor(cycle * 8) % 2 === 0) { g.fillStyle = 'rgba(255, 77, 94, 0.25)'; g.fillRect(ix, iy, iw, ih); }
  }

  function draw(t = 0) {
    g.clearRect(0, 0, SCENE.w, SCENE.h);
    if (tileset) {
      const c = PIECES.carpet_red;
      for (let y = 0; y < SCENE.h; y += c.sh) for (let x = 0; x < SCENE.w; x += c.sw) g.drawImage(tileset, c.sx, c.sy, c.sw, c.sh, x, y, c.sw, c.sh);
    }
    g.fillStyle = 'rgba(11, 11, 20, 0.34)'; g.fillRect(0, 0, SCENE.w, SCENE.h);   // luz de noche
    drawScreen(t);
    for (const p of PLACEMENTS) piece(p.piece, p.x, p.y);
    const n = SLOT_FRAME.frames.length;
    for (const s of SLOTS) {
      const sheet = slotSheets[s.sheet];
      if (!sheet) continue;
      const f = SLOT_FRAME.frames[(Math.floor(t / 130) + s.offset) % n];
      g.drawImage(sheet, (f % SLOT_FRAME.cols) * SLOT_FRAME.w, Math.floor(f / SLOT_FRAME.cols) * SLOT_FRAME.h, SLOT_FRAME.w, SLOT_FRAME.h, s.x, s.y, SLOT_FRAME.w, SLOT_FRAME.h);
    }
  }

  const animated = () => prefs.get('quality') === 'alta' && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  function loop(now) {
    raf = 0;
    if (now - lastDraw >= 66) { draw(now); lastDraw = now; }   // unos 15 cuadros por segundo alcanzan para píxeles
    if (shouldRun()) raf = requestAnimationFrame(loop);
  }
  const shouldRun = () => animated() && !document.hidden && screens.current() === 'salon';
  function sync() {
    if (shouldRun()) { if (!raf) raf = requestAnimationFrame(loop); }
    else { if (raf) cancelAnimationFrame(raf); raf = 0; draw(0); }
  }

  // ---------- Tamaño: escala entera cuando entra (2x o 3x), si no la que quepa ----------
  function layout() {
    const w = area.clientWidth, h = area.clientHeight;
    if (!w || !h) return;
    const raw = Math.min(w / SCENE.w, h / SCENE.h);
    const s = raw >= 2 ? Math.floor(raw) : Math.max(1, raw);
    stage.style.setProperty('--s', String(s));
    stage.style.width = SCENE.w * s + 'px';
    stage.style.height = SCENE.h * s + 'px';
  }

  // ---------- Zonas tocables ----------
  for (const z of ZONES) {
    const meta = gameMeta(z.game);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'zone';
    btn.dataset.game = z.game;
    btn.style.left = (z.x / SCENE.w) * 100 + '%';
    btn.style.top = (z.y / SCENE.h) * 100 + '%';
    btn.style.width = (z.w / SCENE.w) * 100 + '%';
    btn.style.height = (z.h / SCENE.h) * 100 + '%';
    const sign = document.createElement('span');
    sign.className = 'zone__sign';
    sign.textContent = meta.sign;
    const dots = document.createElement('span');
    dots.className = 'zone__dots';
    btn.append(sign, dots);
    btn.addEventListener('click', () => openGameSheet(z.game));
    zonesEl.append(btn);
    zoneEls.set(z.game, { btn, dots });
  }

  function seatedAt(gameId) {
    return state ? Object.values(state.players).filter((p) => p.seat === gameId) : [];
  }

  function render(next) {
    state = next;
    if (!state) return;
    for (const [gameId, { btn, dots }] of zoneEls) {
      const sitting = seatedAt(gameId);
      dots.replaceChildren(...sitting.map((p) => {
        const d = document.createElement('i');
        d.className = 'zone__dot';
        d.style.background = p.color;
        return d;
      }));
      const who = sitting.length ? `${sitting.length} sentado${sitting.length > 1 ? 's' : ''}` : 'sin nadie sentado';
      btn.setAttribute('aria-label', `${gameMeta(gameId).name}, ${who}`);
    }
  }

  // ---------- Hoja de mesa ----------
  function openGameSheet(gameId) {
    const meta = gameMeta(gameId);
    const body = document.createElement('div');
    body.className = 'game-sheet';
    const desc = document.createElement('p');
    desc.textContent = meta.desc;
    const rules = document.createElement('p');
    rules.className = 'game-sheet__rules';
    const limits = limitsFor(state);
    rules.textContent = `Apuesta mínima ${fmt(limits.min)}, máxima de hoy ${fmt(limits.max)}.`;
    const list = document.createElement('ul');
    list.className = 'game-sheet__players';
    const sitting = seatedAt(gameId);
    if (!sitting.length) {
      const li = document.createElement('li');
      li.className = 'hint';
      li.textContent = 'Nadie está sentado todavía.';
      list.append(li);
    }
    for (const p of sitting) {
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.className = 'zone__dot';
      dot.style.background = p.color;
      li.append(dot, document.createTextNode(' ' + p.name));
      list.append(li);
    }
    body.append(desc, rules, list);
    const canSit = !!state && state.phase === 'day';
    openSheet({
      title: meta.name,
      body,
      actions: [{ label: 'Sentarme', kind: 'gold', disabled: !canSit, onClick: () => session.sitAt(gameId) }],
    });
  }

  // ---------- Arranque ----------
  Promise.all([loadImage(TILESET_URL), ...SLOT_SHEETS.map(loadImage)]).then(([ts, ...sheets]) => {
    tileset = ts; slotSheets = sheets;
    sync();
  });
  new ResizeObserver(layout).observe(area);
  window.addEventListener('resize', layout);
  prefs.onChange((key) => { if (key === 'quality') sync(); });
  document.addEventListener('visibilitychange', sync);
  screens.onShow((name) => { if (name === 'salon') { layout(); render(session.getState()); } sync(); });
  layout();
  draw(0);

  return { render };
}
