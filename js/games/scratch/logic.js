// js/games/scratch/logic.js: reglas, premios y estado del Rasca y Gana (boleto de 3×3, JavaScript puro, sin DOM).
// Modo `solo`: cada jugador sentado tiene su propia instancia (createGame recibe playerId).
// Exporta: meta, createGame, computeRtp, TIERS, SYMBOLS, PRIZE_TABLE, evaluate, makeCells y constantes de tiempo.
//
// ACCIONES (handleAction):
//   { type: 'buy', tier: 'bronce' | 'plata' | 'oro' }   compra un boleto ($1, $5 o $25). Se puede comprar en `idle` o en `done`.
//   { type: 'peek', cell: 0..8 }     la vista la manda al EMPEZAR a rascar una celda: publica su contenido (la capa plateada
//                                     sigue tapándola en pantalla) para que se vea debajo mientras se rasca. No cuenta como revelada.
//   { type: 'reveal', cell: 0..8 }   la celda quedó rascada del todo (la vista la manda al pasar del 60%). Publica y la marca abierta.
//   { type: 'revealAll' }            abre las 9 celdas (botón "Rascar todo").
//   { type: 'debug_force', outcome: 'lose' | 0..5 }   SOLO con config.debug === true: fuerza el próximo boleto (perdedor o ganador con ese símbolo).
// Errores: boleto_en_curso, sin_boleto, tier_invalido, celda_invalida, monto_invalido, supera_maximo, sin_fondos, no_sentado,
//          accion_invalida, accion_desconocida.
//
// SÍMBOLOS: las seis fichas del pack assets/chips/ (chip_0.25, chip_1, chip_5, chip_25, chip_100, chip_500).
// GANA el boleto si algún símbolo aparece 3 veces (en cualquier lugar de la grilla; nunca hay dos tríos). Premio = precio × multiplicador:
//   | ficha   | paga (× precio del boleto) | peso sobre 10.000 |
//   | $0,25   |   1  (devuelve el boleto)  | 1000              |
//   | $1      |   2                        | 1200              |
//   | $5      |   5                        |  600              |
//   | $25     |  10                        |  125              |
//   | $100    |  50                        |   20              |
//   | $500    | 200                        |    3              |
//   | sin premio                           | 7052              |
// RTP exacto = (1000×1 + 1200×2 + 600×5 + 125×10 + 20×50 + 3×200) / 10000 = 0,9250 (rango pedido 0,90 a 0,95). Los tres boletos
// usan la misma tabla: el precio solo escala el premio. Probabilidad de ganar algo: 29,48%.
//
// DÓNDE VIVE EL SECRETO (punto delicado): el boleto se sortea al comprar y queda en una variable PRIVADA de createGame (del lado del
// anfitrión). getPublicState() solo publica en `cells` las celdas que la vista pidió con `peek`/`reveal` (el resto es null), nunca
// el premio ni `winSymbol` antes del final. El premio viaja en `prize` recién cuando el boleto se liquida (phase 'done').
// Cómo se arma la grilla: con el resultado ya sorteado, un boleto ganador pone el símbolo premiado en 3 lugares al azar y rellena
// los otros 6 con los demás símbolos (máximo 2 de cada uno); un perdedor usa cada símbolo como mucho 2 veces. Así `evaluate(cells)`
// (que cuenta tríos) siempre coincide con el resultado sorteado, y los "casi" (dos fichas grandes) son frecuentes, como en el real.
//
// LIQUIDACIÓN: se acredita cuando las 9 celdas están abiertas (reveal/revealAll), en onSeatLeft, o por TIMEOUT de 30 s sin rascar
// (DECISIÓN: el plazo se renueva con cada peek/reveal, así quien rasca despacio no se corta; si pasa, se abre todo y se paga).
// El estado queda en `done` mostrando el boleto hasta que se compra otro (DECISIÓN: no hay vuelta automática a idle).
// Un `bet_result` por boleto (stake = precio, payout = 0 si no hay premio). payoutMult multiplica solo la GANANCIA.
// LÍMITES: DECISIÓN: el precio del boleto debe ser >= minBet y <= maxBet (ctx.limits); si no, 'supera_maximo' o 'monto_invalido'.
// Se puede tener un solo boleto abierto por vez, así que el tope por ronda es el precio de ese boleto.
import { readLimits } from '../limits.js';

export const TIERS = { bronce: 100, plata: 500, oro: 2500 };            // precio en centavos
export const TIER_NAMES = { bronce: 'Bronce', plata: 'Plata', oro: 'Oro' };
export const SYMBOLS = [25, 100, 500, 2500, 10000, 50000];              // valor de la ficha en centavos (orden de menor a mayor)
export const PRIZE_TABLE = [                                            // premio por símbolo: mult = × precio, weight sobre WEIGHT_TOTAL
  { symbol: 0, mult: 1, weight: 1000 }, { symbol: 1, mult: 2, weight: 1200 }, { symbol: 2, mult: 5, weight: 600 },
  { symbol: 3, mult: 10, weight: 125 }, { symbol: 4, mult: 50, weight: 20 }, { symbol: 5, mult: 200, weight: 3 },
];
export const WEIGHT_TOTAL = 10000;
export const CELLS = 9;
export const IDLE_TIMEOUT_MS = 30000;

// Cuenta tríos en la grilla y devuelve { symbol, mult, cells } del que gana, o null si no hay premio.
export function evaluate(cells) {
  for (const row of PRIZE_TABLE) {
    const at = [];
    cells.forEach((c, i) => { if (c === row.symbol) at.push(i); });
    if (at.length >= 3) return { symbol: row.symbol, mult: row.mult, cells: at.slice(0, 3) };
  }
  return null;
}

export function computeRtp() {
  let s = 0;
  for (const r of PRIZE_TABLE) s += r.weight * r.mult;
  return s / WEIGHT_TOTAL;
}

export const meta = { id: 'scratch', name: 'Rasca y gana', mode: 'solo', minBet: 25, maxBet: null, rtp: computeRtp() };

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
}

// Sortea el resultado: devuelve el símbolo ganador (0..5) o null si el boleto no tiene premio.
export function drawOutcome(rng) {
  let r = Math.floor(rng() * WEIGHT_TOTAL);
  for (const row of PRIZE_TABLE) { if (r < row.weight) return row.symbol; r -= row.weight; }
  return null;
}

// Arma la grilla de 9 celdas para un resultado (winSymbol o null).
export function makeCells(rng, winSymbol) {
  const n = SYMBOLS.length;
  if (winSymbol == null) {
    const pool = []; for (let s = 0; s < n; s++) pool.push(s, s);
    return shuffle(pool, rng).slice(0, CELLS);
  }
  const pool = []; for (let s = 0; s < n; s++) if (s !== winSymbol) pool.push(s, s);
  const rest = shuffle(pool, rng).slice(0, CELLS - 3);
  const cells = shuffle(rest.concat([winSymbol, winSymbol, winSymbol]), rng);
  return cells;
}

const fail = (error) => ({ ok: false, error, effects: [] });
const ok = (effects = []) => ({ ok: true, effects });

export function createGame({ rng, now, config, playerId } = {}) {
  const debug = !!(config && config.debug);
  let phase = 'idle', round = 0, phaseEndsAt = null;
  let tier = null, price = 0;
  let secret = null;                    // PRIVADO: las 9 celdas del boleto actual (nunca sale en el estado)
  let shown = new Array(CELLS).fill(false);   // celdas publicadas (peek o reveal)
  let open = new Array(CELLS).fill(false);    // celdas rascadas del todo
  let settled = false;
  let result = null;                    // { prize, mult, symbol, cells } cuando phase === 'done'
  let forced;                           // undefined = sin forzar; 'lose' o 0..5
  let limits = readLimits(null);

  const refOf = () => `r${round}:${playerId}`;
  const openCount = () => open.filter(Boolean).length;

  function settle(ctx) {
    settled = true;
    const win = evaluate(secret);
    const mult = win ? win.mult : 0;
    const pm = Number(ctx && ctx.modifiers && ctx.modifiers.payoutMult);
    const payoutMult = Number.isFinite(pm) && pm >= 0 ? pm : 1;
    // payoutMult multiplica solo la GANANCIA (lo que excede el precio devuelto)
    const payout = mult > 0 ? price + Math.floor((mult - 1) * price * payoutMult + 1e-9) : 0;
    shown = shown.map(() => true); open = open.map(() => true);
    result = { prize: payout, mult, symbol: win ? win.symbol : null, cells: win ? win.cells : [] };
    phase = 'done'; phaseEndsAt = null;
    const effects = [];
    if (payout > 0) effects.push({ type: 'credit', playerId, amount: payout, kind: 'payout', ref: refOf() });
    effects.push({
      type: 'event', name: 'bet_result',
      data: { playerId, ref: refOf(), stake: price, payout, detail: { tier, cells: secret.slice(), symbol: result.symbol, mult } },
    });
    if (mult === 200) effects.push({ type: 'event', name: 'jackpot', data: { playerId, amount: payout } });
    return effects;
  }

  const touch = () => { phaseEndsAt = now() + IDLE_TIMEOUT_MS; };

  return {
    getPublicState() {
      return {
        phase, phaseEndsAt, round, tier, price,
        cells: secret ? secret.map((c, i) => (shown[i] ? c : null)) : new Array(CELLS).fill(null),
        open: open.slice(), revealed: openCount(),
        prize: phase === 'done' ? result.prize : null,
        mult: phase === 'done' ? result.mult : null,
        winSymbol: phase === 'done' ? result.symbol : null,
        winCells: phase === 'done' ? result.cells.slice() : null,
        limits: { min: limits.minBet, max: limits.maxBet },
      };
    },

    handleAction(pid, action, ctx) {
      if (!action || typeof action.type !== 'string') return fail('accion_invalida');
      if (action.type === 'debug_force') {
        const o = action.outcome;
        if (!debug || !(o === 'lose' || (Number.isInteger(o) && o >= 0 && o < SYMBOLS.length))) return fail('accion_desconocida');
        forced = o;
        return ok();
      }
      if (action.type === 'buy') {
        if (phase === 'scratching') return fail('boleto_en_curso');
        if (!Object.prototype.hasOwnProperty.call(TIERS, action.tier)) return fail('tier_invalido');
        limits = readLimits(ctx);
        const cost = TIERS[action.tier];
        if (cost < limits.minBet) return fail('monto_invalido');
        if (cost > limits.maxBet) return fail('supera_maximo');
        if (Array.isArray(ctx.seats) && !ctx.seats.includes(pid)) return fail('no_sentado');
        if (cost > ctx.bank) return fail('sin_fondos');
        const win = forced === undefined ? drawOutcome(rng) : (forced === 'lose' ? null : forced);
        forced = undefined;
        secret = makeCells(rng, win);
        shown = new Array(CELLS).fill(false); open = new Array(CELLS).fill(false);
        settled = false; result = null;
        round += 1; tier = action.tier; price = cost;
        phase = 'scratching'; touch();
        return ok([{ type: 'debit', playerId: pid, amount: cost, kind: 'bet', ref: refOf() }]);
      }
      if (action.type === 'peek' || action.type === 'reveal' || action.type === 'revealAll') {
        if (phase !== 'scratching' || !secret || settled) return fail('sin_boleto');
        if (action.type === 'revealAll') return ok(settle(ctx));
        if (!Number.isInteger(action.cell) || action.cell < 0 || action.cell >= CELLS) return fail('celda_invalida');
        shown[action.cell] = true;
        if (action.type === 'reveal') open[action.cell] = true;
        touch();
        if (openCount() === CELLS) return ok(settle(ctx));
        return ok();
      }
      return fail('accion_desconocida');
    },

    tick(nowMs, ctx) {
      limits = readLimits(ctx);
      if (phase === 'scratching' && !settled && phaseEndsAt != null && nowMs >= phaseEndsAt) return settle(ctx);
      return [];
    },

    onSeatLeft(pid, ctx) {
      // Boleto sin terminar: se abre todo y se paga ya (devolver el precio sería una trampa: ya se ve el resultado).
      if (phase !== 'scratching' || settled) return [];
      return settle(ctx);
    },
  };
}
