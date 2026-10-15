// js/games/roulette/table.js: mesa de apuestas vertical en HTML/CSS (0 arriba, 12 filas x 3 columnas, docenas a la izquierda,
// apuestas externas a la derecha y columnas abajo) y las pilas de fichas apostadas, con el color de cada jugador.
// Usa GSAP global (window.gsap). Exporta createTable({ chips, fmt, onSpot }) -> { el, setBets, setMode, highlight,
// clearHighlight, stacks, resetRound, rowHeight, destroy }.
import { colorOf, spotWins } from './constants.js';

// Textura de ruido suave del paño (filtro SVG feTurbulence), como imagen de fondo.
const NOISE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n' x='0' y='0' width='100%' height='100%'>" +
  "<feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter>" +
  "<rect width='100%' height='100%' filter='url(#n)'/></svg>";

const ROWS = 14; // 1 (cero) + 12 (números) + 1 (columnas)

export function createTable({ chips, fmt, onSpot }) {
  const el = document.createElement('div');
  el.className = 'rou-table';
  const noise = document.createElement('div');
  noise.className = 'rou-noise';
  noise.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(NOISE_SVG)}")`;
  el.appendChild(noise);

  const cells = new Map(); // spot -> botón
  function addCell(spot, cls, html, row, col) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rou-cell ' + cls;
    b.dataset.spot = spot;
    b.style.gridRow = row;
    b.style.gridColumn = col;
    b.innerHTML = html + '<span class="rou-cellchips"></span>'; // contenido fijo, sin datos de usuarios
    el.appendChild(b);
    cells.set(spot, b);
  }
  const num = (t) => `<i class="rou-num">${t}</i>`;
  const lbl = (t, extra = '') => `<i class="rou-lbl ${extra}">${t}</i>`;

  addCell('n0', 'is-green', num(0), '1', '2 / 5');
  for (let n = 1; n <= 36; n++) {
    addCell('n' + n, 'is-' + colorOf(n), num(n), String(2 + Math.floor((n - 1) / 3)), String(2 + ((n - 1) % 3)));
  }
  ['c1', 'c2', 'c3'].forEach((s, i) => addCell(s, 'is-outside', lbl('2:1'), '14', String(2 + i)));
  [['d1', '2 / 6', '1ª 12'], ['d2', '6 / 10', '2ª 12'], ['d3', '10 / 14', '3ª 12']]
    .forEach(([s, row, t]) => addCell(s, 'is-outside', lbl(t, 'rou-vert'), row, '1'));
  [['low', '2 / 4', lbl('1-18')], ['even', '4 / 6', lbl('PAR')],
    ['red', '6 / 8', '<span class="rou-diamond is-red"></span>'], ['black', '8 / 10', '<span class="rou-diamond is-black"></span>'],
    ['odd', '10 / 12', lbl('IMPAR')], ['high', '12 / 14', lbl('19-36')]]
    .forEach(([s, row, html]) => addCell(s, 'is-outside', html, row, '5'));

  el.addEventListener('click', (e) => {
    const b = e.target.closest('.rou-cell');
    if (!b || el.classList.contains('is-dim') || el.classList.contains('is-closed')) return;
    onSpot(b.dataset.spot, b);
  });

  // ---- Pilas de fichas ----
  const recs = new Map(); // "playerId|spot" -> { spot, pid, amount, size, color, mine, wrap, inner, gone }

  function compact(cents) { // monto corto para el cartelito de la pila
    const v = cents / 100;
    if (v >= 1e6) return '$' + +(v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + +(v / 1e3).toFixed(1) + 'k';
    return fmt(cents);
  }

  function makeStack(amount, color, mine, size) {
    const wrap = document.createElement('div');
    wrap.className = 'rou-stack' + (mine ? ' is-mine' : '');
    wrap.style.setProperty('--pc', color);
    const inner = document.createElement('div');
    inner.className = 'rou-stack-in';
    const pile = chips.stack(amount, { max: 3, size, label: false });
    pile.classList.add('rou-pile');
    const badge = document.createElement('b');
    badge.className = 'rou-badge';
    badge.textContent = compact(amount);
    inner.append(pile, badge);
    wrap.appendChild(inner);
    return { wrap, inner };
  }

  function dropRec(rec, animate) {
    if (!animate || rec.gone) { rec.wrap.remove(); return; }
    gsap.to(rec.inner, { opacity: 0, scale: 0.5, duration: 0.18, onComplete: () => rec.wrap.remove() });
  }

  // Sincroniza las pilas con el estado: bets = { playerId: { spot: centavos } }.
  function setBets(bets, players, youId, size, animate) {
    const seen = new Set();
    for (const pid of Object.keys(bets || {})) {
      const color = (players[pid] && players[pid].color) || '#F5F1E6';
      const mine = pid === youId;
      for (const spot of Object.keys(bets[pid])) {
        const key = pid + '|' + spot;
        seen.add(key);
        const amount = bets[pid][spot];
        let rec = recs.get(key);
        if (rec && rec.gone) continue;
        if (rec && rec.amount === amount && rec.size === size && rec.color === color && rec.mine === mine) continue;
        const holder = cells.get(spot) && cells.get(spot).querySelector('.rou-cellchips');
        if (!holder) continue;
        const { wrap, inner } = makeStack(amount, color, mine, size);
        const isNew = !rec;
        if (rec) rec.wrap.replaceWith(wrap); else holder.appendChild(wrap);
        recs.set(key, { key, spot, pid, amount, size, color, mine, wrap, inner, gone: false });
        if (animate && isNew) gsap.fromTo(inner, { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(2)' });
      }
    }
    for (const [key, rec] of recs) {
      if (!seen.has(key)) { dropRec(rec, animate); recs.delete(key); }
    }
  }

  function resetRound() {
    for (const rec of recs.values()) rec.wrap.remove();
    recs.clear();
  }

  // Modos: 'open' (se puede apostar), 'dim' (girando: apagada y sin toques), 'closed' (resultado: brillante pero sin toques).
  function setMode(mode) {
    el.classList.toggle('is-dim', mode === 'dim');
    el.classList.toggle('is-closed', mode === 'closed');
  }

  function clearHighlight() { cells.forEach((b) => b.classList.remove('is-win', 'is-win-soft')); }
  function highlight(n) { // el número ganador con pulso dorado y los lugares externos que ganan, más suaves
    clearHighlight();
    cells.forEach((b, spot) => { if (spotWins(spot, n)) b.classList.add(spot === 'n' + n ? 'is-win' : 'is-win-soft'); });
  }

  return {
    el, setBets, setMode, highlight, clearHighlight, resetRound,
    stacks: () => [...recs.values()],
    rowHeight: () => el.clientHeight / ROWS,
    destroy() { for (const rec of recs.values()) gsap.killTweensOf(rec.inner); recs.clear(); el.remove(); },
  };
}
