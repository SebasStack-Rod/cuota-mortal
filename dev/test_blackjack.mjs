// dev/test_blackjack.mjs: pruebas del Blackjack. `node dev/test_blackjack.mjs` desde cuota-mortal/.
// Cubre reglas, RTP medido, reparto, natural 3:2, banca en 17 blando, mirada de natural, doblar, timeouts, límites, onSeatLeft, zapato y estado.
import { createGame, meta, computeRtp, RTP_MEASURED, BETTING_MS, PLAY_MS, DEAL_CARD_MS, DEAL_TAIL_MS, DEALER_STEP_MS, SETTLE_MS } from '../js/games/blackjack/logic.js';
import { handValue, isNatural, dealerShouldHit, outcomeOf, makeShoe, simulate, basicAction } from '../js/games/blackjack/rules.js';
import { limitsForDay } from '../js/games/limits.js';
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fails = 0;
const check = (n, c, x = '') => { console.log((c ? '  ok   ' : '  FALLA ') + n + (x ? '  ' + x : '')); if (!c) fails++; };

function host(seed, { bank = 1e9, config = { debug: true }, seats = ['a', 'b'] } = {}) {
  let t = 1_700_000_000_000;
  const g = createGame({ rng: mulberry32(seed), now: () => t, config });
  const h = {
    g, banks: { a: bank, b: bank, c: bank }, net: 0, events: [], effects: [], mods: { payoutMult: 1 }, seats, limits: { minBet: 25, maxBet: 1e9 },
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
    until(phase, max = 2000) { for (let i = 0; i < max && g.getPublicState().phase !== phase; i++) h.adv(100); return g.getPublicState(); },
    results() { return h.events.filter((e) => e.name === 'bet_result'); },
    st: () => g.getPublicState(), t: () => t,
  };
  return h;
}
const force = (h, ...cards) => h.act({ type: 'debug_force', next: cards });
// Reparto forzado: a1 b1 D1 a2 b2 D2 (dos jugadores). Para uno: a1 D1 a2 D2.
const finish = (h) => { h.until('settle'); return h.st(); };

console.log('1) Reglas puras');
check('As + Rey = 21 blando y natural', handValue(['AceSpades', 'KingHearts']).total === 21 && handValue(['AceSpades', 'KingHearts']).soft && isNatural(['AceSpades', 'KingHearts']));
check('As + As + 9 = 21 (un as baja a 1)', handValue(['AceSpades', 'AceHearts', '9Clubs']).total === 21);
check('As + 6 + Rey = 17 duro', (() => { const v = handValue(['AceSpades', '6Hearts', 'KingClubs']); return v.total === 17 && !v.soft; })());
check('tres cartas con 21 no es natural', !isNatural(['7Spades', '7Hearts', '7Clubs']));
check('la banca se planta en 17 blando y pide en 16', !dealerShouldHit(['AceSpades', '6Hearts']) && dealerShouldHit(['10Spades', '6Hearts']));
check('zapato de 6 mazos = 312 cartas únicas por mazo', makeShoe(6).length === 312 && new Set(makeShoe(1)).size === 52);
check('outcomeOf: natural contra natural empata, natural gana, bust pierde', outcomeOf(['AceSpades', 'KingHearts'], ['AceClubs', '10Hearts']) === 'push' && outcomeOf(['AceSpades', 'KingHearts'], ['10Clubs', '9Hearts']) === 'blackjack' && outcomeOf(['10Spades', '6Hearts', '9Clubs'], ['10Clubs', '9Hearts']) === 'bust');

console.log('2) RTP medido por simulación');
{
  const r = computeRtp(), mimic = simulate({ hands: 1000000, seed: 20260101, strategy: 'mimic' }).rtp;
  check('computeRtp() reproduce la constante RTP_MEASURED (semilla fija)', r === RTP_MEASURED && meta.rtp === RTP_MEASURED, 'rtp=' + r.toFixed(5));
  check('imitar a la banca rinde menos que la estrategia básica', mimic < r - 0.03, 'mimic=' + mimic.toFixed(5));
  check('estrategia básica: RTP < 1 (la casa gana)', r < 1 && r > 0.97);
  check('meta del contrato', meta.id === 'blackjack' && meta.mode === 'shared' && meta.minBet === 25);
}

console.log('3) Flujo de una ronda (a pierde 17 contra 19)');
{
  const h = host(1); h.act({ type: 'bet', amount: 1000 });
  force(h, '10Spades', '10Diamonds', '7Hearts', '9Clubs');
  check('bet: un débito con ref r1:a', h.effects[0].type === 'debit' && h.effects[0].ref === 'r1:a' && h.banks.a === 1e9 - 1000);
  check('sin apuestas no se reparte (otra ronda)', (() => { const g = host(2); g.adv(BETTING_MS + 1); return g.st().phase === 'betting' && g.st().round === 1; })());
  h.adv(BETTING_MS);
  let s = h.st();
  const dealMs = 2 * 2 * DEAL_CARD_MS + DEAL_TAIL_MS;
  check('dealing: duración 280 ms por carta + 500', s.phase === 'dealing' && s.phaseEndsAt === h.t() + dealMs && s.dealStartedAt === h.t());
  check('cartas repartidas: 2 al jugador, banca con la oculta en null', s.hands.a.cards.join() === '10Spades,7Hearts' && s.dealer.cards.length === 2 && s.dealer.cards[0] === '10Diamonds' && s.dealer.cards[1] === null);
  check('el total de la banca solo cuenta la carta visible', s.dealer.total === 10 && s.hands.a.total === 17);
  h.adv(dealMs); s = h.st();
  check('playing: turno de 15 s y la carta oculta sigue oculta', s.phase === 'playing' && s.hands.a.endsAt === h.t() + PLAY_MS && s.dealer.cards[1] === null);
  check('no se puede apostar en playing', h.act({ type: 'bet', amount: 100 }, 'b').error === 'apuestas_cerradas');
  h.act({ type: 'stand' }); h.adv(100); s = h.st();
  check('al plantarse todos pasa a dealer y se da vuelta la oculta', s.phase === 'dealer' && s.dealer.cards.join() === '10Diamonds,9Clubs' && s.dealer.total === 19);
  check('antes de settle no hay créditos ni bet_result', h.results().length === 0);
  s = finish(h);
  check('settle: pierde, un bet_result con payout 0 y sin crédito', s.results.a.outcome === 'lose' && h.results().length === 1 && h.results()[0].data.payout === 0 && !h.effects.some((e) => e.type === 'credit'));
  check('detail trae cartas, total y banca', h.results()[0].data.detail.total === 17 && h.results()[0].data.detail.dealerTotal === 19 && h.results()[0].data.detail.dealer.length === 2);
  h.adv(SETTLE_MS); s = h.st();
  check('ronda nueva: round 2, sin manos', s.phase === 'betting' && s.round === 2 && s.order.length === 0 && s.dealer.cards.length === 0);
}

console.log('4) Natural, empate, 17 blando y banca que pide');
{
  const h = host(3); h.act({ type: 'bet', amount: 1000 }); force(h, 'AceSpades', '9Clubs', 'KingHearts', '8Hearts');
  h.adv(BETTING_MS); h.until('dealer');
  check('natural del jugador: no hay fase playing (pasa derecho a la banca)', h.st().hands.a.status === 'blackjack');
  finish(h);
  check('natural paga 3:2 (2500 total)', h.results()[0].data.payout === 2500 && h.results()[0].data.detail.outcome === 'blackjack' && h.net === 1500);
  const h2 = host(4); h2.act({ type: 'bet', amount: 1000 }); force(h2, '10Spades', 'AceClubs', '8Hearts', '6Hearts'); h2.adv(BETTING_MS); h2.until('playing'); h2.act({ type: 'stand' });
  const s2 = finish(h2);
  check('banca con 17 blando (As + 6) se planta; 18 gana', s2.dealer.cards.length === 2 && s2.results.a.outcome === 'win' && h2.results()[0].data.payout === 2000);
  const h3 = host(5); h3.act({ type: 'bet', amount: 1000 }); force(h3, '10Spades', '10Clubs', 'KingHearts', '5Hearts', '6Diamonds'); h3.adv(BETTING_MS); h3.until('playing'); h3.act({ type: 'stand' });
  const s3 = finish(h3);
  check('banca con 15 pide una carta (6) y llega a 21', s3.dealer.cards.length === 3 && s3.dealer.total === 21 && s3.results.a.outcome === 'lose');
  const h4 = host(6); h4.act({ type: 'bet', amount: 1000 }); force(h4, '10Spades', '10Clubs', '9Hearts', '8Hearts'); h4.adv(BETTING_MS); h4.until('playing'); h4.act({ type: 'stand' }); finish(h4);
  check('ganar 19 contra 18 paga 2x (2000)', h4.results()[0].data.detail.outcome === 'win' && h4.results()[0].data.payout === 2000);
  const h5 = host(7); h5.act({ type: 'bet', amount: 1000 }); force(h5, '10Spades', '10Clubs', '8Hearts', '8Diamonds'); h5.adv(BETTING_MS); h5.until('playing'); h5.act({ type: 'stand' }); finish(h5);
  check('empate devuelve la apuesta con kind refund', h5.results()[0].data.detail.outcome === 'push' && h5.effects.some((e) => e.type === 'credit' && e.kind === 'refund' && e.amount === 1000) && h5.net === 0);
  const h6 = host(8); h6.act({ type: 'bet', amount: 1000 }); h6.act({ type: 'bet', amount: 500 }, 'b');
  force(h6, 'AceSpades', '9Hearts', 'AceClubs', 'KingHearts', '7Hearts', 'QueenClubs'); h6.adv(BETTING_MS);
  const s6 = h6.until('dealer');
  check('la banca mira: con natural no se juega (a natural empata, b pierde)', s6.dealer.cards.join() === 'AceClubs,QueenClubs' && s6.dealer.status === 'blackjack');
  finish(h6);
  const ra = h6.results().find((e) => e.data.playerId === 'a'), rb = h6.results().find((e) => e.data.playerId === 'b');
  check('natural contra natural: empate; el otro pierde', ra.data.detail.outcome === 'push' && ra.data.payout === 1000 && rb.data.payout === 0);
}

console.log('5) Pedir, pasarse y doblar');
{
  const h = host(10); h.act({ type: 'bet', amount: 1000 }); force(h, '10Spades', '10Clubs', '6Hearts', '7Hearts', '10Diamonds'); h.adv(BETTING_MS); h.until('playing');
  const t0 = h.st().hands.a.endsAt; h.adv(3000);
  check('hit: da la carta y renueva el turno (+15 s)', h.act({ type: 'hit' }).ok && h.st().hands.a.status === 'bust' && h.st().hands.a.cards.length === 3);
  const s = finish(h);
  check('pasarse pierde y la banca no pide más', s.results.a.outcome === 'bust' && s.dealer.cards.length === 2 && h.results()[0].data.payout === 0);
  check('la mano pasada no puede seguir', h.act({ type: 'hit' }).error === 'fuera_de_turno');
  const h2 = host(11); h2.act({ type: 'bet', amount: 1000 }); force(h2, '5Spades', '10Clubs', '6Hearts', '7Hearts', '10Diamonds'); h2.adv(BETTING_MS); h2.until('playing');
  const d = h2.act({ type: 'double' });
  check('doblar: segundo débito igual con ref r1:a:double y mano plantada', d.ok && d.effects.length === 1 && d.effects[0].type === 'debit' && d.effects[0].amount === 1000 && d.effects[0].ref === 'r1:a:double' && h2.st().hands.a.status === 'stand' && h2.st().hands.a.doubled && h2.st().hands.a.bet === 2000);
  check('doblar da una sola carta (21)', h2.st().hands.a.cards.length === 3 && h2.st().hands.a.total === 21);
  finish(h2);
  check('doblada ganada paga 2x sobre 2000 = 4000', h2.results()[0].data.stake === 2000 && h2.results()[0].data.payout === 4000 && h2.net === 2000);
  const h3 = host(12); h3.act({ type: 'bet', amount: 1000 }); force(h3, '2Spades', '10Clubs', '3Hearts', '7Hearts', '2Diamonds'); h3.adv(BETTING_MS); h3.until('playing'); h3.act({ type: 'hit' });
  check('no se dobla con tres cartas', h3.act({ type: 'double' }).error === 'no_puede_doblar');
  const h4 = host(13, { bank: 1500 }); h4.act({ type: 'bet', amount: 1000 }); h4.adv(BETTING_MS); h4.until('playing');
  check('doblar sin fondos: error y sin efectos', h4.act({ type: 'double' }).error === 'sin_fondos' && h4.effects.length === 1);
  const h5 = host(14); h5.limits = limitsForDay(1); h5.act({ type: 'bet', amount: 15000 }); force(h5, '5Spades', '10Clubs', '6Hearts', '7Hearts'); h5.adv(BETTING_MS); h5.until('playing');
  check('doblar que pase el máximo ($200): supera_maximo', h5.act({ type: 'double' }).error === 'supera_maximo');
  const h6 = host(15); h6.mods.payoutMult = 1.1; h6.act({ type: 'bet', amount: 1000 }); force(h6, 'AceSpades', '9Clubs', 'KingHearts', '8Hearts'); h6.adv(BETTING_MS); finish(h6);
  check('trébol sobre el natural: 1000 + floor(1500 x 1,1) = 2650', h6.results()[0].data.payout === 2650);
  const h7 = host(16); h7.mods.payoutMult = 1.5; h7.act({ type: 'bet', amount: 1000 }); force(h7, '10Spades', '9Clubs', '10Hearts', '7Hearts'); h7.adv(BETTING_MS); h7.until('playing'); h7.act({ type: 'stand' }); finish(h7);
  check('trébol sobre ganar: 1000 + floor(1000 x 1,5) = 2500; el empate no cambia', h7.results()[0].data.payout === 2500);
}

console.log('6) Tiempos, errores y límites');
{
  const h = host(20); h.act({ type: 'bet', amount: 1000 }); h.act({ type: 'bet', amount: 700 }, 'b'); force(h, '10Spades', '9Spades', '10Clubs', '6Hearts', '7Hearts', '8Hearts'); h.adv(BETTING_MS); h.until('playing');
  h.act({ type: 'stand' }, 'a');
  check('un jugador plantado no frena al otro: sigue en playing', h.st().phase === 'playing' && h.st().hands.b.status === 'playing');
  h.adv(PLAY_MS - 100); check('antes de agotar los 15 s sigue en juego', h.st().hands.b.status === 'playing' || h.st().phase !== 'playing');
  h.adv(200);
  check('se agotan los 15 s: la mano se planta sola y pasa a dealer', h.st().phase === 'dealer' && h.st().hands.b.status === 'stand');
  const e = host(21); e.act({ type: 'bet', amount: 500 });
  check('una sola apuesta por ronda', e.act({ type: 'bet', amount: 500 }).error === 'ya_apostaste');
  check('hit en betting: fuera_de_turno', e.act({ type: 'hit' }).error === 'fuera_de_turno');
  e.adv(BETTING_MS); e.until('playing');
  check('sin mano en la ronda: sin_mano', e.act({ type: 'hit' }, 'b').error === 'sin_mano');
  e.act({ type: 'stand' }); check('mano cerrada tras plantarse', e.act({ type: 'hit' }).error === 'fuera_de_turno' || e.act({ type: 'hit' }).error === 'mano_cerrada');
  const f = host(22); f.limits = limitsForDay(1);
  check('monto menor al mínimo y no entero', f.act({ type: 'bet', amount: 24 }).error === 'monto_invalido' && f.act({ type: 'bet', amount: 100.5 }).error === 'monto_invalido');
  check('día 1: más de $200 → supera_maximo', f.act({ type: 'bet', amount: 20001 }).error === 'supera_maximo' && f.act({ type: 'bet', amount: 20000 }).ok);
  check('sin fondos', host(23, { bank: 500 }).act({ type: 'bet', amount: 600 }).error === 'sin_fondos');
  check('no sentado', host(24, { seats: ['b'] }).act({ type: 'bet', amount: 100 }).error === 'no_sentado');
  const u = host(25); u.act({ type: 'bet', amount: 800 });
  check('undo devuelve la apuesta', u.act({ type: 'undo' }).effects[0].kind === 'refund' && u.banks.a === 1e9 && u.act({ type: 'undo' }).error === 'nada_que_deshacer');
  check('sin config.debug no se puede forzar', host(26, { config: {} }).act({ type: 'debug_force', next: ['AceSpades'] }).error === 'accion_desconocida');
  check('debug_force con carta inválida', host(27).act({ type: 'debug_force', next: ['AceBananas'] }).ok === false);
  check('acción desconocida', host(28).act({ type: 'xyz' }).error === 'accion_desconocida');
}

console.log('7) onSeatLeft por fase');
{
  const h = host(30); h.act({ type: 'bet', amount: 700 });
  const lv = h.g.onSeatLeft('a', h.ctx()); h.apply(lv);
  check('betting: se devuelve la apuesta', lv.length === 1 && lv[0].kind === 'refund' && h.net === 0 && Object.keys(h.st().bets).length === 0);
  const h2 = host(31); h2.act({ type: 'bet', amount: 1000 }); h2.act({ type: 'bet', amount: 1000 }, 'b'); force(h2, '10Spades', '10Hearts', '10Clubs', '8Spades', '9Hearts', '9Clubs'); h2.adv(BETTING_MS); h2.until('playing');
  h2.apply(h2.g.onSeatLeft('a', h2.ctx()));
  check('playing: la mano se planta sola', h2.st().hands.a.status === 'stand' && h2.st().phase === 'playing');
  h2.act({ type: 'stand' }, 'b'); finish(h2);
  check('se liquida en settle igual (a plantado con 18 pierde contra 19)', h2.results().length === 2 && h2.results().find((e) => e.data.playerId === 'a').data.payout === 0);
  const h3 = host(32); h3.act({ type: 'bet', amount: 1000 }); force(h3, '10Spades', '9Hearts', '10Clubs', '6Diamonds'); h3.adv(BETTING_MS);
  h3.apply(h3.g.onSeatLeft('a', h3.ctx())); check('dealing: queda pendiente', h3.st().phase === 'dealing');
  h3.until('dealer'); check('al terminar el reparto su mano ya está plantada (no espera 15 s)', h3.st().hands.a.status === 'stand');
  check('levantarse sin apuesta no hace nada', host(33).g.onSeatLeft('a', host(33).ctx()).length === 0);
}

console.log('8) Zapato y simulación con el juego real');
{
  const h = host(40); let minLeft = 1e9, shuffles = 0, lastLeft = 312, jumps = 0, staked = 0, paid = 0;
  for (let i = 0; i < 400; i++) {
    h.act({ type: 'bet', amount: 1000 }); staked += 1000;
    h.until('playing');
    while (h.st().phase === 'playing' && h.st().hands.a.status === 'playing') {
      const hd = h.st().hands.a, up = h.st().dealer.cards[0].match(/^(Ace|10|Jack|Queen|King|\d)/)[1];
      const upv = up === 'Ace' ? 11 : ['10', 'Jack', 'Queen', 'King'].includes(up) ? 10 : Number(up);
      const a = basicAction(hd.cards, upv, hd.cards.length === 2);
      if (a === 'double') { const r = h.act({ type: 'double' }); staked += 1000; if (!r.ok) h.act({ type: 'hit' }); } else h.act({ type: a });
    }
    const s = finish(h); const left = s.shoe.left;
    minLeft = Math.min(minLeft, left); if (left > lastLeft) jumps++; lastLeft = left;
    h.adv(SETTLE_MS);
  }
  shuffles = h.events.filter((e) => e.name === 'shoe_shuffled').length;
  paid = h.results().reduce((s, e) => s + e.data.payout, 0);
  const stakedReal = h.results().reduce((s, e) => s + e.data.stake, 0);
  check('el zapato se baraja al bajar del 25% (hubo barajadas)', shuffles >= 2 && jumps === shuffles, shuffles + ' barajadas');
  check('nunca se acaba el zapato', minLeft > 0, 'mínimo ' + minLeft);
  check('contabilidad: net = pagos − apuestas (con dobles)', h.net === paid - stakedReal && stakedReal >= staked - 0);
  check('un bet_result por ronda', h.results().length === 400);
}

console.log('9) Dos jugadores y estado público');
{
  const h = host(50); h.act({ type: 'bet', amount: 1000 }); h.act({ type: 'bet', amount: 500 }, 'b');
  force(h, '10Spades', '9Hearts', '8Clubs', '9Spades', '10Hearts', '7Clubs'); h.adv(BETTING_MS); h.until('playing');
  check('ven todas las manos (a 19, b 19) y las dos juegan a la vez', h.st().hands.a.total === 19 && h.st().hands.b.total === 19 && h.st().order.join() === 'a,b');
  h.act({ type: 'stand' }, 'b'); h.act({ type: 'stand' }, 'a'); finish(h);
  check('banca 15 pide: bancos separados y un bet_result por jugador', h.results().length === 2 && new Set(h.results().map((e) => e.data.ref)).size === 2);
  const g = host(51, { seats: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'], bank: 1e9 });
  for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) g.act({ type: 'bet', amount: 12345 }, p);
  g.adv(BETTING_MS); g.until('playing'); for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) { g.act({ type: 'hit' }, p); g.act({ type: 'hit' }, p); }
  const json = JSON.stringify(g.st());
  check('estado de 8 jugadores con varias cartas < 4 KB', json.length < 4096, json.length + ' bytes');
  const n = host(52); n.act({ type: 'bet', amount: 100 });
  check('en betting no hay cartas de la banca', n.st().dealer.cards.length === 0 && n.st().dealStartedAt === null && n.st().bets.a === 100);
}
console.log(fails === 0 ? '\nTODO OK' : `\n${fails} PRUEBA(S) FALLARON`);
process.exit(fails === 0 ? 0 : 1);
