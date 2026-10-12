// js/core/stats.js: cuentas de estadísticas por jugador, títulos y resumen del día. Funciones puras (sin DOM ni red).
// Exporta emptyStats, applyResult, pickTitles, computeTitles y buildSummary. Todo el dinero va en centavos.

export function emptyStats() {
  return { bet: 0, won: 0, net: 0, streak: 0, bestWin: 0, worstLoss: 0, rounds: 0 };
}

// Suma el resultado de una apuesta liquidada.
// DECISIÓN: la racha sube si gana (payout > stake) y baja si pierde (payout < stake); un empate no la cambia.
// DECISIÓN: worstLoss se guarda como número positivo (cuánto se perdió en la peor apuesta).
export function applyResult(stats, stake, payout) {
  stats.bet += stake;
  stats.won += payout;
  stats.net = stats.won - stats.bet;
  stats.rounds += 1;
  const diff = payout - stake;
  if (diff > 0) {
    stats.streak = stats.streak > 0 ? stats.streak + 1 : 1;
    stats.bestWin = Math.max(stats.bestWin, diff);
  } else if (diff < 0) {
    stats.streak = stats.streak < 0 ? stats.streak - 1 : -1;
    stats.worstLoss = Math.max(stats.worstLoss, -diff);
  }
}

// Elige "Mayor ganador" (mayor neto, positivo) y "Oveja negra" (menor neto, negativo) de una lista [{ id, net }].
// Si hay empate gana quien aparece primero en la lista. Si nadie gana o nadie pierde, el título queda en null.
export function pickTitles(entries) {
  let top = null, sheep = null;
  for (const e of entries) {
    if (e.net > 0 && (!top || e.net > top.net)) top = e;
    if (e.net < 0 && (!sheep || e.net < sheep.net)) sheep = e;
  }
  return { topWinner: top ? top.id : null, blackSheep: sheep ? sheep.id : null };
}

const porLlegada = (a, b) => a.joinedAt - b.joinedAt;

// Títulos de toda la partida, a partir de players[id].stats (solo cuentan los que ya apostaron).
export function computeTitles(players) {
  const lista = Object.values(players).filter(p => p.stats.rounds > 0).sort(porLlegada);
  return pickTitles(lista.map(p => ({ id: p.id, net: p.stats.net })));
}

// Resumen del día para la pantalla de cobro. dayStats = { id: { bet, won, net } } acumulado solo de ese día.
// bankDelta = cuánto cambió el banco jugando ese día (antes de cobrar la cuota).
export function buildSummary(day, dayStats, players, bankDelta) {
  const perPlayer = {};
  const lista = Object.values(players).sort(porLlegada);
  for (const p of lista) {
    const d = dayStats[p.id] || { bet: 0, won: 0, net: 0 };
    perPlayer[p.id] = { bet: d.bet, won: d.won, net: d.net };
  }
  const titulos = pickTitles(lista.map(p => ({ id: p.id, net: perPlayer[p.id].net })));
  return { day, perPlayer, topWinner: titulos.topWinner, blackSheep: titulos.blackSheep, bankDelta };
}
