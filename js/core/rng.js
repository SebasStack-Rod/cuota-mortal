// js/core/rng.js: generadores de números aleatorios.
// Exporta hostRng (seguro, lo usa el anfitrión para todos los resultados)
// y seededRng (repetible con una semilla, solo para pruebas).

// Devuelve un número en [0, 1) usando 53 bits aleatorios del navegador.
// Sin sesgo: no usa módulo ni Math.random.
export function hostRng() {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const alto = buf[0] >>> 5;   // 27 bits
  const bajo = buf[1] >>> 6;   // 26 bits
  return (alto * 67108864 + bajo) / 9007199254740992; // 2^26 y 2^53
}

// Generador mulberry32: con la misma semilla da siempre la misma secuencia.
export function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
