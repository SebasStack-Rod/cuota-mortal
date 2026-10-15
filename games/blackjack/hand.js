// js/games/blackjack/hand.js: dibujo de cartas y manos del blackjack. Cada carta es un elemento con cara (assets/cards/<Carta>.png) y dorso
// dibujado con CSS (no hay asset de dorso). Las imágenes son cuadradas con margen transparente: se mide el recuadro real de la primera
// carta que carga (canvas) y se recorta por CSS con las variables --cfx / --cfy / --car de la raíz del juego.
// Exporta cardUrl, watchCrop(root) y createHand({ size, onDeal, onFlip }) -> { el, set(cards, opts), clear() }.
export const cardUrl = (name) => `assets/cards/${name}.png`;

// Mide el recuadro opaco de una imagen y deja las proporciones en la raíz. Si el canvas no se puede leer, quedan los valores por defecto.
export function watchCrop(root) {
  let done = false;
  return function measure(img) {
    if (done || !img.naturalWidth) return;
    done = true;
    try {
      const S = 96, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, S, S);
      const d = g.getImageData(0, 0, S, S).data;
      let x0 = S, y0 = S, x1 = -1, y1 = -1;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return;
      const fx = (x1 - x0 + 1) / S, fy = (y1 - y0 + 1) / S;
      if (fx < 0.2 || fy < 0.2) return;
      root.style.setProperty('--cfx', fx.toFixed(3)); root.style.setProperty('--cfy', fy.toFixed(3));
      root.style.setProperty('--car', ((fx * img.naturalWidth) / (fy * img.naturalHeight)).toFixed(3));
      root.style.setProperty('--cox', (((x0 + x1 + 1) / 2 / S - 0.5) * -100 / fx).toFixed(2) + '%'); root.style.setProperty('--coy', (((y0 + y1 + 1) / 2 / S - 0.5) * -100 / fy).toFixed(2) + '%');
    } catch (e) { /* tainted canvas o similar: se queda el recorte por defecto */ }
  };
}

function makeCard(measure) {
  const el = document.createElement('div'); el.className = 'bj-card is-down';
  el.innerHTML = '<div class="bj-inner"><div class="bj-front"><img alt="" draggable="false"></div><div class="bj-back"></div></div>';
  const img = el.querySelector('img');
  img.addEventListener('load', () => measure(img));
  return { el, img, name: null };
}

// size: 'big' | 'mid' | 'small' (solo cambia la clase; los tamaños salen del CSS).
export function createHand({ size = 'mid', measure, onDeal, onFlip } = {}) {
  const el = document.createElement('div'); el.className = 'bj-hand bj-hand--' + size;
  const row = document.createElement('div'); row.className = 'bj-cards';
  const tag = document.createElement('div'); tag.className = 'bj-tag';
  el.append(row, tag);
  let cards = [];
  return {
    el, row, tag,
    clear() { row.textContent = ''; cards = []; },
    // opts: { animate, from (elemento del zapato), delays: [seg por carta] }
    set(names, opts = {}) {
      if (names.length < cards.length) { row.textContent = ''; cards = []; }
      names.forEach((n, i) => {
        let c = cards[i], fresh = false;
        if (!c) { c = makeCard(measure); cards[i] = c; row.appendChild(c.el); fresh = true; }
        if (n && c.name !== n) {
          const wasDown = !fresh && c.el.classList.contains('is-down');
          c.name = n; c.img.src = cardUrl(n);
          if (fresh) { c.el.classList.remove('is-down'); } else { void c.el.offsetWidth; c.el.classList.remove('is-down'); if (wasDown && onFlip) onFlip(); }
        }
        if (fresh && opts.animate && opts.from && window.gsap) {
          const a = opts.from.getBoundingClientRect(), b = c.el.getBoundingClientRect();
          const delay = (opts.delays && opts.delays[i]) || 0;
          window.gsap.fromTo(c.el, { x: a.left + a.width / 2 - (b.left + b.width / 2), y: a.top + a.height / 2 - (b.top + b.height / 2), rotation: -24, opacity: 0 },
            { x: 0, y: 0, rotation: 0, opacity: 1, duration: 0.38, delay, ease: 'power2.out' });
          if (onDeal) onDeal(delay);
        }
      });
      row.classList.toggle('is-many', names.length > 3);
    },
  };
}
