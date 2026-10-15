// dev/test_dice.mjs: pruebas de la lógica de los Dados. `node dev/test_dice.mjs` desde cuota-mortal/.
// Cubre RTP, pagos, simulación, banco, límites, sin fondos, reroll, onSeatLeft por fase, dos jugadores, tamaño del estado y debug_force.
import { createGame, meta, computeRtp, rtpBySpot, spotWins, BETTING_MS, ROLLING_MS, RESULT_MS, REROLL_VIEW_MS } from '../js/games/dice/logic.js';
import { limitsForDay } from '../js/games/limits.js';
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fails = 0;
const check = (n, c, x = '') => { console.log((c ? '  ok   ' : '  FALLA ') + n + (x ? '  ' + x : '')); if (!c) fails++; };

function host(seed, { bank = 1e9, config = { debug: true }, seats = ['a', 'b'] } = {}) {
  let t = 1_700_000_000_000;
  const g = createGame({ rng: mulberry32(seed), now: () => t, config });
  const h = {
    g, banks: { a: bank, b: bank, c: bank }, net: 0, events: [], effects: [], mods: { payoutMult: 1, rerolls: 0 }, seats,
    limits: { minBet: 25, maxBet: 1e9 },
    ctx(pid = 'a') { return { bank: h.banks[pid], modifiers: h.mods, seats: h.seats, names: {}, limits: h.limits }; },
    apply(es) {
      for (const e of es) {
        h.effects.push(e);
        if (e.type === 'debit') { h.banks[e.playerId] -= e.amount; h.net -= e.amount; }
        if (e.type === 'credit') { h.banks[e.playerId] += e.amount; h.net += e.amount; }
        if (e.type === 'event') h.events.push(e);
      }
    },
    act(a, pid = 'a') { const r = g.handleAction(pid, a, h.ctx(pid)); if (r.ok) h.apply(r.effects); return r; },
    adv(ms) { t += ms; h.apply(g.tick(t, h.ctx())); },
    results() { return h.events.filter((e) => e.name === 'bet_result'); },
    t: () => t,
  };
  return h;
}
const toResult = (h) => { h.adv(BETTING_MS); h.adv(ROLLING_MS); };   // deja la mesa en `result`
const toNext = (h) => h.adv(RESULT_MS);

console.log('1) RTP y tabla de pagos');
const rtp = computeRtp(), by = rtpBySpot();
check('under y over: RTP 0,9583', Math.abs(by.under - 0.95833) < 1e-4 && Math.abs(by.over - 0.95833) < 1e-4, 'under=' + by.under.toFixed(5));
check('seven: RTP 0,9333', Math.abs(by.seven - 0.93333) < 1e-4, 'seven=' + by.seven.toFixed(5));
check('RTP promedio entre 0,92 y 0,98', rtp >= 0.92 && rtp <= 0.98, 'rtp=' + rtp.toFixed(5));
check('meta.rtp coincide con computeRtp()', meta.rtp === rtp && meta.id === 'dice' && meta.mode === 'shared' && meta.minBet === 25);
let n7 = 0, nu = 0, no = 0;
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) { const s = a + b; if (spotWins('seven', s)) n7++; if (spotWins('under', s)) nu++; if (spotWins('over', s)) no++; }
check('36 combinaciones: under 15, over 15, seven 6 (nunca dos ganan a la vez)', nu === 15 && no === 15 && n7 === 6);

console.log('2) Simulación con el juego real (200 mil rondas, 3 apuestas por ronda)');
{
  const h = host(7); let staked = 0, paid = 0;
  for (let i = 0; i < 200000; i++) {
    h.act({ type: 'bet', spot: 'under', amount: 1000 }); h.act({ type: 'bet', spot: 'over', amount: 1000 }); h.act({ type: 'bet', spot: 'seven', amount: 1000 });
    staked += 3000; toResult(h); toNext(h);
  }
  for (const e of h.results()) paid += e.data.payout;
  check('RTP simulado cerca del exacto (0,95)', Math.abs(paid / staked - rtp) < 0.01, 'simulado=' + (paid / staked).toFixed(4));
  check('contabilidad del banco: net = pagos − apuestas', h.net === paid - staked);
  check('un bet_result por apuesta liquidada', h.results().length === 600000);
}

console.log('3) Fases, efectos y contrato');
{
  const h = host(1);
  check('arranca en betting con phaseEndsAt', h.g.getPublicState().phase === 'betting' && h.g.getPublicState().phaseEndsAt === h.t() + BETTING_MS);
  h.adv(BETTING_MS + 1);
  check('nadie apostó: no se tira, otra ronda de apuestas', h.g.getPublicState().phase === 'betting' && h.g.getPublicState().round === 1);
  h.act({ type: 'debug_force', dice: [3, 4] });
  const r = h.act({ type: 'bet', spot: 'seven', amount: 1000 });
  check('bet: un débito de 1000 con ref r1:a:seven', r.ok && r.effects.length === 1 && r.effects[0].type === 'debit' && r.effects[0].ref === 'r1:a:seven');
  h.adv(BETTING_MS);
  let st = h.g.getPublicState();
  check('rolling: dados publicados y rolledAt', st.phase === 'rolling' && st.dice.join() === '3,4' && st.rolledAt === h.t() && st.phaseEndsAt === h.t() + ROLLING_MS);
  check('no se puede apostar en rolling', h.act({ type: 'bet', spot: 'under', amount: 100 }).error === 'apuestas_cerradas');
  h.adv(ROLLING_MS);
  st = h.g.getPublicState();
  check('result: suma en el historial y pago provisional, SIN créditos todavía', st.phase === 'result' && st.history[0] === 7 && st.payouts.a.payout === 5600 && h.results().length === 0 && h.net === -1000);
  h.adv(RESULT_MS - 1); check('antes del final de result no liquida', h.results().length === 0);
  h.adv(1);
  const res = h.results();
  check('al final de result: crédito 5,6x y un bet_result', res.length === 1 && res[0].data.payout === 5600 && res[0].data.stake === 1000 && h.net === 4600);
  check('detail trae spot, dados y suma', res[0].data.detail.spot === 'seven' && res[0].data.detail.sum === 7 && res[0].data.detail.dice.join() === '3,4');
  st = h.g.getPublicState();
  check('ronda nueva: round 2, sin dados ni apuestas', st.phase === 'betting' && st.round === 2 && st.dice === null && Object.keys(st.bets).length === 0);
  const h2 = host(2); h2.act({ type: 'debug_force', dice: [1, 1] }); h2.act({ type: 'bet', spot: 'over', amount: 500 }); toResult(h2); toNext(h2);
  check('apuesta perdedora: bet_result con payout 0 y sin crédito', h2.results()[0].data.payout === 0 && !h2.effects.some((e) => e.type === 'credit'));
  const h3 = host(3); h3.act({ type: 'debug_force', dice: [6, 6] }); h3.act({ type: 'bet', spot: 'seven', amount: 100 }); h3.act({ type: 'bet', spot: 'seven', amount: 100 });
  toResult(h3); toNext(h3);
  check('dos fichas al mismo lugar se liquidan juntas (un bet_result de 200)', h3.results().length === 1 && h3.results()[0].data.stake === 200);
  const h4 = host(4); h4.act({ type: 'bet', spot: 'under', amount: 300 });
  check('undo devuelve la última ficha (refund)', h4.act({ type: 'undo' }).effects[0].kind === 'refund' && h4.act({ type: 'undo' }).error === 'nada_que_deshacer');
}

console.log('4) Trébol, límites y sin fondos');
{
  const h = host(5); h.mods.payoutMult = 1.1;
  h.act({ type: 'debug_force', dice: [1, 2] }); h.act({ type: 'bet', spot: 'under', amount: 1000 }); toResult(h); toNext(h);
  check('under con trébol: 1000 + floor(1300×1,1) = 2430', h.results()[0].data.payout === 2430);
  const hs = host(6); hs.mods.payoutMult = 1.5;
  hs.act({ type: 'debug_force', dice: [3, 4] }); hs.act({ type: 'bet', spot: 'seven', amount: 1000 }); toResult(hs); toNext(hs);
  check('seven con trébol 1,5: 1000 + floor(4600×1,5) = 7900', hs.results()[0].data.payout === 7900);
  const h1 = host(8, { bank: 500 });
  check('sin fondos: error y cero efectos', h1.act({ type: 'bet', spot: 'under', amount: 600 }).error === 'sin_fondos' && h1.effects.length === 0);
  const h2 = host(9); h2.limits = limitsForDay(1);
  check('monto menor al mínimo', h2.act({ type: 'bet', spot: 'under', amount: 24 }).error === 'monto_invalido');
  check('monto no entero', h2.act({ type: 'bet', spot: 'under', amount: 100.5 }).error === 'monto_invalido');
  check('lugar inexistente', h2.act({ type: 'bet', spot: 'six', amount: 100 }).error === 'lugar_invalido');
  check('día 1: la suma de la ronda no puede pasar de $200', h2.act({ type: 'bet', spot: 'under', amount: 15000 }).ok && h2.act({ type: 'bet', spot: 'over', amount: 5001 }).error === 'supera_maximo' && h2.act({ type: 'bet', spot: 'over', amount: 5000 }).ok);
  check('monto libre $37,41 permitido', host(10).act({ type: 'bet', spot: 'seven', amount: 3741 }).ok);
  const h3 = host(11, { seats: ['b'] }); check('no sentado', h3.act({ type: 'bet', spot: 'under', amount: 100 }).error === 'no_sentado');
  const h4 = host(12, { config: {} }); check('sin config.debug no se puede forzar', h4.act({ type: 'debug_force', dice: [1, 1] }).error === 'accion_desconocida');
  check('debug_force con dados inválidos', host(13).act({ type: 'debug_force', dice: [0, 7] }).ok === false);
  check('acción desconocida', host(14).act({ type: 'xyz' }).error === 'accion_desconocida');
}

console.log('5) Dados cargados (reroll)');
{
  const h = host(21); h.mods.rerolls = 1;
  h.act({ type: 'debug_force', dice: [1, 1] });
  h.act({ type: 'bet', spot: 'over', amount: 1000 }); h.act({ type: 'bet', spot: 'under', amount: 500 }, 'b');
  check('reroll fuera de result', h.act({ type: 'reroll' }).error === 'fuera_de_resultado');
  toResult(h);
  const endsBefore = h.g.getPublicState().phaseEndsAt;
  check('quien gana todo no puede relanzar (b: under con 2)', h.act({ type: 'reroll' }, 'b').error === 'nada_que_relanzar');
  h.mods.rerolls = 0; check('sin dados cargados', h.act({ type: 'reroll' }).error === 'sin_dados_cargados'); h.mods.rerolls = 1;
  const r = h.act({ type: 'reroll' });
  check('reroll: ok y evento reroll_used con playerId', r.ok && r.effects.length === 1 && r.effects[0].name === 'reroll_used' && r.effects[0].data.playerId === 'a');
  const st = h.g.getPublicState();
  check('el estado publica los dados nuevos solo de ese jugador', st.rerolls.a && st.rerolls.a.dice.length === 2 && !st.rerolls.b && st.dice.join() === '1,1');
  check('no hay créditos antes del final de result', h.results().length === 0);
  check('un solo reroll por ronda', h.act({ type: 'reroll' }).error === 'ya_relanzaste');
  check('el reroll no cambia la apuesta ni el límite', Object.keys(st.bets.a).join() === 'over' && st.bets.a.over === 1000);
  check('phaseEndsAt nunca retrocede', st.phaseEndsAt >= endsBefore);
  toNext(h);
  const mine = h.results().filter((e) => e.data.playerId === 'a')[0], theirs = h.results().filter((e) => e.data.playerId === 'b')[0];
  const nd = st.rerolls.a.dice, ns = nd[0] + nd[1];
  check('a se liquida con sus dados nuevos y b con los de la mesa', mine.data.detail.dice.join() === nd.join() && mine.data.detail.rerolled === true && theirs.data.detail.dice.join() === '1,1' && theirs.data.detail.rerolled === false);
  check('el pago de a coincide con spotWins sobre los dados nuevos', (mine.data.payout > 0) === spotWins('over', ns));
  // reroll tardío: la fase se alarga
  const h2 = host(22); h2.mods.rerolls = 1; h2.act({ type: 'debug_force', dice: [1, 1] }); h2.act({ type: 'bet', spot: 'over', amount: 100 }); toResult(h2);
  h2.adv(RESULT_MS - 500); h2.act({ type: 'reroll' });
  check('reroll en el último segundo alarga result hasta now + 2 s', h2.g.getPublicState().phaseEndsAt === h2.t() + REROLL_VIEW_MS);
  // rerolls estadístico: relanzar nunca es peor en promedio que perder
  let wins = 0, tries = 4000;
  for (let i = 0; i < tries; i++) { const hh = host(1000 + i); hh.mods.rerolls = 1; hh.act({ type: 'debug_force', dice: [1, 1] }); hh.act({ type: 'bet', spot: 'over', amount: 100 }); toResult(hh); hh.act({ type: 'reroll' }); toNext(hh); if (hh.results()[0].data.payout > 0) wins++; }
  check('relanzar una apuesta perdedora gana ~42% de las veces (15/36)', Math.abs(wins / tries - 15 / 36) < 0.03, (wins / tries).toFixed(3));
}

console.log('6) onSeatLeft en cada fase');
{
  const h = host(31); h.act({ type: 'bet', spot: 'under', amount: 700 }); h.act({ type: 'bet', spot: 'seven', amount: 300 });
  const lv = h.g.onSeatLeft('a', h.ctx()); h.apply(lv);
  check('betting: se devuelven las apuestas (refund por lugar), sin bet_result', lv.length === 2 && lv.every((e) => e.type === 'credit' && e.kind === 'refund') && h.net === 0);
  const h2 = host(32); h2.act({ type: 'debug_force', dice: [2, 2] }); h2.act({ type: 'bet', spot: 'under', amount: 1000 }); h2.adv(BETTING_MS);
  const lv2 = h2.g.onSeatLeft('a', h2.ctx()); h2.apply(lv2);
  check('rolling: se liquida al instante con los dados ya sorteados (gana under con 4)', lv2.some((e) => e.type === 'credit' && e.amount === 2300) && lv2.some((e) => e.name === 'bet_result'));
  h2.adv(ROLLING_MS); h2.adv(RESULT_MS);
  check('no se liquida dos veces', h2.results().length === 1 && h2.net === 1300);
  const h3 = host(33); h3.act({ type: 'debug_force', dice: [6, 5] }); h3.act({ type: 'bet', spot: 'over', amount: 400 }); toResult(h3);
  const lv3 = h3.g.onSeatLeft('a', h3.ctx()); h3.apply(lv3);
  check('result: se liquida al instante (over con 11 paga 920)', lv3.some((e) => e.type === 'credit' && e.amount === 920));
  check('en result el pago ya queda fijo en payouts', h3.g.getPublicState().payouts.a.payout === 920);
  toNext(h3); check('y no se paga otra vez', h3.results().length === 1 && h3.net === 520);
  const h4 = host(34); check('levantarse sin apuestas no hace nada', h4.g.onSeatLeft('a', h4.ctx()).length === 0);
}

console.log('7) Dos jugadores a la vez');
{
  const h = host(41); h.act({ type: 'debug_force', dice: [4, 4] });
  h.act({ type: 'bet', spot: 'over', amount: 1000 }, 'a'); h.act({ type: 'bet', spot: 'under', amount: 2000 }, 'b'); h.act({ type: 'bet', spot: 'seven', amount: 500 }, 'b');
  toResult(h); toNext(h);
  const ra = h.results().filter((e) => e.data.playerId === 'a'), rb = h.results().filter((e) => e.data.playerId === 'b');
  check('a gana over (suma 8)', ra.length === 1 && ra[0].data.payout === 2300);
  check('b pierde las dos (under y seven)', rb.length === 2 && rb.every((e) => e.data.payout === 0));
  check('bancos separados', h.banks.a === 1e9 + 1300 && h.banks.b === 1e9 - 2500);
  check('refs únicos por jugador y lugar', new Set(h.results().map((e) => e.data.ref)).size === 3);
  const h2 = host(42, { bank: 1500 }); h2.act({ type: 'bet', spot: 'under', amount: 1000 }, 'a');
  check('el banco se mira por jugador (a ya gastó 1000 de 1500; b todavía puede)', h2.act({ type: 'bet', spot: 'over', amount: 600 }, 'a').error === 'sin_fondos' && h2.act({ type: 'bet', spot: 'over', amount: 600 }, 'b').ok);
}

console.log('8) Estado público');
{
  const h = host(51, { seats: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] });
  for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) { h.banks[p] = 1e9; for (const s of ['under', 'over', 'seven']) h.act({ type: 'bet', spot: s, amount: 12345 }, p); }
  h.mods.rerolls = 1; for (let i = 0; i < 12; i++) { toResult(h); toNext(h); for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) h.act({ type: 'bet', spot: 'under', amount: 100 }, p); }
  toResult(h); for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) h.act({ type: 'reroll' }, p);
  const s = h.g.getPublicState(), json = JSON.stringify(s);
  check('8 jugadores con reroll y 12 en el historial < 4 KB', json.length < 4096, json.length + ' bytes');
  check('en betting no hay dados ni rolledAt (no adelanta nada)', (() => { const g = host(52); g.act({ type: 'bet', spot: 'under', amount: 100 }); const x = g.g.getPublicState(); return x.dice === null && x.rolledAt === null && x.payouts === null; })());
  check('el estado trae limits y phaseEndsAt', s.limits.min === 25 && s.limits.max > 0 && typeof s.phaseEndsAt === 'number');
}
console.log(fails === 0 ? '\nTODO OK' : `\n${fails} PRUEBA(S) FALLARON`);
process.exit(fails === 0 ? 0 : 1);
