// js/ui/credits.js
// Pantalla de Créditos: lee assets/CREDITOS.txt y lo muestra como lista de párrafos (la lista tiene scroll interno).
// Exporta mountCredits(raiz, { screens }). Se carga la primera vez que se abre la pantalla.

import { $, h, clear } from './dom.js';

export function mountCredits(root, { screens }) {
  const body = $('#credits-body', root);
  let loaded = false;

  function paint(text) {
    clear(body);
    body.append(h('p', {}, 'Cuota Mortal es un juego con dinero ficticio. No hay premios, pagos ni retiros reales.'));
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines.slice(1)) body.append(h('p', {}, line)); // la 1ª línea es una nota para quien programa
    // Respaldo: si el archivo no nombra estas piezas, la interfaz las agrega para no omitir créditos
    const low = text.toLowerCase();
    const extra = [
      ['gsap', 'Animaciones: GSAP, de GreenSock (licencia estándar de GreenSock, uso gratuito).'],
      ['rubik', 'Tipografías: Monoton, Bungee y Rubik, de Google Fonts (licencia SIL Open Font).'],
      ['kenney', 'Sonidos y arte: Kenney (kenney.nl), dominio público CC0.'],
    ];
    for (const [key, line] of extra) if (!low.includes(key)) body.append(h('p', {}, line));
  }

  async function load() {
    body.textContent = 'Cargando…';
    try {
      const res = await fetch('assets/CREDITOS.txt');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      paint(await res.text());
      loaded = true;
    } catch (err) {
      console.warn('[credits] no se pudo leer CREDITOS.txt', err);
      body.textContent = 'No se pudieron cargar los créditos. Probá de nuevo más tarde.';
    }
  }

  $('#credits-back', root).addEventListener('click', () => screens.show(screens.previous() || 'home'));
  screens.onShow((name) => { if (name === 'credits' && !loaded) load(); });
}
