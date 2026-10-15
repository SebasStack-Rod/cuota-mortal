// js/games/slots/logic.js: reglas, pagos y estado de la tragamonedas de 3 rodillos y una línea (JavaScript puro, sin DOM).
// Modo `solo`: cada jugador sentado tiene su propia instancia (createGame recibe playerId).
// Exporta: meta, createGame, computeRtp, STRIP, SYMBOLS, payMult y constantes de tiempo.
//
// ACCIONES (handleAction):
//   { type: 'spin', amount: 500 }   gira. Se puede girar en `idle` o en `result`; en `spinning` devuelve 'girando'.
//   { type: 'debug_force', reels: [0, 5, 9] }   SOLO con config.debug === true (sandbox): fuerza las paradas del próximo giro.
// Errores: girando, monto_invalido, supera_maximo, sin_fondos, no_sentado, accion_invalida, accion_desconocida.
//
// SÍMBOLOS: 0 = siete (slot-symbol1), 1 = cerezas (symbol2), 2 = campana (symbol3), 3 = BAR (symbol4), 4 = casilla vacía.
// CADA RODILLO tiene la misma tira de 32 paradas (se sortea una parada al azar por rodillo, así los pesos son los conteos):
//   cerezas 11, campanas 7, BAR 6, vacías 5, sietes 3.
// TABLA DE PAGOS (pago TOTAL sobre la apuesta, línea central):
//   | combinación                           | paga | probabilidad |
//   | 7 7 7                                 | 50x  | (3/32)^3      |
//   | campana x3                            | 20x  | (7/32)^3      |
//   | BAR x3                                | 10x  | (6/32)^3      |
//   | cerezas x3                            |  6x  | (11/32)^3     |
//   | cereza, cereza, otra cosa             |  2x  | (11/32)^2 (21/32) |
//   | cereza en el 1er rodillo y no en el 2º|  1x (devuelve la apuesta) | (11/32)(21/32) |
// RTP exacto = 0,9409 (se calcula enumerando las 32^3 combinaciones en computeRtp()). Objetivo del juego: 0,92 a 0,96.
//
// El resultado se sortea al iniciar el giro y viaja en el estado (`reels`); la vista solo lo anima. El pago se liquida cuando
// termina el giro (spinEndsAt). DECISIÓN: si el jugador se levanta mientras gira, se liquida al instante (devolver sería una trampa).
// El máximo de apuesta (ctx.limits.maxBet) vale POR GIRO. Ver js/games/limits.js.
import { readLimits } from '../limits.js';

export const SYMBOLS = ['seven', 'cherry', 'bell', 'bar', 'blank'];
export const STRIP = [1, 2, 1, 2, 1, 3, 1, 4, 1, 2, 1, 3, 1, 0, 4, 3, 1, 4, 2, 4, 2, 0, 1, 3, 1, 2, 1, 2, 4, 3, 0, 3];
export const SPIN_MS = 2800;       // duración del giro (el último rodillo frena en spinEndsAt)
export const STOP_GAP_MS = 450;    // cada rodillo frena este tiempo antes del siguiente
export const RESULT_MS = 1800;     // cuánto se muestra el resultado antes de volver a `idle`

// Multiplicador total que paga una combinación de paradas [a, b, c] (0 si pierde).
export function payMult(reels) {
  const [s1, s2, s3] = reels.map((r) => STRIP[r]);
  if (s1 === 0 && s2 === 0 && s3 === 0) return 50;
  if (s1 === 2 && s2 === 2 && s3 === 2) return 20;
  if (s1 === 3 && s2 === 3 && s3 === 3) return 10;
  if (s1 === 1 && s2 === 1 && s3 === 1) return 6;
  if (s1 === 1 && s2 === 1) return 2;
  if (s1 === 1) return 1;
  return 0;
}

export function computeRtp() {
  let sum = 0;
  const n = STRIP.length;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) sum += payMult([a, b, c]);
  return sum / (n * n * n);
}

export const meta = { id: 'slots', name: 'Tragamonedas', mode: 'solo', minBet: 25, maxBet: null, rtp: computeRtp() };

const fail = (error) => ({ ok: false, error, effects: [] });
const ok = (effects = []) => ({ ok: true, effects });

export function createGame({ rng, now, config, playerId } = {}) {
  const debug = !!(config && config.debug);
  let phase = 'idle', round = 0, phaseEndsAt = null;
  let reels = [0, 7, 13];          // paradas que se ven ahora (en el primer giro la vista parte de acá)
  let prev = reels.slice();
  let spinStartedAt = null, spinEndsAt = null;
  let amount = 0, lastWin = 0, lastMult = 0;
  let forced = null;
  let limits = readLimits(null);

  const refOf = () => `r${round}:${playerId}`;

  function settle(ctx) {
    const mult = payMult(reels);
    const pm = Number(ctx && ctx.modifiers && ctx.modifiers.payoutMult);
    const payoutMult = Number.isFinite(pm) && pm >= 0 ? pm : 1;
    // payoutMult multiplica solo la GANANCIA (lo que excede la apuesta devuelta)
    const payout = mult > 0 ? amount + Math.floor((mult - 1) * amount * payoutMult + 1e-9) : 0;
    const effects = [];
    if (payout > 0) effects.push({ type: 'credit', playerId, amount: payout, kind: 'payout', ref: refOf() });
    effects.push({
      type: 'event', name: 'bet_result',
      data: { playerId, ref: refOf(), stake: amount, payout, detail: { reels: reels.slice(), symbols: reels.map((r) => SYMBOLS[STRIP[r]]), mult } },
    });
    if (mult === 50) effects.push({ type: 'event', name: 'jackpot', data: { playerId, amount: payout } });
    lastWin = payout; lastMult = mult;
    return effects;
  }

  return {
    getPublicState() {
      return {
        phase, phaseEndsAt, round,
        reels: reels.slice(), prev: prev.slice(),
        spinStartedAt, spinEndsAt,
        amount,
        lastWin: phase === 'spinning' ? null : lastWin,   // el premio se muestra recién cuando termina el giro
        lastMult: phase === 'spinning' ? null : lastMult,
        limits: { min: limits.minBet, max: limits.maxBet },
      };
    },

    handleAction(pid, action, ctx) {
      if (!action || typeof action.type !== 'string') return fail('accion_invalida');
      if (action.type === 'debug_force') {
        const r = action.reels;
        if (!debug || !Array.isArray(r) || r.length !== 3 || !r.every((x) => Number.isInteger(x) && x >= 0 && x < STRIP.length)) return fail('accion_desconocida');
        forced = r.slice();
        return ok();
      }
      if (action.type !== 'spin') return fail('accion_desconocida');
      if (phase === 'spinning') return fail('girando');
      limits = readLimits(ctx);
      if (!Number.isInteger(action.amount) || action.amount < limits.minBet) return fail('monto_invalido');
      if (action.amount > limits.maxBet) return fail('supera_maximo');
      if (Array.isArray(ctx.seats) && !ctx.seats.includes(pid)) return fail('no_sentado');
      if (action.amount > ctx.bank) return fail('sin_fondos');
      const t = now();
      prev = reels.slice();
      reels = forced || [0, 1, 2].map(() => Math.floor(rng() * STRIP.length));
      forced = null;
      round += 1; amount = action.amount;
      spinStartedAt = t; spinEndsAt = t + SPIN_MS;
      phase = 'spinning'; phaseEndsAt = spinEndsAt;
      return ok([{ type: 'debit', playerId: pid, amount, kind: 'bet', ref: refOf() }]);
    },

    tick(nowMs, ctx) {
      limits = readLimits(ctx);
      if (phase === 'spinning' && nowMs >= spinEndsAt) {
        const effects = settle(ctx);
        phase = 'result'; phaseEndsAt = nowMs + RESULT_MS;
        return effects;
      }
      if (phase === 'result' && nowMs >= phaseEndsAt) { phase = 'idle'; phaseEndsAt = null; }
      return [];
    },

    onSeatLeft(pid, ctx) {
      if (phase !== 'spinning') return [];       // en idle/result no hay nada sin resolver
      const effects = settle(ctx);
      phase = 'result'; phaseEndsAt = now() + RESULT_MS;
      return effects;
    },
  };
}
