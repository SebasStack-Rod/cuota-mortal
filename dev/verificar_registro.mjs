// dev/verificar_registro.mjs: verificación final de la fase 7. `node dev/verificar_registro.mjs` desde cuota-mortal/.
// Revisa que registry.js liste los seis juegos y que cada uno cumpla el contrato: exports, RTP, sin Date.now/Math.random/DOM en logic.js,
// los cuatro métodos de createGame, vista con mount, comentario inicial en cada archivo y tamaño de archivo.
import { GAMES } from '../js/games/registry.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
let fails = 0, warns = 0;
const check = (n, c, x = '') => { console.log((c ? '  ok   ' : '  FALLA ') + n + (x ? '  ' + x : '')); if (!c) fails++; };
const warn = (n, x = '') => { console.log('  AVISO ' + n + (x ? '  ' + x : '')); warns++; };
const IDS = ['roulette', 'crash', 'dice', 'blackjack', 'slots', 'scratch'];
const MODES = { roulette: 'shared', crash: 'shared', dice: 'shared', blackjack: 'shared', slots: 'solo', scratch: 'solo' };
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

console.log('1) Registro');
check('registry lista exactamente los seis juegos', Object.keys(GAMES).sort().join() === [...IDS].sort().join());
const reg = readFileSync('js/games/registry.js', 'utf8');
check('el comentario de RTP tiene una fila por juego', IDS.every((id) => new RegExp('\\| ' + id + ' +\\|').test(reg)));

for (const id of IDS) {
  console.log(`2) ${id}`);
  const def = GAMES[id];
  check('id, nombre y modo del registro', def.id === id && !!def.name && def.mode === MODES[id] && typeof def.logic === 'function' && typeof def.view === 'function');
  const L = await def.logic();
  check('logic exporta meta, createGame y computeRtp', !!L.meta && typeof L.createGame === 'function' && typeof L.computeRtp === 'function');
  check('meta coincide con el registro', L.meta.id === id && L.meta.mode === def.mode && L.meta.minBet === 25);
  const rtp = L.computeRtp();
  check('meta.rtp === computeRtp()', L.meta.rtp === rtp, 'rtp=' + rtp.toFixed(4));
  if (rtp >= 0.90 && rtp <= 0.98) check('RTP dentro del rango del contrato (0,90 a 0,98)', true); else warn('RTP fuera del rango 0,92 a 0,98', 'rtp=' + rtp.toFixed(4));
  const g = L.createGame({ rng: mulberry32(1), now: () => 1_700_000_000_000, config: { debug: false }, playerId: 'a' });
  check('game tiene getPublicState, handleAction, tick y onSeatLeft', ['getPublicState', 'handleAction', 'tick', 'onSeatLeft'].every((m) => typeof g[m] === 'function'));
  const st = g.getPublicState();
  check('el estado trae phase, phaseEndsAt y round', 'phase' in st && 'phaseEndsAt' in st && 'round' in st);
  const ctx = { bank: 1e9, modifiers: { payoutMult: 1 }, seats: ['a'], names: {}, limits: { minBet: 25, maxBet: 20000 } };
  check('debug_force sin config.debug da accion_desconocida', g.handleAction('a', { type: 'debug_force', number: 1, crashAt: 2, reels: [0, 0, 0], dice: [1, 1], next: [], outcome: 1 }, ctx).error === 'accion_desconocida');
  check('tick y onSeatLeft devuelven arreglos', Array.isArray(g.tick(1_700_000_000_000, ctx)) && Array.isArray(g.onSeatLeft('a', ctx)));
  const dir = `js/games/${id}`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js') || x.endsWith('.css'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const lines = src.split('\n').length;
    check(`${f}: empieza con comentario y tiene menos de 600 líneas`, /^(\/\/|\/\*)/.test(src) && lines <= 600, lines + ' líneas');
    if (f === 'logic.js') {
      const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      check('logic.js sin Date.now, Math.random ni DOM', !/Date\.now|Math\.random|document\.|window\./.test(code));
    }
    if (f === 'view.js') {
      check('view.js exporta mount, usa loadStyle y destroy', /export function mount/.test(src) && /loadStyle/.test(src) && /destroy\(/.test(src));
      check('view.js usa new URL(\'./style.css\', import.meta.url)', /new URL\('\.\/style\.css', import\.meta\.url\)/.test(src));
    }
  }
  for (const f of ['logic.js', 'view.js', 'style.css']) check(`existe ${f}`, statSync(join(dir, f)).isFile());
  check(`existe dev/test_${id}.mjs`, statSync(`dev/test_${id}.mjs`).isFile());
}
console.log(fails ? `\n${fails} FALLAS` : `\nTODO OK${warns ? ' (con ' + warns + ' aviso)' : ''}`);
process.exit(fails ? 1 : 0);
