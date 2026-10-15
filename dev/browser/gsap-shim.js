// SOLO PARA PRUEBAS (no se entrega): imita lo mínimo de GSAP que usa la ruleta.
(function(){
  const tweens = new Set();
  const st = (el) => el._g || (el._g = { x:0,y:0,scale:1,rotation:0,xPercent:0,opacity:null });
  const apply = (el) => { const s = st(el); el.style.transform = `translate(${s.xPercent}%,0) translate(${s.x}px,${s.y}px) rotate(${s.rotation}deg) scale(${s.scale})`; if (s.opacity!=null) el.style.opacity = s.opacity; };
  const list = (t) => Array.isArray(t) ? t : [t];
  const get = (el,k) => { const s = st(el); if (k==='opacity' && s.opacity==null) { const o = parseFloat(getComputedStyle(el).opacity); s.opacity = isNaN(o)?1:o; } return s[k]; };
  const KEYS = ['x','y','scale','rotation','xPercent','opacity'];
  function setProps(el, v){ const s = st(el); for (const k of KEYS) if (k in v) s[k]=v[k]; if (v.transformOrigin) el.style.transformOrigin = v.transformOrigin; apply(el); }
  function run(targets, from, to, vars){
    const els = list(targets).filter(Boolean);
    const dur = (vars.duration ?? 0.5) * 1000, delay = (vars.delay||0)*1000;
    if (vars.overwrite) els.forEach(e => api.killTweensOf(e));
    if (from) els.forEach(e => setProps(e, from));
    const t = { els, killed:false, start: performance.now()+delay };
    t.init = els.map(e => { const o = {}; for (const k of KEYS) if (k in to) o[k] = get(e,k); return o; });
    t.kill = () => { t.killed = true; tweens.delete(t); };
    tweens.add(t);
    const step = () => {
      if (t.killed) return;
      const p = Math.min(1, Math.max(0, (performance.now()-t.start)/Math.max(1,dur)));
      if (performance.now() >= t.start) {
        const e = p<.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2;
        els.forEach((el,i) => { const s = st(el); for (const k of KEYS) if (k in to) s[k] = t.init[i][k] + (to[k]-t.init[i][k])*e; apply(el); });
      }
      if (p>=1) { tweens.delete(t); vars.onComplete && vars.onComplete(); } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return t;
  }
  const api = {
    to:(t,v)=>run(t,null,v,v), fromTo:(t,f,v)=>run(t,f,v,v),
    set:(t,v)=>{ list(t).forEach(e=>setProps(e,v)); },
    delayedCall:(s,fn)=>{ const t={killed:false}; const id=setTimeout(()=>{ if(!t.killed) fn(); }, s*1000); t.kill=()=>{t.killed=true;clearTimeout(id);}; return t; },
    killTweensOf:(t)=>{ const els=list(t); [...tweens].forEach(tw=>{ if(tw.els.some(e=>els.includes(e))) tw.kill(); }); },
  };
  window.gsap = api;
})();
