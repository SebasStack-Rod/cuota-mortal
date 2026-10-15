// js/games/blackjack/rules.js: reglas puras del blackjack (cartas, valores, zapato, resultado de una mano, estrategias y simulación del RTP).
// Sin DOM, sin Date.now ni Math.random: la simulación usa su propio RNG con semilla. Lo usan logic.js, view.js y las pruebas.
// Cartas con formato `RangoPalo` (AceSpades, 10Hearts, KingClubs) que mapea a assets/cards/<carta>.png.
// Exporta SUITS, RANKS, parseCard, isCard, cardValue, handValue, isNatural, makeShoe, shuffle, dealerShouldHit, outcomeOf, outcomeMult, basicAction, mimicAction, simulate.
export const SUITS = ['Spades', 'Hearts', 'Diamonds', 'Clubs'];
export const RANKS = ['Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King'];
const CARD_RE = /^(Ace|[2-9]|10|Jack|Queen|King)(Spades|Hearts|Diamonds|Clubs)$/;

export function parseCard(name) { const m = CARD_RE.exec(String(name)); return m ? { rank: m[1], suit: m[2] } : null; }
export const isCard = (name) => CARD_RE.test(String(name));
export function cardValue(rank) { return rank === 'Ace' ? 11 : rank === 'Jack' || rank === 'Queen' || rank === 'King' ? 10 : Number(rank); }

// Total de una mano. Los ases valen 11 y bajan a 1 de a uno mientras se pase de 21. `soft` = queda algún as contando 11.
export function handValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { const r = parseCard(c).rank; total += cardValue(r); if (r === 'Ace') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
export const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;

export function makeShoe(decks = 6) {
  const out = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) out.push(r + s);
  return out;
}
export function shuffle(arr, rng) { // Fisher-Yates
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// La banca pide con menos de 17 y se planta en TODO 17 (también en 17 blando).
export const dealerShouldHit = (cards) => handValue(cards).total < 17;

// Resultado de una mano ya terminada contra la banca ya jugada. Devuelve 'blackjack' | 'win' | 'push' | 'lose' | 'bust'.
export function outcomeOf(playerCards, dealerCards) {
  const pn = isNatural(playerCards), dn = isNatural(dealerCards);
  if (pn) return dn ? 'push' : 'blackjack';
  const p = handValue(playerCards).total;
  if (p > 21) return 'bust';
  if (dn) return 'lose';
  const d = handValue(dealerCards).total;
  if (d > 21 || p > d) return 'win';
  return p === d ? 'push' : 'lose';
}
// Multiplicador sobre la apuesta TOTAL (incluida la doblada): natural 2,5x, ganar 2x, empate 1x, perder 0.
export const outcomeMult = (o) => (o === 'blackjack' ? 2.5 : o === 'win' ? 2 : o === 'push' ? 1 : 0);

// Estrategia básica SIMPLIFICADA (sin separar pares ni seguro). up = carta visible de la banca (valor 2 a 11).
export function basicAction(cards, up, canDouble) {
  const { total, soft } = handValue(cards);
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return up >= 3 && up <= 6 && canDouble ? 'double' : up <= 8 ? 'stand' : 'hit';
    return (total === 17 || total === 16 ? up >= 4 && up <= 6 : up >= 5 && up <= 6) && canDouble ? 'double' : 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  if (total === 11) return canDouble ? 'double' : 'hit';
  if (total === 10) return up <= 9 && canDouble ? 'double' : 'hit';
  if (total === 9) return up >= 3 && up <= 6 && canDouble ? 'double' : 'hit';
  return 'hit';
}
// "Imitar a la banca": pide hasta 17 y nunca dobla.
export const mimicAction = (cards) => (handValue(cards).total < 17 ? 'hit' : 'stand');

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Simula `hands` manos de UN jugador contra la banca con las mismas reglas del juego (zapato de 6 mazos, se baraja con menos del 25%,
// la banca mira si tiene natural con as o figura, se planta en 17 blando). Devuelve { rtp, staked, returned }.
export function simulate({ hands = 1000000, seed = 20260101, strategy = 'basic', decks = 6 } = {}) {
  const rng = mulberry32(seed), total = decks * 52;
  let shoe = shuffle(makeShoe(decks), rng), pos = 0, staked = 0, returned = 0;
  const draw = () => shoe[pos++];
  for (let h = 0; h < hands; h++) {
    if (total - pos < total * 0.25) { shoe = shuffle(makeShoe(decks), rng); pos = 0; }
    const p = [draw()], d = [draw()];
    p.push(draw()); d.push(draw());
    let stake = 1, doubled = false;
    const up = cardValue(parseCard(d[0]).rank);
    const peekNatural = up >= 10 && isNatural(d);
    if (!isNatural(p) && !peekNatural) {
      for (;;) {
        const t = handValue(p).total;
        if (t >= 21) break;
        const a = strategy === 'basic' ? basicAction(p, up, p.length === 2) : mimicAction(p);
        if (a === 'stand') break;
        if (a === 'double') { doubled = true; stake = 2; p.push(draw()); break; }
        p.push(draw());
      }
    }
    if (handValue(p).total <= 21 && !isNatural(p) && !peekNatural) while (dealerShouldHit(d)) d.push(draw());
    staked += stake;
    returned += stake * outcomeMult(outcomeOf(p, d));
    void doubled;
  }
  return { rtp: returned / staked, staked, returned };
}
