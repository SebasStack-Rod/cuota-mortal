// js/ui/toast.js
// Avisos breves arriba de la barra inferior (evento 'toast' de la sesión). Exporta toast.show({kind, text}).
// kind: 'info' | 'win' | 'loss' | 'warn'. Máximo 3 a la vez; cada uno se va solo a los 3,2 s. La fase 4 los completa.

const MAX = 3;
const LIFETIME = 3200;

export const toast = {
  show({ kind = 'info', text = '' } = {}) {
    const host = document.getElementById('toasts');
    if (!host || !text) return;
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.textContent = text;
    host.append(el);
    while (host.children.length > MAX) host.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 250);
    }, LIFETIME);
  },
};
