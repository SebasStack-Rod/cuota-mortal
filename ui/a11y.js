// js/ui/a11y.js
// Accesibilidad y teclado virtual.
//  1) Anunciador para lectores de pantalla: avisa cuando empieza un día, abre la tienda y quedan 30 y 10 segundos.
//     (Los cambios de pantalla ya se anuncian porque screens.js enfoca el título.)
//  2) Teclado virtual: cuando se abre, #app se ajusta a la altura visible (visualViewport) y el campo enfocado
//     se acerca al centro. Mientras está abierto, #app lleva data-keyboard="open" para que el CSS esconda adornos.
// Exporta mountA11y({ session }).

import { $ } from './dom.js';

export function mountA11y({ session }) {
  const app = $('#app');
  const live = $('#sr-announcer');

  // ---------- Anunciador ----------
  function say(text) {
    live.textContent = '';
    // un instante vacío para que el lector repita un texto igual al anterior
    setTimeout(() => { live.textContent = text; }, 60);
  }

  let lastPhase = null;
  let lastDay = null;
  const said = new Set();   // avisos de tiempo ya dados en el día actual

  session.on('state', (state) => {
    if (!state) { lastPhase = lastDay = null; return; }
    if (state.phase !== lastPhase || state.day !== lastDay) {
      if (state.phase === 'day') { said.clear(); say(`Día ${state.day} de 7. Empieza el día.`); }
      else if (state.phase === 'shop') say('Tienda abierta. Pueden proponer un ítem.');
      lastPhase = state.phase;
      lastDay = state.day;
    }
  });

  setInterval(() => {
    const state = session.getState();
    if (!state || state.phase !== 'day' || !state.dayEndsAt) return;
    const left = Math.ceil((state.dayEndsAt - session.serverNow()) / 1000);
    for (const mark of [30, 10]) {
      if (left <= mark && left > mark - 3 && !said.has(mark)) { said.add(mark); say(`Quedan ${mark} segundos.`); }
    }
  }, 1000);

  // ---------- Teclado virtual ----------
  const vv = window.visualViewport;
  function syncViewport() {
    if (!vv) return;
    const open = window.innerHeight - vv.height > 120;
    app.dataset.keyboard = open ? 'open' : 'closed';
    app.style.height = open ? `${Math.round(vv.height)}px` : '';
    app.style.bottom = open ? 'auto' : '';
    app.style.top = open ? `${Math.round(vv.offsetTop)}px` : '';
  }
  if (vv) {
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);
  }
  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLElement) || !el.matches('input, textarea')) return;
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'auto' }), 280);   // espera a que el teclado termine de subir
  });
}
