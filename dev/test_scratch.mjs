// dev/test_scratch.mjs: pruebas de la lógica del Rasca y Gana. `node dev/test_scratch.mjs` desde cuota-mortal/.
import { createGame, meta, computeRtp, evaluate, makeCells, drawOutcome, TIERS, PRIZE_TABLE, SYMBOLS, IDLE_TIMEOUT_MS } from '../js/games/scratch/logic.js';
import { limitsForDay } from '../js/games/limits.js';
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fails = 0;
const check = (n, c, x = '') => { console.log((c ? '  ok   ' : '  FALLA ') + n + (x ? '  ' + x : '')); if (!c) fails++; };
function host(seed, bank = 1e9, config = { debug: true }, pid = 'a') {
  let t = 1_700_000_000_000;
  const g = createGame({ rng: mulberry32(seed), now: () => t, config, playerId: pid });
  const h = { g, bank, net: 0, events: [], effects: [], mods: { payoutMult: 1 }, seats: [pid], limits: { minBet: 25, maxBet: 1e9 },
    ctx() { return { bank: h.bank, modifiers: h.mods, seats: h.seats, names: {}, limits: h.limits }; },
    apply(es) { for (const e of es) { h.effects.push(e); if (e.type === 'debit') { h.bank -= e.amount; h.net -= e.amount; } if (e.type === 'credit') { h.bank += e.amount; h.net += e.amount; } if (e.type === 'event') h.events.push(e); } },
    act(a) { const r = g.handleAction(pid, a, h.ctx()); if (r.ok) h.apply(r.effects); return r; },
    adv(ms) { t += ms; h.apply(g.tick(t, h.ctx())); } };
  return h;
}
const results = (h) => h.events.filter((e) => e.name === 'bet_result');

console.log('1) RTP y tabla de premios');
const rtp = computeRtp();
check('RTP exacto entre 0,90 y 0,95', rtp >= 0.90 && rtp <= 0.95, 'rtp=' + rtp.toFixed(5));
check('meta.rtp coincide con computeRtp()', meta.rtp === rtp);
check('los pesos suman 10.000 con 7052 sin premio', PRIZE_TABLE.reduce((s, r) => s + r.weight, 0) === 2948);
check('seis símbolos con los valores de las fichas', SYMBOLS.join() === '25,100,500,2500,10000,50000');
check('los tres precios son 100, 500 y 2500', TIERS.bronce === 100 && TIERS.plata === 500 && TIERS.oro === 2500);
check('todos los premios son enteros en centavos', Object.values(TIERS).every((p) => PRIZE_TABLE.every((r) => Number.isInteger(p * r.mult))));

console.log('2) Armado de la grilla (200 mil boletos)');
{
  const rng = mulberry32(5); let okAll = true, maxCount = 0, wins = 0, N = 200000, paid = 0;
  for (let i = 0; i < N; i++) {
    const w = drawOutcome(rng); const cells = makeCells(rng, w); const ev = evaluate(cells);
    const cnt = {}; cells.forEach((c) => { cnt[c] = (cnt[c] || 0) + 1; });
    const triples = Object.values(cnt).filter((v) => v >= 3).length;
    maxCount = Math.max(maxCount, ...Object.values(cnt));
    if (cells.length !== 9 || triples !== (w == null ? 0 : 1) || (w == null) !== (ev == null) || (ev && ev.symbol !== w)) okAll = false;
    if (ev) { wins++; paid += ev.mult; }
  }
  check('un ganador tiene exactamente un trío del símbolo sorteado; un perdedor ninguno', okAll);
  check('ningún símbolo aparece más de 3 veces', maxCount === 3);
  check('probabilidad de ganar cerca de 29,48%', Math.abs(wins / N - 0.2948) < 0.006, (wins / N * 100).toFixed(2) + '%');
  check('RTP de la grilla evaluada cerca del exacto', Math.abs(paid / N - rtp) < 0.03, (paid / N).toFixed(4));
}

console.log('3) Simulación con el juego real (100 mil boletos por precio)');
for (const tier of Object.keys(TIERS)) {
  const h = host(11 + TIERS[tier]); let staked = 0, paid = 0;
  let betResults = 0, evPaid = 0;
  for (let i = 0; i < 100000; i++) {
    h.act({ type: 'buy', tier }); staked += TIERS[tier];
    const n0 = h.events.length; h.act({ type: 'revealAll' });
    for (let k = n0; k < h.events.length; k++) if (h.events[k].name === 'bet_result') { betResults++; evPaid += h.events[k].data.payout; }
    h.events.length = 0; h.effects.length = 0;
  }
  paid = evPaid;
  check(`${tier}: RTP simulado cerca del exacto`, Math.abs(paid / staked - rtp) < 0.04, (paid / staked).toFixed(4));
  check(`${tier}: contabilidad del banco (net = pagos - apuestas)`, h.net === paid - staked);
  check(`${tier}: un bet_result por boleto`, betResults === 100000);
}

console.log('4) Fases, contrato y secreto');
{
  const h = host(1);
  let st = h.g.getPublicState();
  check('al inicio: idle, sin celdas', st.phase === 'idle' && st.cells.every((c) => c === null) && st.prize === null);
  h.act({ type: 'debug_force', outcome: 4 });
  const r = h.act({ type: 'buy', tier: 'plata' });
  st = h.g.getPublicState();
  check('buy: un débito del precio y fase scratching', r.ok && r.effects.length === 1 && r.effects[0].type === 'debit' && r.effects[0].amount === 500 && r.effects[0].kind === 'bet' && st.phase === 'scratching');
  check('el estado NO trae celdas ni premio al comprar', st.cells.every((c) => c === null) && st.prize === null && st.winSymbol === null && st.winCells === null && st.mult === null);
  check('hay un plazo (phaseEndsAt) de 30 s', st.phaseEndsAt === 1_700_000_000_000 + IDLE_TIMEOUT_MS);
  check('comprar con un boleto en curso da boleto_en_curso', h.act({ type: 'buy', tier: 'bronce' }).error === 'boleto_en_curso');
  const p = h.act({ type: 'peek', cell: 3 }); st = h.g.getPublicState();
  check('peek publica SOLO esa celda, sin abrirla', p.ok && st.cells.filter((c) => c !== null).length === 1 && st.cells[3] !== null && st.open[3] === false && st.revealed === 0 && st.phase === 'scratching');
  const raw = JSON.stringify(st);
  check('el JSON del estado no trae el premio ni el símbolo ganador', !raw.includes('"winSymbol":4') && st.prize === null);
  h.act({ type: 'reveal', cell: 3 }); st = h.g.getPublicState();
  check('reveal abre la celda y cuenta', st.open[3] === true && st.revealed === 1);
  check('celda fuera de rango o sin boleto da error', h.act({ type: 'reveal', cell: 9 }).error === 'celda_invalida' && h.act({ type: 'reveal', cell: 1.5 }).error === 'celda_invalida');
  for (let i = 0; i < 9; i++) if (i !== 3 && i !== 8) h.act({ type: 'reveal', cell: i });
  st = h.g.getPublicState();
  check('con 8 celdas abiertas todavía no se liquida', st.phase === 'scratching' && st.revealed === 8 && results(h).length === 0);
  const last = h.act({ type: 'reveal', cell: 8 }); st = h.g.getPublicState();
  check('al abrir la novena se liquida: crédito + bet_result', last.ok && st.phase === 'done' && results(h).length === 1 && last.effects.some((e) => e.type === 'credit'));
  check('premio de 50x el boleto de plata (símbolo $100)', st.prize === 25000 && st.mult === 50 && st.winSymbol === 4 && st.winCells.length === 3);
  check('bet_result: stake = precio, payout = premio', results(h)[0].data.stake === 500 && results(h)[0].data.payout === 25000);
  check('créditos con ref igual al del débito', h.effects.find((e) => e.type === 'credit').ref === r.effects[0].ref);
  check('revealAll después de liquidar da sin_boleto', h.act({ type: 'revealAll' }).error === 'sin_boleto');
  check('en done se puede comprar otro boleto', h.act({ type: 'buy', tier: 'bronce' }).ok);
}

console.log('5) Resultados forzados y trébol');
{
  const h = host(2);
  h.act({ type: 'debug_force', outcome: 'lose' }); h.act({ type: 'buy', tier: 'oro' }); h.act({ type: 'revealAll' });
  let st = h.g.getPublicState();
  check('perdedor: payout 0, sin crédito, un bet_result', st.prize === 0 && st.winSymbol === null && !h.effects.some((e) => e.type === 'credit') && results(h).length === 1 && results(h)[0].data.payout === 0);
  h.act({ type: 'debug_force', outcome: 0 }); h.act({ type: 'buy', tier: 'oro' }); h.mods.payoutMult = 1.1; h.act({ type: 'revealAll' });
  check('1x con trébol devuelve exactamente el precio', h.g.getPublicState().prize === 2500);
  h.act({ type: 'debug_force', outcome: 1 }); h.act({ type: 'buy', tier: 'oro' }); h.act({ type: 'revealAll' });
  check('2x con trébol 1,1: precio + floor(ganancia × 1,1)', h.g.getPublicState().prize === 2500 + Math.floor(2500 * 1.1), 'premio=' + h.g.getPublicState().prize);
  h.act({ type: 'debug_force', outcome: 5 }); h.act({ type: 'buy', tier: 'oro' }); h.act({ type: 'revealAll' });
  check('jackpot 200x: emite evento jackpot', h.events.some((e) => e.name === 'jackpot') && h.g.getPublicState().prize === 2500 + Math.floor(199 * 2500 * 1.1));
}

console.log('6) Banco y límites');
{
  const h = host(3, 99);
  const r = h.act({ type: 'buy', tier: 'bronce' });
  check('banco menor al precio: sin_fondos y sin efectos', r.ok === false && r.error === 'sin_fondos' && r.effects.length === 0 && h.g.getPublicState().phase === 'idle');
  const h2 = host(3, 100);
  check('banco justo alcanza (débito = banco)', h2.act({ type: 'buy', tier: 'bronce' }).ok && h2.bank === 0);
  const h3 = host(3); h3.limits = limitsForDay(1);
  check('día 1 ($200 de máximo): el boleto de oro entra', h3.act({ type: 'buy', tier: 'oro' }).ok);
  const h4 = host(3); h4.limits = { minBet: 25, maxBet: 2000 };
  check('máximo menor al precio: supera_maximo', h4.act({ type: 'buy', tier: 'oro' }).error === 'supera_maximo' && h4.act({ type: 'buy', tier: 'plata' }).ok === true);
  const h5 = host(3); h5.limits = { minBet: 200, maxBet: 1e6 };
  check('mínimo mayor al precio: monto_invalido', h5.act({ type: 'buy', tier: 'bronce' }).error === 'monto_invalido');
  check('tier inventado: tier_invalido', host(3).act({ type: 'buy', tier: 'diamante' }).error === 'tier_invalido');
  const h6 = host(3); h6.seats = [];
  check('sin asiento: no_sentado', h6.act({ type: 'buy', tier: 'bronce' }).error === 'no_sentado');
  const st = host(3).g.getPublicState();
  check('el estado expone limits {min, max}', st.limits && Number.isInteger(st.limits.min) && Number.isInteger(st.limits.max));
}

console.log('7) onSeatLeft, timeout y debug_force');
{
  const h = host(4); h.act({ type: 'debug_force', outcome: 3 }); h.act({ type: 'buy', tier: 'bronce' }); h.act({ type: 'peek', cell: 0 });
  h.apply(h.g.onSeatLeft('a', h.ctx()));
  check('onSeatLeft con boleto abierto: se abre todo y se paga ya', h.g.getPublicState().phase === 'done' && h.net === 1000 - 100 && results(h).length === 1);
  check('onSeatLeft en done o idle no hace nada', h.g.onSeatLeft('a', h.ctx()).length === 0 && host(4).g.onSeatLeft('a', host(4).ctx()).length === 0);
  const t = host(5); t.act({ type: 'debug_force', outcome: 2 }); t.act({ type: 'buy', tier: 'bronce' });
  t.adv(29000); check('a los 29 s sin rascar sigue en curso', t.g.getPublicState().phase === 'scratching');
  t.act({ type: 'peek', cell: 1 }); t.adv(29000);
  check('rascar renueva el plazo de 30 s', t.g.getPublicState().phase === 'scratching');
  t.adv(2000);
  check('pasados 30 s sin actividad se liquida solo', t.g.getPublicState().phase === 'done' && t.g.getPublicState().prize === 500 && results(t).length === 1);
  t.adv(60000); check('después no se liquida dos veces', results(t).length === 1);
  const prod = host(6, 1e9, {});
  check('debug_force sin config.debug da accion_desconocida', prod.act({ type: 'debug_force', outcome: 1 }).error === 'accion_desconocida');
  check('debug_force con valor inválido da accion_desconocida', host(6).act({ type: 'debug_force', outcome: 9 }).error === 'accion_desconocida');
  check('acción inventada o vacía', host(6).act({ type: 'xyz' }).error === 'accion_desconocida' && host(6).g.handleAction('a', null, host(6).ctx()).error === 'accion_invalida');
}

console.log('8) Dos jugadores a la vez y tamaño del estado');
{
  const a = host(7, 1e9, { debug: true }, 'a'), b = host(8, 1e9, { debug: true }, 'b');
  a.act({ type: 'debug_force', outcome: 5 }); b.act({ type: 'debug_force', outcome: 'lose' });
  a.act({ type: 'buy', tier: 'bronce' }); b.act({ type: 'buy', tier: 'plata' });
  a.act({ type: 'revealAll' });
  check('cada jugador liquida lo suyo sin afectar al otro', a.g.getPublicState().phase === 'done' && b.g.getPublicState().phase === 'scratching' && results(b).length === 0);
  b.act({ type: 'revealAll' });
  check('los resultados son independientes', a.g.getPublicState().prize === 20000 && b.g.getPublicState().prize === 0);
  const sz = JSON.stringify(a.g.getPublicState()).length;
  check('estado público de 8 jugadores menor a 4 KB', sz * 8 < 4096, sz + ' bytes por jugador');
}

console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
