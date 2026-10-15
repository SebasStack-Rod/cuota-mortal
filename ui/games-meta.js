// js/ui/games-meta.js
// Datos de presentación de los 6 juegos (nombre, texto del cartel de neón y descripción corta) para el salón y las hojas.
// Exporta GAME_LIST (en orden) y gameMeta(id). La lógica real de cada juego es de la IA 3 (js/games/<id>/logic.js).

export const GAME_LIST = [
  { id: 'roulette', name: 'Ruleta', sign: 'RULETA', desc: 'Ruleta europea: apostá a números, colores y docenas.' },
  { id: 'blackjack', name: 'Blackjack', sign: 'BLACKJACK', desc: 'Llegá a 21 sin pasarte, contra la casa.' },
  { id: 'slots', name: 'Tragamonedas', sign: 'TRAGAMONEDAS', desc: 'Tres rodillos: tu propia máquina, a tu ritmo.' },
  { id: 'crash', name: 'Crash', sign: 'CRASH', desc: 'El multiplicador sube: retirate antes de que explote.' },
  { id: 'dice', name: 'Dados', sign: 'DADOS', desc: 'Dos dados: apostá a más de 7 o a menos de 7.' },
  { id: 'scratch', name: 'Rasca y gana', sign: 'RASCA Y GANA', desc: 'Raspá el cartón y descubrí si hay premio.' },
];

export const gameMeta = (id) => GAME_LIST.find((g) => g.id === id) || { id, name: id, sign: id.toUpperCase(), desc: '' };
