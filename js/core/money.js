// js/core/money.js: unidad de dinero, fichas y formato. Exporta UNIT, CHIP_VALUES, fmt, chipUrl y breakdown.
export const UNIT = 100; // 100 centavos = $1
export const CHIP_VALUES = [25, 50, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000,
  100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000]; // 17 fichas, de $0,25 a $100.000

export function fmt(cents) {
  const v = cents / UNIT;
  return '$' + v.toLocaleString('es-AR', {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function chipUrl(cents) {
  return `assets/chips/chip_${cents / UNIT}.png`; // 25 -> chip_0.25.png, 100 -> chip_1.png
}

export function breakdown(cents) { // fichas necesarias, de mayor a menor valor
  const out = [];
  let rest = Math.round(cents);
  for (let i = CHIP_VALUES.length - 1; i >= 0; i--) {
    const n = Math.floor(rest / CHIP_VALUES[i]);
    if (n > 0) { out.push({ value: CHIP_VALUES[i], count: n }); rest -= n * CHIP_VALUES[i]; }
  }
  return out;
}
