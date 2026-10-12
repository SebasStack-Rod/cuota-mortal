// js/core/items.js: tienda con votación y efectos de los 5 objetos. Exporta createItems.
// Trabaja sobre el estado de la sala que le pasa host.js (state.inventory, state.effects, state.vote, state.bank).
// FASE 4. Los objetos se compran solo en la fase 'shop', por votación, y el precio sale del banco común.
import { CONFIG } from '../config.js';
import { fmt } from './money.js';

// DECISIÓN: los números de cada objeto viven acá (el contrato de config solo define precio y nombre).
const SEGURO_FRACCION = 0.5;    // seguro: el banco recupera el 50% de la primera pérdida del día
const RELOJ_MS = 60000;         // reloj: +60 s al próximo día
const TREBOL_MULT = 1.1;        // trébol: +10% de ganancia en la ruleta durante el próximo día
const SOBORNO_DESCUENTO = 0.15; // soborno: la próxima cuota baja 15%

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });

// log(kind, datos): anota en el historial. toast({kind, text}): avisa a todos los celulares.
export function createItems({ state, now, log, toast }) {
  let voteCount = 0;
  let lossSeen = false;   // ya hubo una pérdida en el día actual (para el seguro)

  const connectedIds = () => Object.values(state.players).filter(p => p.connected).map(p => p.id);
  const alive = (id) => !!state.players[id];

  // La votación se cierra antes de tiempo si más de la mitad de los conectados votó "sí",
  // o si todos los conectados ya votaron (DECISIÓN: este segundo caso no está en el contrato, evita esperas inútiles).
  function shouldClose(v) {
    const conn = connectedIds();
    if (!conn.length) return false;
    const yesConn = v.yes.filter(id => conn.includes(id)).length;
    if (yesConn > conn.length / 2) return true;
    return conn.every(id => v.yes.includes(id) || v.no.includes(id));
  }

  // Aprobada si hay más "sí" que "no" (el empate rechaza) y el banco alcanza. Se cobra del banco.
  function resolve() {
    const v = state.vote;
    if (!v) return;
    const item = CONFIG.items[v.itemId];
    const yes = v.yes.filter(alive).length;
    const no = v.no.filter(alive).length;
    state.vote = null;
    if (yes <= no) { toast({ kind: 'info', text: `Se rechazó la compra: ${item.label}.` }); return; }
    if (state.bank < v.price) { toast({ kind: 'warn', text: `No alcanza el banco para ${item.label}.` }); return; }
    state.bank -= v.price;
    state.inventory[v.itemId] += 1;
    log('shop', { player: state.players[v.proposedBy] || null, amount: v.price, detail: { item: v.itemId } });
    toast({ kind: 'info', text: `Compraron ${item.label} por ${fmt(v.price)}.` });
  }

  // Cualquier jugador puede proponer. Quien propone vota "sí" automáticamente.
  // DECISIÓN: no se puede proponer un objeto que ya tenés sin usar (máximo uno de cada uno).
  function propose(from, itemId) {
    if (state.phase !== 'shop') return fail('no_es_momento');
    if (!alive(from)) return fail('no_en_sala');
    const item = CONFIG.items[itemId];
    if (!item) return fail('objeto_inexistente');
    if (state.vote) return fail('votacion_abierta');
    if (state.inventory[itemId] > 0) return fail('ya_lo_tenes');
    if (item.price > state.bank) return fail('sin_fondos');
    state.vote = { id: 'v' + (++voteCount), itemId, price: item.price, proposedBy: from, yes: [from], no: [], endsAt: now() + CONFIG.voteMs };
    if (shouldClose(state.vote)) resolve();   // con un solo jugador conectado se aprueba al instante
    return ok();
  }

  // Un voto por jugador, sin cambiarlo.
  function vote(from, voteId, yes) {
    const v = state.vote;
    if (!v || v.id !== voteId) return fail('sin_votacion');
    if (!alive(from)) return fail('no_en_sala');
    if (v.yes.includes(from) || v.no.includes(from)) return fail('ya_voto');
    (yes ? v.yes : v.no).push(from);
    if (shouldClose(v)) resolve();
    return ok();
  }

  // Se llama en cada tick de la tienda: cierra la votación si venció el tiempo o cambió la gente conectada.
  function tick(t) {
    const v = state.vote;
    if (v && (t >= v.endsAt || shouldClose(v))) resolve();
  }

  // Al terminar la tienda, una votación abierta se resuelve con los votos que tenga.
  function closeShop() { if (state.vote) resolve(); }

  // Al empezar un día los objetos del inventario pasan a ser efectos de ese día (reloj, trébol, soborno).
  // Devuelve cuánto se alarga el día y por cuánto se multiplica la cuota.
  function onDayStart() {
    lossSeen = false;
    state.effects = [];
    const inv = state.inventory;
    let extraMs = 0, quotaMult = 1;
    if (inv.reloj > 0) {
      extraMs = RELOJ_MS * inv.reloj; inv.reloj = 0;
      state.effects.push({ id: 'reloj', label: 'Reloj robado (+60 s)', expires: 'dayEnd' });
    }
    if (inv.trebol > 0) {
      inv.trebol = 0;
      state.effects.push({ id: 'trebol', label: 'Trébol (+10% ruleta)', expires: 'dayEnd' });
    }
    if (inv.soborno > 0) {
      quotaMult = 1 - SOBORNO_DESCUENTO; inv.soborno = 0;
      state.effects.push({ id: 'soborno', label: 'Soborno (-15% cuota)', expires: 'dayEnd' });
    }
    return { extraMs, quotaMult };
  }

  function onDayEnd() { state.effects = []; }

  // Modificadores que ve cada juego en ctx.modifiers.
  function modifiersFor(gameId) {
    const trebol = state.effects.some(e => e.id === 'trebol');
    return {
      payoutMult: gameId === 'roulette' && trebol ? TREBOL_MULT : 1,   // multiplica solo la ganancia
      rerolls: gameId === 'dice' ? state.inventory.dados : 0,          // dados cargados: repeticiones disponibles
    };
  }

  // Seguro: en la primera pérdida del día (payout < stake) el banco recupera el 50% y el objeto se gasta.
  function onBetResult(player, stake, payout, ref) {
    if (payout >= stake || lossSeen) return;
    lossSeen = true;
    if (state.inventory.seguro <= 0) return;
    state.inventory.seguro -= 1;
    const back = Math.floor((stake - payout) * SEGURO_FRACCION);
    state.bank += back;
    log('refund', { player, amount: back, detail: { item: 'seguro', ref } });
    toast({ kind: 'info', text: `Seguro de deuda: el banco recupera ${fmt(back)}.` });
  }

  // Dados cargados: el juego 'dice' avisa con el evento reroll_used cuando se usó la repetición.
  function onGameEvent(gameId, name) {
    if (gameId === 'dice' && name === 'reroll_used' && state.inventory.dados > 0) state.inventory.dados -= 1;
  }

  // Nueva partida o revancha: inventario, efectos y votación en cero.
  function reset() {
    for (const id of Object.keys(state.inventory)) state.inventory[id] = 0;
    state.effects = [];
    state.vote = null;
    lossSeen = false;
  }

  return { propose, vote, tick, closeShop, onDayStart, onDayEnd, modifiersFor, onBetResult, onGameEvent, reset };
}
