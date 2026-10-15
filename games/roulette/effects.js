// js/games/roulette/effects.js: efectos del resultado de la ruleta: cartel de neón, rastrillo que barre las fichas
// perdedoras, fichas ganadoras que vuelan al banco y avisos breves. Todo es decorativo (el resultado ya viene en el estado).
// Usa GSAP global (window.gsap). Exporta createEffects({ layer, root, table, chips, quality, reduce }).
import { colorOf, spotWins, spotMult } from './constants.js';

const COLOR_NAME = { red: 'Rojo', black: 'Negro', green: 'Verde' };

export function createEffects({ layer, root, table, chips, quality, getReduce }) {
  const mk = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
  const sign = mk('rou-sign');
  const signNum = mk('rou-sign-num');
  const signTxt = mk('rou-sign-txt');
  sign.append(signNum, signTxt);
  const notice = mk('rou-notice');
  const rake = mk('rou-rake');
  layer.append(sign, notice, rake);
  gsap.set([sign, notice], { xPercent: -50 });
  gsap.set(rake, { opacity: 0 });
  const timers = [];
  let noticeCall = null;

  function describe(n) {
    if (n === 0) return 'Verde · Cero';
    return `${COLOR_NAME[colorOf(n)]} · ${n % 2 ? 'Impar' : 'Par'} · ${n <= 18 ? 'Bajo' : 'Alto'}`;
  }

  function showSign(n, instant) {
    gsap.killTweensOf(sign);
    sign.className = 'rou-sign is-' + colorOf(n);
    signNum.textContent = String(n);
    signTxt.textContent = describe(n);
    sign.style.display = 'flex';
    if (instant || getReduce()) { gsap.set(sign, { opacity: 1, scale: 1, rotation: 0 }); return; }
    gsap.fromTo(sign, { opacity: 0, scale: 0.2, rotation: -8 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.55, ease: 'back.out(2.2)' });
  }

  function hideSign(instant) {
    gsap.killTweensOf(sign);
    if (instant || getReduce()) { sign.style.display = 'none'; return; }
    gsap.to(sign, { opacity: 0, duration: 0.3, onComplete: () => { sign.style.display = 'none'; } });
  }

  // Rastrillo: baja por la mesa y empuja fuera las pilas perdedoras. Devuelve true si había algo para barrer.
  function sweepLosers(n, instant) {
    const losers = table.stacks().filter((r) => !r.gone && !spotWins(r.spot, n));
    if (!losers.length) return false;
    if (instant || getReduce()) {
      losers.forEach((r) => { r.gone = true; r.wrap.style.display = 'none'; });
      return true;
    }
    const rr = root.getBoundingClientRect(), tr = table.el.getBoundingClientRect();
    Object.assign(rake.style, { left: (tr.left - rr.left) + 'px', top: (tr.top - rr.top) + 'px', width: tr.width + 'px' });
    gsap.killTweensOf(rake);
    gsap.fromTo(rake, { y: -18, opacity: 1 }, {
      y: tr.height + 4, duration: 1.0, ease: 'power1.inOut',
      onComplete: () => { gsap.to(rake, { opacity: 0, duration: 0.2 }); },
    });
    losers.forEach((r) => {
      const top = r.wrap.getBoundingClientRect().top - tr.top;
      const frac = Math.min(1, Math.max(0, top / tr.height));
      r.gone = true;
      gsap.to(r.inner, {
        y: 34, x: 8, rotation: 14, opacity: 0, scale: 0.6, duration: quality === 'baja' ? 0.25 : 0.35,
        delay: 0.05 + frac * 0.85, ease: 'power2.in', onComplete: () => r.wrap.remove(),
      });
    });
    return true;
  }

  // Fichas ganadoras: vuelan al banco. Con calidad baja o muchas pilas, solo vuelan las primeras.
  function payWinners(n, instant) {
    const winners = table.stacks().filter((r) => !r.gone && spotWins(r.spot, n));
    const bank = chips.bankEl && chips.bankEl();
    const cap = quality === 'baja' ? 4 : 10;
    winners.forEach((r, i) => {
      r.gone = true;
      if (instant || getReduce() || !bank) { r.wrap.style.display = 'none'; return; }
      timers.push(gsap.delayedCall(i * 0.12, () => {
        if (i < cap) chips.fly({ from: r.wrap, to: bank, amount: Math.floor(r.amount * spotMult(r.spot)), count: 3, duration: 0.9 });
        gsap.to(r.inner, { opacity: 0, scale: 0.6, duration: 0.2, onComplete: () => r.wrap.remove() });
      }));
    });
    return winners.length > 0;
  }

  function showNotice(text) {
    if (noticeCall) noticeCall.kill();
    notice.textContent = text;
    gsap.killTweensOf(notice);
    gsap.fromTo(notice, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.18 });
    noticeCall = gsap.delayedCall(1.9, () => gsap.to(notice, { opacity: 0, duration: 0.3 }));
  }

  return {
    showSign, hideSign, sweepLosers, payWinners, notice: showNotice,
    setSignTop(px) { sign.style.top = px + 'px'; },
    // Limpia lo que haya quedado de una ronda anterior (al abrirse las apuestas).
    reset() {
      timers.forEach((t) => t.kill()); timers.length = 0;
      gsap.killTweensOf(rake); gsap.set(rake, { opacity: 0 });
      hideSign(true);
    },
    destroy() {
      timers.forEach((t) => t.kill());
      if (noticeCall) noticeCall.kill();
      gsap.killTweensOf([sign, notice, rake]);
      sign.remove(); notice.remove(); rake.remove();
    },
  };
}
