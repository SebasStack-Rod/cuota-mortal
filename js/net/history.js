// js/net/history.js: guarda en Supabase el historial de la partida (tablas runs y events) en lotes, sin bloquear el juego.
// Exporta createHistory(supabase, roomCode). Si la base falla, la partida sigue y se reintenta en el próximo lote.
// DECISIÓN: si el anfitrión cierra la pestaña de golpe, la partida queda con result en null (no se puede avisar a tiempo).

const EVERY_MS = 5000;     // cada cuánto se manda un lote
const BATCH = 200;         // filas por envío
const MAX_QUEUE = 5000;    // tope de filas esperando (si la base está caída mucho tiempo se descartan las más viejas)

export function createHistory(supabase, roomCode) {
  const runs = new Map();  // runId -> { id, startedAt, saved, end, endSaved }
  let queue = [];          // filas de events esperando
  let busy = false, again = false;
  const timer = setInterval(flush, EVERY_MS);

  function onLog(row) {
    queue.push(row);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  }

  function onRun(msg) {
    if (msg.type === 'start') {
      runs.set(msg.runId, { id: msg.runId, startedAt: msg.startedAt, saved: false, end: null, endSaved: false });
    } else if (msg.type === 'end') {
      const r = runs.get(msg.runId);
      if (r) r.end = msg;
    }
    flush();
  }

  // Un error de integridad (código 23xxx) es de la fila misma y no se arregla reintentando: se descarta esa fila.
  async function sendRows(rows) {
    const { error } = await supabase.from('events').insert(rows);
    if (!error) return true;
    if (/^23/.test(error.code || '')) {
      if (rows.length === 1) { console.warn('[history] fila descartada:', error.message, rows[0]); return true; }
      for (const row of rows) await sendRows([row]);
      return true;
    }
    console.warn('[history] no pude guardar eventos, reintento luego:', error.message);
    return false;
  }

  async function step() {
    for (const r of runs.values()) {
      if (r.saved) continue;
      const { error } = await supabase.from('runs').insert({ id: r.id, room_code: roomCode, started_at: r.startedAt });
      if (error) { console.warn('[history] no pude guardar la partida, reintento luego:', error.message); return; }
      r.saved = true;
    }
    while (queue.length) {
      const lote = queue.filter(e => runs.get(e.runId) && runs.get(e.runId).saved).slice(0, BATCH);
      if (!lote.length) break;
      const filas = lote.map(({ runId, ...resto }) => ({ run_id: runId, ...resto }));
      if (!(await sendRows(filas))) return;
      queue = queue.filter(e => !lote.includes(e));
    }
    for (const [id, r] of runs) {
      if (r.end && !r.endSaved) {
        const { error } = await supabase.from('runs').update({
          ended_at: r.end.endedAt, result: r.end.result, days_survived: r.end.daysSurvived, final_bank: r.end.finalBank,
        }).eq('id', id);
        if (error) { console.warn('[history] no pude cerrar la partida, reintento luego:', error.message); return; }
        r.endSaved = true;
      }
      if (r.endSaved && !queue.some(e => e.runId === id)) runs.delete(id);
    }
  }

  async function flush() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      do { again = false; await step(); } while (again);
    } catch (e) {
      console.warn('[history] error inesperado:', e);
    } finally {
      busy = false;
    }
  }

  async function close() {
    clearInterval(timer);
    await flush();
  }

  return { onLog, onRun, flush, close };
}
