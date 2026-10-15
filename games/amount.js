// js/games/amount.js: selector de monto libre para las vistas (botón + panelcito con un campo numérico).
// Si el jugador no escribió un monto, se usa la ficha activa de la bandeja (chips.selected()). Elegir otra ficha borra el monto libre.
// Exporta createAmountPicker({ chips, fmt }) -> { btn, pop, get(), setLimits(limits, usedCents), clear(), destroy() }.
const CSS = `
.amt-btn{min-height:44px;border-radius:12px;font:600 12px var(--font-body,sans-serif);background:var(--panel,rgba(20,20,34,.86));border:1px solid rgba(212,175,55,.5);color:var(--gold-light,#F3D77A);padding:0 8px;cursor:pointer}
.amt-btn.is-custom{background:#2b2a14;border-color:var(--gold-light,#F3D77A)}
.amt-pop{position:absolute;left:8px;right:8px;bottom:60px;z-index:9;display:none;flex-direction:column;gap:8px;padding:12px;border-radius:14px;background:rgba(14,14,26,.97);border:1px solid var(--gold,#D4AF37);box-shadow:0 8px 24px rgba(0,0,0,.6);color:var(--text,#F5F1E6);font:13px var(--font-body,sans-serif)}
.amt-pop.is-open{display:flex}
.amt-title{font:12px var(--font-title,sans-serif);color:var(--gold-light,#F3D77A);letter-spacing:.05em}
.amt-input{width:100%;min-height:44px;font:600 20px var(--font-body,sans-serif);text-align:center;border-radius:10px;border:1px solid #3a3a58;background:#1c1c30;color:var(--text,#F5F1E6)}
.amt-row{display:flex;gap:6px}
.amt-row button,.amt-chip{flex:1;min-height:44px;border-radius:10px;border:1px solid #3a3a58;background:#1c1c30;color:var(--text,#F5F1E6);font:600 13px var(--font-body,sans-serif);cursor:pointer}
.amt-info{font-size:11px;color:var(--text-dim,#A9A59A);line-height:1.4}
`;

export function createAmountPicker({ chips, fmt }) {
  if (!document.getElementById('amt-style')) {
    const st = document.createElement('style'); st.id = 'amt-style'; st.textContent = CSS; document.head.appendChild(st);
  }
  let custom = null, min = 25, max = 20000, used = 0;

  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'amt-btn';
  const pop = document.createElement('div');
  pop.className = 'amt-pop';
  pop.innerHTML = `<div class="amt-title">MONTO DE LA APUESTA</div>
    <input class="amt-input" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Monto en $">
    <div class="amt-row"><button type="button" data-q="min">Mín</button><button type="button" data-q="half">½</button><button type="button" data-q="dbl">×2</button><button type="button" data-q="max">Máx</button></div>
    <div class="amt-info"></div>
    <button type="button" class="amt-chip" data-q="chip">Usar la ficha de la bandeja</button>`;
  const input = pop.querySelector('.amt-input'), info = pop.querySelector('.amt-info');

  const clamp = (v) => Math.min(max, Math.max(min, Math.round(v)));
  function paint() {
    btn.textContent = custom ? fmt(custom) : '✎ Monto';
    btn.classList.toggle('is-custom', !!custom);
    input.value = custom ? String(custom / 100) : '';
    info.textContent = `Mínimo ${fmt(min)} · máximo por ronda ${fmt(max)} (te quedan ${fmt(Math.max(0, max - used))})`;
  }
  const current = () => custom || chips.selected() || min;

  btn.addEventListener('click', () => pop.classList.toggle('is-open'));
  input.addEventListener('change', () => {
    const v = Number(input.value);
    custom = Number.isFinite(v) && v > 0 ? clamp(v * 100) : null;
    paint();
  });
  pop.addEventListener('click', (e) => {
    const q = e.target.dataset && e.target.dataset.q;
    if (!q) return;
    if (q === 'min') custom = min;
    else if (q === 'max') custom = clamp(Math.max(min, max - used));
    else if (q === 'half') custom = clamp(current() / 2);
    else if (q === 'dbl') custom = clamp(current() * 2);
    else if (q === 'chip') { custom = null; pop.classList.remove('is-open'); }
    paint();
  });
  const off = chips.onChange(() => { custom = null; paint(); }); // elegir otra ficha en la bandeja vuelve al modo ficha
  paint();

  return {
    btn, pop,
    get: () => custom || chips.selected(),
    setLimits(lim, usedCents) {
      if (!lim) return;
      min = lim.minBet; max = lim.maxBet; used = usedCents || 0;
      if (custom) custom = clamp(custom);
      paint();
    },
    clear() { custom = null; paint(); },
    destroy() { off(); pop.remove(); btn.remove(); },
  };
}
