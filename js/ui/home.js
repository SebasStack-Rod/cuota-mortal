// js/ui/home.js
// Pantalla de Inicio: nombre del jugador (se recuerda), botón "Crear sala" y "Unirse" con código de 4 letras.
// Exporta mountHome(raiz, { session, screens, prefs, onEntered }). Traduce los errores de joinRoom a español claro.
// Cuando se entra a una sala llama onEntered() y main.js muestra la pantalla que corresponda.

import { $ } from './dom.js';

const ERROR_TEXT = {
  room_not_found: 'No encontramos esa sala. Revisá las 4 letras del código.',
  room_full: 'La sala está llena: el máximo es de 8 jugadores.',
  name_taken: 'Ya hay alguien con ese nombre en la sala. Probá con otro.',
  already_started: 'Esa partida ya empezó. Pedile al anfitrión que arme una sala nueva.',
};
const GENERIC_ERROR = 'No pudimos conectarnos. Revisá tu internet y probá de nuevo.';

export function mountHome(root, { session, screens, prefs, onEntered }) {
  const nameInput = $('#home-name', root);
  const codeInput = $('#home-code', root);
  const createBtn = $('#home-create', root);
  const joinBtn = $('#home-join', root);
  const errorEl = $('#home-error', root);
  let busy = false;

  nameInput.value = prefs.get('name');

  const cleanName = () => nameInput.value.replace(/\s+/g, ' ').trim().slice(0, 12);
  const showError = (text) => { errorEl.textContent = text; };

  function setBusy(isBusy, button, busyText) {
    busy = isBusy;
    for (const b of [createBtn, joinBtn]) b.disabled = isBusy;
    if (isBusy) {
      button.dataset.label = button.textContent;
      button.textContent = busyText;
      button.setAttribute('aria-busy', 'true');
    } else {
      for (const b of [createBtn, joinBtn]) {
        if (b.dataset.label) { b.textContent = b.dataset.label; delete b.dataset.label; }
        b.removeAttribute('aria-busy');
      }
    }
  }

  async function run(button, busyText, action) {
    if (busy) return;
    const name = cleanName();
    if (!name) {
      showError('Escribí tu nombre para entrar.');
      nameInput.focus();
      return;
    }
    showError('');
    prefs.set('name', name);
    setBusy(true, button, busyText);
    try {
      await action(name);
      onEntered();
    } catch (err) {
      showError(ERROR_TEXT[err && err.code] || GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  createBtn.addEventListener('click', () => run(createBtn, 'Creando…', (name) => session.createRoom(name)));

  function join() {
    const code = codeInput.value;
    if (code.length !== 4) {
      showError('El código tiene 4 letras.');
      codeInput.focus();
      return;
    }
    run(joinBtn, 'Entrando…', (name) => session.joinRoom(code, name));
  }
  joinBtn.addEventListener('click', join);

  // El código solo admite letras A-Z y se escribe en mayúsculas
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    showError('');
  });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  nameInput.addEventListener('input', () => showError(''));
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') codeInput.focus(); });

  $('#home-credits', root).addEventListener('click', () => screens.show('credits'));
  $('#home-settings', root).addEventListener('click', () => screens.show('settings'));

  // Al volver a Inicio se limpia el error y se refresca el nombre guardado
  screens.onShow((name) => {
    if (name !== 'home') return;
    showError('');
    nameInput.value = prefs.get('name');
  });
}
