// js/ui/audio.js
// Motor de audio: reproduce los OGG de Kenney (variante al azar y velocidad levemente distinta) y los sonidos
// sintetizados de audio-synth.js. Exporta audio con play(nombre, {volume, rate}), loop(nombre) -> {stop()} y unlock().
// Los celulares bloquean el audio hasta el primer toque: unlock() se engancha al primer gesto. Respeta Ajustes (sonido y volumen).

import { prefs } from './prefs.js';
import { SYNTH, LOOP_MS } from './audio-synth.js';

// Cantidad de variantes de cada sonido de Kenney (chip-lay -> chip-lay-1..3.ogg)
const SAMPLES = {
  'chip-lay': 3, 'chips-collide': 4, 'chips-handle': 6, 'chips-stack': 6,
  'card-place': 4, 'card-slide': 8, 'card-fan': 2, 'card-shove': 4,
  'dice-throw': 3, 'dice-shake': 3, 'dice-grab': 2, 'die-throw': 4,
  'card-shuffle': 0, // 0 = un solo archivo sin número (card-shuffle.ogg)
};

let ctx = null;
let master = null;
let unlocked = false;
const buffers = new Map();   // url -> AudioBuffer
const loading = new Set();
const lastPlayed = new Map();

function sampleUrl(name, variant) {
  return variant ? `assets/audio/${name}-${variant}.ogg` : `assets/audio/${name}.ogg`;
}

function applyVolume() {
  if (master) master.gain.value = prefs.get('sound') ? prefs.get('volume') : 0;
}

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.connect(ctx.destination);
  applyVolume();
  return ctx;
}

async function loadBuffer(url) {
  if (buffers.has(url) || loading.has(url) || !ctx) return;
  loading.add(url);
  try {
    const res = await fetch(url);
    const data = await res.arrayBuffer();
    buffers.set(url, await ctx.decodeAudioData(data));
  } catch (err) {
    console.warn('[audio] no se pudo cargar', url, err);
  } finally {
    loading.delete(url);
  }
}

function preloadAll() {
  for (const [name, n] of Object.entries(SAMPLES)) {
    if (n === 0) loadBuffer(sampleUrl(name, 0));
    else for (let i = 1; i <= n; i++) loadBuffer(sampleUrl(name, i));
  }
}

function unlock() {
  if (!ensureContext()) return;
  const resume = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  resume.then(() => {
    unlocked = true;
    preloadAll();
  }).catch(() => { /* si el navegador no deja, se reintenta en el próximo toque */ });
}

// Primer gesto del usuario: desbloquea el audio y deja de escuchar
function attachUnlock() {
  const events = ['pointerdown', 'touchend', 'keydown'];
  const handler = () => {
    unlock();
    if (unlocked || (ctx && ctx.state === 'running')) events.forEach((e) => window.removeEventListener(e, handler, true));
  };
  events.forEach((e) => window.addEventListener(e, handler, true));
}

function play(name, { volume = 1, rate = 1 } = {}) {
  if (!prefs.get('sound') || !ctx || ctx.state !== 'running') return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) || 0) < 25) return;   // evita duplicados casi simultáneos
  lastPlayed.set(name, now);

  if (SYNTH[name]) {
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(master);
    SYNTH[name](ctx, out, ctx.currentTime);
    return;
  }
  if (!(name in SAMPLES)) { console.warn('[audio] sonido desconocido:', name); return; }
  const n = SAMPLES[name];
  const url = sampleUrl(name, n ? 1 + Math.floor(Math.random() * n) : 0);
  const buf = buffers.get(url);
  if (!buf) { loadBuffer(url); return; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);   // variación leve para que no suene repetido
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(master);
  src.start();
}

// Repite un sonido hasta que se llame a stop()
function loop(name, opts) {
  const ms = LOOP_MS[name] || 500;
  play(name, opts);
  const id = setInterval(() => play(name, opts), ms);
  return { stop: () => clearInterval(id) };
}

prefs.onChange((key) => { if (key === 'sound' || key === 'volume') applyVolume(); });

// Pestaña oculta: se suspende el audio; al volver se reanuda
document.addEventListener('visibilitychange', () => {
  if (!ctx || !unlocked) return;
  if (document.hidden) ctx.suspend(); else ctx.resume();
});

export const audio = {
  play, loop, unlock, attachUnlock,
  names: () => [...Object.keys(SAMPLES), ...Object.keys(SYNTH)],
  synthNames: () => Object.keys(SYNTH),
  isReady: () => !!ctx && ctx.state === 'running',
};
