// js/ui/frames.js
// Tiñe de dorado el marco de Kenney (líneas blancas) con un canvas y lo deja listo para CSS:
// guarda la imagen en la variable --frame-gold y pone la clase "frames-ready" en <html>.
// Exporta applyFrames(). Si algo falla, los paneles usan un borde dorado simple.

const FRAME_URL = 'assets/ui/kenney-fantasy/default/border/panel-border-001.png';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar ' + url));
    img.src = url;
  });
}

export async function applyFrames() {
  const img = await loadImage(FRAME_URL);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  // "source-in" deja el color nuevo solo donde ya había píxeles: las líneas blancas pasan a doradas
  ctx.globalCompositeOperation = 'source-in';
  const gold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#D4AF37';
  ctx.fillStyle = gold;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const root = document.documentElement;
  root.style.setProperty('--frame-gold', `url("${canvas.toDataURL('image/png')}")`);
  root.classList.add('frames-ready');
}
