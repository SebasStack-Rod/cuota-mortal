// js/main.js
// Arranque de la app: prepara los marcos dorados, arma el gestor de pantallas, conecta cada pantalla con la sesión
// y decide qué pantalla mostrar según el estado de la sala (sin sala -> Inicio, lobby -> Sala de espera, el resto -> provisoria).
// Fase 2: también arma el audio, la barra superior (HUD), la bandeja de fichas, la barra inferior y los avisos.
// Fase 3: en el día se muestra el salón (sin asiento) o la mesa (sentado), con la vista del juego montada por gamehost.js.
// Fase 4: tienda con votación y hojas de la barra. Fase 5: cobro del Prestamista y pantallas finales.

import { session } from './net/index.js';
import { $ } from './ui/dom.js';
import { prefs } from './ui/prefs.js';
import { applyFrames } from './ui/frames.js';
import { fitAll } from './ui/fit.js';
import { createScreens } from './ui/screens.js';
import { mountHome } from './ui/home.js';
import { mountLobby } from './ui/lobby.js';
import { mountCollect } from './ui/collect.js';
import { mountEnding } from './ui/ending.js';
import { mountSettings } from './ui/settings.js';
import { mountCredits } from './ui/credits.js';
import { audio } from './ui/audio.js';
import { mountHud } from './ui/hud.js';
import { mountTray } from './ui/tray.js';
import { toast } from './ui/toast.js';
import { mountSalon } from './ui/salon.js';
import { createGameHost } from './ui/gamehost.js';
import { closeSheet } from './ui/sheets.js';
import { mountShop } from './ui/shop.js';
import { mountBarSheets } from './ui/bar-sheets.js';
import { mountA11y } from './ui/a11y.js';

const FREE_SCREENS = new Set(['home', 'settings', 'credits']);   // pantallas que se pueden abrir sin estar en una sala

// ---- Calidad de animación: queda escrita en <html data-quality="alta|baja"> para el CSS ----
function applyQuality() {
  document.documentElement.dataset.quality = prefs.get('quality');
}

// ---- Aviso de conexión ----
function setupConnectionBanner() {
  const banner = $('#conn-banner');
  const TEXT = { offline: 'Sin conexión. Reintentando…', reconnecting: 'Reconectando…' };
  session.on('connection', (status) => {
    banner.hidden = status === 'online';
    banner.textContent = TEXT[status] || '';
  });
}

async function start() {
  applyQuality();
  prefs.onChange((key) => { if (key === 'quality') applyQuality(); });

  // Los marcos dorados son un detalle: si tardan o fallan, la app arranca igual con un borde simple
  try {
    await Promise.race([applyFrames(), new Promise((_, reject) => setTimeout(() => reject(new Error('tiempo agotado')), 1500))]);
  } catch (err) {
    console.warn('[main] sin marcos ornamentales:', err.message);
  }

  const screens = createScreens($('#app'));

  // Salir de la sala: se avisa a la sesión y se vuelve a Inicio
  function leave() {
    session.leaveRoom();
    route();
  }

  const home = mountHome($('#screen-home'), { session, screens, prefs, onEntered: () => route() });
  const lobby = mountLobby($('#screen-lobby'), { session, screens, onLeave: leave });
  const collect = mountCollect($('#screen-collect'));
  const ending = mountEnding($('#screen-end'), { session, onLeave: leave });
  const salon = mountSalon($('#screen-salon'), { session, screens, prefs });
  const shop = mountShop($('#screen-shop'), { session, screens });
  const gameHost = createGameHost($('#game-container'));

  // Mientras la persona cambia de mesa (se levanta y se sienta) no se pasa por el salón: evita un parpadeo
  let switchingTo = null;
  let switchTimer = null;
  const barSheets = mountBarSheets({
    session,
    onSwitching(gameId) {
      switchingTo = gameId;
      clearTimeout(switchTimer);
      switchTimer = setTimeout(() => { switchingTo = null; }, 2000);   // por si la sesión rechaza el asiento
    },
  });
  mountSettings($('#screen-settings'), { screens, prefs });
  mountCredits($('#screen-credits'), { screens });

  // ---- Barras fijas, bandeja y avisos ----
  const hud = mountHud({
    serverNow: () => session.serverNow(),
    onAction(action) {
      if (action === 'leave') session.standUp();
      else barSheets.open(action);   // switch, profit y team
    },
  });
  mountTray(document.getElementById('tray'));
  session.on('toast', (t) => toast.show(t));
  audio.attachUnlock();
  // Sonido de clic en todos los botones
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.btn, .btn-link, .seg__btn, .bar__btn')) audio.play('ui-click', { volume: 0.5 });
  });

  // El HUD se ve durante el día, el cobro y la tienda; bandeja y barra inferior solo si estás sentado en una mesa
  function updateChrome(state) {
    const inGame = !!state && ['day', 'collect', 'shop'].includes(state.phase);
    const me = state && session.me();
    const seated = inGame && state.phase === 'day' && !!me && !!state.players[me.id] && !!state.players[me.id].seat;
    const app = $('#app');
    app.classList.toggle('has-hud', inGame);
    app.classList.toggle('has-seat', seated);
    hud.setVisible(inGame);
    hud.setBarVisible(seated);
  }

  // Elige la pantalla según el estado de la sala
  function route() {
    const state = session.getState();
    const current = screens.current();
    updateChrome(state);
    if (!state) {
      hud.reset();
      gameHost.destroy();
      if (!FREE_SCREENS.has(current)) screens.show('home');
      return;
    }
    const me = session.me();
    const seated = !!me && !!state.players[me.id] && !!state.players[me.id].seat;
    let target = 'lobby';
    if (state.phase === 'lobby') target = 'lobby';
    else if (state.phase === 'shop') target = 'shop';
    else if (state.phase === 'collect') target = 'collect';
    else if (state.phase === 'gameover' || state.phase === 'victory') target = 'end';
    else if (state.phase === 'day') target = seated ? 'table' : 'salon';
    if (switchingTo) {
      if (state.phase === 'day' && !seated && current === 'table') return;   // todavía no llegó el asiento nuevo
      switchingTo = null;
    }
    if (current !== target) { closeSheet(); screens.show(target); }
  }

  session.on('state', (state) => {
    route();
    hud.render(state);
    salon.render(state);
    gameHost.render(state);
    lobby.render(state);
    shop.render(state);
    collect.render(state);
    ending.render(state);
  });
  setupConnectionBanner();
  mountA11y({ session });

  // Pestaña oculta: se pausan las animaciones CSS
  document.addEventListener('visibilitychange', () => {
    document.documentElement.classList.toggle('is-hidden', document.hidden);
  });

  // El texto de una línea (cartel y código de sala) se ajusta al ancho disponible
  window.addEventListener('resize', fitAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitAll);

  screens.show('home', { instant: true });
  fitAll();

  // Caja de herramientas de prueba: solo existe con la sesión falsa (consola: dev.skip(), dev.fill(8)...)
  if (session.dev) window.dev = session.dev;
}

start().catch((err) => {
  console.error('[main] no se pudo iniciar la app', err);
});
