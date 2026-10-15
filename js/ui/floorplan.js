// js/ui/floorplan.js
// Datos del salón: mapa de piezas del tileset (rectángulos medidos sobre assets/tileset/tileset_1024x512.png),
// cuadros de animación de las tragamonedas, colocación de cada pieza en la escena y las 6 zonas tocables.
// Exporta TILESET_URL, SLOT_SHEETS, PIECES, SLOT_FRAME, SCENE, PLACEMENTS, SLOTS, SCREEN y ZONES. Todo en píxeles lógicos (escena de 176x256).

export const TILESET_URL = 'assets/tileset/tileset_1024x512.png';
export const SLOT_SHEETS = [
  'assets/tileset/anim/SlotMachinesAnimationSheet_0.png',
  'assets/tileset/anim/SlotMachinesAnimationSheet_1.png',
];

// Piezas del tileset: { sx, sy } = esquina de arriba a la izquierda, { sw, sh } = tamaño
export const PIECES = {
  carpet_red: { sx: 32, sy: 0, sw: 48, sh: 48 },          // alfombra roja, se repite sin cortes
  roulette_table: { sx: 912, sy: 196, sw: 112, sh: 60 },  // mesa de ruleta con la rueda a la izquierda
  dice_table: { sx: 864, sy: 240, sw: 32, sh: 52 },       // mesa verde ovalada con dos bandejas (dados)
  die: { sx: 705, sy: 401, sw: 16, sh: 15 },              // dado rojo suelto
  blackjack_table: { sx: 928, sy: 369, sw: 96, sh: 50 },  // semicírculo de blackjack
  counter: { sx: 870, sy: 89, sw: 68, sh: 28 },           // mostrador naranja (rasca y gana)
  railing: { sx: 736, sy: 208, sw: 160, sh: 16 },         // baranda larga con palos de cartas
  plant: { sx: 615, sy: 322, sw: 36, sh: 65 },            // planta grande
};

// Hojas de tragamonedas: cuadros de 32x48 en grilla de 8 columnas. Se usan los cuadros "girando" (sin cartel WIN/LOSE)
export const SLOT_FRAME = {
  w: 32, h: 48, cols: 8,
  frames: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31],
};

export const SCENE = { w: 176, h: 256 };

// Piezas fijas, de atrás hacia adelante
export const PLACEMENTS = [
  { piece: 'railing', x: 8, y: 118 },
  { piece: 'roulette_table', x: 0, y: 54 },
  { piece: 'dice_table', x: 132, y: 58 },
  { piece: 'die', x: 134, y: 84 },
  { piece: 'die', x: 146, y: 94 },
  { piece: 'plant', x: 2, y: 146 },
  { piece: 'plant', x: 138, y: 146 },
  { piece: 'blackjack_table', x: 40, y: 142 },
  { piece: 'counter', x: 108, y: 214 },
];

// Tres tragamonedas animadas (hoja a usar y desfase para que no giren al unísono)
export const SLOTS = [
  { x: 4, y: 206, sheet: 0, offset: 0 },
  { x: 40, y: 206, sheet: 1, offset: 9 },
  { x: 76, y: 206, sheet: 0, offset: 17 },
];

// Pantalla grande del Crash (se dibuja por código: marco, cuadrícula y curva que sube)
export const SCREEN = { x: 24, y: 4, w: 128, h: 40 };

// Zonas tocables: una por juego
export const ZONES = [
  { game: 'crash', x: 24, y: 4, w: 128, h: 40 },
  { game: 'roulette', x: 0, y: 54, w: 112, h: 60 },
  { game: 'dice', x: 120, y: 54, w: 52, h: 58 },
  { game: 'blackjack', x: 40, y: 142, w: 96, h: 50 },
  { game: 'slots', x: 4, y: 206, w: 104, h: 48 },
  { game: 'scratch', x: 108, y: 214, w: 68, h: 28 },
];
