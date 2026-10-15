// js/ui/limits.js
// Límites de apuesta por día. Exporta MIN_BET, MAX_BET_BY_DAY y limitsFor(state) -> { min, max } en centavos.
// Si el estado de la sala trae betLimits (lo pide el PEDIDO DE CAMBIO AL CONTRATO) se usa ese; si no, esta tabla.
// DECISIÓN: tope del día 1 = $200 y del día 5 = $4.000 (pedido del usuario); el resto sigue la misma curva.

export const MIN_BET = 25; // $0,25: la ficha más chica
export const MAX_BET_BY_DAY = [20000, 50000, 100000, 200000, 400000, 700000, 1200000]; // $200 ... $12.000

export function limitsFor(state) {
  if (state && state.betLimits) return state.betLimits;
  const day = Math.min(7, Math.max(1, (state && state.day) || 1));
  return { min: MIN_BET, max: MAX_BET_BY_DAY[day - 1] };
}
