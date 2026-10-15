// js/ui/prefs.js
// Preferencias del jugador guardadas en localStorage: nombre, sonido, volumen y calidad de animación.
// Exporta el objeto prefs con get(clave), set(clave, valor) y onChange(cb) (devuelve la función para dejar de escuchar).
// Si localStorage no está disponible (modo privado, por ejemplo), funciona igual pero sin recordar nada.

const STORAGE_KEY = 'cuota-mortal:prefs';
const DEFAULTS = { name: '', sound: true, volume: 0.8, quality: 'alta' };

function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (typeof raw.name === 'string') out.name = raw.name.slice(0, 12);
  if (typeof raw.sound === 'boolean') out.sound = raw.sound;
  if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) out.volume = raw.volume;
  if (raw.quality === 'alta' || raw.quality === 'baja') out.quality = raw.quality;
  return out;
}

let data = { ...DEFAULTS };
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) data = sanitize(JSON.parse(saved));
} catch (err) {
  console.warn('[prefs] no se pudieron leer las preferencias', err);
}

const listeners = new Set();

export const prefs = {
  get(key) {
    return data[key];
  },
  set(key, value) {
    if (!(key in DEFAULTS) || data[key] === value) return;
    data = sanitize({ ...data, [key]: value });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('[prefs] no se pudieron guardar las preferencias', err);
    }
    for (const cb of [...listeners]) cb(key, data[key], data);
  },
  onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
