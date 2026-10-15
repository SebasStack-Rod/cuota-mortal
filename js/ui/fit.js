// js/ui/fit.js
// Achica la letra de un texto de una sola línea hasta que entre en su contenedor.
// Sirve para el cartel de neón y el código de sala, porque Monoton es una fuente muy ancha.
// Exporta fit(elemento) y fitAll() (todos los que tienen el atributo data-fit).

import { $$ } from './dom.js';

export function fit(el) {
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  let guard = 60;
  while (el.scrollWidth > el.clientWidth + 1 && size > 18 && guard-- > 0) {
    size -= 2;
    el.style.fontSize = size + 'px';
  }
}

export function fitAll() {
  $$('[data-fit]').forEach(fit);
}
