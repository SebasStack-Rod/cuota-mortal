// js/games/roulette/logic.js: reglas, pagos y estado de la ruleta europea (JavaScript puro, sin DOM).
// Corre en el celular del anfitrión y en el sandbox. Usa solo rng() y now() que recibe (nada de Date.now ni Math.random).
// Exporta: meta, createGame, computeRtp.
//
// ACCIONES (handleAction):
//   { type: 'bet', spot: 'red', amount: 500 }  apuesta una ficha. spot: n0..n36, red, black, even, odd, low, high, d1..d3, c1..c3.
//   { type: 'undo' }    quita la última ficha del jugador y se la devuelve (refund).
//   { type: 'clear' }   devuelve todas las apuestas del jugador en esta ronda.
//   { type: 'rebet' }   repite las fichas de la última ronda en que apostó (si alcanza el banco y todavía no apostó en esta).
//   { type: 'debug_force', number: 17 }   SOLO si config.debug === true (sandbox): fuerza el próximo número.
// LÍMITES: el monto es libre (cualquier entero en centavos) entre ctx.limits.minBet y ctx.limits.maxBet. El máximo es la SUMA
//   de lo que un jugador apuesta en la ronda (todos los lugares juntos). Sin ctx.limits se usa el tope del día 1 ($200).
// Errores posibles: supera_maximo, sin_fondos, apuestas_cerradas, lugar_invalido, monto_invalido, no_sentado, demasiadas_fichas,
//   demasiados_lugares, nada_que_deshacer, sin_apuestas_previas, ya_apostaste, accion_invalida, accion_desconocida.
//
// FASES: betting (20 s) -> spinning (9 s) -> result (6 s) -> betting. Si al cerrar las apuestas nadie apostó, no se gira.
// PAGOS (total sobre la apuesta): pleno 36x; rojo/negro/par/impar/bajo/alto 2x; docenas y columnas 3x. El 0 pierde todo salvo el pleno.
// RTP teórico = 36/37 = 0,9730 en todos los lugares (un solo cero). Se calcula con computeRtp().
//
// DECISIÓN: un `bet_result` por cada (jugador, lugar). Si apostás 3 fichas al rojo y 1 al 17, son 2 apuestas liquidadas.
// DECISIÓN: el número sorteado se publica en `result` desde que empieza `spinning` (las apuestas ya están cerradas) porque
//   la vista lo necesita para que la bola caiga en el bolsillo exacto. La vista no lo muestra hasta que la bola frena.
// DECISIÓN: si alguien se levanta durante `spinning`, sus apuestas se liquidan al instante con el número ya sorteado
//   (devolverlas sería una trampa: se vería el resultado y se saldría a tiempo).
import {
  WHEEL, BETTING_MS, SPIN_PHASE_MS, RESULT_MS, HISTORY_LEN, MIN_BET, MAX_CHIPS_PER_PLAYER, MAX_SPOTS_PER_PLAYER,
  SPOTS, isSpot, spotWins, spotMult, colorOf,
} from './constants.js';
import { makeSpin, wheelAngleAt, idleAngleAt } from './spinmath.js';
import { readLimits } from '../limits.js';

// RTP exacto: para cada lugar se suman los pagos de los 37 resultados y se divide por 37.
export function computeRtp() {
  let sum = 0;
  for (const spot of SPOTS) {
    let ret = 0;
    for (let n = 0; n < 37; n++) if (spotWins(spot, n)) ret += spotMult(spot);
    sum += ret / 37;
  }
  return sum / SPOTS.length;
}

export const meta = {
  id: 'roulette', name: 'Ruleta', mode: 'shared',
  minBet: MIN_BET, maxBet: null, rtp: computeRtp(),
};

const fail = (error) => ({ ok: false, error, effects: [] });
const ok = (effects = []) => ({ ok: true, effects });

export function createGame({ rng, now, config } = {}) {
  const debug = !!(config && config.debug);
  let phase = 'betting';
  let round = 1;
  let phaseEndsAt = now() + BETTING_MS;
  let bets = {};        // playerId -> [{ spot, amount }]  (una entrada por ficha, en orden)
  let lastBets = {};    // playerId -> fichas de la última ronda en que apostó (para 'rebet')
  let result = null;    // número sorteado (desde que empieza el giro)
  let spin = null;      // último giro (se conserva para que la rueda siga girando sin saltos)
  let history = [];     // últimos números, el más nuevo primero
  let payouts = {};     // playerId -> { stake, payout } de la ronda que se liquidó
  let forced = null;
  let limits = readLimits(null);   // últimos límites que mandó el anfitrión (viajan en el estado público para la vista)

  const refOf = (pid, spot) => `r${round}:${pid}:${spot}`;

  // Suma las fichas de un jugador por lugar, respetando el orden de aparición.
  function byspot(chips) {
    const m = new Map();
    for (const c of chips) m.set(c.spot, (m.get(c.spot) || 0) + c.amount);
    return m;
  }
  const hasAnyBet = () => Object.keys(bets).some((pid) => bets[pid].length > 0);

  function refundAll(pid) {
    const chips = bets[pid];
    if (!chips || !chips.length) return [];
    const effects = [];
    for (const [spot, amount] of byspot(chips)) {
      effects.push({ type: 'credit', playerId: pid, amount, kind: 'refund', ref: refOf(pid, spot) });
    }
    delete bets[pid];
    return effects;
  }

  // Liquida las apuestas de los jugadores indicados con el número sorteado.
  function settle(ctx, pids) {
    const mult = Number(ctx && ctx.modifiers && ctx.modifiers.payoutMult);
    const payoutMult = Number.isFinite(mult) && mult >= 0 ? mult : 1;
    const effects = [];
    for (const pid of pids) {
      const chips = bets[pid];
      if (!chips || !chips.length) continue;
      let stakeTotal = 0;
      let payoutTotal = 0;
      for (const [spot, stake] of byspot(chips)) {
        // payoutMult multiplica solo la GANANCIA, no la apuesta devuelta.
        const payout = spotWins(spot, result)
          ? stake + Math.floor((spotMult(spot) - 1) * stake * payoutMult + 1e-9)
          : 0;
        const ref = refOf(pid, spot);
        if (payout > 0) effects.push({ type: 'credit', playerId: pid, amount: payout, kind: 'payout', ref });
        effects.push({
          type: 'event', name: 'bet_result',
          data: { playerId: pid, ref, stake, payout, detail: { spot, number: result, color: colorOf(result) } },
        });
        stakeTotal += stake;
        payoutTotal += payout;
      }
      lastBets[pid] = chips.map((c) => ({ spot: c.spot, amount: c.amount }));
      payouts[pid] = { stake: stakeTotal, payout: payoutTotal };
    }
    return effects;
  }

  function doBet(playerId, a, ctx) {
    if (phase !== 'betting') return fail('apuestas_cerradas');
    if (!isSpot(a.spot)) return fail('lugar_invalido');
    limits = readLimits(ctx);
    if (!Number.isInteger(a.amount) || a.amount < limits.minBet) return fail('monto_invalido');
    if (Array.isArray(ctx.seats) && !ctx.seats.includes(playerId)) return fail('no_sentado');
    const mine = bets[playerId] || [];
    if (mine.reduce((s, c) => s + c.amount, 0) + a.amount > limits.maxBet) return fail('supera_maximo');
    if (mine.length >= MAX_CHIPS_PER_PLAYER) return fail('demasiadas_fichas');
    if (!mine.some((c) => c.spot === a.spot) && byspot(mine).size >= MAX_SPOTS_PER_PLAYER) return fail('demasiados_lugares');
    if (a.amount > ctx.bank) return fail('sin_fondos');
    mine.push({ spot: a.spot, amount: a.amount });
    bets[playerId] = mine;
    return ok([{ type: 'debit', playerId, amount: a.amount, kind: 'bet', ref: refOf(playerId, a.spot) }]);
  }

  function doUndo(playerId) {
    if (phase !== 'betting') return fail('apuestas_cerradas');
    const mine = bets[playerId];
    if (!mine || !mine.length) return fail('nada_que_deshacer');
    const last = mine.pop();
    if (!mine.length) delete bets[playerId];
    return ok([{ type: 'credit', playerId, amount: last.amount, kind: 'refund', ref: refOf(playerId, last.spot) }]);
  }

  function doClear(playerId) {
    if (phase !== 'betting') return fail('apuestas_cerradas');
    const effects = refundAll(playerId);
    return effects.length ? ok(effects) : fail('nada_que_deshacer');
  }

  function doRebet(playerId, ctx) {
    if (phase !== 'betting') return fail('apuestas_cerradas');
    if (Array.isArray(ctx.seats) && !ctx.seats.includes(playerId)) return fail('no_sentado');
    if (bets[playerId] && bets[playerId].length) return fail('ya_apostaste');
    const prev = lastBets[playerId];
    if (!prev || !prev.length) return fail('sin_apuestas_previas');
    limits = readLimits(ctx);
    const total = prev.reduce((s, c) => s + c.amount, 0);
    if (total > limits.maxBet) return fail('supera_maximo');
    if (total > ctx.bank) return fail('sin_fondos');
    bets[playerId] = prev.map((c) => ({ spot: c.spot, amount: c.amount }));
    const effects = [];
    for (const [spot, amount] of byspot(prev)) {
      effects.push({ type: 'debit', playerId, amount, kind: 'bet', ref: refOf(playerId, spot) });
    }
    return ok(effects);
  }

  const game = {
    getPublicState() {
      const pub = {};
      for (const pid of Object.keys(bets)) {
        if (!bets[pid].length) continue;
        const o = {};
        for (const [spot, amount] of byspot(bets[pid])) o[spot] = amount;
        pub[pid] = o;
      }
      const inRound = phase === 'spinning' || phase === 'result';
      return {
        phase, phaseEndsAt, round,
        bets: pub,
        history: history.slice(),
        limits: { min: limits.minBet, max: limits.maxBet },
        result: inRound ? result : null,
        spin: spin ? { ...spin } : null,
        payouts: phase === 'result' ? JSON.parse(JSON.stringify(payouts)) : null,
      };
    },

    handleAction(playerId, action, ctx) {
      if (!action || typeof action.type !== 'string') return fail('accion_invalida');
      switch (action.type) {
        case 'bet': return doBet(playerId, action, ctx);
        case 'undo': return doUndo(playerId);
        case 'clear': return doClear(playerId);
        case 'rebet': return doRebet(playerId, ctx);
        case 'debug_force':
          if (!debug || !Number.isInteger(action.number) || action.number < 0 || action.number > 36) return fail('accion_desconocida');
          forced = action.number;
          return ok();
        default: return fail('accion_desconocida');
      }
    },

    tick(nowMs, ctx) {
      limits = readLimits(ctx);
      if (nowMs < phaseEndsAt) return [];
      if (phase === 'betting') {
        if (!hasAnyBet()) { phaseEndsAt = nowMs + BETTING_MS; return []; } // nadie apostó: otra ronda de apuestas
        result = forced != null ? forced : Math.floor(rng() * WHEEL.length);
        forced = null;
        const startAngle = spin ? wheelAngleAt(spin, nowMs) : idleAngleAt(nowMs);
        spin = makeSpin(rng, nowMs, result, startAngle);
        payouts = {};
        phase = 'spinning';
        phaseEndsAt = nowMs + SPIN_PHASE_MS;
        return [];
      }
      if (phase === 'spinning') {
        const effects = settle(ctx, Object.keys(bets));
        history.unshift(result);
        if (history.length > HISTORY_LEN) history.length = HISTORY_LEN;
        phase = 'result';
        phaseEndsAt = nowMs + RESULT_MS;
        return effects;
      }
      // phase === 'result': arranca una ronda nueva
      bets = {};
      payouts = {};
      result = null;
      round += 1;
      phase = 'betting';
      phaseEndsAt = nowMs + BETTING_MS;
      return [];
    },

    onSeatLeft(playerId, ctx) {
      if (phase === 'betting') return refundAll(playerId);
      if (phase === 'spinning') {
        const effects = settle(ctx, [playerId]);
        delete bets[playerId];
        return effects;
      }
      return []; // en `result` ya se liquidó todo
    },
  };
  return game;
}
