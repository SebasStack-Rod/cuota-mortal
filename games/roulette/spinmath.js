// js/games/roulette/spinmath.js: matemática pura (sin DOM) del giro de la ruleta.
// La usa logic.js para fabricar el objeto `spin` y la vista para dibujar rueda y bola idénticas en todos los celulares.
// Exporta: makeSpin, prepareSpin, wheelAngleAt, wheelOmegaAt, idleAngleAt, ballPoseAt, pocketRel y constantes geométricas.
//
// Cómo funciona (todos los ángulos en radianes; positivo = sentido horario, como en Canvas):
//  - La rueda arranca rápido y frena con una curva exponencial hasta una velocidad lenta de reposo (WHEEL_IDLE).
//  - La bola gira al revés. Primero va por la pista (fase "track") frenando; al llegar a `DROP_AT` cae (fase "drop"):
//    ahí se mide su ángulo RESPECTO DE LA RUEDA y termina clavado en el bolsillo ganador (con rebotes).
//  - `ballStartAngle` no es libre: se calcula hacia atrás para que la caída termine justo en el bolsillo del resultado.
import { WHEEL } from './constants.js';

export const TAU = Math.PI * 2;
export const POCKETS = WHEEL.length;            // 37
export const POCKET_ANGLE = TAU / POCKETS;
export const WHEEL_IDLE = 0.32;                 // rad/s: velocidad lenta de la rueda entre giros
const WHEEL_TAU = 3.2;                          // s: constante de tiempo del frenado de la rueda
const DROP_AT = 0.64;                           // fracción de `duration` en que la bola deja la pista
const F_LO = 0.38 * TAU;                        // recorrido relativo mínimo (rad) de la bola durante la caída
const F_SPAN = 0.55 * TAU;                      // rango del recorrido relativo

// Radios como fracción del radio de la rueda (la vista los usa para dibujar).
export const R_TRACK = 0.865;                   // por dónde corre la bola en la pista
export const R_EDGE = 0.795;                    // borde interior de la pista (donde empieza a caer)
export const R_REST = 0.60;                     // radio del bolsillo donde se asienta la bola

export const pocketRel = (idx) => idx * POCKET_ANGLE - Math.PI / 2; // ángulo del centro del bolsillo idx, respecto de la rueda (el 0 arriba)
export const mod = (a, m) => ((a % m) + m) % m;
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const round3 = (x) => Math.round(x * 1e3) / 1e3;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- Rueda ----
function wheelParams(spin) {
  const T = spin.duration / 1000;
  const k = WHEEL_TAU * (1 - Math.exp(-T / WHEEL_TAU));
  const w0 = WHEEL_IDLE + (TAU * spin.wheelTurns - WHEEL_IDLE * T) / k; // velocidad inicial para dar `wheelTurns` vueltas en `duration`
  return { w0 };
}

// Ángulo de la rueda en el instante tMs (hora del anfitrión). Sigue valiendo después del giro: converge a la velocidad lenta.
export function wheelAngleAt(spin, tMs) {
  const t = Math.max(0, (tMs - spin.startedAt) / 1000);
  const { w0 } = wheelParams(spin);
  return spin.wheelStartAngle + WHEEL_IDLE * t + (w0 - WHEEL_IDLE) * WHEEL_TAU * (1 - Math.exp(-t / WHEEL_TAU));
}

export function wheelOmegaAt(spin, tSec) {
  const { w0 } = wheelParams(spin);
  return WHEEL_IDLE + (w0 - WHEEL_IDLE) * Math.exp(-tSec / WHEEL_TAU);
}

// Ángulo de la rueda cuando todavía no hubo ningún giro (mismo valor en todos los celulares gracias al reloj sincronizado).
export function idleAngleAt(nowMs) {
  return (nowMs / 1000 * WHEEL_IDLE) % TAU;
}

// ---- Bola ----
// Calcula una sola vez todo lo derivado de un `spin` y del número ganador.
export function prepareSpin(spin, number) {
  const idx = WHEEL.indexOf(number);
  const T = spin.duration / 1000;
  const td = T * DROP_AT;                       // s: la bola deja la pista
  const Ts = T - td;                            // s: duración de la caída
  const N = spin.ballTurns;                     // vueltas que da por la pista
  const target = pocketRel(idx);
  const wTd = wheelAngleAt(spin, spin.startedAt + td * 1000);
  const omTd = wheelOmegaAt(spin, td);
  // f = cuánto le falta recorrer a la bola, respecto de la rueda, desde que cae hasta el bolsillo (se recupera de ballStartAngle)
  const raw = spin.ballStartAngle - TAU * N - wTd - target;
  const f = F_LO + mod(raw - F_LO, TAU);
  const vEnd = Math.max(0, 2.2 * f / Ts - omTd);          // rad/s de la bola respecto del suelo al caer
  const B = vEnd * td;
  const A = TAU * N - B;
  const p = Math.min(4.5, Math.max(1.5, (omTd + vEnd) * Ts / f)); // exponente del frenado de la caída
  const thetaTd = wTd + target + f;             // ángulo absoluto de la bola al caer
  return { idx, T, td, Ts, N, target, f, A, B, p, thetaTd, kb: 3 + (idx % 2) };
}

// Posición de la bola en el instante tMs. Devuelve { angle, r, hop, phase, rel }:
//   angle: ángulo absoluto; r: radio (fracción del radio de la rueda); hop: altura del rebote (0 a ~0.05);
//   phase: 'track' | 'drop' | 'rest'; rel: ángulo respecto de la rueda (para los "tic" al cruzar separadores).
export function ballPoseAt(prep, spin, tMs) {
  const t = (tMs - spin.startedAt) / 1000;
  const wA = wheelAngleAt(spin, tMs);
  if (t < prep.td) {
    const x = Math.max(0, t) / prep.td;
    const angle = prep.thetaTd + prep.A * (1 - x) * (1 - x) + prep.B * (1 - x);
    const r = R_TRACK - (R_TRACK - R_EDGE) * smooth(0.82, 1, x) - 0.008 * x;
    return { angle, r, hop: 0, phase: 'track', rel: angle - wA };
  }
  if (t < prep.T) {
    const s = (t - prep.td) / prep.Ts;
    const g = 1 - Math.pow(1 - s, prep.p);
    const bounce = 1.1 * POCKET_ANGLE * (1 - s) * (1 - s) * Math.sin(TAU * 2.5 * s) * smooth(0, 0.25, s);
    const rel = prep.target + prep.f * (1 - g) + bounce;
    const hop = 0.045 * Math.pow(1 - s, 1.6) * Math.abs(Math.sin(Math.PI * prep.kb * s));
    const r = R_REST + (R_EDGE - R_REST) * Math.pow(1 - s, 2.2) + hop * 0.3;
    return { angle: wA + rel, r, hop, phase: 'drop', rel };
  }
  return { angle: wA + prep.target, r: R_REST, hop: 0, phase: 'rest', rel: prep.target };
}

// Fabrica el objeto `spin` (viaja por la red) a partir del RNG del anfitrión y del número ya sorteado.
// wheelStartAngle es el ángulo actual de la rueda (así no pega un salto al empezar a girar).
export function makeSpin(rng, startedAt, number, wheelStartAngle) {
  const idx = WHEEL.indexOf(number);
  const spin = {
    startedAt,
    duration: 8300 + Math.floor(rng() * 600),             // 8,3 a 8,9 s (la fase dura 9 s)
    wheelTurns: round3(2.4 + rng() * 0.8),
    ballTurns: round3(5.5 + rng() * 2),
    wheelStartAngle: round6(mod(wheelStartAngle, TAU)),
    ballStartAngle: 0,
  };
  const f = F_LO + 0.04 * TAU + rng() * (F_SPAN - 0.08 * TAU);
  const wTd = wheelAngleAt(spin, startedAt + spin.duration * DROP_AT);
  spin.ballStartAngle = round6(mod(wTd + pocketRel(idx) + f + TAU * spin.ballTurns, TAU));
  return spin;
}
