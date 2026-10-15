// dev/sandbox.js: anfitrión falso para probar un juego solo. Parámetros: ?game=roulette&seed=123
// Hace de IA 1 (banco, bucle tick cada 100 ms, efectos) y de IA 2 (ctx con chips, audio y reloj). 3 jugadores virtuales.
// También sirve para los juegos 'solo' (una instancia por jugador sentado). Expone window.__sandbox para depurar.
import { GAMES } from '../js/games/registry.js';
import { mulberry32, fmt, makeTray, makeAudio } from './sandbox-ctx.js';
import { limitsForDay } from '../js/games/limits.js';

const params = new URLSearchParams(location.search);
const gameId = params.get('game') || 'roulette';
const seed = Number(params.get('seed') || 1);
const def = GAMES[gameId];
const $ = (id) => document.getElementById(id);
if (!def) { document.body.textContent = 'Juego desconocido: ' + gameId; throw new Error('Juego desconocido ' + gameId); }
const logicMod = await def.logic();
const viewMod = await def.view();
const meta = logicMod.meta;
$('sb-title').textContent = meta.name + ' · semilla ' + seed;

// Botones de "forzar resultado" por juego (donde tenga sentido).
const FORCE = {
  slots: { label: 'Paradas (0-31) ej. 21,21,13', text: true, value: '13,13,13', action: (v) => ({ type: 'debug_force', reels: String(v).split(',').map(Number) }) },
  crash: { label: 'Explota en ×', min: 1, max: 1000, value: 2.5, step: 0.01, action: (n) => ({ type: 'debug_force', crashAt: n }) },
  dice: { label: 'Dados de la mesa ej. 3,4', text: true, value: '3,4', action: (v) => ({ type: 'debug_force', dice: String(v).split(',').map(Number) }) },
  blackjack: { label: 'Próximas cartas ej. AceSpades,KingHearts,9Clubs,8Hearts', text: true, value: 'AceSpades,9Clubs,KingHearts,8Hearts', action: (v) => ({ type: 'debug_force', next: String(v).split(',').map((x) => x.trim()) }) },
  scratch: { label: 'Próximo boleto: lose o símbolo 0-5 (5 = 200x)', text: true, value: '2', action: (v) => ({ type: 'debug_force', outcome: v === 'lose' ? 'lose' : Number(v) }) },
  roulette: { label: 'Próximo número', min: 0, max: 36, value: 17, action: (n) => ({ type: 'debug_force', number: n }) },
};

const COLORS = ['#FF4D5E', '#FFB020', '#F7E04B'];
const players = [{ id: 'p_ana', name: 'Ana' }, { id: 'p_beto', name: 'Beto' }, { id: 'p_caro', name: 'Caro' }]
  .map((p, i) => ({ ...p, color: COLORS[i], seated: true }));
let bank = 200000, active = 0, offset = 0, view = null, lastJson = '', ignoreBank = false;
const rng = mulberry32(seed);
const now = () => Date.now() + offset;
const modifiers = { payoutMult: 1, rerolls: 0 };
const games = {}; // id de jugador -> instancia (juegos 'solo'); para 'shared' se usa games.__table
const logLines = [], soundLines = [];

function getGame(pid) {
  const key = meta.mode === 'solo' ? pid : '__table';
  if (!games[key]) games[key] = logicMod.createGame({ rng, now, config: { debug: true }, playerId: meta.mode === 'solo' ? pid : undefined });
  return games[key];
}
const seatsList = () => players.filter((p) => p.seated).map((p) => p.id);
let day = 1;
const hostCtx = () => ({ bank, modifiers, limits: limitsForDay(day), seats: seatsList(), names: Object.fromEntries(players.map((p) => [p.id, p.name])) });

function apply(effects) {
  for (const e of effects) {
    if (e.type === 'debit') {
      if (e.amount > bank) console.error('CONTRATO ROTO: débito mayor al banco', e);
      bank -= e.amount;
    } else if (e.type === 'credit') bank += e.amount;
    else if (e.name === 'reroll_used') { modifiers.rerolls = Math.max(0, modifiers.rerolls - 1); const cb = $('sb-rerolls'); if (cb) cb.checked = modifiers.rerolls > 0; } // el anfitrión descuenta el objeto
    const d = e.data ? ' ' + JSON.stringify(e.data) : '';
    logLines.unshift(`${e.type}${e.kind ? ':' + e.kind : ''} ${e.name || ''} ${e.playerId || ''} ${e.amount != null ? fmt(e.amount) : ''}${d}`.trim());
  }
  logLines.length = Math.min(logLines.length, 30);
}

function stateFor(pid) { return getGame(pid).getPublicState(); }
function info() {
  const me = players[active];
  return {
    you: me.id, seats: seatsList(), bank, serverNow: now(),
    players: Object.fromEntries(players.map((p) => [p.id, { name: p.name, color: p.color, connected: true }])),
  };
}

function publish(force) {
  const st = stateFor(players[active].id);
  const json = JSON.stringify([st, bank, seatsList(), active]);
  $('sb-bank').textContent = fmt(bank);
  if (json === lastJson && !force) return;
  lastJson = json;
  $('sb-state').textContent = JSON.stringify(st, null, 1);
  $('sb-log').textContent = logLines.join('\n');
  if (view) view.update(st, info());
}

// ---- ctx falso (sección 7 del contrato) ----
const chips = makeTray($('sb-tray'), () => $('sb-bank'), () => bank, () => ignoreBank);
const audio = makeAudio((name) => {
  if (name === 'countdown-tick' || name === 'roulette-ball-tick') return; // demasiado frecuentes para la lista
  soundLines.unshift(name); soundLines.length = Math.min(soundLines.length, 12);
  $('sb-sounds').textContent = soundLines.join('\n');
});

function makeCtx() {
  return {
    playerId: players[0].id,
    quality: $('sb-quality').value,
    chips, audio, fmt,
    clock: { now },
    onEvent: () => () => {},
    async send(action) {
      const me = players[active];
      const res = getGame(me.id).handleAction(me.id, action, hostCtx());
      if (res.ok) apply(res.effects);
      else logLines.unshift(`RECHAZADA ${action.type}: ${res.error}`);
      publish();
      return { ok: res.ok, error: res.error };
    },
  };
}

function mountView() {
  if (view) view.destroy();
  const [w, h] = $('sb-size').value.split(',').map(Number);
  $('sb-phone').style.width = w + 'px';
  $('sb-container').style.height = (h - 56 * 2 - 90) + 'px';
  view = viewMod.mount($('sb-container'), makeCtx());
  publish(true);
}

// ---- Panel ----
function paintPlayers() {
  $('sb-players').textContent = '';
  $('sb-seats').textContent = '';
  players.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = i === active ? 'is-on' : '';
    b.innerHTML = `<span class="sb-dot" style="background:${p.color}"></span>${p.name}`;
    b.onclick = () => { active = i; paintPlayers(); publish(true); };
    $('sb-players').appendChild(b);
    const s = document.createElement('button');
    s.className = p.seated ? 'is-on' : '';
    s.textContent = (p.seated ? 'Se levanta ' : 'Se sienta ') + p.name;
    s.onclick = () => {
      if (p.seated) { apply(getGame(p.id).onSeatLeft(p.id, hostCtx())); p.seated = false; }
      else p.seated = true;
      paintPlayers(); publish(true);
    };
    $('sb-seats').appendChild(s);
  });
  $('sb-whoami').textContent = 'toca: ' + players[active].name;
}
paintPlayers();

$('sb-setbank').onclick = () => { bank = Math.round(Number($('sb-bankin').value) * 100); publish(true); };
$('sb-size').onchange = mountView;
$('sb-quality').onchange = mountView;
$('sb-remount').onclick = mountView;
const paintLimits = () => { const l = limitsForDay(day); $('sb-limits').textContent = `apuesta ${fmt(l.minBet)} a ${fmt(l.maxBet)} por ronda`; };
paintLimits();
$('sb-day').onchange = (e) => { day = Number(e.target.value); paintLimits(); };
$('sb-trebol').onchange = (e) => { modifiers.payoutMult = e.target.checked ? 1.1 : 1; };
$('sb-rerolls').onchange = (e) => { modifiers.rerolls = e.target.checked ? 1 : 0; publish(true); };
$('sb-ignorebank').onchange = (e) => { ignoreBank = e.target.checked; };
$('sb-t5').onclick = () => { offset += 5000; };
$('sb-t15').onclick = () => { offset += 15000; };
const fc = FORCE[gameId];
if (fc) {
  $('sb-force').innerHTML = `${fc.label} <input ${fc.text ? 'type="text" style="width:90px"' : `type="number" min="${fc.min}" max="${fc.max}" step="${fc.step || 1}"`} id="sb-fv" value="${fc.value}"> <button id="sb-fb">Forzar</button>`;
  $('sb-fb').onclick = () => {
    const r = getGame(players[active].id).handleAction(players[active].id, fc.action(fc.text ? $('sb-fv').value : Number($('sb-fv').value)), hostCtx());
    logLines.unshift(r.ok ? 'forzado: ' + $('sb-fv').value : 'no se pudo forzar: ' + r.error);
  };
}

// ---- Bucle del anfitrión: tick cada 100 ms ----
function tickAll() {
  const ids = meta.mode === 'solo' ? players.filter((p) => p.seated).map((p) => p.id) : ['__table'];
  for (const id of ids) apply(getGame(meta.mode === 'solo' ? id : null).tick(now(), hostCtx()));
  publish();
}
setInterval(tickAll, 100);
mountView();
window.__sandbox = { players, hostCtx, getGame, setOffset: (ms) => { offset = ms; }, setActive: (i) => { active = i; paintPlayers(); publish(true); }, publish, mountView, bankNow: () => bank, setBank: (c) => { bank = c; publish(true); } };
