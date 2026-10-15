// dev/test_crash.mjs: pruebas automáticas de la lógica del Crash. Se corre con `node dev/test_crash.mjs` desde cuota-mortal/.
// Verifica: RTP (teórico y simulado con el juego real), retiros manual y automático, 'ya_exploto', que NO se filtre el punto
// de explosión, límites por día, salir sentado y la contabilidad del banco.
import { createGame, meta, computeRtp, crashPointFrom, multAt, BETTING_MS, CRASHED_MS } from '../js/games/crash/logic.js';
import { limitsForDay } from '../js/games/limits.js';

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fails = 0;
const check = (n, c, x = '') => { console.log((c ? '  ok   ' : '  FALLA ') + n + (x ? '  ' + x : '')); if (!c) fails++; };

function makeHost(seed, bank = 1e9, config = {}) {
  let t = 1_700_000_000_000;
  const game = createGame({ rng: mulberry32(seed), now: () => t, config });
  const h = { bank, net: 0, events: [], effects: [], seats: ['a', 'b'], limits: { minBet: 25, maxBet: 1e9 }, game,
    ctx() { return { bank: h.bank, modifiers: {}, seats: h.seats, names: {}, limits: h.limits }; },
    apply(es) { for (const e of es) { h.effects.push(e); if (e.type === 'debit') { h.bank -= e.amount; h.net -= e.amount; } if (e.type === 'credit') { h.bank += e.amount; h.net += e.amount; } if (e.type === 'event') h.events.push(e); } },
    act(pid, a) { const r = game.handleAction(pid, a, h.ctx()); if (r.ok) h.apply(r.effects); return r; },
    advance(ms) { t += ms; h.apply(game.tick(t, h.ctx())); },
    toRunning() { let g = 0; while (game.getPublicState().phase !== 'running' && g++ < 5) h.advance(BETTING_MS + 10); },
    toCrashed() { let g = 0; while (game.getPublicState().phase === 'running' && g++ < 200000) h.advance(100); },
    toBetting() { let g = 0; while (game.getPublicState().phase !== 'betting' && g++ < 5) h.advance(CRASHED_MS + 10); },
    now: () => t };
  return h;
}

console.log('1) RTP');
check('computeRtp() = 0,97', Math.abs(computeRtp() - 0.97) < 1e-12);
check('meta.rtp coincide', meta.rtp === computeRtp());
check('punto de explosión mínimo 1,00 y tope 1000', crashPointFrom(0) === 1 && crashPointFrom(0.9999999999) === 1000);
{ // simulación con el juego real: todos retiran en 2x automático
  const h = makeHost(21); let staked = 0, paid = 0;
  const N = 150000;
  for (let i = 0; i < N; i++) {
    h.act('a', { type: 'bet', amount: 10000, auto: 2 }); staked += 10000;
    const before = h.events.length;
    h.toRunning(); h.toCrashed();
    for (const e of h.events.slice(before)) paid += e.data.payout;
    h.toBetting();
  }
  const rtp = paid / staked;
  check(`RTP simulado retirando en 2x (${N} rondas) cerca de 0,97`, Math.abs(rtp - 0.97) < 0.012, 'simulado=' + rtp.toFixed(4));
  check('contabilidad del banco', h.net === paid - staked);
}

console.log('2) Retiro manual, ya_exploto y que no se filtre crashAt');
{
  const h = makeHost(2, 1e9, { debug: true });
  h.act('a', { type: 'debug_force', crashAt: 3 });
  h.act('a', { type: 'bet', amount: 1000 }); h.act('b', { type: 'bet', amount: 1000 });
  check('en betting no se puede retirar', h.act('a', { type: 'cashout' }).error === 'no_en_juego');
  h.toRunning();
  const st = h.game.getPublicState();
  check('running: crashedAt es null y phaseEndsAt null', st.crashedAt === null && st.phaseEndsAt === null && st.phase === 'running');
  check('el estado no contiene el punto de explosión', !JSON.stringify(st).includes('"crashAt"'));
  h.advance(10000); // m = exp(.07*10) = 2.01
  const r = h.act('a', { type: 'cashout' });
  const m = multAt(0.07, 10000);
  check('cobra floor(apuesta × multiplicador)', r.ok && r.effects[0].amount === Math.floor(1000 * m + 1e-9), `m=${m} cobra=${r.effects && r.effects[0].amount}`);
  check('retirar dos veces: ya_retirado', h.act('a', { type: 'cashout' }).error === 'ya_retirado');
  h.advance(6000); // m ≈ 3,07 > 3 => explotó
  check('después de explotar el retiro se rechaza con ya_exploto', h.game.getPublicState().phase === 'crashed' && h.act('b', { type: 'cashout' }).error === 'ya_exploto');
  const st2 = h.game.getPublicState();
  check('crashed publica crashedAt = 3 y el historial', st2.crashedAt === 3 && st2.history[0] === 3);
  const res = h.events.filter((e) => e.name === 'bet_result');
  check('un bet_result por apuesta (a cobró, b perdió)', res.length === 2 && res.find((e) => e.data.playerId === 'b').data.payout === 0);
}

console.log('3) Retiro automático, explosión en 1,00x y apuestas');
{
  const h = makeHost(3, 1e9, { debug: true });
  h.act('a', { type: 'debug_force', crashAt: 5 });
  h.act('a', { type: 'bet', amount: 2000, auto: 1.5 });
  check('auto inválido', h.act('b', { type: 'bet', amount: 100, auto: 0.5 }).error === 'auto_invalido');
  check('una sola apuesta por ronda', h.act('a', { type: 'bet', amount: 100 }).error === 'ya_apostaste');
  h.toRunning(); h.toCrashed();
  const e = h.events.find((x) => x.data.playerId === 'a');
  check('el auto cobra exactamente en 1,5x', e.data.payout === 3000 && e.data.detail.cashedAt === 1.5);
  h.toBetting();
  h.act('a', { type: 'debug_force', crashAt: 1 }); h.act('a', { type: 'bet', amount: 500 });
  h.toRunning();
  check('crash en 1,00x: no se puede retirar', h.act('a', { type: 'cashout' }).error === 'ya_exploto');
  h.advance(100);
  check('y se liquida como pérdida', h.events.at(-1).data.payout === 0 && h.game.getPublicState().crashedAt === 1);
}

console.log('4) Banco, límites, cancelar y salir sentado');
{
  const h = makeHost(4, 700);
  check('sin fondos', h.act('a', { type: 'bet', amount: 800 }).error === 'sin_fondos');
  h.limits = limitsForDay(1);
  h.bank = 1e9;
  check('día 1: pasarse de $200 se rechaza', h.act('a', { type: 'bet', amount: 20001 }).error === 'supera_maximo');
  check('$200 justos entra', h.act('a', { type: 'bet', amount: 20000 }).ok);
  const c = h.act('a', { type: 'cancel' });
  check('cancelar devuelve la apuesta', c.ok && c.effects[0].kind === 'refund' && c.effects[0].amount === 20000);
  check('monto libre $12,34', h.act('a', { type: 'bet', amount: 1234 }).ok);
  const lv = h.game.onSeatLeft('a'); h.apply(lv);
  check('salir en betting devuelve (refund)', lv.length === 1 && lv[0].kind === 'refund');
  const h2 = makeHost(5, 1e9, { debug: true });
  h2.act('a', { type: 'debug_force', crashAt: 9 }); h2.act('a', { type: 'bet', amount: 1000 }); h2.toRunning(); h2.advance(5000);
  const lv2 = h2.game.onSeatLeft('a'); h2.apply(lv2);
  check('salir en running retira al multiplicador actual', lv2.length === 2 && lv2[0].kind === 'payout' && lv2[0].amount === Math.floor(1000 * multAt(0.07, 5000) + 1e-9));
  const big = makeHost(6, 1e9); big.seats = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  big.seats.forEach((p) => big.act(p, { type: 'bet', amount: 100000, auto: 2.5 }));
  big.toRunning(); big.toCrashed();
  check('estado público de 8 jugadores < 4 KB', JSON.stringify(big.game.getPublicState()).length < 4096, JSON.stringify(big.game.getPublicState()).length + ' bytes');
}
console.log(fails === 0 ? '\nTODO OK' : `\n${fails} PRUEBA(S) FALLARON`);
process.exit(fails === 0 ? 0 : 1);
