// js/games/roulette/constants.js: datos y reglas puras de la ruleta europea (sin DOM y sin azar).
// Los comparten logic.js, spinmath.js y la vista, así hay una sola verdad.
// Exporta: WHEEL, REDS, tiempos de fase, límites, colorOf, SPOTS, isSpot, spotWins, spotMult, spotLabel.

// Orden físico de los bolsillos de la rueda, empezando por el 0 y siguiendo en sentido horario.
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Duración de cada fase en milisegundos.
export const BETTING_MS = 20000;
export const SPIN_PHASE_MS = 9000;
export const RESULT_MS = 6000;

export const HISTORY_LEN = 12;        // cuántos números recuerda el historial
export const MIN_BET = 25;            // $0,25 en centavos (igual que meta.minBet)
export const MAX_CHIPS_PER_PLAYER = 80;   // tope de fichas por jugador y ronda (cuida el tamaño del estado)
export const MAX_SPOTS_PER_PLAYER = 24;   // tope de lugares distintos por jugador y ronda

export function colorOf(n) {
  if (n === 0) return 'green';
  return REDS.has(n) ? 'red' : 'black';
}

// Lugares de apuesta: n0..n36 (pleno) y las apuestas externas.
const OUTSIDE = ['red', 'black', 'even', 'odd', 'low', 'high', 'd1', 'd2', 'd3', 'c1', 'c2', 'c3'];
export const SPOTS = [...Array.from({ length: 37 }, (_, n) => 'n' + n), ...OUTSIDE];
const SPOT_SET = new Set(SPOTS);

export function isSpot(spot) {
  return typeof spot === 'string' && SPOT_SET.has(spot);
}

// Pago TOTAL sobre la apuesta (incluye la ficha devuelta): pleno 36x, docenas y columnas 3x, el resto 2x.
export function spotMult(spot) {
  if (spot.charAt(0) === 'n') return 36;
  if (spot === 'd1' || spot === 'd2' || spot === 'd3' || spot === 'c1' || spot === 'c2' || spot === 'c3') return 3;
  return 2;
}

// ¿Gana este lugar si sale el número n? El 0 pierde todo salvo el pleno al 0.
export function spotWins(spot, n) {
  if (spot.charAt(0) === 'n') return n === Number(spot.slice(1));
  if (n === 0) return false;
  switch (spot) {
    case 'red': return REDS.has(n);
    case 'black': return !REDS.has(n);
    case 'even': return n % 2 === 0;
    case 'odd': return n % 2 === 1;
    case 'low': return n <= 18;
    case 'high': return n >= 19;
    case 'd1': return n <= 12;
    case 'd2': return n >= 13 && n <= 24;
    case 'd3': return n >= 25;
    case 'c1': return n % 3 === 1;
    case 'c2': return n % 3 === 2;
    case 'c3': return n % 3 === 0;
    default: return false;
  }
}

const LABELS = {
  red: 'Rojo', black: 'Negro', even: 'Par', odd: 'Impar', low: '1-18', high: '19-36',
  d1: '1ª docena', d2: '2ª docena', d3: '3ª docena', c1: '1ª columna', c2: '2ª columna', c3: '3ª columna',
};

// Nombre legible de un lugar para avisos y registros.
export function spotLabel(spot) {
  if (spot.charAt(0) === 'n') return 'Pleno ' + spot.slice(1);
  return LABELS[spot] || spot;
}
