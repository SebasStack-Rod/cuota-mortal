// dev/dummy-game.js: juego falso ("cara o ceca") que cumple el contrato de la sección 6. Solo sirve para probar el motor.
// Exporta meta y createGame. Acción: { type: 'bet', side: 'cara' | 'ceca', amount: centavos }. Paga 2 a 1 (RTP 1.0).
export const meta = { id: 'dummy', name: 'Moneda (prueba)', mode: 'solo', minBet: 25, maxBet: null, rtp: 1.0 };

export function createGame({ rng, now, config, playerId }) {
  let round = 0;
  let last = null;
  return {
    getPublicState() {
      return { phase: 'idle', phaseEndsAt: null, round, last };
    },
    handleAction(pid, action, ctx) {
      if (!action || action.type !== 'bet') return { ok: false, error: 'accion_invalida', effects: [] };
      if (!Number.isInteger(action.amount) || action.amount < meta.minBet) return { ok: false, error: 'monto_invalido', effects: [] };
      if (action.amount > ctx.bank) return { ok: false, error: 'sin_fondos', effects: [] };
      round += 1;
      const ref = `d${round}`;
      const flip = rng() < 0.5 ? 'cara' : 'ceca';
      // Solo para pruebas: testOutcome 'win' o 'lose' fuerza el resultado (no existe en los juegos reales).
      const win = action.testOutcome ? action.testOutcome === 'win' : flip === action.side;
      const payout = win ? action.amount * 2 : 0;
      last = flip;
      const effects = [{ type: 'debit', playerId: pid, amount: action.amount, kind: 'bet', ref }];
      if (win) effects.push({ type: 'credit', playerId: pid, amount: payout, kind: 'payout', ref });
      effects.push({ type: 'event', name: 'bet_result',
        data: { playerId: pid, ref, stake: action.amount, payout, detail: { side: action.side, flip } } });
      return { ok: true, effects };
    },
    tick() { return []; },
    onSeatLeft() { return []; },
  };
}
