// js/ui/screens.js
// Gestor de pantallas: muestra una (la que tiene data-screen="nombre") y oculta las demás, con transición.
// Exporta createScreens(raiz) -> { show(nombre), current(), previous(), onShow(cb) }.
// Las pantallas ocultas quedan "inert" (no reciben foco ni lectores de pantalla).

export function createScreens(root) {
  const map = new Map();
  const listeners = new Set();
  let current = null;
  let previous = null;

  for (const el of root.querySelectorAll('[data-screen]')) {
    map.set(el.dataset.screen, el);
    el.classList.remove('is-active');
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
  }

  function show(name, { instant = false } = {}) {
    const next = map.get(name);
    if (!next) throw new Error(`No existe la pantalla "${name}"`);
    if (name === current) return;

    if (instant) {
      root.classList.add('no-anim');
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-anim')));
    }
    if (current) {
      const old = map.get(current);
      old.classList.remove('is-active');
      old.classList.add('is-leaving');   // sale hacia arriba; la nueva entra desde abajo
      setTimeout(() => old.classList.remove('is-leaving'), 320);
      old.inert = true;
      old.setAttribute('aria-hidden', 'true');
    }
    next.classList.add('is-active');
    next.inert = false;
    next.removeAttribute('aria-hidden');

    previous = current;
    current = name;

    // Foco al título para que lectores de pantalla anuncien la pantalla nueva
    const focusTarget = next.querySelector('[data-focus]');
    if (focusTarget && !instant) focusTarget.focus({ preventScroll: true });

    for (const cb of [...listeners]) cb(name, previous);
  }

  return {
    show,
    current: () => current,
    previous: () => previous,
    onShow(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
