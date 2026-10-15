// js/games/dice/logic.js: reglas, pagos y estado de los Dados, más o menos de 7 (JavaScript puro, sin DOM).
// Corre en el celular del anfitrión y en el sandbox. Usa solo rng() y now() que recibe (nada de Date.now ni Math.random).
// Exporta: meta, createGame, computeRtp, rtpBySpot, SPOTS, spotWins, spotMult, y las constantes de tiempo.
//
// ACCIONES (handleAction):
//   { type: 'bet', spot: 'under' | 'over' | 'seven', amount: 500 }   apuesta una ficha (solo en `betting`).
//   { type: 'undo' }     quita la última ficha del jugador y se la devuelve (refund).
//   { type: 'reroll' }   DADOS CARGADOS: durante `result`, si ctx.modifiers.rerolls > 0 y el jugador tiene alguna apuesta perdedora,
//                        lanza de nuevo SOLO sus dados. Una vez por ronda. Emite el evento `reroll_used` { playerId } y el anfitrión descuenta el objeto.
//   { type: 'debug_force', dice: [3, 4] }   SOLO si config.debug === true (sandbox): fuerza los dados de la mesa de la próxima tirada.
// LÍMITES: monto libre (entero en centavos) entre ctx.limits.minBet y ctx.limits.maxBet. El máximo es la SUMA de lo que un jugador
//   apuesta en la ronda (los tres lugares juntos). El reroll no cambia la apuesta. Sin ctx.limits se usa el tope del día 1 ($200).
// Errores: supera_maximo, sin_fondos, apuestas_cerradas, lugar_invalido, monto_invalido, no_sentado, demasiadas_fichas,
//   nada_que_deshacer, sin_apuestas, sin_dados_cargados, fuera_de_resultado, nada_que_relanzar, ya_relanzaste, accion_invalida, accion_desconocida.
//
// FASES: betting (12 s) -> rolling (3 s) -> result (5 s) -> betting. Si al cerrar las apuestas nadie apostó, no se tira.
// PAGOS (total sobre la apuesta): under = suma 2 a 6 (15/36) paga 2,3x; over = suma 8 a 12 (15/36) paga 2,3x; seven = suma 7 (6/36) paga 5,6x.
// RTP: under y over 0,9583; seven 0,9333. computeRtp() devuelve el promedio de los tres lugares (0,9500).
//
// LIQUIDACIÓN: a diferencia de la ruleta, los créditos y los `bet_result` se emiten al FINAL de `result` (así el reroll todavía puede
//   cambiar el resultado de un jugador). Si alguien se levanta en `rolling` o en `result`, sus apuestas se liquidan al instante con los
//   dados que tiene en ese momento (devolverlas sería una trampa: se vería el resultado y se saldría a tiempo).
// DECISIÓN: los dados de la mesa se publican desde que empieza `rolling` (las apuestas ya están cerradas) porque la vista necesita las
//   caras finales para animar. La vista no muestra la suma hasta que los dados frenan.
// DECISIÓN: el reroll relanza los dos dados del jugador y TODAS sus apuestas se evalúan con esos dados nuevos (puede salir peor).
//   Los dados relanzados viajan en `rerolls[playerId] = { dice, at }`. Si el reroll llega con menos de 2 s de `result`, se alarga la
//   fase hasta now + 2 s para que se vea la animación (REROLL_VIEW_MS).
// DECISIÓN: el pago provisional de `result` (`payouts`) usa el último payoutMult que mandó el anfitrión; el crédito real usa el del ctx de la liquidación.
// DECISIÓN: ctx.modifiers.rerolls se lee en el momento de la acción (cuántos relanzamientos tiene disponibles quien actúa). El anfitrión debe
//   descontar uno al recibir `reroll_used`.
import { readLimits } from '../limits.js';

export const BETTING_MS = 12000;
export const ROLLING_MS = 3000;
export const RESULT_MS = 5000;
export const REROLL_VIEW_MS = 2000;
export const HISTORY_LEN = 12;
export const MAX_CHIPS_PER_PLAYER = 24;
export const SPOTS = ['under', 'over', 'seven'];

const MULT = { under: 2.3, over: 2.3, seven: 5.6 };
export const spotMult = (spot) => MULT[spot];
export const isSpot = (s) => SPOTS.includes(s);
export function spotWins(spot, sum) {
  if (spot === 'under') return sum >= 2 && sum <= 6;
  if (spot === 'over') return sum >= 8 && sum <= 12;
  return sum === 7;
}

// RTP exacto por lugar: se enumeran las 36 combinaciones de dos dados.
export function rtpBySpot() {
  const out = {};
  for (const spot of SPOTS) {
    let ret = 0;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (spotWins(spot, a + b)) ret += MULT[spot];
    out[spot] = ret / 36;
  }
  return out;
}
export function computeRtp() {
  const r = rtpBySpot();
  return SPOTS.reduce((s, k) => s + r[k], 0) / SPOTS.length;
}

export const meta = { id: 'dice', name: 'Dados', mode: 'shared', minBet: 25, maxBet: null, rtp: computeRtp() };

const fail = (error) => ({ ok: false, error, effects: [] });
const ok = (effects = []) => ({ ok: true, effects });
const pmOf = (ctx) => {
  const m = Number(ctx && ctx.modifiers && ctx.modifiers.payoutMult);
  return Number.isFinite(m) && m >= 0 ? m : 1;
};
// payoutMult multiplica solo la GANANCIA, no la apuesta devuelta.
const payoutFor = (spot, stake, sum, pm) => (spotWins(spot, sum) ? stake + Math.floor((MULT[spot] - 1) * stake * pm + 1e-9) : 0);

export function createGame({ rng, now, config } = {}) {
  const debug = !!(config && config.debug);
  let phase = 'betting';
  let round = 1;
  let phaseEndsAt = now() + BETTING_MS;
  let bets = {};          // playerId -> [{ spot, amount }]  (una entrada por ficha, en orden)
  let dice = null;        // [a, b] de la mesa (desde que empieza `rolling`)
  let rolledAt = null;    // ms en que empezó `rolling`
  let rerolls = {};       // playerId -> { dice: [a, b], at }
  let settled = {};       // playerId -> { stake, payout } de quienes ya se liquidaron en esta ronda
  let history = [];       // sumas de la mesa, la más nueva primero
  let forced = null;
  let limits = readLimits(null);
  let lastPm = 1;

  const refOf = (pid, spot) => `r${round}:${pid}:${spot}`;
  const roll1 = () => 1 + Math.floor(rng() * 6);
  const sumOf = (d) => d[0] + d[1];
  const diceOf = (pid) => (rerolls[pid] ? rerolls[pid].dice : dice);

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
    for (const [spot, amount] of byspot(chips)) effects.push({ type: 'credit', playerId: pid, amount, kind: 'refund', ref: refOf(pid, spot) });
    delete bets[pid];
    return effects;
  }

  // Cuánto paga HOY la apuesta de un jugador con sus dados actuales.
  function evalPlayer(pid, pm) {
    const d = diceOf(pid), sum = sumOf(d);
    let stake = 0, payout = 0;
    const lines = [];
    for (const [spot, s] of byspot(bets[pid] || [])) {
      const p = payoutFor(spot, s, sum, pm);
      stake += s; payout += p; lines.push({ spot, stake: s, payout: p });
    }
    return { stake, payout, lines, sum, dice: d };
  }

  // Liquida (créditos + un bet_result por lugar) a los jugadores indicados que todavía no se liquidaron.
  function settle(ctx, pids) {
    const pm = pmOf(ctx);
    lastPm = pm;
    const effects = [];
    for (const pid of pids) {
      if (!bets[pid] || !bets[pid].length || settled[pid]) continue;
      const ev = evalPlayer(pid, pm);
      for (const l of ev.lines) {
        const ref = refOf(pid, l.spot);
        if (l.payout > 0) effects.push({ type: 'credit', playerId: pid, amount: l.payout, kind: 'payout', ref });
        effects.push({
          type: 'event', name: 'bet_result',
          data: { playerId: pid, ref, stake: l.stake, payout: l.payout, detail: { spot: l.spot, dice: ev.dice.slice(), sum: ev.sum, rerolled: !!rerolls[pid] } },
        });
      }
      settled[pid] = { stake: ev.stake, payout: ev.payout };
    }
    return effects;
  }

  function doBet(pid, a, ctx) {
    if (phase !== 'betting') return fail('apuestas_cerradas');
    if (!isSpot(a.spot)) return fail('lugar_invalido');
    limits = readLimits(ctx);
    if (!Number.isInteger(a.amount) || a.amount < limits.minBet) return fail('monto_invalido');
    if (Array.isArray(ctx.seats) && !ctx.seats.includes(pid)) return fail('no_sentado');
    const mine = bets[pid] || [];
    if (mine.reduce((s, c) => s + c.amount, 0) + a.amount > limits.maxBet) return fail('supera_maximo');
    if (mine.length >= MAX_CHIPS_PER_PLAYER) return fail('demasiadas_fichas');
    if (a.amount > ctx.bank) return fail('sin_fondos');
    mine.push({ spot: a.spot, amount: a.amount });
    bets[pid] = mine;
    return ok([{ type: 'debit', playerId: pid, amount: a.amount, kind: 'bet', ref: refOf(pid, a.spot) }]);
  }

  function doUndo(pid) {
    if (phase !== 'betting') return fail('apuestas_cerradas');
    const mine = bets[pid];
    if (!mine || !mine.length) return fail('nada_que_deshacer');
    const last = mine.pop();
    if (!mine.length) delete bets[pid];
    return ok([{ type: 'credit', playerId: pid, amount: last.amount, kind: 'refund', ref: refOf(pid, last.spot) }]);
  }

  function doReroll(pid, ctx) {
    if (phase !== 'result') return fail('fuera_de_resultado');
    if (!bets[pid] || !bets[pid].length) return fail('sin_apuestas');
    if (settled[pid]) return fail('nada_que_relanzar');
    if (rerolls[pid]) return fail('ya_relanzaste');
    const n = Number(ctx && ctx.modifiers && ctx.modifiers.rerolls);
    if (!(n > 0)) return fail('sin_dados_cargados');
    // Solo tiene sentido (y solo se permite) si alguna apuesta pierde con los dados que tiene ahora.
    if (!evalPlayer(pid, 1).lines.some((l) => l.payout === 0)) return fail('nada_que_relanzar');
    const t = now();
    rerolls[pid] = { dice: [roll1(), roll1()], at: t };
    phaseEndsAt = Math.max(phaseEndsAt, t + REROLL_VIEW_MS);
    return ok([{ type: 'event', name: 'reroll_used', data: { playerId: pid } }]);
  }

  return {
    getPublicState() {
      const pub = {};
      for (const pid of Object.keys(bets)) {
        if (!bets[pid].length) continue;
        const o = {};
        for (const [spot, amount] of byspot(bets[pid])) o[spot] = amount;
        pub[pid] = o;
      }
      const inRound = phase === 'rolling' || phase === 'result';
      let payouts = null;
      if (phase === 'result') { // pago provisional: el crédito real llega al final de `result`
        payouts = {};
        for (const pid of Object.keys(bets)) {
          if (!bets[pid].length) continue;
          if (settled[pid]) payouts[pid] = { ...settled[pid] };
          else { const ev = evalPlayer(pid, lastPm); payouts[pid] = { stake: ev.stake, payout: ev.payout }; }
        }
        for (const pid of Object.keys(settled)) if (!payouts[pid]) payouts[pid] = { ...settled[pid] };
      }
      return {
        phase, phaseEndsAt, round,
        bets: pub,
        dice: inRound && dice ? dice.slice() : null,
        rolledAt: inRound ? rolledAt : null,
        rerolls: phase === 'result' ? JSON.parse(JSON.stringify(rerolls)) : {},
        payouts,
        history: history.slice(),
        limits: { min: limits.minBet, max: limits.maxBet },
      };
    },

    handleAction(pid, action, ctx) {
      if (!action || typeof action.type !== 'string') return fail('accion_invalida');
      switch (action.type) {
        case 'bet': return doBet(pid, action, ctx);
        case 'undo': return doUndo(pid);
        case 'reroll': return doReroll(pid, ctx);
        case 'debug_force': {
          const d = action.dice;
          if (!debug || !Array.isArray(d) || d.length !== 2 || !d.every((x) => Number.isInteger(x) && x >= 1 && x <= 6)) return fail('accion_desconocida');
          forced = d.slice();
          return ok();
        }
        default: return fail('accion_desconocida');
      }
    },

    tick(nowMs, ctx) {
      limits = readLimits(ctx);
      lastPm = pmOf(ctx);
      if (nowMs < phaseEndsAt) return [];
      if (phase === 'betting') {
        if (!hasAnyBet()) { phaseEndsAt = nowMs + BETTING_MS; return []; } // nadie apostó: otra ronda de apuestas
        dice = forced || [roll1(), roll1()];
        forced = null;
        rolledAt = nowMs; rerolls = {}; settled = {};
        phase = 'rolling'; phaseEndsAt = nowMs + ROLLING_MS;
        return [];
      }
      if (phase === 'rolling') {
        history.unshift(sumOf(dice));
        if (history.length > HISTORY_LEN) history.length = HISTORY_LEN;
        phase = 'result'; phaseEndsAt = nowMs + RESULT_MS;
        return [];
      }
      // phase === 'result': se liquida todo lo pendiente y arranca una ronda nueva
      const effects = settle(ctx, Object.keys(bets));
      bets = {}; dice = null; rolledAt = null; rerolls = {}; settled = {};
      round += 1; phase = 'betting'; phaseEndsAt = nowMs + BETTING_MS;
      return effects;
    },

    onSeatLeft(pid, ctx) {
      if (phase === 'betting') return refundAll(pid);
      const effects = settle(ctx, [pid]); // rolling o result: se liquida ya, con los dados que tiene
      return effects;
    },
  };
}
