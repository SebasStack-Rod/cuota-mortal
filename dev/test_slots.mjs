// dev/test_slots.mjs: pruebas de la lógica de la tragamonedas. `node dev/test_slots.mjs` desde cuota-mortal/.
import { createGame, meta, computeRtp, payMult, STRIP, SPIN_MS, RESULT_MS } from '../js/games/slots/logic.js';
import { limitsForDay } from '../js/games/limits.js';
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fails = 0;
const check = (n, c, x = '') => { console.log((c ? '  ok   ' : '  FALLA ') + n + (x ? '  ' + x : '')); if (!c) fails++; };
function host(seed, bank = 1e9, config = { debug: true }) {
  let t = 1_700_000_000_000;
  const g = createGame({ rng: mulberry32(seed), now: () => t, config, playerId: 'a' });
  const h = { g, bank, net: 0, events: [], effects: [], mods: { payoutMult: 1 }, seats: ['a'], limits: { minBet: 25, maxBet: 1e9 },
    ctx() { return { bank: h.bank, modifiers: h.mods, seats: h.seats, names: {}, limits: h.limits }; },
    apply(es) { for (const e of es) { h.effects.push(e); if (e.type === 'debit') { h.bank -= e.amount; h.net -= e.amount; } if (e.type === 'credit') { h.bank += e.amount; h.net += e.amount; } if (e.type === 'event') h.events.push(e); } },
    act(a) { const r = g.handleAction('a', a, h.ctx()); if (r.ok) h.apply(r.effects); return r; },
    adv(ms) { t += ms; h.apply(g.tick(t, h.ctx())); } };
  return h;
}
const idx = (sym) => STRIP.indexOf(sym);

console.log('1) RTP y tabla de pagos');
const rtp = computeRtp();
check('RTP exacto entre 0,92 y 0,96', rtp >= 0.92 && rtp <= 0.96, 'rtp=' + rtp.toFixed(5));
check('meta.rtp coincide con computeRtp()', meta.rtp === rtp);
check('la tira tiene 32 paradas con 3 sietes, 7 campanas, 6 BAR, 11 cerezas, 5 vacías', [3, 11, 7, 6, 5].every((c, i) => STRIP.filter((s) => s === [0, 1, 2, 3, 4][i]).length === c));
const s7 = idx(0), sc = idx(1), sb = idx(2), sr = idx(3), se = idx(4);
check('7 7 7 paga 50x', payMult([s7, s7, s7]) === 50);
check('campana x3 paga 20x', payMult([sb, sb, sb]) === 20);
check('BAR x3 paga 10x', payMult([sr, sr, sr]) === 10);
check('cerezas x3 paga 6x', payMult([sc, sc, sc]) === 6);
check('dos cerezas al comienzo pagan 2x', payMult([sc, sc, se]) === 2 && payMult([sc, sc, s7]) === 2);
check('una cereza al comienzo devuelve la apuesta (1x)', payMult([sc, se, sc]) === 1 && payMult([sc, sb, sr]) === 1);
check('sin cereza al comienzo y sin trío pierde', payMult([se, sc, sc]) === 0 && payMult([sb, sb, sr]) === 0);

console.log('2) Simulación con el juego real (300 mil giros)');
{
  const h = host(8); let staked = 0, paid = 0;
  for (let i = 0; i < 300000; i++) {
    const r = h.act({ type: 'spin', amount: 1000 }); staked += 1000;
    h.adv(SPIN_MS); const ev = h.events.at(-1); paid += ev.name === 'jackpot' ? h.events.at(-2).data.payout : ev.data.payout; h.adv(RESULT_MS);
  }
  check('RTP simulado cerca del exacto', Math.abs(paid / staked - rtp) < 0.03, 'simulado=' + (paid / staked).toFixed(4));
  check('contabilidad del banco', h.net === paid - staked);
}

console.log('3) Fases, efectos y contrato');
{
  const h = host(1);
  h.act({ type: 'debug_force', reels: [s7, s7, s7] });
  const r = h.act({ type: 'spin', amount: 1000 });
  const st = h.g.getPublicState();
  check('spin: 1 débito y fase spinning con spinEndsAt', r.ok && r.effects.length === 1 && r.effects[0].type === 'debit' && st.phase === 'spinning' && st.spinEndsAt === st.spinStartedAt + SPIN_MS);
  check('mientras gira lastWin es null (no adelanta el premio)', st.lastWin === null);
  check('no se puede girar dos veces a la vez', h.act({ type: 'spin', amount: 1000 }).error === 'girando');
  h.adv(SPIN_MS - 1); check('antes de spinEndsAt no liquida', h.g.getPublicState().phase === 'spinning');
  h.adv(1);
  const st2 = h.g.getPublicState();
  const names = h.events.map((e) => e.name);
  check('liquida: crédito 50x, un bet_result y un jackpot', st2.phase === 'result' && st2.lastWin === 50000 && names.join() === 'bet_result,jackpot' && h.bank === 1e9 - 1000 + 50000);
  check('se puede girar de nuevo estando en result', h.act({ type: 'spin', amount: 500 }).ok);
  h.adv(SPIN_MS); h.adv(RESULT_MS + 10);
  check('vuelve a idle', h.g.getPublicState().phase === 'idle' && h.g.getPublicState().phaseEndsAt === null);
}

console.log('4) Trébol, límites, sin fondos y levantarse girando');
{
  const h = host(2); h.mods.payoutMult = 1.1;
  h.act({ type: 'debug_force', reels: [sc, sc, sc] }); h.act({ type: 'spin', amount: 1000 }); h.adv(SPIN_MS);
  check('cerezas x3 con trébol: 1000 + floor(5000*1,1) = 6500', h.events.at(-1).data.payout === 6500);
  const h1 = host(3); h1.mods.payoutMult = 1.1;
  h1.act({ type: 'debug_force', reels: [sc, sb, sr] }); h1.act({ type: 'spin', amount: 1000 }); h1.adv(SPIN_MS);
  check('1x devuelve exactamente la apuesta aunque haya trébol', h1.events.at(-1).data.payout === 1000);
  const h2 = host(4, 500);
  check('sin fondos', h2.act({ type: 'spin', amount: 600 }).error === 'sin_fondos' && h2.effects.length === 0);
  h2.limits = limitsForDay(1); h2.bank = 1e9;
  check('día 1: pasar de $200 por giro se rechaza', h2.act({ type: 'spin', amount: 20001 }).error === 'supera_maximo');
  check('monto libre $37,41 permitido', h2.act({ type: 'spin', amount: 3741 }).ok);
  const h3 = host(5); h3.act({ type: 'debug_force', reels: [se, se, se] }); h3.act({ type: 'spin', amount: 700 });
  const lv = h3.g.onSeatLeft('a', h3.ctx());
  check('levantarse girando liquida (bet_result, sin refund)', lv.length === 1 && lv[0].name === 'bet_result' && lv[0].data.payout === 0);
  const h4 = host(6, 1e9, {}); check('sin config.debug no se puede forzar', h4.act({ type: 'debug_force', reels: [0, 0, 0] }).ok === false);
  check('el estado público es chico', JSON.stringify(h.g.getPublicState()).length < 600);
}
console.log(fails === 0 ? '\nTODO OK' : `\n${fails} PRUEBA(S) FALLARON`);
process.exit(fails === 0 ? 0 : 1);
