// js/games/registry.js: lista de juegos disponibles. IA 1 carga la lógica y IA 2 monta la vista con import() dinámico.
// Exporta GAMES = { [id]: { id, name, mode, logic(), view() } }. Lista los seis juegos.
//
// TABLA DE RTP (retorno teórico = devuelto / apostado)
// | Juego     | RTP teórico | Cómo se calculó                                              |
// |-----------|-------------|--------------------------------------------------------------|
// | roulette  | 0,9730      | exacto: cada lugar devuelve 36/37 (computeRtp() de logic.js)  |
// | crash     | 0,9700      | exacto: P(explota >= x) = 0,97/x, así que retirarse en x devuelve 0,97 |
// | slots     | 0,9409      | exacto: enumeración de las 32^3 combinaciones (computeRtp())   |
// | dice      | 0,9500      | exacto: enumeración de 36 tiradas; under y over 0,9583 (2,3x), seven 0,9333 (5,6x), promedio de los 3 lugares |
// | blackjack | 0,9911      | simulado: 1.000.000 de manos, semilla fija, estrategia básica sin separar (imitar a la banca: 0,9429). Fuera del rango 0,92-0,98: ver informe |
// | scratch   | 0,9250      | exacto: tabla de premios por símbolo, (1000×1 + 1200×2 + 600×5 + 125×10 + 20×50 + 3×200) / 10000 (computeRtp()) |//
// PRUEBAS HECHAS POR JUEGO (Node: dev/test_<id>.mjs, dev/test_transversal.mjs y dev/verificar_registro.mjs; navegador: sandbox + dev/browser/)
// | Prueba                                   | roulette | crash | dice | blackjack | slots | scratch |
// |------------------------------------------|----------|-------|------|-----------|-------|---------|
// | Apuesta sin fondos (sin_fondos, sin efectos) | Node | Node  | Node | Node      | Node + navegador | Node + navegador |
// | Entrar a mitad de ronda (remontar vista)  | navegador| navegador | navegador | navegador | navegador | navegador |
// | Salir sentado con apuestas abiertas (onSeatLeft) | Node | Node | Node | Node  | Node + navegador | Node + navegador |
// | Dos jugadores apostando a la vez          | Node     | Node (transversal) | Node | Node | Node (transversal) | Node |
// | Estado público menor a 4 KB con 8 jugadores | Node   | Node  | Node | Node      | Node (transversal) | Node |
// Todas las suites imprimen TODO OK. Nunca se probó con GSAP real, sonidos reales ni assets reales (ver informe de la fase 7).
export const GAMES = {
  roulette: {
    id: 'roulette', name: 'Ruleta', mode: 'shared',
    logic: () => import('./roulette/logic.js'),
    view: () => import('./roulette/view.js'),
  },
  crash: {
    id: 'crash', name: 'Crash', mode: 'shared',
    logic: () => import('./crash/logic.js'),
    view: () => import('./crash/view.js'),
  },
  dice: {
    id: 'dice', name: 'Dados', mode: 'shared',
    logic: () => import('./dice/logic.js'),
    view: () => import('./dice/view.js'),
  },
  blackjack: {
    id: 'blackjack', name: 'Blackjack', mode: 'shared',
    logic: () => import('./blackjack/logic.js'),
    view: () => import('./blackjack/view.js'),
  },
  slots: {
    id: 'slots', name: 'Tragamonedas', mode: 'solo',
    logic: () => import('./slots/logic.js'),
    view: () => import('./slots/view.js'),
  },
  scratch: {
    id: 'scratch', name: 'Rasca y gana', mode: 'solo',
    logic: () => import('./scratch/logic.js'),
    view: () => import('./scratch/view.js'),
  },
};
