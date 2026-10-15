// js/ui/sheets.js
// Hoja inferior reutilizable (bottom sheet) con marco dorado: título, contenido y botones. Se cierra con el fondo,
// con Escape o con el botón Cerrar, y devuelve el foco a donde estaba. Exporta openSheet({ title, body, actions, onClose }) -> { close }.
// Solo hay una hoja abierta a la vez. La usan la hoja de mesa y (fase 4) Cambiar de juego, Ganancias y Equipo.

let current = null;

export function openSheet({ title, body, actions = [], onClose = () => {} }) {
  if (current) current.close();
  const root = document.getElementById('sheet-root');
  const opener = document.activeElement;
  root.hidden = false;
  root.replaceChildren();

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet panel panel--framed';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'sheet-title');

  const heading = document.createElement('h2');
  heading.id = 'sheet-title';
  heading.className = 'sheet__title';
  heading.tabIndex = -1;
  heading.textContent = title;
  const content = document.createElement('div');
  content.className = 'sheet__body';
  content.append(body);
  const bar = document.createElement('div');
  bar.className = 'sheet__actions';

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    sheet.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    setTimeout(() => { if (current === api) { root.hidden = true; root.replaceChildren(); current = null; } }, 220);
    if (opener && opener.focus) opener.focus({ preventScroll: true });
    onClose();
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  for (const a of [...actions, { label: 'Cerrar', kind: 'ghost', onClick: null }]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn--${a.kind || 'gold'}`;
    btn.textContent = a.label;
    if (a.disabled) btn.disabled = true;
    btn.addEventListener('click', () => { if (a.onClick) a.onClick(); close(); });
    bar.append(btn);
  }

  sheet.append(heading, content, bar);
  root.append(backdrop, sheet);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => { backdrop.classList.add('is-open'); sheet.classList.add('is-open'); heading.focus({ preventScroll: true }); });

  const api = { close };
  current = api;
  return api;
}

export const closeSheet = () => { if (current) current.close(); };
