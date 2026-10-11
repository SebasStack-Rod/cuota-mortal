// js/core/host.js: motor del anfitrión. Solo corre en el celular del anfitrión.
// Exporta createHost y quotaFor. Maneja la sala, los asientos, las mesas, el banco y el ciclo de días.
// FASE 2 (versión mínima): todavía no hay estadísticas, historial en Supabase, votación de la tienda ni ítems.
import { CONFIG } from '../config.js';
import { hostRng } from './rng.js';

const COLORS = ['#FF4D5E', '#FFB020', '#F7E04B', '#2EE59D', '#22E6FF', '#6C8CFF', '#B26BFF', '#FF2BD6'];
const RECONNECT_MS = 60000;   // 60 s para volver a entrar sin perder el lugar
const DAY_MIN_MS = 10000;     // mínimo para pruebas: 10 s
const DAY_MAX_MS = 600000;    // máximo: 10 minutos

// Cuota del día n en centavos, con pesos enteros (1000, 1400, 1960, ...).
export function quotaFor(day) {
  return Math.round((CONFIG.quotaBase / 100) * Math.pow(CONFIG.quotaGrowth, day - 1)) * 100;
}

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const zeroStats = () => ({ bet: 0, won: 0, net: 0, streak: 0, bestWin: 0, worstLoss: 0, rounds: 0 });

export function createHost({ roomCode, hostId, now = () => Date.now(), rng = hostRng,
  onChange = () => {}, onTableEvent = () => {} }) {
  // RoomState (contrato, sección 4). "settings" es un campo extra: la duración del día se ajusta en el lobby.
  const state = {
    seq: 0, roomCode, hostId, phase: 'lobby', day: 1, now: now(),
    dayEndsAt: null, shopEndsAt: null, bank: 0, quota: quotaFor(1), collect: null,
    players: {}, tables: {},
    inventory: { seguro: 0, reloj: 0, dados: 0, trebol: 0, soborno: 0 },
    effects: [], vote: null, summary: null, titles: { topWinner: null, blackSheep: null },
    settings: { dayMs: CONFIG.dayMs },
  };
  let modules = {};     // id de juego -> módulo { meta, createGame }, lo carga session al iniciar
  let instances = {};   // 'juego' (compartido) o 'juego:jugador' (solo) -> instancia de la lógica
  let collectNext = null;

  const seatedIds = (gameId) => Object.values(state.players).filter(p => p.seat === gameId).map(p => p.id);
  const names = () => Object.fromEntries(Object.values(state.players).map(p => [p.id, p.name]));
  const ctxFor = (gameId) => ({
    bank: state.bank, modifiers: { payoutMult: 1, rerolls: 0 }, seats: seatedIds(gameId), names: names(),
  });
  const keyFor = (gameId, pid) => (modules[gameId].meta.mode === 'solo' ? `${gameId}:${pid}` : gameId);

  function instanceFor(gameId, pid) {
    const k = keyFor(gameId, pid);
    if (!instances[k]) {
      const mod = modules[gameId];
      instances[k] = mod.createGame({
        rng, now, config: {},
        playerId: mod.meta.mode === 'solo' ? pid : undefined,
      });
    }
    return instances[k];
  }

  // Aplica los efectos de un juego. Un débito que supere el banco no se aplica y devuelve false.
  function applyEffects(effects, gameId) {
    const debit = effects.filter(e => e.type === 'debit').reduce((s, e) => s + e.amount, 0);
    if (debit > state.bank) return false;
    for (const e of effects) {
      if (e.type === 'debit') state.bank -= e.amount;
      else if (e.type === 'credit') state.bank += e.amount;
      else if (e.type === 'event') {
        // El aviso llega solo a quienes están en esa mesa (o al dueño, si el juego es 'solo').
        const solo = modules[gameId] && modules[gameId].meta.mode === 'solo';
        const to = solo && e.data && e.data.playerId ? [e.data.playerId] : seatedIds(gameId);
        onTableEvent({ gameId, name: e.name, data: e.data, to });
      }
    }
    return true;
  }

  // Las vistas reciben el estado público de cada mesa. Los juegos solo, por jugador.
  function refreshTables() {
    const t = {};
    for (const [k, inst] of Object.entries(instances)) {
      const [gameId, pid] = k.split(':');
      if (pid) (t[gameId] ||= {})[pid] = inst.getPublicState();
      else t[gameId] = inst.getPublicState();
    }
    state.tables = t;
  }

  function join(id, rawName) {
    const existing = state.players[id];
    if (existing) {                       // reconexión: conserva su lugar y su nombre
      existing.connected = true;
      delete existing.disconnectedAt;
      return ok();
    }
    const name = String(rawName || '').trim().slice(0, 16);
    if (!name) return fail('nombre_vacio');
    if (state.phase !== 'lobby') return fail('already_started');
    if (Object.keys(state.players).length >= CONFIG.maxPlayers) return fail('room_full');
    if (Object.values(state.players).some(p => p.name.toLowerCase() === name.toLowerCase())) return fail('name_taken');
    const n = Object.keys(state.players).length;
    state.players[id] = {
      id, name, color: COLORS[n % COLORS.length], joinedAt: now(),
      connected: true, seat: null, stats: zeroStats(),
    };
    return ok();
  }

  // Levantarse de la mesa: el juego devuelve lo que quedó sin resolver (refund).
  function standUp(pid) {
    const p = state.players[pid];
    if (!p || !p.seat) return;
    const gameId = p.seat;
    const k = keyFor(gameId, pid);
    if (instances[k]) {
      applyEffects(instances[k].onSeatLeft(pid, ctxFor(gameId)) || [], gameId);
      if (modules[gameId].meta.mode === 'solo') delete instances[k];
    }
    p.seat = null;
  }

  function removePlayer(pid) {
    standUp(pid);
    delete state.players[pid];
  }

  function sit(pid, gameId) {
    const p = state.players[pid];
    if (!p) return fail('no_en_sala');
    if (state.phase !== 'day') return fail('no_es_momento');
    if (!modules[gameId]) return fail('juego_inexistente');
    if (p.seat === gameId) return ok();
    standUp(pid);
    p.seat = gameId;
    instanceFor(gameId, pid);
    return ok();
  }

  function gameAction(pid, gameId, action) {
    const p = state.players[pid];
    if (state.phase !== 'day') return fail('no_es_momento');
    if (!p || p.seat !== gameId) return fail('no_sentado');
    const res = instanceFor(gameId, pid).handleAction(pid, action, ctxFor(gameId));
    if (!res || !res.ok) return fail(res ? res.error : 'sin_respuesta');
    if (!applyEffects(res.effects || [], gameId)) return fail('sin_fondos');
    return ok();
  }

  function startDay(t, day) {
    state.day = day;
    state.quota = quotaFor(day);
    state.phase = 'day';
    state.collect = null;
    state.shopEndsAt = null;
    state.dayEndsAt = t + state.settings.dayMs;
  }

  // Cierra las mesas y cobra la cuota. El día 7 pagado da la victoria; sin fondos, se pierde.
  function endDay(t) {
    for (const p of Object.values(state.players)) standUp(p.id);
    instances = {};
    const q = quotaFor(state.day);
    state.quota = q;
    const paid = state.bank >= q;
    if (paid) state.bank -= q;
    state.collect = { paid, amount: q, bankAfter: state.bank, endsAt: t + CONFIG.collectMs };
    state.phase = 'collect';
    collectNext = !paid ? 'gameover' : state.day >= CONFIG.days ? 'victory' : 'shop';
  }

  function tick() {
    const before = state.phase;
    const t = now();
    state.now = t;

    for (const p of Object.values(state.players)) {
      if (!p.connected && t - p.disconnectedAt > RECONNECT_MS) removePlayer(p.id);
    }

    for (const [k, inst] of Object.entries(instances)) {
      const gameId = k.split(':')[0];
      const effects = inst.tick(t, ctxFor(gameId)) || [];
      if (effects.length && !applyEffects(effects, gameId)) console.warn('[host] tick sin fondos en', gameId);
    }

    if (state.phase === 'day' && t >= state.dayEndsAt) {
      endDay(t);
    } else if (state.phase === 'collect' && t >= state.collect.endsAt) {
      if (collectNext === 'shop') { state.phase = 'shop'; state.shopEndsAt = t + CONFIG.shopMs; }
      else state.phase = collectNext;
    } else if (state.phase === 'shop' && t >= state.shopEndsAt) {
      startDay(t, state.day + 1);
    }

    refreshTables();
    onChange(before !== state.phase);
  }

  // Punto de entrada de todas las intenciones. Corre de a una: JavaScript es de un solo hilo,
  // así que cada intención se procesa completa antes de la siguiente (orden de llegada).
  function intent(from, body) {
    const before = state.phase;
    let r;
    switch (body && body.type) {
      case 'join': r = join(from, body.name); break;
      case 'sit': r = sit(from, body.gameId); break;
      case 'stand': standUp(from); r = ok(); break;
      case 'game': r = gameAction(from, body.gameId, body.action); break;
      case 'setDayLength':
        if (from !== hostId) r = fail('solo_anfitrion');
        else if (state.phase !== 'lobby') r = fail('no_es_momento');
        else {
          const ms = Number(body.ms) || CONFIG.dayMs;
          state.settings.dayMs = Math.min(DAY_MAX_MS, Math.max(DAY_MIN_MS, ms));
          r = ok();
        }
        break;
      case 'rematch': r = rematch(from); break;
      case 'proposeItem': case 'vote': r = fail('pendiente_fase_4'); break;
      default: r = fail('accion_desconocida');
    }
    refreshTables();
    onChange(before !== state.phase);
    return r;
  }

  // Solo el anfitrión llama esto. mods: { id: módulo } ya cargados por session.
  function startGame(mods) {
    if (state.phase !== 'lobby') return fail('no_es_momento');
    if (Object.keys(state.players).length === 0) return fail('sin_jugadores');
    modules = mods;
    state.bank = CONFIG.startBank;
    startDay(now(), 1);
    refreshTables();
    onChange(true);
    return ok();
  }

  // Revancha: solo el anfitrión, solo al terminar la partida. Vuelve al lobby con los mismos jugadores.
  function rematch(from) {
    if (from !== hostId) return fail('solo_anfitrion');
    if (state.phase !== 'gameover' && state.phase !== 'victory') return fail('no_es_momento');
    instances = {};
    collectNext = null;
    state.phase = 'lobby';
    state.day = 1;
    state.bank = 0;
    state.quota = quotaFor(1);
    state.collect = null;
    state.shopEndsAt = null;
    state.dayEndsAt = null;
    state.tables = {};
    for (const p of Object.values(state.players)) { p.seat = null; p.stats = zeroStats(); }
    return ok();
  }

  // Presence informa si un jugador está conectado. Una caída empieza a contar los 60 s.
  function setConnected(pid, on) {
    const p = state.players[pid];
    if (!p || p.connected === on) return;
    p.connected = on;
    if (on) delete p.disconnectedAt;
    else p.disconnectedAt = now();
    onChange(false);
  }

  return { state, intent, tick, startGame, setConnected };
}
