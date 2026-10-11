// js/net/session.js: conexión en tiempo real entre celulares (Supabase Realtime) y la API de sesión (sección 5 del contrato).
// Exporta session. El anfitrión procesa las intenciones con js/core/host.js; los demás solo las envían y dibujan lo que llega.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.104.0/+esm';
import { CONFIG } from '../config.js';
import { createHost } from '../core/host.js';

const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey, {
  auth: { persistSession: false }, // sin login: cada jugador entra como anónimo
});

// DECISIÓN: la identidad se guarda en sessionStorage (no en localStorage) para que cada pestaña
// tenga su propio jugador. Así funciona la prueba con dos pestañas en la misma computadora.
// Igual sobrevive a una recarga de la misma pestaña.
const ID_KEY = 'cuota-mortal:identidad';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const PATCH_EVERY_MS = 120;
const FULL_EVERY_MS = 10000;
const JOIN_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 4000;
const CONNECT_TIMEOUT_MS = 8000;
const HOST_GONE_MS = 3000;
const MENSAJES = {
  room_full: 'La sala ya está llena (máximo 8 jugadores).',
  name_taken: 'Ese nombre ya lo usa alguien en la sala.',
  already_started: 'La partida ya empezó, no se puede entrar ahora.',
  nombre_vacio: 'Escribí un nombre.',
};

let gameLoader = defaultGameLoader;
let channel = null, roomCode = null, me = null, host = null;
let state = null, lastSeq = 0, lastSent = {};
let connection = 'offline', reopening = false, resolveSub = null;
let minDelay = Infinity;               // para estimar la hora del anfitrión
let patchTimer = null, fullTimer = null, tickTimer = null, hostGoneTimer = null;
let pendingJoin = null;
const pendingReqs = new Map();
const listeners = new Map();

// ---------- utilidades ----------
function emit(ev, ...args) {
  for (const cb of [...(listeners.get(ev) || [])]) {
    try { cb(...args); } catch (e) { console.error(`[session] ${ev}:`, e); }
  }
}
function setConnection(v) { if (v !== connection) { connection = v; emit('connection', v); } }
function fail(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
function newId() { return 'p_' + crypto.randomUUID().slice(0, 8); }
function randomCode() {
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => CODE_CHARS[n % CODE_CHARS.length]).join('');
}
function cleanName(n) { return String(n || '').trim().slice(0, 16); }
function withTimeout(p, ms, code) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(fail(code, 'Sin conexión con el servidor')), ms))]);
}
function loadIdentity() { try { return JSON.parse(sessionStorage.getItem(ID_KEY)) || null; } catch { return null; } }
function saveIdentity(v) { try { sessionStorage.setItem(ID_KEY, JSON.stringify(v)); } catch { /* sin storage: se pierde al recargar */ } }

async function defaultGameLoader() {
  try { return (await import('../games/registry.js')).GAMES; }
  catch (e) { console.warn('[session] todavía no hay js/games/registry.js'); return {}; }
}
async function loadModules() {
  let games = {};
  try { games = await gameLoader(); } catch (e) { console.warn('[session] no pude leer los juegos', e); }
  const out = {};
  await Promise.all(Object.entries(games).map(async ([id, entry]) => { out[id] = await entry.logic(); }));
  return out;
}

// ---------- reloj ----------
function noteHostTime(hostNow) {
  if (typeof hostNow === 'number') minDelay = Math.min(minDelay, Date.now() - hostNow);
}
function serverNow() {
  if (host) return Date.now();
  return minDelay === Infinity ? Date.now() : Date.now() - minDelay;
}

// ---------- transporte ----------
function send(event, payload) { if (channel) channel.send({ type: 'broadcast', event, payload }); }

function snapshotOf(s) {
  const out = {};
  for (const k of Object.keys(s)) if (k !== 'seq' && k !== 'now') out[k] = JSON.stringify(s[k]);
  return out;
}

// El anfitrión manda el estado completo (al entrar alguien, cada 10 s y si alguien lo pide).
function sendFull() {
  if (!host) return;
  const s = host.state;
  s.now = Date.now();
  lastSent = snapshotOf(s);
  send('state_full', { state: JSON.parse(JSON.stringify(s)), now: s.now });
}

// El anfitrión manda solo lo que cambió. Cada parche lleva un número de secuencia.
function flushPatch() {
  clearTimeout(patchTimer); patchTimer = null;
  if (!host) return;
  const s = host.state;
  s.now = Date.now();
  const cur = snapshotOf(s);
  const patch = {};
  for (const k of Object.keys(cur)) if (cur[k] !== lastSent[k]) patch[k] = JSON.parse(cur[k]);
  if (!Object.keys(patch).length) return;
  s.seq += 1;
  lastSent = cur;
  send('state_patch', { seq: s.seq, now: s.now, patch });
  emit('state', s, Object.keys(patch));
}
function scheduleFlush(immediate) {
  if (immediate) return flushPatch();
  if (!patchTimer) patchTimer = setTimeout(flushPatch, PATCH_EVERY_MS);
}
const hostChanged = (immediate) => scheduleFlush(immediate);
function onHostTableEvent(ev) { send('table_event', ev); emit('tableEvent', ev); }

// ---------- mensajes que recibe el anfitrión ----------
function onHello({ id, name }) {
  if (!host) return;
  const r = host.intent(id, { type: 'join', name });
  send('join_result', { to: id, ok: r.ok, error: r.error });
  sendFull();
}
function onIntent({ from, reqId, body }) {
  if (!host) return;
  const r = host.intent(from, body);
  if (reqId) send('intent_result', { to: from, reqId, ok: r.ok, error: r.error });
}

// ---------- mensajes que reciben los demás ----------
function onStateFull({ state: s, now }) {
  noteHostTime(now);
  state = s;
  lastSeq = s.seq;
  emit('state', state, Object.keys(state));
}
function onStatePatch({ seq, now, patch }) {
  noteHostTime(now);
  if (!state || seq !== lastSeq + 1) { send('request_full', {}); return; } // hueco: pedir el estado completo
  state = { ...state, ...patch, seq, now };
  lastSeq = seq;
  emit('state', state, Object.keys(patch));
}
function onJoinResult(p) { if (pendingJoin) { const f = pendingJoin; pendingJoin = null; f(p); } }
function onIntentResult({ reqId, ok, error }) {
  const f = pendingReqs.get(reqId);
  if (f) { pendingReqs.delete(reqId); f({ ok, error }); }
}

// ---------- presencia ----------
function onPresenceSync() {
  if (!channel) return;
  const ps = channel.presenceState();
  const present = new Set(Object.keys(ps));
  if (host) {
    for (const id of Object.keys(host.state.players)) host.setConnected(id, present.has(id));
    return;
  }
  const hostHere = Object.values(ps).some(list => list.some(m => m.isHost));
  if (hostHere) {
    clearTimeout(hostGoneTimer); hostGoneTimer = null;
  } else if (state && !hostGoneTimer) {
    hostGoneTimer = setTimeout(() => {
      hostGoneTimer = null;
      toast('warn', 'El anfitrión se desconectó');
      setConnection('offline');
    }, HOST_GONE_MS);
  }
}
function toast(kind, text) { emit('toast', { kind, text }); }

// ---------- canal ----------
function openChannel(code) {
  const ch = supabase.channel(`room:${code}`, {
    config: { broadcast: { self: false }, presence: { key: me.id } },
  });
  ch.on('broadcast', { event: 'hello' }, ({ payload }) => host && onHello(payload));
  ch.on('broadcast', { event: 'intent' }, ({ payload }) => host && onIntent(payload));
  ch.on('broadcast', { event: 'request_full' }, () => host && sendFull());
  ch.on('broadcast', { event: 'join_result' }, ({ payload }) => payload.to === me.id && onJoinResult(payload));
  ch.on('broadcast', { event: 'intent_result' }, ({ payload }) => payload.to === me.id && onIntentResult(payload));
  ch.on('broadcast', { event: 'state_full' }, ({ payload }) => !host && onStateFull(payload));
  ch.on('broadcast', { event: 'state_patch' }, ({ payload }) => !host && onStatePatch(payload));
  ch.on('broadcast', { event: 'table_event' }, ({ payload }) => !host && emit('tableEvent', payload));
  ch.on('presence', { event: 'sync' }, onPresenceSync);
  return ch;
}

function subscribe(ch) {
  return new Promise((resolve) => {
    resolveSub = resolve;
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnection('online');
        const r = resolveSub; resolveSub = null; if (r) r();
      } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && roomCode && !reopening) {
        reopen();
      }
    });
  });
}

// Si se corta la conexión, vuelve a abrir el canal y se presenta de nuevo.
async function reopen() {
  if (reopening || !roomCode) return;
  reopening = true;
  setConnection('reconnecting');
  try {
    if (channel) await supabase.removeChannel(channel);
    await new Promise(r => setTimeout(r, 1500));
    if (!roomCode) return;
    channel = openChannel(roomCode);
    await subscribe(channel);
    await channel.track({ name: me.name, isHost: !!host });
    if (host) sendFull();
    else send('hello', { id: me.id, name: me.name });   // reconexión: el anfitrión conserva el lugar
  } catch (e) {
    console.error('[session] no pude reconectar', e);
  } finally {
    reopening = false;
  }
}

function requestJoin(id, name) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingJoin = null; resolve(null); }, JOIN_TIMEOUT_MS);
    pendingJoin = (p) => { clearTimeout(timer); resolve(p); };
    send('hello', { id, name });
  });
}

// Intención de un jugador: el anfitrión la procesa en el acto; los demás esperan la respuesta.
function request(body) {
  if (host) return Promise.resolve(host.intent(me.id, body));
  if (!channel) return Promise.resolve({ ok: false, error: 'sin_sala' });
  const reqId = newId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pendingReqs.delete(reqId); resolve({ ok: false, error: 'timeout' }); }, REQUEST_TIMEOUT_MS);
    pendingReqs.set(reqId, (r) => { clearTimeout(timer); resolve(r); });
    send('intent', { from: me.id, reqId, body });
  });
}

// ---------- entrar y salir ----------
async function enterAsHost(code, name) {
  me = { id: newId(), name, color: null };
  roomCode = code;
  saveIdentity({ id: me.id, name, roomCode: code });
  host = createHost({ roomCode: code, hostId: me.id, onChange: hostChanged, onTableEvent: onHostTableEvent });
  host.intent(me.id, { type: 'join', name });
  channel = openChannel(code);
  await withTimeout(subscribe(channel), CONNECT_TIMEOUT_MS, 'sin_red');
  await channel.track({ name, isHost: true });
  tickTimer = setInterval(() => host && host.tick(), 100);
  fullTimer = setInterval(sendFull, FULL_EVERY_MS);
  sendFull();
  emit('state', host.state, Object.keys(host.state));
}

async function createRoom(name) {
  if (roomCode) await leaveRoom();
  const n = cleanName(name);
  if (!n) throw fail('nombre_vacio', MENSAJES.nombre_vacio);
  let code = null;
  for (let i = 0; i < 20 && !code; i++) {
    const c = randomCode();
    const { error } = await supabase.from('rooms').insert({ code: c, host_name: n });
    if (!error) code = c;
    else if (error.code !== '23505') throw fail('db', 'No pude crear la sala: ' + error.message);   // 23505 = código repetido
  }
  if (!code) throw fail('db', 'No encontré un código libre');
  try { await enterAsHost(code, n); }
  catch (e) { await leaveRoom(); throw e; }
  return { roomCode: code };
}

async function joinRoom(code, name) {
  const c = String(code || '').toUpperCase().trim();
  if (roomCode) await leaveRoom();
  const saved = loadIdentity();
  const reuse = saved && saved.roomCode === c;     // misma pestaña, misma sala: recupera su lugar
  me = { id: reuse ? saved.id : newId(), name: reuse ? saved.name : cleanName(name), color: null };
  roomCode = c;
  saveIdentity({ id: me.id, name: me.name, roomCode: c });
  try {
    channel = openChannel(c);
    await withTimeout(subscribe(channel), CONNECT_TIMEOUT_MS, 'sin_red');
    await channel.track({ name: me.name, isHost: false });
    const reply = await requestJoin(me.id, me.name);
    if (!reply) throw fail('room_not_found', 'No encontré esa sala. Revisá el código.');
    if (!reply.ok) throw fail(reply.error, MENSAJES[reply.error] || reply.error);
    const t0 = Date.now();
    while (!state && Date.now() - t0 < JOIN_TIMEOUT_MS) await new Promise(r => setTimeout(r, 50));
  } catch (e) {
    await leaveRoom();
    throw e;
  }
}

async function leaveRoom() {
  clearInterval(tickTimer); clearInterval(fullTimer);
  clearTimeout(patchTimer); clearTimeout(hostGoneTimer);
  tickTimer = fullTimer = patchTimer = hostGoneTimer = null;
  const ch = channel;
  channel = null; roomCode = null; host = null; state = null;
  lastSeq = 0; lastSent = {}; pendingJoin = null; minDelay = Infinity;
  if (ch) { try { await supabase.removeChannel(ch); } catch { /* ya cerrado */ } }
  setConnection('offline');
  emit('state', null, []);
}

// ---------- historial ----------
async function fetchRankings() {
  const [pl, runs] = await Promise.all([
    supabase.from('rankings_players').select('player_name, net_total').order('net_total', { ascending: false }),
    supabase.from('runs').select('room_code, days_survived, final_bank, ended_at')
      .order('days_survived', { ascending: false }).order('final_bank', { ascending: false }).limit(5),
  ]);
  if (pl.error) throw pl.error;
  if (runs.error) throw runs.error;
  const rows = (pl.data || []).map(r => ({ name: r.player_name, net: Number(r.net_total) }));
  return {
    topWinners: rows.slice(0, 3),
    blackSheep: [...rows].sort((a, b) => a.net - b.net).slice(0, 3),
    bestRuns: (runs.data || []).map(r => ({
      room: r.room_code, days: r.days_survived, finalBank: Number(r.final_bank), endedAt: r.ended_at,
    })),
  };
}

// ---------- API pública (sección 5 del contrato) ----------
export const session = {
  createRoom,
  joinRoom,
  leaveRoom,
  getState: () => state,
  me: () => (me ? { id: me.id, name: me.name, color: state?.players[me.id]?.color ?? null } : null),
  isHost: () => !!host,
  serverNow,
  on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return () => listeners.get(event).delete(cb);
  },
  async startGame() {
    if (!host) return;
    const r = host.startGame(await loadModules());
    if (!r.ok) toast('warn', r.error);
  },
  setDayLength: (ms) => request({ type: 'setDayLength', ms }),
  sitAt: (gameId) => request({ type: 'sit', gameId }),
  standUp: () => request({ type: 'stand' }),
  sendGameAction: (gameId, action) => request({ type: 'game', gameId, action }),
  proposeItem: (itemId) => request({ type: 'proposeItem', itemId }),
  vote: (voteId, yes) => request({ type: 'vote', voteId, yes }),
  rematch: () => request({ type: 'rematch' }),
  fetchRankings,
  // Solo para pruebas: permite cambiar de dónde salen los juegos mientras no existe js/games/registry.js.
  setGameLoader(fn) { gameLoader = fn; },
};
