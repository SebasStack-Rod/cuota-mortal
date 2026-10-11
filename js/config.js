// js/config.js: configuración de la partida (tiempos, dinero, tienda y datos de Supabase).
// Exporta CONFIG. Todos los montos de dinero están en CENTAVOS (100 = $1).
// Acá se ajusta el juego sin tocar el resto del código.

export const CONFIG = {
  maxPlayers: 8,        // máximo de jugadores por sala
  days: 7,              // días que hay que sobrevivir para ganar
  dayMs: 300000,        // duración de un día: 300000 ms = 5 minutos
  shopMs: 60000,        // duración de la tienda entre días: 60 s
  voteMs: 15000,        // tiempo que dura una votación de compra: 15 s
  collectMs: 6000,      // duración de la animación del cobro del Prestamista: 6 s
  startBank: 200000,    // banco inicial: 200000 centavos = $2.000
  quotaBase: 100000,    // cuota del día 1: 100000 centavos = $1.000
  quotaGrowth: 1.4,     // la cuota sube 40% cada día (se redondea a pesos enteros)

  items: {              // objetos de la tienda (precio en centavos)
    seguro:  { price: 40000, label: 'Seguro de deuda' },   // devuelve el 50% de la primera pérdida del día
    reloj:   { price: 60000, label: 'Reloj robado' },      // +60 s al próximo día
    dados:   { price: 30000, label: 'Dados cargados' },    // 1 repetición de tirada en el juego de dados
    trebol:  { price: 50000, label: 'Trébol' },            // +10% de ganancia en la ruleta durante el próximo día
    soborno: { price: 90000, label: 'Soborno' },           // la próxima cuota baja 15%
  },

  supabase: {           // datos de tu proyecto de Supabase (la clave es la PÚBLICA, nunca la secreta)
    url: 'https://ylcfzqkdwoqpuvvblwnt.supabase.co',
    anonKey: 'sb_publishable_9qDEXZFkxNz7m5e2-68I7g_i8W9ET7a',
  },
};
