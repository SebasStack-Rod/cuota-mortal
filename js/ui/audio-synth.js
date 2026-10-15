// js/ui/audio-synth.js
// Sonidos sintetizados con Web Audio (osciladores, ruido filtrado y envolventes): los que no vienen en los archivos de Kenney.
// Exporta SYNTH: { nombre: (ctx, salida, t0) => void } y LOOP_MS (cada cuántos ms se repite un sonido en audio.loop).
// Todos tienen un pico parecido (~0.3) para que el volumen sea parejo entre sí.

const noiseCache = new WeakMap();

function noiseBuffer(ctx) {
  if (!noiseCache.has(ctx)) {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return noiseCache.get(ctx);
}

// Tono con envolvente: sube rápido y baja exponencial. f2 = frecuencia final si el tono se desliza.
function tone(ctx, out, t, { type = 'sine', f = 440, f2 = null, dur = 0.12, vol = 0.3, attack = 0.004 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Ráfaga de ruido filtrado (golpes, clics, explosiones)
function noise(ctx, out, t, { dur = 0.1, vol = 0.3, type = 'lowpass', freq = 1000, freq2 = null, q = 1 }) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (freq2) filter.frequency.exponentialRampToValueAtTime(freq2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(filter).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

const arpeggio = (ctx, out, t, notes, step, opts) => notes.forEach((f, i) => tone(ctx, out, t + i * step, { f, ...opts }));

export const SYNTH = {
  'ui-click': (c, o, t) => tone(c, o, t, { type: 'triangle', f: 1400, f2: 900, dur: 0.05, vol: 0.28 }),
  'win-small': (c, o, t) => arpeggio(c, o, t, [660, 880, 1100], 0.08, { type: 'triangle', dur: 0.22, vol: 0.28 }),
  'win-big': (c, o, t) => {
    arpeggio(c, o, t, [523, 659, 784, 1047, 1319], 0.09, { type: 'triangle', dur: 0.4, vol: 0.24 });
    noise(c, o, t + 0.3, { dur: 0.5, vol: 0.12, type: 'highpass', freq: 5000, q: 0.7 });
  },
  jackpot: (c, o, t) => {
    for (let r = 0; r < 3; r++) arpeggio(c, o, t + r * 0.5, [523, 659, 784, 1047, 1319, 1568], 0.07, { type: 'square', dur: 0.3, vol: 0.14 });
    tone(c, o, t + 1.5, { type: 'triangle', f: 1047, dur: 0.9, vol: 0.28 });
  },
  lose: (c, o, t) => {
    tone(c, o, t, { type: 'sawtooth', f: 330, f2: 140, dur: 0.38, vol: 0.2 });
    tone(c, o, t + 0.05, { type: 'triangle', f: 247, f2: 98, dur: 0.4, vol: 0.2 });
  },
  coin: (c, o, t) => {
    tone(c, o, t, { type: 'square', f: 1318, dur: 0.07, vol: 0.2 });
    tone(c, o, t + 0.07, { type: 'square', f: 1760, dur: 0.22, vol: 0.2 });
  },
  'slot-spin': (c, o, t) => {
    noise(c, o, t, { dur: 0.05, vol: 0.75, type: 'bandpass', freq: 1800, q: 2 });
    tone(c, o, t, { type: 'square', f: 220, dur: 0.04, vol: 0.1 });
  },
  'slot-stop': (c, o, t) => {
    tone(c, o, t, { type: 'sine', f: 200, f2: 90, dur: 0.16, vol: 0.22 });
    noise(c, o, t, { dur: 0.04, vol: 0.15, type: 'highpass', freq: 2500 });
  },
  'roulette-wheel': (c, o, t) => noise(c, o, t, { dur: 0.09, vol: 2.6, type: 'bandpass', freq: 700, q: 4 }),
  'roulette-ball-tick': (c, o, t) => tone(c, o, t, { type: 'triangle', f: 2400, f2: 1800, dur: 0.03, vol: 0.28 }),
  'roulette-ball-drop': (c, o, t) => {
    tone(c, o, t, { type: 'triangle', f: 1500, f2: 700, dur: 0.06, vol: 0.28 });
    tone(c, o, t + 0.1, { type: 'triangle', f: 1200, f2: 600, dur: 0.07, vol: 0.24 });
    tone(c, o, t + 0.2, { type: 'triangle', f: 900, f2: 500, dur: 0.09, vol: 0.2 });
  },
  'crash-tick': (c, o, t) => tone(c, o, t, { type: 'sine', f: 880, dur: 0.035, vol: 0.28 }),
  'crash-boom': (c, o, t) => {
    noise(c, o, t, { dur: 0.7, vol: 0.28, type: 'lowpass', freq: 2200, freq2: 90, q: 0.8 });
    tone(c, o, t, { type: 'sine', f: 110, f2: 38, dur: 0.6, vol: 0.26 });
  },
  'countdown-tick': (c, o, t) => tone(c, o, t, { type: 'sine', f: 880, dur: 0.09, vol: 0.3 }),
  'countdown-go': (c, o, t) => tone(c, o, t, { type: 'triangle', f: 1320, dur: 0.35, vol: 0.3 }),
  bell: (c, o, t) => {
    tone(c, o, t, { type: 'sine', f: 880, dur: 1.1, vol: 0.16 });
    tone(c, o, t, { type: 'sine', f: 2217, dur: 0.7, vol: 0.1 });
    tone(c, o, t, { type: 'sine', f: 1318, dur: 0.9, vol: 0.1 });
  },
};

// Cada cuántos milisegundos se repite un sonido dentro de audio.loop(nombre)
export const LOOP_MS = {
  'slot-spin': 110, 'roulette-wheel': 140, 'crash-tick': 260, 'countdown-tick': 1000,
  'chips-handle': 600, 'dice-shake': 450, 'card-shuffle': 900,
};
