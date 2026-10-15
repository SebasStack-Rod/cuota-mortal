// js/games/limits.js: mínimo y máximo de apuesta según el día de la partida (compartido por todos los juegos).
// El anfitrión (IA 1) arma ctx.limits = limitsForDay(day) y se lo pasa a handleAction y tick de cada juego.
// Exporta MIN_BET, MAX_BY_DAY, limitsForDay(day) y readLimits(ctx) (con valores por defecto si el ctx no trae límites).
// El máximo es por JUGADOR y por RONDA (suma de todo lo que apuesta en esa ronda). Valores en centavos.
export const MIN_BET = 25; // $0,25
// Día 1: $200 · 2: $500 · 3: $1.000 · 4: $2.000 · 5: $4.000 · 6: $8.000 · 7: $15.000 (la cuota crece 40% por día)
export const MAX_BY_DAY = [20000, 50000, 100000, 200000, 400000, 800000, 1500000];

export function limitsForDay(day) {
  const d = Math.min(7, Math.max(1, Math.floor(Number(day)) || 1));
  return { minBet: MIN_BET, maxBet: MAX_BY_DAY[d - 1] };
}

export function readLimits(ctx) {
  const l = ctx && ctx.limits;
  const min = l && Number.isInteger(l.minBet) && l.minBet > 0 ? l.minBet : MIN_BET;
  const max = l && Number.isInteger(l.maxBet) && l.maxBet >= min ? l.maxBet : MAX_BY_DAY[0];
  return { minBet: min, maxBet: max };
}
