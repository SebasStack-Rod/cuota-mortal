// js/games/dice/roll.js: dos dados que ruedan, rebotan, giran y frenan en 2D. La pose es una FUNCIÓN PURA del tiempo (poseAt), así que
// quien entra a mitad de la tirada ve el punto exacto de la animación y no hace falta GSAP ni timelines. Caras: assets/dice/Dice1.png a Dice6.png.
// Exporta faceUrl, poseAt y createDiceStage({ small, speed }) -> { el, resize(w, h), setFaces(f), draw(t, finals, audioHit), hide(), show(), destroy() }.
export const faceUrl = (n) => `assets/dice/Dice${n}.png`;

const FALL_S = 0.55;                                     // caída inicial
const BOUNCES = [{ T: 0.62, h: 0.55 }, { T: 0.42, h: 0.22 }, { T: 0.28, h: 0.08 }]; // duración y altura relativa de cada rebote
const SETTLE_S = 2.0;                                    // desde acá la cara es la final
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOut3 = (u) => 1 - Math.pow(1 - clamp01(u), 3);
const easeOut4 = (u) => 1 - Math.pow(1 - clamp01(u), 4);

// Pose del dado i (0 o 1) a los t segundos de empezar. Devuelve { x, y, rot, scale, lift, bounced } con x e y relativos a su lugar de reposo.
// `lift` va de 0 (apoyado) a 1 (en el aire, para la sombra). `hitAt` lista los instantes de impacto para el sonido.
export function poseAt(i, t, size, W, H) {
  const dir = i ? 1 : -1;
  const rx = dir * size * 0.62, ry = i * size * 0.12;
  const k = 1 + i * 0.08;                               // el segundo dado rebota un poco distinto
  const hb = Math.max(size * 0.9, H * 0.3);
  const tt = Math.max(0, t - i * 0.07);
  const x0 = rx + dir * (W * 0.5 + size), rot0 = -dir * 220;
  const rotF = (i ? 14 : -9) + 360 * (2 + i);
  const x = x0 + (rx - x0) * easeOut3(tt / 2.0);
  const rot = rot0 + (rotF - rot0) * easeOut4(tt / 2.3);
  let y = 0, lift = 0;
  const fall = FALL_S * k;
  if (tt < fall) { const u = tt / fall; lift = 1 - u * u; y = -hb * 1.8 * lift; }
  else {
    let s = tt - fall;
    for (const b of BOUNCES) {
      const T = b.T * k;
      if (s < T) { const u = (s - T / 2) / (T / 2); lift = b.h * (1 - u * u); y = -hb * 1.8 * lift; break; }
      s -= T;
    }
  }
  const scale = 1 + 0.35 * (1 - clamp01(tt / fall));
  return { x, y: ry + y, rot, scale, lift: clamp01(lift) };
}
export function hitTimes(i) {
  const k = 1 + i * 0.08, out = [];
  let acc = i * 0.07 + FALL_S * k;
  out.push(acc);
  for (const b of BOUNCES) { acc += b.T * k; out.push(acc); }
  return out;
}

export function createDiceStage({ small = false, speed = 1 } = {}) {
  const el = document.createElement('div');
  el.className = 'dic-dice' + (small ? ' is-small' : '');
  const dies = [0, 1].map(() => {
    const wrap = document.createElement('div'); wrap.className = 'dic-die';
    const sh = document.createElement('i'); sh.className = 'dic-shadow';
    const img = document.createElement('img'); img.alt = ''; img.draggable = false; img.src = faceUrl(1);
    wrap.append(sh, img); el.appendChild(wrap);
    return { wrap, sh, img, face: 0 };
  });
  let W = 300, H = 160, size = 72, shown = false;

  function setFace(d, n) { if (d.face !== n) { d.face = n; d.img.src = faceUrl(n); } }
  function place(i, p) {
    const d = dies[i];
    d.wrap.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
    d.img.style.transform = `rotate(${p.rot.toFixed(1)}deg) scale(${p.scale.toFixed(3)})`;
    d.sh.style.transform = `translateY(${(size * 0.46).toFixed(1)}px) scale(${(1 - 0.45 * p.lift).toFixed(3)}, ${(1 - 0.55 * p.lift).toFixed(3)})`;
    d.sh.style.opacity = String((0.5 - 0.35 * p.lift).toFixed(2));
  }

  return {
    el,
    resize(w, h) {
      if (!w || !h) return;
      W = w; H = h;
      size = Math.round(Math.max(small ? 34 : 56, Math.min(small ? 52 : 104, w * (small ? 0.12 : 0.22), h * (small ? 0.9 : 0.42))));
      el.style.setProperty('--dsz', size + 'px');
    },
    setFaces(f) { f.forEach((n, i) => setFace(dies[i], n)); },
    // t en segundos desde que arrancó la tirada. finals = [a, b]. Posa los dados y elige la cara (girando hasta SETTLE_S).
    draw(t, finals) {
      const ts = t * speed;
      for (let i = 0; i < 2; i++) {
        place(i, poseAt(i, ts, size, W, H));
        setFace(dies[i], ts < SETTLE_S ? ((Math.floor(ts * 16) * 5 + i * 2) % 6) + 1 : finals[i]);
      }
      this.show();
    },
    rest(finals) { // dados quietos en su lugar, con la cara final (entrar tarde o después de la tirada)
      for (let i = 0; i < 2; i++) { place(i, poseAt(i, 99, size, W, H)); setFace(dies[i], finals[i]); }
      this.show();
    },
    show() { if (!shown) { shown = true; el.style.visibility = 'visible'; } },
    hide() { shown = false; el.style.visibility = 'hidden'; },
    destroy() { el.remove(); },
  };
}
