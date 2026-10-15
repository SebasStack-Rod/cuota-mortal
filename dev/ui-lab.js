// dev/ui-lab.js
// Lógica del laboratorio dev/ui-lab.html: conecta los controles con chips, bandeja, HUD y audio.
// No es parte del juego: solo sirve para probar y ajustar fichas, animaciones y sonidos sueltos.

import { chips } from '../js/ui/chips.js';
import { mountTray } from '../js/ui/tray.js';
import { mountHud } from '../js/ui/hud.js';
import { audio } from '../js/ui/audio.js';
import { UNIT } from '../js/core/money.js';

const $ = (id) => document.getElementById(id);
audio.attachUnlock();
setInterval(() => { $('lab-audio-state').textContent = audio.isReady() ? 'Audio listo.' : 'Tocá cualquier botón para desbloquear el audio.'; }, 500);

// ---- Pilas ----
function drawStack() {
  const cents = Math.round(Number($('stack-amount').value) * UNIT);
  $('stack-demo').replaceChildren(chips.stack(cents, { max: Number($('stack-max').value), size: Number($('stack-size').value), label: true }));
}
for (const v of [0.25, 5, 137.5, 2500, 99999.75]) {
  const b = document.createElement('button');
  b.className = 'lab-btn'; b.textContent = '$' + v;
  b.onclick = () => { $('stack-amount').value = v; drawStack(); };
  $('stack-presets').append(b);
}
['stack-amount', 'stack-max', 'stack-size'].forEach((id) => $(id).addEventListener('input', drawStack));
drawStack();

// ---- Bandeja ----
mountTray($('tray'));
const setTrayBank = () => chips.setBank(Math.round(Number($('tray-bank').value) * UNIT));
$('tray-bank').addEventListener('input', setTrayBank);
chips.onChange((v) => { $('tray-selected').textContent = 'chips.selected() = ' + v + ' centavos'; });
setTrayBank();

// ---- Fichas voladoras ----
async function fly(from, to) {
  const t0 = performance.now();
  $('fly-msg').textContent = 'volando…';
  await chips.fly({ from: $(from), to: $(to), amount: Math.round(Number($('fly-amount').value) * UNIT), count: Number($('fly-count').value) });
  $('fly-msg').textContent = `llegaron (${Math.round(performance.now() - t0)} ms)`;
}
$('fly-ab').onclick = () => fly('fly-a', 'fly-b');
$('fly-ba').onclick = () => fly('fly-b', 'fly-a');

// ---- Barra superior ----
let bank = 120000;
let endsAt = Date.now() + 90000;
const hud = mountHud({ serverNow: Date.now });
const fakeState = () => ({ phase: 'day', day: 3, bank, quota: 196000, dayEndsAt: endsAt });
hud.render(fakeState());
$('hud-up').onclick = () => { bank += 15000; hud.render(fakeState()); };
$('hud-down').onclick = () => { bank = Math.max(0, bank - 30000); hud.render(fakeState()); };
$('hud-danger').onclick = () => { endsAt = Date.now() + 20000; bank = 100000; hud.render(fakeState()); };
hud.setVisible(true);

// ---- Sonidos ----
const group = (title, names) => {
  for (const name of names) {
    const b = document.createElement('button');
    b.className = 'lab-btn'; b.textContent = name;
    b.onclick = () => audio.play(name, { volume: $('snd-volume').value / 100, rate: $('snd-rate').value / 100 });
    $('sounds').append(b);
  }
};
group('todos', audio.names());
for (const name of ['slot-spin', 'roulette-wheel', 'crash-tick', 'chips-handle']) {
  const b = document.createElement('button');
  b.className = 'lab-btn'; b.textContent = name + ' (repetir)';
  let handle = null;
  b.onclick = () => {
    if (handle) { handle.stop(); handle = null; b.textContent = name + ' (repetir)'; }
    else { handle = audio.loop(name); b.textContent = 'parar ' + name; }
  };
  $('loops').append(b);
}
