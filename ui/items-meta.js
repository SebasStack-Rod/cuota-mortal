// js/ui/items-meta.js
// Datos de presentación de los 5 ítems de la tienda (nombre y qué hacen) y del precio de respaldo.
// Exporta ITEM_LIST (en orden) e itemMeta(id). El precio que manda es el de la votación (state.vote.price);
// DECISIÓN: PRICE solo se usa para mostrar el botón "Proponer" antes de que haya votación. Los valores reales
// están en js/config.js (IA 1); estos son una copia de los precios del traspaso.

export const ITEM_LIST = [
  { id: 'seguro', name: 'Seguro de deuda', price: 40000, desc: 'Te devuelve la mitad de la primera apuesta que pierdas. Se gasta al usarse.' },
  { id: 'reloj', name: 'Reloj robado', price: 60000, desc: 'Suma 60 segundos al día siguiente.' },
  { id: 'dados', name: 'Dados cargados', price: 30000, desc: 'Una repetición de tirada en Dados. Se gasta al usarse.' },
  { id: 'trebol', name: 'Trébol', price: 50000, desc: '10% más de premio en la ruleta durante el día siguiente.' },
  { id: 'soborno', name: 'Soborno', price: 90000, desc: 'Baja la cuota del día siguiente un 15%.' },
];

export const itemMeta = (id) => ITEM_LIST.find((i) => i.id === id) || { id, name: id, price: 0, desc: '' };
