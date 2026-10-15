// dev/test_transversal.mjs: pruebas de fase 7 que cruzan juegos: crash con dos jugadores a la vez y tamaño del estado con 8 jugadores.
import * as crash from '../js/games/crash/logic.js';
import * as slots from '../js/games/slots/logic.js';
import { limitsForDay } from '../js/games/limits.js';
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fails = 0;
const check = (n, c, x = '') => { console.log((c ? '  ok   ' : '  FALLA ') + n + (x ? '  ' + x : '')); if (!c) fails++; };
const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const ctx = () => ({ bank: 1e9, modifiers: { payoutMult: 1 }, seats: ids, names: {}, limits: limitsForDay(1) });

console.log('1) Crash: dos jugadores a la vez, liquidación separada y estado de 8 jugadores');
{
  let t = 1_700_000_000_000, net = {}; const events = [];
  const g = crash.createGame({ rng: mulberry32(3), now: () => t, config: { debug: true } });
  const apply = (es) => { for (const e of es) { if (e.type === 'debit') net[e.playerId] = (net[e.playerId] || 0) - e.amount; if (e.type === 'credit') net[e.playerId] = (net[e.playerId] || 0) + e.amount; if (e.type === 'event' && e.name === 'bet_result') events.push(e.data); } };
  g.handleAction('a', { type: 'debug_force', crashAt: 3 }, ctx());
  for (const id of ids) apply(g.handleAction(id, { type: 'bet', amount: 1000 }, ctx()).effects);
  check('8 jugadores apuestan en la misma ronda', ids.every((id) => net[id] === -1000));
  const size = JSON.stringify(g.getPublicState()).length;
  check('estado público con 8 jugadores menor a 4 KB', size < 4096, size + ' bytes');
  t += 9000; apply(g.tick(t, ctx()));
  check('la ronda empezó (running)', g.getPublicState().phase === 'running');
  t += 6000; const r = g.handleAction('a', { type: 'cashout' }, ctx()); apply(r.effects);
  check('a se retira y cobra solo lo suyo', r.ok && net.a > -1000 && ids.slice(1).every((id) => net[id] === -1000));
  t += 30000; apply(g.tick(t, ctx()));
  check('los otros 7 pierden con un bet_result cada uno (payout 0)', events.length === 8 && events.filter((e) => e.payout === 0).length === 7 && !JSON.stringify(g.getPublicState()).includes('undefined'));
}

console.log('2) Tragamonedas: instancias independientes por jugador y estado chico');
{
  let t = 1_700_000_000_000; const games = ids.map((id) => slots.createGame({ rng: mulberry32(id.charCodeAt(0)), now: () => t, config: { debug: true }, playerId: id }));
  games[0].handleAction('a', { type: 'spin', amount: 500 }, ctx());
  check('girar en una máquina no mueve las otras', games[0].getPublicState().phase === 'spinning' && games.slice(1).every((g) => g.getPublicState().phase === 'idle'));
  const total = games.reduce((s, g) => s + JSON.stringify(g.getPublicState()).length, 0);
  check('estados de 8 máquinas menores a 4 KB en total', total < 4096, total + ' bytes');
}
console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
