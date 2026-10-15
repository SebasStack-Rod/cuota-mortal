// dev/test_roulette.mjs: pruebas automáticas de la lógica de la ruleta (sin navegador).
// Se corre con `node dev/test_roulette.mjs` desde la carpeta cuota-mortal/ (Node 22.7 o más nuevo).
// Verifica: RTP, contrato de efectos, banco sin fondos, salir sentado, dos jugadores a la vez, pagos con trébol y la
// matemática del giro (la bola termina EXACTAMENTE en el bolsillo del número sorteado).
import { createGame, meta, computeRtp } from '../js/games/roulette/logic.js';
import { limitsForDay } from '../js/games/limits.js';
import { WHEEL, spotWins, spotMult, SPOTS, BETTING_MS, SPIN_PHASE_MS, RESULT_MS } from '../js/games/roulette/constants.js';
import { makeSpin, prepareSpin, ballPoseAt, wheelAngleAt, pocketRel, mod, TAU, POCKET_ANGLE } from '../js/games/roulette/spinmath.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let fails = 0;
function check(name, cond, extra = '') {
  console.log((cond ? '  ok   ' : '  FALLA ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fails++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Mini anfitrión: aplica efectos al banco y avanza el reloj.
function makeHost(seed, bank = 1e9, config = {}) {
  let t = 1_700_000_000_000;
  const rng = mulberry32(seed);
  const game = createGame({ rng, now: () => t, config });
  const host = {
    bank, net: 0, events: [], effects: [], mods: { payoutMult: 1, rerolls: 0 }, seats: ['a', 'b', 'c'],
    limits: { minBet: 25, maxBet: 1e9 },
    ctx() { return { bank: host.bank, modifiers: host.mods, seats: host.seats, names: {}, limits: host.limits }; },
    apply(effs) {
      for (const e of effs) {
        host.effects.push(e);
        if (e.type === 'debit') { host.bank -= e.amount; host.net -= e.amount; }
        if (e.type === 'credit') { host.bank += e.amount; host.net += e.amount; }
        if (e.type === 'event') host.events.push(e);
      }
    },
    act(pid, action) { const r = game.handleAction(pid, action, host.ctx()); if (r.ok) host.apply(r.effects); return r; },
    advance(ms) { t += ms; host.apply(game.tick(t, host.ctx())); },
    toPhase(p) { let guard = 0; while (game.getPublicState().phase !== p && guard++ < 10) host.advance(1000 + Math.max(BETTING_MS, SPIN_PHASE_MS, RESULT_MS)); },
    game, now: () => t,
  };
  return host;
}

console.log('1) RTP');
check('computeRtp() = 36/37', near(computeRtp(), 36 / 37));
check('meta.rtp coincide con computeRtp()', meta.rtp === computeRtp(), 'rtp=' + meta.rtp.toFixed(5));
for (const spot of ['n7', 'red', 'even', 'low', 'd2', 'c3']) {
  let r = 0; for (let n = 0; n < 37; n++) if (spotWins(spot, n)) r += spotMult(spot);
  check(`RTP de ${spot} = 36/37`, near(r / 37, 36 / 37));
}

console.log('2) Simulación: 3 jugadores, 6000 rondas, apuestas al azar');
{
  const h = makeHost(7);
  const rnd = mulberry32(99);
  let staked = 0, paid = 0, results = 0, expectedResults = 0, creditMismatch = 0;
  for (let r = 0; r < 6000; r++) {
    const placed = new Set();
    for (const pid of ['a', 'b', 'c']) {
      const n = 1 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const spot = SPOTS[Math.floor(rnd() * SPOTS.length)];
        const res = h.act(pid, { type: 'bet', spot, amount: 100 * (1 + Math.floor(rnd() * 5)) });
        if (res.ok) { placed.add(pid + '|' + spot); staked += res.effects[0].amount; }
      }
    }
    expectedResults += placed.size;
    const before = h.events.length;
    h.toPhase('result');
    for (const e of h.events.slice(before)) {
      if (e.name === 'bet_result') {
        results++; paid += e.data.payout;
        const credit = h.effects.filter((x) => x.type === 'credit' && x.ref === e.data.ref && x.kind === 'payout').reduce((s, x) => s + x.amount, 0);
        if (credit !== e.data.payout) creditMismatch++;
      }
    }
    h.toPhase('betting');
  }
  check('un bet_result por cada (jugador, lugar)', results === expectedResults, `${results}/${expectedResults}`);
  check('el crédito de cada pago coincide con el payout del evento', creditMismatch === 0);
  const rtp = paid / staked;
  check('RTP simulado cerca de 0,973', Math.abs(rtp - 36 / 37) < 0.02, 'simulado=' + rtp.toFixed(4));
  check('contabilidad del banco: net = pagado - apostado', h.net === paid - staked);
}

console.log('3) Banco sin fondos y dos jugadores a la vez');
{
  const h = makeHost(1, 700);
  const r1 = h.act('a', { type: 'bet', spot: 'red', amount: 500 });
  const r2 = h.act('b', { type: 'bet', spot: 'black', amount: 500 });
  check('la primera apuesta entra', r1.ok && r1.effects.length === 1);
  check('la segunda se rechaza con sin_fondos y sin efectos', !r2.ok && r2.error === 'sin_fondos' && r2.effects.length === 0);
  check('el banco quedó en 200', h.bank === 200);
  const r3 = h.act('a', { type: 'bet', spot: 'red', amount: 10 });
  check('monto menor al mínimo', !r3.ok && r3.error === 'monto_invalido');
  const r4 = h.act('a', { type: 'bet', spot: 'n99', amount: 100 });
  check('lugar inválido', !r4.ok && r4.error === 'lugar_invalido');
  const r5 = h.act('zz', { type: 'bet', spot: 'red', amount: 100 });
  check('jugador que no está sentado', !r5.ok && r5.error === 'no_sentado');
}

console.log('4) undo / clear / rebet');
{
  const h = makeHost(2, 100000);
  h.act('a', { type: 'bet', spot: 'red', amount: 500 });
  h.act('a', { type: 'bet', spot: 'red', amount: 100 });
  h.act('a', { type: 'bet', spot: 'n17', amount: 100 });
  const u = h.act('a', { type: 'undo' });
  check('undo devuelve la última ficha con refund', u.ok && u.effects[0].kind === 'refund' && u.effects[0].amount === 100);
  check('estado: red=600 y sin n17', JSON.stringify(h.game.getPublicState().bets.a) === '{"red":600}');
  const c = h.act('a', { type: 'clear' });
  check('clear devuelve todo', c.ok && c.effects.reduce((s, e) => s + e.amount, 0) === 600 && h.bank === 100000);
  check('undo sin nada', h.act('a', { type: 'undo' }).error === 'nada_que_deshacer');
  h.act('a', { type: 'bet', spot: 'black', amount: 300 });
  h.act('a', { type: 'bet', spot: 'n5', amount: 200 });
  h.toPhase('result'); h.toPhase('betting');
  const rb = h.act('a', { type: 'rebet' });
  check('rebet repite las fichas anteriores (2 lugares, $5 en total)', rb.ok && rb.effects.length === 2 && rb.effects.reduce((s, e) => s + e.amount, 0) === 500);
  check('rebet dos veces seguidas: ya_apostaste', h.act('a', { type: 'rebet' }).error === 'ya_apostaste');
  check('rebet sin historial', h.act('b', { type: 'rebet' }).error === 'sin_apuestas_previas');
}

console.log('5) Fases, nadie apostó y salir sentado');
{
  const h = makeHost(3, 100000);
  h.advance(BETTING_MS + 50);
  check('si nadie apostó no se gira', h.game.getPublicState().phase === 'betting');
  h.act('a', { type: 'bet', spot: 'red', amount: 1000 });
  h.act('b', { type: 'bet', spot: 'n0', amount: 500 });
  const stA = h.game.getPublicState();
  check('en betting el estado NO adelanta el resultado', stA.result === null);
  h.advance(BETTING_MS + 50);
  const stB = h.game.getPublicState();
  check('pasa a spinning con spin y result', stB.phase === 'spinning' && stB.result !== null && stB.spin !== null);
  const leave = h.game.onSeatLeft('a', h.ctx()); h.apply(leave);
  check('salir en spinning liquida (no devuelve): 1 bet_result y sin refund', leave.filter((e) => e.name === 'bet_result').length === 1 && !leave.some((e) => e.kind === 'refund'));
  h.advance(SPIN_PHASE_MS + 50);
  const st = h.game.getPublicState();
  check('result: payouts y history', st.phase === 'result' && st.history[0] === st.result && st.payouts && st.payouts.b);
  const h2 = makeHost(4, 100000);
  h2.act('a', { type: 'bet', spot: 'red', amount: 1000 });
  const lv = h2.game.onSeatLeft('a', h2.ctx()); h2.apply(lv);
  check('salir en betting devuelve con refund y deja el banco igual', lv.length === 1 && lv[0].kind === 'refund' && h2.bank === 100000);
}

console.log('6) Pago con trébol (payoutMult 1,1 solo sobre la ganancia)');
{
  const h = makeHost(5, 1e7, { debug: true });
  h.mods.payoutMult = 1.1;
  h.act('a', { type: 'debug_force', number: 17 });
  h.act('a', { type: 'bet', spot: 'n17', amount: 1000 });
  h.act('b', { type: 'bet', spot: 'red', amount: 1000 });  // 17 es negro
  h.toPhase('result');
  const ev = h.events.filter((e) => e.name === 'bet_result');
  const a = ev.find((e) => e.data.playerId === 'a').data, b = ev.find((e) => e.data.playerId === 'b').data;
  check('pleno 1000 con x1,1: devuelve 1000 + floor(35000*1,1) = 39500', a.payout === 39500, 'payout=' + a.payout);
  check('rojo perdedor paga 0', b.payout === 0);
  const h3 = makeHost(6, 1e7);
  h3.act('a', { type: 'debug_force', number: 17 });
  h3.act('a', { type: 'bet', spot: 'red', amount: 100 });
  h3.toPhase('result');
  check('sin config.debug el force no funciona', h3.game.getPublicState().result !== null && h3.act('a', { type: 'debug_force', number: 5 }).ok === false);
}

console.log('7) Tamaño del estado (peor caso: 8 jugadores con 24 lugares cada uno)');
{
  const h = makeHost(8, 1e9);
  h.seats = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  for (const pid of h.seats) for (let i = 0; i < 24; i++) h.act(pid, { type: 'bet', spot: SPOTS[(i * 2) % SPOTS.length], amount: 100000 });
  h.advance(BETTING_MS + 50); h.advance(SPIN_PHASE_MS + 50);
  const size = JSON.stringify(h.game.getPublicState()).length;
  check('el estado público pesa menos de 4 KB', size < 4096, size + ' bytes');
}

console.log('7b) Límites de apuesta por día (monto libre)');
{
  const h = makeHost(12, 1e9);
  h.limits = limitsForDay(1);
  check('día 1: máximo $200', h.limits.maxBet === 20000);
  check('día 5: máximo $4.000', limitsForDay(5).maxBet === 400000);
  check('apostar un monto libre ($137,35) está permitido', h.act('a', { type: 'bet', spot: 'red', amount: 13735 }).ok);
  const r = h.act('a', { type: 'bet', spot: 'black', amount: 6266 });
  check('pasarse del máximo por ronda se rechaza (supera_maximo)', !r.ok && r.error === 'supera_maximo' && r.effects.length === 0);
  check('justo en el máximo entra ($62,65 más)', h.act('a', { type: 'bet', spot: 'black', amount: 6265 }).ok);
  check('menos del mínimo se rechaza', h.act('b', { type: 'bet', spot: 'red', amount: 10 }).error === 'monto_invalido');
  check('el estado publica los límites', JSON.stringify(h.game.getPublicState().limits) === '{"min":25,"max":20000}');
  h.limits = limitsForDay(5);
  check('al subir el día entra una apuesta de $3.500', h.act('b', { type: 'bet', spot: 'n1', amount: 350000 }).ok);
}

console.log('8) Matemática del giro: la bola termina en el bolsillo exacto');
{
  const rng = mulberry32(2026);
  let worstEnd = 0, worstJump = 0, worstR = 0, minR = 9, bad = 0;
  for (let k = 0; k < 4000; k++) {
    const number = Math.floor(rng() * 37);
    const spin = makeSpin(rng, 1_700_000_000_000, number, rng() * TAU);
    const prep = prepareSpin(spin, number);
    if (WHEEL[prep.idx] !== number) bad++;
    // 1) posición final = centro del bolsillo
    const endT = spin.startedAt + spin.duration + 500;
    const pose = ballPoseAt(prep, spin, endT);
    const rel = mod(pose.angle - wheelAngleAt(spin, endT) - pocketRel(prep.idx) + Math.PI, TAU) - Math.PI;
    worstEnd = Math.max(worstEnd, Math.abs(rel));
    // 2) continuidad en el tiempo (paso de 8 ms) y radios razonables
    let prev = null;
    for (let t = 0; t <= spin.duration + 200; t += 8) {
      const p = ballPoseAt(prep, spin, spin.startedAt + t);
      if (prev) {
        const d = Math.abs(p.angle - prev.angle);
        worstJump = Math.max(worstJump, d / 0.008); // rad/s
      }
      worstR = Math.max(worstR, p.r); minR = Math.min(minR, p.r);
      prev = p;
    }
    // 3) la bola ya está quieta respecto de la rueda en los últimos instantes
    const p1 = ballPoseAt(prep, spin, spin.startedAt + spin.duration - 30);
    const relNear = mod(p1.rel - prep.target + Math.PI, TAU) - Math.PI;
    if (Math.abs(relNear) > POCKET_ANGLE * 0.2) bad++;
  }
  check('el bolsillo calculado es el del número', bad === 0, 'errores=' + bad);
  check('error angular final < 1e-5 rad', worstEnd < 1e-5, 'peor=' + worstEnd.toExponential(2));
  check('velocidad angular máxima razonable (< 22 rad/s, sin saltos)', worstJump < 22, 'máx=' + worstJump.toFixed(2) + ' rad/s');
  check('radio de la bola dentro de [0,58 ; 0,87]', minR > 0.58 && worstR < 0.87, `min=${minR.toFixed(3)} máx=${worstR.toFixed(3)}`);
}

console.log(fails === 0 ? '\nTODO OK' : `\n${fails} PRUEBA(S) FALLARON`);
process.exit(fails === 0 ? 0 : 1);
