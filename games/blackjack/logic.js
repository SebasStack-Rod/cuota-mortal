// js/games/blackjack/logic.js: Blackjack contra la banca, todos los sentados juegan a la vez (JavaScript puro, sin DOM).
// Usa solo rng() y now() que recibe. Exporta: meta, createGame, computeRtp, RTP_MEASURED y las constantes de tiempo.
//
// ACCIONES (handleAction):
//   { type: 'bet', amount: 500 }   una sola apuesta por jugador y ronda (solo en `betting`).
//   { type: 'undo' }               retira la apuesta propia y la devuelve (solo en `betting`). Extensión chica sobre el contrato.
//   { type: 'hit' } | { type: 'stand' } | { type: 'double' }   solo en `playing` y con la mano en juego.
//     double: solo con las dos primeras cartas; debita otra apuesta igual, da UNA carta y la mano se planta (o se pasa).
//   { type: 'debug_force', next: ['AceSpades', 'KingHearts', ...] }   SOLO con config.debug === true: las próximas cartas que salgan,
//     en orden de reparto (1ª carta de cada jugador, 1ª de la banca, 2ª de cada jugador, 2ª de la banca, y después las que se pidan).
//     Las forzadas no gastan el zapato.
// Errores: supera_maximo, sin_fondos, apuestas_cerradas, monto_invalido, no_sentado, ya_apostaste, nada_que_deshacer, fuera_de_turno,
//   sin_mano, mano_cerrada, no_puede_doblar, accion_invalida, accion_desconocida.
//
// FASES: betting (15 s) -> dealing (se reparte todo junto, dura 280 ms por carta + 500 ms) -> playing (15 s por mano, se renueva al pedir carta;
//   al agotarse la mano se planta sola) -> dealer (se da vuelta la carta oculta y la banca pide, 900 ms por paso) -> settle (5 s) -> betting.
// REGLAS: zapato de 6 mazos que se baraja cuando queda menos del 25%. La banca pide hasta 17 y se planta en TODO 17 (también blando).
//   Natural (21 con dos cartas) paga 3:2 (2,5x total). Ganar 2x, empate devuelve la apuesta. Sin separar pares ni seguro.
// DECISIÓN: la banca MIRA si tiene natural cuando su carta visible es as o figura. Si lo tiene, no se juega: todas las manos se cierran, los
//   naturales empatan y el resto pierde su apuesta (nunca se dobla contra un natural). Se publica recién en la fase `dealer`.
// DECISIÓN: el máximo del contrato (ctx.limits.maxBet) vale para la apuesta inicial, y doblar solo se permite si 2 x apuesta <= maxBet.
// DECISIÓN: la liquidación (créditos y bet_result, uno por jugador con ref r<ronda>:<id>) ocurre AL EMPEZAR `settle`. El débito de doblar
//   lleva ref r<ronda>:<id>:double. Un empate devuelve la apuesta con kind 'refund'. payoutMult multiplica solo la ganancia.
// DECISIÓN: quien se levanta en `betting` recupera la apuesta. En `dealing` o `playing` su mano se planta sola y se liquida igual en `settle`
//   (la tirada de la banca sigue su curso). En `dealer` o `settle` no pasa nada.
// DECISIÓN: la carta oculta de la banca viaja como null hasta la fase `dealer`; el total de la banca solo cuenta lo que se ve.
// RTP: depende de cómo juegue cada uno. Se mide por simulación (1.000.000 de manos, semilla fija) con estrategia básica simplificada.
import { readLimits } from '../limits.js';
import { handValue, isNatural, makeShoe, shuffle, dealerShouldHit, outcomeOf, outcomeMult, isCard, parseCard, cardValue, simulate } from './rules.js';

export const BETTING_MS = 15000;
export const PLAY_MS = 15000;
export const DEAL_CARD_MS = 280;
export const DEAL_TAIL_MS = 500;
export const DEALER_STEP_MS = 900;
export const SETTLE_MS = 5000;
export const DECKS = 6;
export const RESHUFFLE_BELOW = 0.25;
export const RTP_MEASURED = 0.991144178839186; // simulate({ hands: 1e6, seed: 20260101, strategy: 'basic' }); la prueba lo recalcula y exige igualdad
export const computeRtp = () => simulate({ hands: 1000000, seed: 20260101, strategy: 'basic' }).rtp;
export const meta = { id: 'blackjack', name: 'Blackjack', mode: 'shared', minBet: 25, maxBet: null, rtp: RTP_MEASURED };

const fail = (error) => ({ ok: false, error, effects: [] });
const ok = (effects = []) => ({ ok: true, effects });
const pmOf = (ctx) => { const m = Number(ctx && ctx.modifiers && ctx.modifiers.payoutMult); return Number.isFinite(m) && m >= 0 ? m : 1; };

export function createGame({ rng, now, config } = {}) {
  const debug = !!(config && config.debug);
  let phase = 'betting', round = 1, phaseEndsAt = now() + BETTING_MS;
  let shoe = shuffle(makeShoe(DECKS), rng), pos = 0;
  let bets = {}, hands = {}, order = [], left = new Set();
  let dealerFull = [], dealerShown = 0, dealerNextAt = 0, dealerEndsAt = 0, dealStartedAt = null;
  let results = {}, forced = [], limits = readLimits(null), lastPm = 1;

  const refOf = (pid) => `r${round}:${pid}`;
  const draw = () => (forced.length ? forced.shift() : shoe[pos++]);
  const total = DECKS * 52;
  const stakeOf = (pid) => bets[pid] * (hands[pid] && hands[pid].doubled ? 2 : 1);
  const upValue = () => (dealerFull[0] ? cardValue(parseCard(dealerFull[0]).rank) : 0);

  function startDealing(nowMs, effects) {
    const fresh = total - pos < total * RESHUFFLE_BELOW;
    if (fresh) { shoe = shuffle(makeShoe(DECKS), rng); pos = 0; effects.push({ type: 'event', name: 'shoe_shuffled', data: {} }); }
    order = Object.keys(bets);
    hands = {}; for (const pid of order) hands[pid] = { cards: [], status: 'playing', doubled: false, endsAt: 0 };
    dealerFull = [];
    for (let c = 0; c < 2; c++) { for (const pid of order) hands[pid].cards.push(draw()); dealerFull.push(draw()); }
    for (const pid of order) if (isNatural(hands[pid].cards)) hands[pid].status = 'blackjack';
    dealerShown = 0; results = {}; dealStartedAt = nowMs;
    phase = 'dealing'; phaseEndsAt = nowMs + (order.length + 1) * 2 * DEAL_CARD_MS + DEAL_TAIL_MS;
  }

  function startPlaying(nowMs) {
    const up = upValue();
    if (up >= 10 && isNatural(dealerFull)) { // la banca mira: con natural no se juega
      for (const pid of order) if (hands[pid].status === 'playing') hands[pid].status = 'stand';
      return startDealer(nowMs);
    }
    for (const pid of order) {
      const h = hands[pid];
      if (left.has(pid) && h.status === 'playing') h.status = 'stand';
      if (h.status === 'playing') h.endsAt = nowMs + PLAY_MS;
    }
    if (!order.some((pid) => hands[pid].status === 'playing')) return startDealer(nowMs);
    phase = 'playing'; refreshPlayEnd();
  }
  function refreshPlayEnd() {
    const ends = order.filter((pid) => hands[pid].status === 'playing').map((pid) => hands[pid].endsAt);
    if (ends.length) phaseEndsAt = Math.max(...ends);
  }

  function startDealer(nowMs) {
    const live = order.some((pid) => hands[pid].status === 'stand');
    if (live) while (dealerShouldHit(dealerFull)) dealerFull.push(draw()); // se decide ahora, se muestra de a una
    dealerShown = 2; dealerNextAt = nowMs + DEALER_STEP_MS;
    dealerEndsAt = nowMs + (dealerFull.length - 1) * DEALER_STEP_MS;
    phase = 'dealer'; phaseEndsAt = dealerEndsAt;
  }

  function settle(nowMs, ctx, effects) {
    const pm = pmOf(ctx); lastPm = pm;
    for (const pid of order) {
      const h = hands[pid], stake = stakeOf(pid), outcome = outcomeOf(h.cards, dealerFull), mult = outcomeMult(outcome);
      const payout = mult === 0 ? 0 : mult === 1 ? stake : stake + Math.floor((mult - 1) * stake * pm + 1e-9);
      if (payout > 0) effects.push({ type: 'credit', playerId: pid, amount: payout, kind: mult === 1 ? 'refund' : 'payout', ref: refOf(pid) });
      effects.push({ type: 'event', name: 'bet_result', data: { playerId: pid, ref: refOf(pid), stake, payout, detail: {
        outcome, cards: h.cards.slice(), total: handValue(h.cards).total, doubled: h.doubled, dealer: dealerFull.slice(), dealerTotal: handValue(dealerFull).total } } });
      results[pid] = { outcome, stake, payout };
    }
    phase = 'settle'; phaseEndsAt = nowMs + SETTLE_MS;
  }

  function newRound(nowMs) {
    bets = {}; hands = {}; order = []; left = new Set(); dealerFull = []; dealerShown = 0; results = {}; dealStartedAt = null;
    round += 1; phase = 'betting'; phaseEndsAt = nowMs + BETTING_MS;
  }

  function doBet(pid, a, ctx) {
    if (phase !== 'betting') return fail('apuestas_cerradas');
    limits = readLimits(ctx);
    if (!Number.isInteger(a.amount) || a.amount < limits.minBet) return fail('monto_invalido');
    if (Array.isArray(ctx.seats) && !ctx.seats.includes(pid)) return fail('no_sentado');
    if (bets[pid]) return fail('ya_apostaste');
    if (a.amount > limits.maxBet) return fail('supera_maximo');
    if (a.amount > ctx.bank) return fail('sin_fondos');
    bets[pid] = a.amount;
    return ok([{ type: 'debit', playerId: pid, amount: a.amount, kind: 'bet', ref: refOf(pid) }]);
  }
  function doUndo(pid) {
    if (phase !== 'betting') return fail('apuestas_cerradas');
    if (!bets[pid]) return fail('nada_que_deshacer');
    const amount = bets[pid]; delete bets[pid];
    return ok([{ type: 'credit', playerId: pid, amount, kind: 'refund', ref: refOf(pid) }]);
  }
  function myHand(pid) {
    if (phase !== 'playing') return { err: 'fuera_de_turno' };
    const h = hands[pid];
    if (!h) return { err: 'sin_mano' };
    if (h.status !== 'playing') return { err: 'mano_cerrada' };
    return { h };
  }
  function afterCard(h, nowMs) {
    const t = handValue(h.cards).total;
    if (t > 21) h.status = 'bust'; else if (t === 21) h.status = 'stand'; else h.endsAt = nowMs + PLAY_MS;
    refreshPlayEnd();
  }
  function doPlay(pid, type, ctx) {
    const { h, err } = myHand(pid);
    if (err) return fail(err);
    const t = now();
    if (type === 'stand') { h.status = 'stand'; return ok(); }
    if (type === 'hit') { h.cards.push(draw()); afterCard(h, t); return ok(); }
    if (h.cards.length !== 2 || h.doubled) return fail('no_puede_doblar');
    limits = readLimits(ctx);
    if (bets[pid] * 2 > limits.maxBet) return fail('supera_maximo');
    if (bets[pid] > ctx.bank) return fail('sin_fondos');
    h.doubled = true; h.cards.push(draw());
    if (handValue(h.cards).total > 21) h.status = 'bust'; else h.status = 'stand';
    refreshPlayEnd();
    return ok([{ type: 'debit', playerId: pid, amount: bets[pid], kind: 'bet', ref: refOf(pid) + ':double' }]);
  }

  return {
    getPublicState() {
      const up = phase === 'dealing' || phase === 'playing';
      const dcards = phase === 'betting' ? [] : up ? [dealerFull[0] || null, null] : dealerFull.slice(0, dealerShown);
      const vis = dcards.filter(Boolean);
      const hv = {};
      for (const pid of order) {
        const h = hands[pid], v = handValue(h.cards);
        hv[pid] = { cards: h.cards.slice(), bet: stakeOf(pid), doubled: h.doubled, status: h.status, total: v.total, soft: v.soft, endsAt: h.status === 'playing' ? h.endsAt : null };
      }
      return {
        phase, phaseEndsAt, round, order: order.slice(), bets: { ...bets }, hands: hv,
        dealer: { cards: dcards, total: vis.length ? handValue(vis).total : null, status: !up && phase !== 'betting' && dealerShown >= dealerFull.length && vis.length >= 2 ? (isNatural(vis) ? 'blackjack' : handValue(vis).total > 21 ? 'bust' : 'stand') : null },
        results: phase === 'settle' ? JSON.parse(JSON.stringify(results)) : {},
        dealStartedAt: phase === 'betting' ? null : dealStartedAt, dealStepMs: DEAL_CARD_MS,
        shoe: { left: total - pos, total },
        limits: { min: limits.minBet, max: limits.maxBet },
      };
    },

    handleAction(pid, action, ctx) {
      if (!action || typeof action.type !== 'string') return fail('accion_invalida');
      switch (action.type) {
        case 'bet': return doBet(pid, action, ctx);
        case 'undo': return doUndo(pid);
        case 'hit': case 'stand': case 'double': return doPlay(pid, action.type, ctx);
        case 'debug_force': {
          if (!debug || !Array.isArray(action.next) || !action.next.every(isCard)) return fail('accion_desconocida');
          forced = action.next.slice(); return ok();
        }
        default: return fail('accion_desconocida');
      }
    },

    tick(nowMs, ctx) {
      limits = readLimits(ctx); lastPm = pmOf(ctx);
      const effects = [];
      if (phase === 'betting') {
        if (nowMs < phaseEndsAt) return effects;
        if (!Object.keys(bets).length) { phaseEndsAt = nowMs + BETTING_MS; return effects; }
        startDealing(nowMs, effects);
      } else if (phase === 'dealing') {
        if (nowMs >= phaseEndsAt) startPlaying(nowMs);
      } else if (phase === 'playing') {
        for (const pid of order) if (hands[pid].status === 'playing' && nowMs >= hands[pid].endsAt) hands[pid].status = 'stand';
        if (!order.some((pid) => hands[pid].status === 'playing')) startDealer(nowMs); else refreshPlayEnd();
      } else if (phase === 'dealer') {
        while (dealerShown < dealerFull.length && nowMs >= dealerNextAt) { dealerShown++; dealerNextAt += DEALER_STEP_MS; }
        if (dealerShown >= dealerFull.length && nowMs >= dealerEndsAt) settle(nowMs, ctx, effects);
      } else if (nowMs >= phaseEndsAt) newRound(nowMs);
      return effects;
    },

    onSeatLeft(pid, ctx) {
      void ctx;
      if (phase === 'betting') return doUndo(pid).effects;
      if (!hands[pid]) return [];
      if (phase === 'dealing') left.add(pid);
      else if (phase === 'playing' && hands[pid].status === 'playing') { hands[pid].status = 'stand'; refreshPlayEnd(); }
      return [];
    },
  };
}
