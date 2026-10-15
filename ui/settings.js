// js/ui/settings.js
// Pantalla de Ajustes: sonido (sí/no), volumen y calidad de animación (alta/baja). Todo se guarda en prefs.
// Exporta mountSettings(raiz, { screens, prefs }). La calidad también se pasa a las vistas como ctx.quality.

import { $, $$ } from './dom.js';

export function mountSettings(root, { screens, prefs }) {
  const soundBtn = $('#set-sound', root);
  const volume = $('#set-volume', root);
  const volumeOut = $('#set-volume-out', root);
  const qualityBtns = $$('#set-quality [data-quality]', root);

  function paint() {
    soundBtn.setAttribute('aria-checked', String(prefs.get('sound')));
    const pct = Math.round(prefs.get('volume') * 100);
    volume.value = String(pct);
    volumeOut.textContent = pct + '%';
    volume.disabled = !prefs.get('sound');
    for (const btn of qualityBtns) btn.setAttribute('aria-pressed', String(btn.dataset.quality === prefs.get('quality')));
  }

  soundBtn.addEventListener('click', () => prefs.set('sound', !prefs.get('sound')));
  volume.addEventListener('input', () => prefs.set('volume', Number(volume.value) / 100));
  for (const btn of qualityBtns) btn.addEventListener('click', () => prefs.set('quality', btn.dataset.quality));
  $('#settings-back', root).addEventListener('click', () => screens.show(screens.previous() || 'home'));

  prefs.onChange(paint);
  paint();
}
