// js/games/crash/logic.js: reglas, pagos y estado del Crash (JavaScript puro, sin DOM). Corre en el anfitrión y en el sandbox.
// Usa solo rng() y now() que recibe. Exporta: meta, createGame, computeRtp, crashPointFrom, multAt y constantes.
//
// ACCIONES (handleAction):
//   { type: 'bet', amount: 500, auto?: 2.5 }  apuesta en `betting`. `auto` = retiro automático (multiplicador, de 1,01 a 1000).
//   { type: 'cashout' }                        retira en `running`: cobra floor(apuesta × multiplicador). Si ya explotó: 'ya_exploto'.
//   { type: 'cancel' }                         en `betting`, cancela la apuesta y la devuelve (refund).
//   { type: 'debug_force', crashAt: 3.2 }      SOLO con config.debug === true (sandbox): fuerza el próximo punto de explosión.
// Errores: ya_exploto, no_en_juego, sin_apuesta, ya_retirado, ya_apostaste, apuestas_cerradas, supera_maximo, monto_invalido,
//   auto_invalido, no_sentado, sin_fondos, nada_que_deshacer, accion_invalida, accion_desconocida.
//
// FASES: betting (8 s) -> running (el multiplicador sube hasta explotar) -> crashed (4 s) -> betting.
// MULTIPLICADOR: m(t) = exp(growth × t), t en segundos desde startedAt, se muestra truncado a 2 decimales.
// EXPLOSIÓN: crashAt = max(1, floor(100 × (1 − edge) / (1 − rng())) / 100), edge = 0,03, tope 1000x. Se sortea al empezar `running`
//   y NUNCA se publica antes de explotar. El anfitrión decide con su reloj: un retiro que llega después de explotar se rechaza.
// RTP: P(crashAt ≥ x) = 0,97 / x, así que cualquier estrategia de retiro fija devuelve 0,97 (house edge 3%).
//
// DECISIÓN: una sola apuesta por jugador y ronda; el máximo por ronda sale de ctx.limits (ver js/games/limits.js).
// DECISIÓN: si alguien se levanta en `running`, su apuesta se retira al multiplicador actual (si todavía no explotó); devolverla
//   sin más sería una salida gratis cuando el crash cae en 1,00x.
import { readLimits } from '../limits.js';

export const EDGE = 0.03;
export const GROWTH = 0.07;
export const BETTING_MS = 8000;
export const CRASHED_MS = 4000;
export const HISTORY_LEN = 15;
export const MAX_CRASH = 1000;

export function crashPointFrom(r) {
  return Math.min(MAX_CRASH, Math.max(1, Math.floor(100 * (1 - EDGE) / (1 - r)) / 100));
}
export function multAt(growth, elapsedMs) {
  return Math.floor(Math.exp(growth * Math.max(0, elapsedMs) / 1000) * 100) / 100;
}

// RTP exacto de retirarse siempre en x: P(crashAt >= x) = (1 - edge) / x, y se cobra x. Se promedia sobre varios objetivos.
export function computeRtp() {
  const targets = [1.01, 1.1, 1.5, 2, 3, 5, 10, 50, 100, 1000];
  return targets.reduce((s, x) => s + Math.min(1, (1 - EDGE) / x) * x, 0) / targets.length;
}

export const meta = { id: 'crash', name: 'Crash', mode: 'shared', minBet: 25, maxBet: null, rtp: computeRtp() };

const fail = (error) => ({ ok: false, error, effects: [] });
const ok = (effects = []) => ({ ok: true, effects });

export function createGame({ rng, now, config } = {}) {
  const debug = !!(config && config.debug);
  const growth = (config && config.crashGrowth) || GROWTH;
  let phase = 'betting', round = 1, phaseEndsAt = now() + BETTING_MS;
  let startedAt = null, crashAt = null, crashedAt = null;
  let bets = {};            // playerId -> { amount, auto, cashedAt, payout }
  let history = [];
  let forced = null;
  let limits = readLimits(null);

  const refOf = (pid) => `r${round}:${pid}`;
  const crashTime = () => startedAt + (Math.log(crashAt) / growth) * 1000;

  function cash(pid, m) {
    const b = bets[pid];
    const payout = Math.floor(b.amount * m + 1e-9);
    b.cashedAt = m; b.payout = payout;
    return [
      { type: 'credit', playerId: pid, amount: payout, kind: 'payout', ref: refOf(pid) },
      { type: 'event', name: 'bet_result', data: { playerId: pid, ref: refOf(pid), stake: b.amount, payout, detail: { cashedAt: m } } },
    ];
  }
  function lose(pid) {
    const b = bets[pid];
    b.cashedAt = null; b.payout = 0; b.lost = true;
    return [{ type: 'event', name: 'bet_result', data: { playerId: pid, ref: refOf(pid), stake: b.amount, payout: 0, detail: { crashedAt: crashAt } } }];
  }
  const open = (b) => b.cashedAt == null && !b.lost;

  const game = {
    getPublicState() {
      const pub = {};
      for (const pid of Object.keys(bets)) {
        const b = bets[pid];
        pub[pid] = { amount: b.amount, auto: b.auto, cashedAt: b.cashedAt, payout: b.payout };
      }
      return {
        phase, round, growth,
        phaseEndsAt: phase === 'running' ? null : phaseEndsAt,
        startedAt: phase === 'betting' ? null : startedAt,
        bets: pub,
        crashedAt: phase === 'crashed' ? crashedAt : null,   // el punto de explosión solo se publica cuando ya explotó
        history: history.slice(),
        limits: { min: limits.minBet, max: limits.maxBet },
      };
    },

    handleAction(playerId, action, ctx) {
      if (!action || typeof action.type !== 'string') return fail('accion_invalida');
      switch (action.type) {
        case 'bet': {
          if (phase !== 'betting') return fail('apuestas_cerradas');
          limits = readLimits(ctx);
          const amount = action.amount;
          if (!Number.isInteger(amount) || amount < limits.minBet) return fail('monto_invalido');
          if (amount > limits.maxBet) return fail('supera_maximo');
          if (Array.isArray(ctx.seats) && !ctx.seats.includes(playerId)) return fail('no_sentado');
          if (bets[playerId]) return fail('ya_apostaste');
          let auto = null;
          if (action.auto != null) {
            if (typeof action.auto !== 'number' || !Number.isFinite(action.auto) || action.auto < 1.01 || action.auto > MAX_CRASH) return fail('auto_invalido');
            auto = Math.round(action.auto * 100) / 100;
          }
          if (amount > ctx.bank) return fail('sin_fondos');
          bets[playerId] = { amount, auto, cashedAt: null, payout: null };
          return ok([{ type: 'debit', playerId, amount, kind: 'bet', ref: refOf(playerId) }]);
        }
        case 'cancel': {
          if (phase !== 'betting') return fail('apuestas_cerradas');
          const b = bets[playerId];
          if (!b) return fail('nada_que_deshacer');
          delete bets[playerId];
          return ok([{ type: 'credit', playerId, amount: b.amount, kind: 'refund', ref: refOf(playerId) }]);
        }
        case 'cashout': {
          if (phase === 'crashed') return fail('ya_exploto');
          if (phase !== 'running') return fail('no_en_juego');
          const b = bets[playerId];
          if (!b) return fail('sin_apuesta');
          if (b.cashedAt != null) return fail('ya_retirado');
          const t = now();
          if (t >= crashTime()) return fail('ya_exploto');
          return ok(cash(playerId, Math.max(1, multAt(growth, t - startedAt))));
        }
        case 'debug_force':
          if (!debug || typeof action.crashAt !== 'number' || action.crashAt < 1) return fail('accion_desconocida');
          forced = Math.min(MAX_CRASH, Math.round(action.crashAt * 100) / 100);
          return ok();
        default: return fail('accion_desconocida');
      }
    },

    tick(nowMs, ctx) {
      limits = readLimits(ctx);
      if (phase === 'betting') {
        if (nowMs < phaseEndsAt) return [];
        if (!Object.keys(bets).length) { phaseEndsAt = nowMs + BETTING_MS; return []; } // nadie apostó: otra ventana de apuestas
        crashAt = forced != null ? forced : crashPointFrom(rng());
        forced = null; crashedAt = null;
        startedAt = nowMs; phase = 'running';
        return [];
      }
      if (phase === 'running') {
        const effects = [];
        const m = multAt(growth, nowMs - startedAt);
        for (const pid of Object.keys(bets)) { // retiros automáticos (si el objetivo no supera el punto de explosión)
          const b = bets[pid];
          if (open(b) && b.auto != null && b.auto <= crashAt && m >= b.auto) effects.push(...cash(pid, b.auto));
        }
        if (nowMs >= crashTime()) {
          for (const pid of Object.keys(bets)) if (open(bets[pid])) effects.push(...lose(pid));
          crashedAt = crashAt;
          history.unshift(crashAt);
          if (history.length > HISTORY_LEN) history.length = HISTORY_LEN;
          phase = 'crashed'; phaseEndsAt = nowMs + CRASHED_MS;
        }
        return effects;
      }
      if (nowMs < phaseEndsAt) return []; // crashed -> nueva ronda
      bets = {}; startedAt = null; crashAt = null; crashedAt = null;
      round += 1; phase = 'betting'; phaseEndsAt = nowMs + BETTING_MS;
      return [];
    },

    onSeatLeft(playerId) {
      const b = bets[playerId];
      if (!b) return [];
      if (phase === 'betting') {
        delete bets[playerId];
        return [{ type: 'credit', playerId, amount: b.amount, kind: 'refund', ref: refOf(playerId) }];
      }
      if (phase === 'running' && open(b)) {
        const t = now();
        if (t < crashTime()) return cash(playerId, Math.max(1, multAt(growth, t - startedAt)));
      }
      return []; // si ya explotó, el tick liquida la pérdida
    },
  };
  return game;
}
