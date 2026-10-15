// js/games/slots/machine.js: la máquina de Caz en capas y el dibujo de los rodillos. Solo dibuja; el resultado ya viene decidido.
// Capas (de atrás hacia adelante): ventanas claras (slot-machine5) -> rodillos en canvas -> máquina con ventanas vacías (slot-machine4)
// -> palanca (slot-machine2 arriba / slot-machine3 abajo) -> canvas de efectos (luces del cartel, línea de pago, destellos).
// Todo en coordenadas de la imagen original (recortada en x desde X0) y escalado por CSS. Exporta createMachine, SW, SH y constantes.
import { STRIP } from './logic.js';

const BASE = 'assets/slots/pixel-fantasy/';
export const X0 = 130, SW = 640, SH = 624;                  // recorte de la máquina (816x624 originales)
const WIN_X = [229, 359, 489].map((x) => x - X0);            // x de cada ventana
const WIN_Y = 246, WIN_W = 108, WIN_H = 210, CH = 70;        // 3 filas de 70 px; la central es la línea de pago
export const PAYLINE_Y = WIN_Y + WIN_H / 2;
const TAU = Math.PI * 2;

function layerImg(name, hidden) {
  const im = new Image();
  im.src = BASE + name;
  im.alt = '';
  im.draggable = false;
  im.style.cssText = `position:absolute;left:${-X0}px;top:0;width:816px;height:624px;image-rendering:pixelated;pointer-events:none;${hidden ? 'display:none;' : ''}`;
  return im;
}
function layerCanvas() {
  const c = document.createElement('canvas');
  c.width = SW; c.height = SH;
  c.style.cssText = 'position:absolute;left:0;top:0;width:640px;height:624px;image-rendering:pixelated;pointer-events:none;';
  return c;
}

export function createMachine({ quality = 'alta' } = {}) {
  const el = document.createElement('div');
  el.className = 'slt-stage';
  el.style.cssText = `position:absolute;left:0;top:0;width:${SW}px;height:${SH}px;transform-origin:0 0;`;
  const wins = layerImg('slot-machine5.png');
  const reelsCv = layerCanvas();
  const frame = layerImg('slot-machine4.png');
  const leverUp = layerImg('slot-machine2.png');
  const leverDown = layerImg('slot-machine3.png', true);
  const fxCv = layerCanvas();
  el.append(wins, reelsCv, frame, leverUp, leverDown, fxCv);
  const rg = reelsCv.getContext('2d'), fg = fxCv.getContext('2d');
  rg.imageSmoothingEnabled = false;

  const syms = [1, 2, 3, 4].map((n) => { const im = new Image(); im.src = `${BASE}slot-symbol${n}.png`; return im; }); // 7, cerezas, campana, BAR

  function drawSymbol(g, kind, cx, cy, alpha) {
    g.globalAlpha = alpha;
    if (kind === 4) { // casilla vacía: un rombito apagado con la paleta de la máquina
      g.fillStyle = '#5b5bb0';
      g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx + 9, cy); g.lineTo(cx, cy + 9); g.lineTo(cx - 9, cy); g.closePath(); g.fill();
    } else {
      const im = syms[kind];
      if (im.complete && im.naturalWidth) g.drawImage(im, cx - 35, cy - 35, 70, 70);
    }
    g.globalAlpha = 1;
  }

  // pos[k]: parada (con decimales) que está en la línea central; speed[k]: celdas por segundo (para el desenfoque)
  function drawReels(pos, speed) {
    rg.clearRect(0, 0, SW, SH);
    for (let k = 0; k < 3; k++) {
      rg.save();
      rg.beginPath(); rg.rect(WIN_X[k], WIN_Y, WIN_W, WIN_H); rg.clip();
      const i0 = Math.floor(pos[k]), f = pos[k] - i0;
      const cx = WIN_X[k] + WIN_W / 2;
      const smear = quality === 'baja' ? 0 : Math.min(12, Math.abs(speed[k]) * 0.9);
      for (let d = -2; d <= 2; d++) {
        const idx = (((i0 + d) % STRIP.length) + STRIP.length) % STRIP.length;
        const cy = PAYLINE_Y + (d - f) * CH;
        if (smear > 3) { // desenfoque vertical: copias desplazadas y translúcidas
          drawSymbol(rg, STRIP[idx], cx, cy - smear, 0.28);
          drawSymbol(rg, STRIP[idx], cx, cy + smear, 0.28);
          drawSymbol(rg, STRIP[idx], cx, cy, 0.6);
        } else drawSymbol(rg, STRIP[idx], cx, cy, 1);
      }
      // sombreado arriba y abajo para dar volumen al rodillo
      const sh = rg.createLinearGradient(0, WIN_Y, 0, WIN_Y + WIN_H);
      sh.addColorStop(0, 'rgba(20,10,60,.55)'); sh.addColorStop(0.28, 'rgba(20,10,60,0)'); sh.addColorStop(0.72, 'rgba(20,10,60,0)'); sh.addColorStop(1, 'rgba(20,10,60,.55)');
      rg.fillStyle = sh; rg.fillRect(WIN_X[k], WIN_Y, WIN_W, WIN_H);
      rg.restore();
    }
  }

  // luces del cartel JACKPOT, línea de pago y destello del premio
  function drawFx(o) {
    fg.clearRect(0, 0, SW, SH);
    const N = 15, cxA = 283, cyA = 176, rx = 250, ry = 150;
    for (let i = 0; i < N; i++) {
      const a = Math.PI + (i * Math.PI) / (N - 1);
      const x = cxA + rx * Math.cos(a), y = cyA + ry * Math.sin(a);
      const on = o.bulbs === 'all' ? Math.floor(o.time / 120) % 2 === 0 : (i + Math.floor(o.time / 220)) % 3 === 0;
      const g = fg.createRadialGradient(x, y, 0, x, y, on ? 11 : 5);
      g.addColorStop(0, on ? 'rgba(255,240,170,1)' : 'rgba(150,120,60,.8)');
      g.addColorStop(1, on ? 'rgba(255,190,60,0)' : 'rgba(150,120,60,0)');
      fg.fillStyle = g; fg.beginPath(); fg.arc(x, y, on ? 11 : 5, 0, TAU); fg.fill();
      fg.fillStyle = on ? '#fff6c8' : '#8a6d3a'; fg.beginPath(); fg.arc(x, y, 2.6, 0, TAU); fg.fill();
    }
    const x1 = WIN_X[0] - 10, x2 = WIN_X[2] + WIN_W + 10;
    fg.strokeStyle = 'rgba(255,70,70,.65)'; fg.lineWidth = 2; // línea de pago
    fg.beginPath(); fg.moveTo(x1, PAYLINE_Y); fg.lineTo(x2, PAYLINE_Y); fg.stroke();
    fg.fillStyle = 'rgba(255,70,70,.9)';
    fg.beginPath(); fg.moveTo(x1 - 4, PAYLINE_Y - 7); fg.lineTo(x1 + 5, PAYLINE_Y); fg.lineTo(x1 - 4, PAYLINE_Y + 7); fg.fill();
    fg.beginPath(); fg.moveTo(x2 + 4, PAYLINE_Y - 7); fg.lineTo(x2 - 5, PAYLINE_Y); fg.lineTo(x2 + 4, PAYLINE_Y + 7); fg.fill();
    if (o.win) { // destello dorado sobre las ventanas que pagan
      const pulse = 0.5 + 0.5 * Math.sin(o.time / 90);
      for (let k = 0; k < o.win.count; k++) {
        const gx = WIN_X[k] - 3, gy = PAYLINE_Y - CH / 2 - 3;
        fg.strokeStyle = `rgba(255,224,110,${0.55 + 0.45 * pulse})`; fg.lineWidth = 4;
        fg.strokeRect(gx, gy, WIN_W + 6, CH + 6);
        fg.fillStyle = `rgba(255,224,110,${0.10 + 0.14 * pulse})`; fg.fillRect(gx, gy, WIN_W + 6, CH + 6);
      }
      fg.strokeStyle = `rgba(255,240,150,${0.5 + 0.5 * pulse})`; fg.lineWidth = 4;
      fg.beginPath(); fg.moveTo(x1, PAYLINE_Y); fg.lineTo(x2, PAYLINE_Y); fg.stroke();
    }
  }

  function lever(down) { leverUp.style.display = down ? 'none' : ''; leverDown.style.display = down ? '' : 'none'; }

  return { el, drawReels, drawFx, lever, destroy() { el.remove(); } };
}
