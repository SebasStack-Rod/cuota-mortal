-- sql/schema.sql: tablas, vista de rankings y reglas de seguridad de "Cuota Mortal".
-- Se pega ENTERO en el SQL Editor de Supabase y se ejecuta con "Run".
-- Se puede ejecutar más de una vez sin romper nada (usa "if not exists" y "drop policy if exists").
--
-- SEGURIDAD: esto es un juego entre amigos con dinero ficticio. El anfitrión es de confianza
-- y cualquiera con la clave pública podría escribir datos falsos en estas tablas.
-- Esta seguridad NO está pensada para dinero real. Lo único que se impide es BORRAR
-- y modificar datos que no sean el cierre de una partida.
--
-- CONVENCIONES (las respeta js/core/host.js):
--   * Todos los montos están en CENTAVOS y son siempre positivos (100 = $1).
--   * kind 'bet'    : apuesta (sale del banco). amount = monto apostado.
--   * kind 'payout' : cobro de una apuesta liquidada (entra al banco, incluye la apuesta devuelta).
--                     detail debe traer {"stake": <centavos apostados>} para calcular la mayor ganancia.
--   * kind 'refund' : apuesta devuelta sin resolver al cerrar el día. Solo queda en el historial
--                     y NO cuenta en el neto (su apuesta nunca se registró como 'bet').
--   * kind 'quota'  : cuota cobrada por el Prestamista. 'shop': compra en la tienda.
--   * Por cada bet_result el anfitrión escribe un 'bet' y, si payout > 0, un 'payout'.

-- ============================================================
-- TABLAS
-- ============================================================

-- Una fila por sala creada. El código es la clave primaria, así que no puede repetirse.
-- DECISIÓN: los clientes no pueden actualizar rooms (solo runs), así que status queda en 'open'.
-- El resultado real de cada partida vive en la tabla runs.
create table if not exists public.rooms (
  code        text primary key check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$'),
  created_at  timestamptz not null default now(),
  host_name   text not null,
  status      text not null default 'open' check (status in ('open', 'closed'))
);

-- Una fila por partida. result es null mientras la partida sigue en juego.
create table if not exists public.runs (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null references public.rooms (code),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  result        text check (result in ('victory', 'gameover', 'abandoned')),
  days_survived integer not null default 0 check (days_survived between 0 and 7),
  final_bank    bigint
);

-- Historial de movimientos de dinero de cada partida.
-- DECISIÓN: player_name y game pueden ser null (la cuota y la tienda no tienen jugador ni juego).
create table if not exists public.events (
  id           bigint generated always as identity primary key,
  run_id       uuid not null references public.runs (id),
  ts           timestamptz not null default now(),
  day          integer not null check (day between 1 and 7),
  player_name  text,
  game         text,
  kind         text not null check (kind in ('bet', 'payout', 'refund', 'quota', 'shop')),
  amount       bigint not null check (amount >= 0),
  detail       jsonb not null default '{}'::jsonb
);

-- ============================================================
-- ÍNDICES
-- ============================================================
create index if not exists runs_room_code_idx   on public.runs (room_code);
create index if not exists runs_best_idx        on public.runs (days_survived desc, final_bank desc);
create index if not exists events_run_idx       on public.events (run_id, ts);
create index if not exists events_player_idx    on public.events (player_name);

-- ============================================================
-- VISTA DE RANKINGS (la usa session.fetchRankings())
-- ============================================================
-- security_invoker hace que la vista respete las reglas de seguridad de events.
create or replace view public.rankings_players
with (security_invoker = true) as
select
  player_name,
  coalesce(sum(amount) filter (where kind = 'bet'), 0)    as total_bet,
  coalesce(sum(amount) filter (where kind = 'payout'), 0) as total_won,
  coalesce(sum(amount) filter (where kind = 'payout'), 0)
    - coalesce(sum(amount) filter (where kind = 'bet'), 0) as net_total,
  coalesce(max(amount - coalesce((detail ->> 'stake')::bigint, 0))
    filter (where kind = 'payout'), 0)                      as best_win,
  count(distinct run_id)                                    as runs_played
from public.events
where player_name is not null
group by player_name;

-- ============================================================
-- SEGURIDAD (Row Level Security)
-- ============================================================
alter table public.rooms  enable row level security;
alter table public.runs   enable row level security;
alter table public.events enable row level security;

-- rooms: leer e insertar. Sin update ni delete.
drop policy if exists rooms_select on public.rooms;
drop policy if exists rooms_insert on public.rooms;
create policy rooms_select on public.rooms for select to anon using (true);
create policy rooms_insert on public.rooms for insert to anon with check (true);

-- runs: leer, insertar y actualizar (para cerrar la partida). Sin delete.
drop policy if exists runs_select on public.runs;
drop policy if exists runs_insert on public.runs;
drop policy if exists runs_update on public.runs;
create policy runs_select on public.runs for select to anon using (true);
create policy runs_insert on public.runs for insert to anon with check (true);
create policy runs_update on public.runs for update to anon using (true) with check (true);

-- events: leer e insertar. Sin update ni delete.
drop policy if exists events_select on public.events;
drop policy if exists events_insert on public.events;
create policy events_select on public.events for select to anon using (true);
create policy events_insert on public.events for insert to anon with check (true);

-- ============================================================
-- PERMISOS (además de las políticas, el rol anónimo necesita permiso sobre cada tabla)
-- ============================================================
grant usage on schema public to anon;
grant select, insert on public.rooms  to anon;
grant select, insert on public.runs   to anon;
grant update (ended_at, result, days_survived, final_bank) on public.runs to anon;
grant select, insert on public.events to anon;
grant select on public.rankings_players to anon;
grant usage, select on all sequences in schema public to anon;
