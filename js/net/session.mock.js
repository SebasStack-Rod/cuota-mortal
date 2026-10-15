// js/net/session.mock.js
// Sesión FALSA con la misma API que la sección 5 del contrato, para desarrollar la interfaz sin red.
// Simula una sala con 3 jugadores falsos: banco que sube y baja, días de 60 s, cobro, tienda, votaciones y rankings.
// Exporta { session }. Al final del archivo hay una caja de herramientas de prueba en session.dev.
//
// Códigos de prueba para "Unirse": MESA (entra a una sala ya armada), FULL (sala llena), YAYA (ya empezó).
// Cualquier otro código da "sala no encontrada". En MESA los nombres Lola, Tato y Mica ya están ocupados.

import { fmt } from '../core/money.js';

const COLORS = ['#FF4D5E', '#FFB020', '#F7E04B', '#2EE59D', '#22E6FF', '#6C8CFF', '#B26BFF', '#FF2BD6'];

// DECISIÓN: copia de los valores de CONFIG (js/config.js es de la IA 1) con fases aceleradas para probar rápido.
const CFG = {
  maxPlayers: 8, days: 7, dayMs: 60000, shopMs: 25000, voteMs: 15000, collectMs: 6000,
  startBank: 200000, quotaBase: 100000, quotaGrowth: 1.4,
  items: {
    seguro: { price: 40000, label: 'Seguro de deuda' },
    reloj: { price: 60000, label: 'Reloj robado' },
    dados: { price: 30000, label: 'Dados cargados' },
    trebol: { price: 50000, label: 'Trébol' },
    soborno: { price: 90000, label: 'Soborno' },
  },
};
// DECISIÓN: tope de apuesta por día (día 1 = $200, día 5 = $4.000). La sesión real lo toma de js/config.js (IA 1).
const MIN_BET = 25;
const MAX_BET_BY_DAY = [20000, 50000, 100000, 200000, 400000, 700000, 1200000];
const betLimitsFor = (day) => ({ min: MIN_BET, max: MAX_BET_BY_DAY[Math.min(7, Math.max(1, day)) - 1] });
const EFFECTS = {
  seguro: { label: 'Seguro de deuda (50% de la 1ª pérdida)', expires: 'firstLoss' },
  reloj: { label: 'Reloj robado (+60 s)', expires: 'dayEnd' },
  dados: { label: 'Dados cargados (1 repetición)', expires: 'use' },
  trebol: { label: 'Trébol (+10% ruleta)', expires: 'dayEnd' },
  soborno: { label: 'Soborno (cuota -15%)', expires: 'dayEnd' },
};
const GAMES = {
  roulette: { name: 'Ruleta', solo: false }, crash: { name: 'Crash', solo: false },
  slots: { name: 'Tragamonedas', solo: true }, dice: { name: 'Dados', solo: false },
  blackjack: { name: 'Blackjack', solo: false }, scratch: { name: 'Rasca y gana', solo: true },
};
const GAME_IDS = Object.keys(GAMES);
const FAKES = [{ id: 'p_lola', name: 'Lola' }, { id: 'p_tato', name: 'Tato' }, { id: 'p_mica', name: 'Mica' }];
const EXTRA_NAMES = ['Nico', 'Vale', 'Pipo', 'Cami', 'Rama'];
const ME_ID = 'p_me';

// ---------- Estado interno ----------
let S = null;                 // RoomState actual (se reemplaza entero en cada cambio, nunca se muta)
let meId = null;
let ticker = null;
let timers = new Set();
let collectEndsAt = 0;
let betSeq = 0;
let voteSeq = 0;
let connection = 'online';
let dayAcc = {};              // apostado y cobrado de cada jugador en el día actual
let dayStartBank = 0;
const pending = new Map();    // apuestas sin resolver: ref -> { pid, gameId, stake }
const listeners = { state: new Set(), toast: new Set(), connection: new Set(), tableEvent: new Set() };

// ---------- Utilidades ----------
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const emptyStats = () => ({ bet: 0, won: 0, net: 0, streak: 0, bestWin: 0, worstLoss: 0, rounds: 0 });

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function emit(event, ...args) {
  for (const cb of [...listeners[event]]) {
    try { cb(...args); } catch (err) { console.error(`[mock] error en un oyente de "${event}"`, err); }
  }
}

function toast(kind, text) {
  emit('toast', { kind, text });
}

function schedule(fn, ms) {
  const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
  timers.add(id);
}

function clearAll() {
  for (const id of timers) clearTimeout(id);
  timers.clear();
  clearInterval(ticker);
  ticker = null;
  pending.clear();
}

function quotaFor(day) {
  return Math.round(CFG.quotaBase * Math.pow(CFG.quotaGrowth, day - 1) / 100) * 100; // a pesos enteros
}

// DECISIÓN: cuota del día siguiente (campo nextQuota, pedido de cambio 7); tiene en cuenta un Soborno ya comprado
function nextQuotaFor(s) {
  const base = quotaFor(s.day + 1);
  return s.inventory.soborno > 0 ? Math.round(base * 0.85 / 100) * 100 : base;
}

function freshTables() {
  const shared = () => ({ phase: 'betting', phaseEndsAt: null, round: 0 });
  return { roulette: shared(), crash: shared(), dice: shared(), blackjack: shared(), slots: {}, scratch: {} };
}

function newState(code, hostId, dayMs = CFG.dayMs) {
  return {
    seq: 1, roomCode: code, hostId, phase: 'lobby', day: 1, now: Date.now(),
    dayEndsAt: null, shopEndsAt: null, bank: CFG.startBank, quota: quotaFor(1), collect: null,
    players: {}, tables: freshTables(),
    inventory: { seguro: 0, reloj: 0, dados: 0, trebol: 0, soborno: 0 },
    effects: [], vote: null, summary: null, titles: { topWinner: null, blackSheep: null },
    betLimits: betLimitsFor(1), // DECISIÓN: campo extra que pide el PEDIDO DE CAMBIO AL CONTRATO
    dayMs, // DECISIÓN: campo extra que pide el PEDIDO DE CAMBIO AL CONTRATO (duración del día elegida)
  };
}

// Aplica un cambio sobre una copia del estado, sube seq, avisa solo las claves que cambiaron.
function commit(mutator) {
  const prev = S;
  const next = structuredClone(prev);
  mutator(next);
  next.seq = prev.seq + 1;
  next.now = Date.now();
  const changed = Object.keys(next).filter(
    (k) => k !== 'seq' && k !== 'now' && JSON.stringify(next[k]) !== JSON.stringify(prev[k]),
  );
  if (changed.length === 0) return;
  S = next;
  emit('state', S, changed);
}

function addPlayer(s, id, name, connected = true) {
  const count = Object.keys(s.players).length;
  if (count >= CFG.maxPlayers) return false;
  s.players[id] = {
    id, name, color: COLORS[count % COLORS.length], joinedAt: Date.now() + count,
    connected, seat: null, stats: emptyStats(),
  };
  return true;
}

function computeTitles(players) {
  const list = Object.values(players);
  const top = list.reduce((a, b) => (b.stats.net > (a?.stats.net ?? 0) ? b : a), null);
  const sheep = list.reduce((a, b) => (b.stats.net < (a?.stats.net ?? 0) ? b : a), null);
  return { topWinner: top?.id ?? null, blackSheep: sheep?.id ?? null };
}

function updateStats(stats, stake, payout) {
  const net = payout - stake;
  stats.bet += stake;
  stats.won += payout;
  stats.net = stats.won - stats.bet;
  stats.rounds += 1;
  if (net > 0) { stats.streak = stats.streak > 0 ? stats.streak + 1 : 1; stats.bestWin = Math.max(stats.bestWin, net); }
  else { stats.streak = stats.streak < 0 ? stats.streak - 1 : -1; stats.worstLoss = Math.max(stats.worstLoss, -net); } // DECISIÓN: worstLoss en positivo
}

// ---------- Asientos y mesas ----------
function leaveSeat(s, pid) {
  const p = s.players[pid];
  if (!p || !p.seat) return;
  if (GAMES[p.seat].solo) delete s.tables[p.seat][pid];
  p.seat = null;
}

function takeSeat(s, pid, gameId) {
  leaveSeat(s, pid);
  s.players[pid].seat = gameId;
  if (GAMES[gameId].solo) s.tables[gameId][pid] = { phase: 'idle', phaseEndsAt: null, round: 0 };
}

function refundPending(pid) {
  let total = 0;
  for (const [ref, bet] of pending) {
    if (bet.pid === pid) { total += bet.stake; pending.delete(ref); }
  }
  return total;
}

function refreshTables() {
  const t = Date.now();
  const due = ['roulette', 'crash', 'dice', 'blackjack'].filter((id) => !S.tables[id].phaseEndsAt || S.tables[id].phaseEndsAt <= t);
  if (due.length === 0) return;
  commit((s) => {
    for (const id of due) {
      const table = s.tables[id];
      if (table.phase === 'betting' && table.phaseEndsAt) { table.phase = 'resolving'; table.phaseEndsAt = t + 5000; }
      else { table.phase = 'betting'; table.phaseEndsAt = t + 12000; table.round += 1; }
    }
  });
}

// ---------- Apuestas simuladas ----------
// Devuelve null si se acepta la apuesta, o el código de error ('sin_fondos' | 'fuera_de_limites')
function placeBet(pid, gameId, stake) {
  if (!S || S.phase !== 'day' || !(stake > 0)) return 'fuera_de_dia';
  const { min, max } = S.betLimits;
  if (stake < min || stake > max || stake % 25 !== 0) return 'fuera_de_limites';
  if (stake > S.bank) return 'sin_fondos';
  const ref = 'b' + (++betSeq);
  pending.set(ref, { pid, gameId, stake });
  commit((s) => { s.bank -= stake; });
  const payout = Math.random() < 0.47 ? stake * 2 : 0;
  schedule(() => settleBet(ref, payout), 1200 + Math.random() * 1800);
  return null;
}

function settleBet(ref, payout) {
  const bet = pending.get(ref);
  if (!bet || !S) return;
  pending.delete(ref);
  const { pid, gameId, stake } = bet;
  const seguroRefund = payout === 0 && pid === meId && S.inventory.seguro > 0 ? Math.floor(stake * 0.5) : 0;
  commit((s) => {
    s.bank += payout + seguroRefund;
    if (s.players[pid]) updateStats(s.players[pid].stats, stake, payout);
    const acc = dayAcc[pid] || (dayAcc[pid] = { bet: 0, won: 0 });
    acc.bet += stake; acc.won += payout;
    if (seguroRefund) { s.inventory.seguro -= 1; s.effects = s.effects.filter((e) => e.id !== 'seguro'); }
    s.titles = computeTitles(s.players);
  });
  emit('tableEvent', { gameId, name: 'bet_result', data: { playerId: pid, ref, stake, payout, detail: {} } });

  const net = payout - stake;
  const game = GAMES[gameId].name;
  if (pid === meId) {
    if (net >= 2500) toast('win', `¡Ganaste ${fmt(net)} en ${game}!`);
    else if (-net >= 2500) toast('loss', `Perdiste ${fmt(-net)} en ${game}.`);
    if (seguroRefund) toast('info', `El seguro de deuda te devolvió ${fmt(seguroRefund)}.`);
  } else if (net >= 5000) {
    toast('info', `${S.players[pid]?.name ?? 'Alguien'} ganó ${fmt(net)} en ${game}.`);
  }
}

function simulate() {
  const others = Object.values(S.players).filter((p) => p.id !== meId && p.connected);
  if (others.length === 0) return;
  if (Math.random() < 0.05) {
    const who = pick(others).id;
    const gameId = pick(GAME_IDS);
    refundPendingAndSeat(who, gameId);
  }
  if (Math.random() < 0.6) {
    const seated = others.filter((p) => p.seat);
    if (seated.length) {
      const p = pick(seated);
      placeBet(p.id, p.seat, pick([100, 500, 500, 1000, 1000, 2500, 5000].filter((a) => a <= S.betLimits.max)));
    }
  }
  refreshTables();
}

function refundPendingAndSeat(pid, gameId) {
  const refund = refundPending(pid);
  commit((s) => { s.bank += refund; takeSeat(s, pid, gameId); });
}

// ---------- Fases ----------
function beginDay(day) {
  let dayMs = S.dayMs;
  let quota = quotaFor(day);
  commit((s) => {
    if (s.inventory.reloj > 0) { dayMs += 60000; s.inventory.reloj -= 1; }
    if (s.inventory.soborno > 0) { quota = Math.round(quota * 0.85 / 100) * 100; s.inventory.soborno -= 1; }
    if (s.inventory.trebol > 0) s.inventory.trebol -= 1;
    s.phase = 'day'; s.day = day; s.quota = quota; s.betLimits = betLimitsFor(day); s.dayEndsAt = Date.now() + dayMs;
    s.shopEndsAt = null; s.collect = null; s.vote = null; s.summary = null; s.nextQuota = null;
    s.tables = freshTables();
    for (const p of Object.values(s.players)) { p.seat = null; }
    for (const p of Object.values(s.players)) {
      if (p.id !== meId && p.connected) takeSeat(s, p.id, pick(GAME_IDS)); // los falsos se sientan al azar
    }
  });
  dayAcc = {};
  dayStartBank = S.bank;
}

function buildSummary(s) {
  const perPlayer = {};
  for (const id of Object.keys(s.players)) {
    const acc = dayAcc[id] || { bet: 0, won: 0 };
    perPlayer[id] = { bet: acc.bet, won: acc.won, net: acc.won - acc.bet };
  }
  const ids = Object.keys(perPlayer);
  const top = ids.reduce((a, id) => (perPlayer[id].net > (perPlayer[a]?.net ?? 0) ? id : a), null);
  const sheep = ids.reduce((a, id) => (perPlayer[id].net < (perPlayer[a]?.net ?? 0) ? id : a), null);
  return { day: s.day, perPlayer, topWinner: top, blackSheep: sheep, bankDelta: s.bank - dayStartBank };
}

function endDay() {
  const refund = [...pending.values()].reduce((sum, b) => sum + b.stake, 0); // se devuelven las apuestas sin resolver
  pending.clear();
  commit((s) => {
    s.bank += refund;
    const paid = s.bank >= s.quota;
    s.summary = buildSummary(s);
    // DECISIÓN: durante 'collect' el banco todavía NO tiene descontada la cuota; bankAfter dice cómo queda.
    s.collect = { paid, amount: s.quota, bankAfter: paid ? s.bank - s.quota : s.bank };
    s.phase = 'collect'; s.dayEndsAt = null;
    s.tables = freshTables();
    for (const p of Object.values(s.players)) p.seat = null;
    s.effects = s.effects.filter((e) => e.expires !== 'dayEnd');
  });
  collectEndsAt = Date.now() + CFG.collectMs;
}

function afterCollect() {
  commit((s) => {
    if (!s.collect.paid) { s.phase = 'gameover'; s.collect = null; return; }
    s.bank = s.collect.bankAfter;
    s.collect = null;
    if (s.day >= CFG.days) { s.phase = 'victory'; return; }
    s.phase = 'shop'; s.shopEndsAt = Date.now() + CFG.shopMs; s.vote = null; s.nextQuota = nextQuotaFor(s);
  });
}

function endShop() {
  if (S.vote) closeVote(S.vote.yes.length > S.vote.no.length);
  beginDay(S.day + 1);
}

function closeVote(approved) {
  const v = S.vote;
  if (!v) return;
  const item = CFG.items[v.itemId];
  let ok = approved;
  if (ok && S.bank < v.price) { toast('warn', `No alcanza el banco para ${item.label}.`); ok = false; }
  else if (!ok) toast('warn', `La compra de ${item.label} no pasó.`);
  commit((s) => {
    s.vote = null;
    if (ok) {
      s.bank -= v.price;
      s.inventory[v.itemId] += 1;
      s.nextQuota = nextQuotaFor(s);
      s.effects.push({ id: v.itemId, label: EFFECTS[v.itemId].label, expires: EFFECTS[v.itemId].expires });
    }
  });
  if (ok) toast('info', `Compraron ${item.label}.`);
}

function castVote(pid, voteId, yes) {
  const v = S?.vote;
  if (!v || v.id !== voteId || v.yes.includes(pid) || v.no.includes(pid)) return;
  commit((s) => { (yes ? s.vote.yes : s.vote.no).push(pid); });
  const connected = Object.values(S.players).filter((p) => p.connected).length;
  if (S.vote.yes.length > connected / 2) closeVote(true); // más de la mitad dijo sí: se aprueba antes
}

function tick() {
  if (!S) return;
  const t = Date.now();
  if (S.phase === 'day') {
    if (t >= S.dayEndsAt) endDay(); else simulate();
  } else if (S.phase === 'collect') {
    if (t >= collectEndsAt) afterCollect();
  } else if (S.phase === 'shop') {
    if (S.vote && t >= S.vote.endsAt) closeVote(S.vote.yes.length > S.vote.no.length);
    if (S.phase === 'shop' && t >= S.shopEndsAt) endShop();
  }
}

function beginGame() {
  commit((s) => { s.bank = CFG.startBank; });
  beginDay(1);
}

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(tick, 500);
}

// ---------- API pública (sección 5 del contrato) ----------
async function createRoom(name) {
  await delay(350);
  leaveRoom();
  const code = Array.from({ length: 4 }, () => pick('ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''))).join('');
  meId = ME_ID;
  S = newState(code, ME_ID);
  commit((s) => { addPlayer(s, ME_ID, name); });
  startTicker();
  FAKES.forEach((f, i) => schedule(() => {
    if (S && S.phase === 'lobby') { commit((s) => { addPlayer(s, f.id, f.name); }); }
  }, 1200 + i * 1400)); // los falsos van entrando de a uno
  return { roomCode: code };
}

async function joinRoom(code, name) {
  await delay(450);
  const room = String(code || '').trim().toUpperCase();
  if (room === 'FULL') throw fail('room_full');
  if (room === 'YAYA') throw fail('already_started');
  if (room !== 'MESA') throw fail('room_not_found');
  if (FAKES.some((f) => f.name.toLowerCase() === String(name).trim().toLowerCase())) throw fail('name_taken');
  leaveRoom();
  meId = ME_ID;
  S = newState('MESA', FAKES[0].id);
  commit((s) => {
    FAKES.forEach((f) => addPlayer(s, f.id, f.name, f.id !== 'p_tato')); // Tato aparece sin conexión
    addPlayer(s, ME_ID, name);
  });
  startTicker();
  schedule(() => { if (S && S.phase === 'lobby') beginGame(); }, 15000); // el anfitrión falso arranca a los 15 s
}

function leaveRoom() {
  clearAll();
  S = null;
  meId = null;
}

const getState = () => S;
const me = () => (S && meId && S.players[meId] ? { id: meId, name: S.players[meId].name, color: S.players[meId].color } : null);
const isHost = () => !!S && S.hostId === meId;
const serverNow = () => Date.now();

function on(event, cb) {
  if (!listeners[event]) throw new Error(`Evento desconocido: ${event}`);
  listeners[event].add(cb);
  return () => listeners[event].delete(cb);
}

function startGame() {
  if (!isHost() || S.phase !== 'lobby') return;
  beginGame();
}

function setDayLength(ms) {
  if (!isHost() || S.phase !== 'lobby') return;
  const dayMs = Math.min(15 * 60000, Math.max(30000, Math.round(ms)));
  commit((s) => { s.dayMs = dayMs; });
}

function sitAt(gameId) {
  if (!S || S.phase !== 'day' || !GAMES[gameId]) return;
  const refund = refundPending(meId);
  commit((s) => { s.bank += refund; takeSeat(s, meId, gameId); });
}

function standUp() {
  if (!S || !S.players[meId]) return;
  const refund = refundPending(meId);
  commit((s) => { s.bank += refund; leaveSeat(s, meId); });
}

async function sendGameAction(gameId, action) {
  await delay(120);
  if (!S || S.phase !== 'day') return { ok: false, error: 'fuera_de_dia' };
  if (S.players[meId].seat !== gameId) return { ok: false, error: 'no_sentado' };
  if (action && action.type === 'bet') {
    const amount = Math.round(Number(action.amount));
    if (!(amount > 0)) return { ok: false, error: 'monto_invalido' };
    const error = placeBet(meId, gameId, amount);
    if (error) return { ok: false, error };
  }
  return { ok: true }; // DECISIÓN: cualquier otra acción se da por buena (las vistas reales son de la IA 3)
}

function proposeItem(itemId) {
  if (!S || S.phase !== 'shop' || S.vote || !CFG.items[itemId]) return;
  const vote = {
    id: 'v' + (++voteSeq), itemId, price: CFG.items[itemId].price, proposedBy: meId,
    yes: [meId], no: [], endsAt: Date.now() + CFG.voteMs, // DECISIÓN: quien propone vota sí automáticamente
  };
  commit((s) => { s.vote = vote; });
  const connected = Object.values(S.players).filter((p) => p.connected);
  if (vote.yes.length > connected.length / 2) { closeVote(true); return; } // con 1 solo conectado, al instante
  for (const p of connected) {
    if (p.id === meId) continue;
    schedule(() => castVote(p.id, vote.id, Math.random() < 0.7), 1000 + Math.random() * 5000);
  }
}

function vote(voteId, yes) {
  if (!S || !S.vote) return;
  castVote(meId, voteId, !!yes);
}

function rematch() {
  if (!isHost() || (S.phase !== 'gameover' && S.phase !== 'victory')) return;
  pending.clear();
  commit((s) => {
    const keep = s.players;
    Object.assign(s, newState(s.roomCode, s.hostId, s.dayMs), { players: keep });
    for (const p of Object.values(s.players)) { p.seat = null; p.stats = emptyStats(); }
  });
}

async function fetchRankings() {
  await delay(500);
  return {
    topWinners: [{ name: 'Lola', net: 1850000 }, { name: 'Nico', net: 1240000 }, { name: 'Vale', net: 905000 }, { name: 'Tato', net: 410000 }, { name: 'Pipo', net: 120000 }],
    blackSheep: [{ name: 'Rama', net: -2310000 }, { name: 'Mica', net: -1675000 }, { name: 'Cami', net: -880000 }, { name: 'Tato', net: -350000 }, { name: 'Pipo', net: -90000 }],
    bestRuns: [
      { room: 'KQZM', days: 7, finalBank: 1230000, endedAt: Date.now() - 86400000 },
      { room: 'PLNT', days: 6, finalBank: 410000, endedAt: Date.now() - 3 * 86400000 },
      { room: 'BRVO', days: 5, finalBank: 180000, endedAt: Date.now() - 6 * 86400000 },
    ],
  };
}

// ---------- Caja de herramientas de prueba (no existe en la sesión real) ----------
// Desde la consola del navegador: dev.skip(), dev.setBank(500000), dev.fill(8), dev.setConnection('offline')
const dev = {
  skip() { // salta a la fase siguiente
    if (!S) return;
    if (S.phase === 'lobby' && isHost()) beginGame();
    else if (S.phase === 'day') endDay();
    else if (S.phase === 'collect') afterCollect();
    else if (S.phase === 'shop') endShop();
  },
  setBank(cents) {
    if (S) commit((s) => { s.bank = Math.max(0, Math.round(cents)); });
  },
  fill(total = CFG.maxPlayers) { // suma jugadores falsos hasta llegar a "total"
    if (!S) return;
    commit((s) => {
      EXTRA_NAMES.forEach((name, i) => {
        if (!s.players['p_x' + i] && Object.keys(s.players).length < total) addPlayer(s, 'p_x' + i, name);
      });
    });
  },
  setConnection(state) {
    connection = state;
    emit('connection', state);
  },
  get connection() { return connection; },
};

export const session = {
  createRoom, joinRoom, leaveRoom, getState, me, isHost, serverNow, on,
  startGame, setDayLength, sitAt, standUp, sendGameAction, proposeItem, vote, rematch, fetchRankings,
  dev,
};
