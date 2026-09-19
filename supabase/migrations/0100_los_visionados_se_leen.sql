-- 0100_los_visionados_se_leen.sql
-- `watched_count` y `last_watched_at` del rollup pasan de CALCULARSE en cada
-- lectura a LEERSE de dos columnas de `library_entries` que mantienen unos
-- disparadores sobre `watch_events` y `episodes`.
--
-- ── Qué había ──────────────────────────────────────────────────────────────
-- Desde 0098 el rollup calcula dos agregados `materialized` por llamada: `eps`
-- (episodios) y `seen` (tus visionados ⨝ episodios, por título). Con la
-- biblioteca de producción —2.109 títulos, ~45.000 episodios, ~34.000
-- visionados de la importación de TV Time— `seen` recorre los 34.000 en CADA
-- apertura de la biblioteca para producir un número que solo cambia cuando
-- marcas o desmarcas un episodio. Es lo mismo que ya se hizo con los emitidos
-- (`titles.aired_count`, 0028): se sella al escribir y se lee al pedir.
--
-- ── Las reglas, que son las del `seen` de 0099 y no otras ──────────────────
--   · cuenta los episodios con `season_number > 0` — los especiales no suman;
--   · es por (user_id del visionado, title_id DEL EPISODIO);
--   · `last_watched_at` es el max(watched_at) de esos mismos visionados, y null
--     si no hay ninguno.
-- La comprobación del final de este fichero compara las columnas contra ese
-- agregado calculado de cero y ABORTA la migración si difieren en una fila.
--
-- ── Los casos que había que decidir, y lo decidido ────────────────────────
-- 1. VISIONADO DE UN TÍTULO QUE NO ESTÁ EN TU BIBLIOTECA. Pasa siempre, no es
--    un borde: `useMarkWatched` (app/src/lib/watch.ts) inserta el visionado y
--    DESPUÉS hace el upsert del seguimiento. El disparador de visionados no
--    encuentra fila y no hace nada — no crea filas de biblioteca, que es
--    decisión del cliente (un título "stopped" no se resucita). Lo que lo
--    arregla es el otro lado: `library_watch_counts_guard` recalcula las dos
--    columnas desde `watch_events` en CADA insert en `library_entries`. Seguir
--    después de ver sale bien contado desde el primer momento, sin backfill
--    perezoso ni nada que se pueda quedar a medias.
--
-- 2. BORRADOS EN CASCADA. Un episodio borrado arrastra sus visionados
--    (`watch_events.episode_id … on delete cascade`). Hoy ningún código borra
--    episodios —el refresco hace upsert por (title_id, season_number,
--    episode_number)— pero el esquema lo permite y el contador tiene que
--    bajar. El problema: cuando el disparador de `watch_events` corre en esa
--    cascada, el episodio YA no existe y no hay de dónde sacar su title_id. Por
--    eso el recuento de ese caso lo hace un disparador en `episodes` (AFTER
--    DELETE por sentencia), que sí tiene el title_id en su tabla de transición
--    y corre DESPUÉS de la cascada — las acciones de clave foránea son
--    disparadores de fila y los de sentencia van detrás. Recalcula todas las
--    filas de biblioteca de esos títulos, de todos los usuarios.
--    Borrar un TÍTULO no necesita nada: se lleva también sus library_entries.
--    Y un episodio que cambie de título o de temporada (hoy nadie lo hace)
--    tiene su disparador de fila con WHEN, que no cuesta nada mientras no pase.
--
-- 3. INSERCIONES MASIVAS. Disparadores POR SENTENCIA con tablas de transición:
--    la importación de TV Time hace un upsert por serie (cientos de filas por
--    sentencia) y `rpc_mark_series` marca una temporada entera de una vez. Un
--    disparador por fila haría un UPDATE de library_entries por visionado; este
--    hace uno por sentencia, agrupado por (usuario, título). Medido en el
--    informe de la PR: 34.000 visionados en una sola sentencia.
--
-- 4. BORRAR EL VISIONADO MÁS RECIENTE. El insert suma (count + n, greatest del
--    max), que es exacto porque (user_id, episode_id) es único. El borrado y la
--    actualización NO restan: RECALCULAN el par entero desde `watch_events`,
--    que es la única forma de que `last_watched_at` vuelva al anterior en vez
--    de quedarse apuntando a un visionado que ya no existe.
--
-- 5. EL UPSERT DE LA IMPORTACIÓN no lleva `ignoreDuplicates`: al repetirla es
--    un ON CONFLICT DO UPDATE que reescribe `watched_at`. Eso dispara el de
--    UPDATE, que recalcula. Por eso existe aunque el cliente nunca actualice.
--
-- ── Concurrencia ──────────────────────────────────────────────────────────
-- El recálculo BLOQUEA las filas de biblioteca (FOR UPDATE, en orden estable)
-- en una sentencia y cuenta en la SIGUIENTE, que en READ COMMITTED lleva
-- instantánea nueva: si otro visionado del mismo par se ha confirmado mientras
-- esperaba el bloqueo, entra en la cuenta. Contado en una sola sentencia, el
-- UPDATE esperaría el bloqueo y escribiría una cuenta sacada de la instantánea
-- vieja. El insert suma sobre la versión bloqueada de la fila, así que no
-- necesita el paso previo.
-- LO QUE QUEDA: seguir un título en la MISMA ventana de tiempo en que otra
-- transacción aún sin confirmar marca un episodio suyo. El alta cuenta sin ver
-- ese visionado y el disparador del visionado no ve la fila de biblioteca. El
-- cliente de hoy no puede producirlo —inserta y sigue en dos peticiones
-- consecutivas— y el siguiente borrado o actualización de ese título lo
-- corrige. Si alguna vez importa, la reparación es la función de recálculo.
--
-- ── RLS: que el cliente no pueda falsear su recuento ──────────────────────
-- `authenticated` tiene UPDATE sobre toda la tabla (0003) y la policy solo
-- mira el user_id. Quitarle el UPDATE de dos columnas obligaría a pasar a
-- grants por columna y a acordarse de conceder cada columna futura —el olvido
-- se vería como un 42501 en producción—. En vez de eso, `library_watch_counts
-- _guard` (BEFORE INSERT OR UPDATE, invoker a propósito para ver el rol que
-- llama):
--   · en el INSERT pisa lo que venga con el recálculo — también sirve al caso 1;
--   · en el UPDATE, si quien actualiza es `authenticated` o `anon`, deja los
--     valores viejos. Los disparadores de mantenimiento son `security definer`
--     y corren como su dueño, así que sus UPDATE pasan; `service_role` y
--     `postgres` también, que es por donde se repara a mano.
-- Si cambian user_id o title_id de la fila (la policy lo deja hacer con los
-- tuyos), las cuentas del título viejo no valen: se recalcula.
-- Las funciones definer llevan `search_path = ''` y todo cualificado.
--
-- ── Despliegue ────────────────────────────────────────────────────────────
-- A mano y antes que cualquier frontend, como todas. No hay cambio de cliente:
-- el rollup devuelve las mismas 32 columnas con los mismos valores.
-- La firma de la función NO cambia —`create or replace` conserva el grant—.
-- Toma un bloqueo SHARE ROW EXCLUSIVE sobre watch_events y episodes mientras
-- dura (el backfill son unos cientos de ms): marcar un episodio o el refresco
-- de episodios esperan ese rato en vez de colarse entre el backfill y los
-- disparadores y quedarse sin contar.
--
-- Quien toque el rollup después: `grep -n "create function public.rpc_library_rollup"
-- supabase/migrations/*.sql` y parte del número más alto; desde aquí también
-- `create or replace function public.rpc_library_rollup`.

lock table public.watch_events, public.episodes in share row exclusive mode;

-- ============================================================
-- 1. Las columnas
-- ============================================================
alter table public.library_entries
  add column if not exists watched_count int not null default 0,
  add column if not exists last_watched_at timestamptz;

comment on column public.library_entries.watched_count is
  'Visionados de episodios con season_number > 0 de este titulo por este usuario. Lo mantienen los disparadores de 0100; el cliente no puede escribirlo.';
comment on column public.library_entries.last_watched_at is
  'max(watched_at) de esos mismos visionados; null si no hay. Mantenido por 0100.';

-- ============================================================
-- 2. El recálculo de un conjunto de pares
-- ============================================================
-- Lo usan el borrado, la actualización y los cambios de episodios. Recalcula
-- de cero, que es lo único correcto cuando lo que se va es el máximo.
create or replace function public.library_watch_counts_refresh(p_users uuid[], p_titles uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Bloquear primero y contar después, en dos sentencias: ver «Concurrencia»
  -- arriba. El orden estable evita el interbloqueo entre dos recálculos.
  perform 1
  from public.library_entries le
  join (select distinct u, t from unnest(p_users, p_titles) as p(u, t)) p
    on le.user_id = p.u and le.title_id = p.t
  order by le.user_id, le.title_id
  for update of le;

  update public.library_entries le
  set watched_count = s.n,
      last_watched_at = s.last
  from (select distinct u, t from unnest(p_users, p_titles) as p(u, t)) p
  cross join lateral (
    select count(*)::int as n, max(w.watched_at) as last
    from public.episodes e
    join public.watch_events w on w.episode_id = e.id and w.user_id = p.u
    where e.title_id = p.t and e.season_number > 0
  ) s
  where le.user_id = p.u and le.title_id = p.t
    and (le.watched_count, le.last_watched_at) is distinct from (s.n, s.last);
end;
$$;
-- Solo los disparadores (y quien repare a mano como postgres). Si el cliente la
-- pudiera llamar, recalcularía los pares de otros usuarios.
revoke all on function public.library_watch_counts_refresh(uuid[], uuid[]) from public, anon, authenticated;

-- ============================================================
-- 3. Disparadores de watch_events, por sentencia
-- ============================================================
-- Un disparador con tablas de transición solo admite un evento, de ahí tres.
create or replace function public.watch_counts_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sumar es exacto: (user_id, episode_id) es único, así que cada fila de
  -- `nuevos` es un visionado que antes no estaba. Las que un ON CONFLICT DO
  -- NOTHING se salta no llegan a la tabla de transición.
  --
  -- Bloqueo previo en el MISMO orden que el recálculo: sin él, el UPDATE de
  -- abajo toma las filas en el orden del hash join, y una importación que
  -- toca veinte títulos a la vez que un desmarcado que recalcula dos de ellos
  -- puede cruzarse y acabar en interbloqueo (40P01).
  perform 1
  from public.library_entries le
  join (select distinct nw.user_id, e.title_id
        from nuevos nw join public.episodes e on e.id = nw.episode_id
        where e.season_number > 0) p
    on le.user_id = p.user_id and le.title_id = p.title_id
  order by le.user_id, le.title_id
  for update of le;

  update public.library_entries le
  set watched_count = le.watched_count + d.n,
      last_watched_at = greatest(le.last_watched_at, d.last)
  from (
    select nw.user_id, e.title_id, count(*)::int as n, max(nw.watched_at) as last
    from nuevos nw
    join public.episodes e on e.id = nw.episode_id
    where e.season_number > 0
    group by nw.user_id, e.title_id
  ) d
  where le.user_id = d.user_id and le.title_id = d.title_id;
  return null;
end;
$$;

create or replace function public.watch_counts_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare us uuid[]; ts uuid[];
begin
  -- Si el borrado viene en cascada de `episodes`, el episodio ya no está y el
  -- join no devuelve nada: ese caso lo cuenta `episode_counts_after_delete`.
  select array_agg(v.user_id), array_agg(e.title_id) into us, ts
  from (select distinct user_id, episode_id from viejos) v
  join public.episodes e on e.id = v.episode_id
  where e.season_number > 0;
  if us is not null then
    perform public.library_watch_counts_refresh(us, ts);
  end if;
  return null;
end;
$$;

create or replace function public.watch_counts_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare us uuid[]; ts uuid[];
begin
  -- Los dos lados: un visionado que cambia de episodio o de usuario resta en
  -- uno y suma en otro. Sin filtrar por temporada: si el episodio viejo era un
  -- especial y el nuevo no (o al revés), el par tiene que recalcularse igual,
  -- y recalcular un par que no ha cambiado no escribe nada (el `is distinct
  -- from` del recálculo).
  select array_agg(x.user_id), array_agg(e.title_id) into us, ts
  from (
    select o.user_id, o.episode_id from viejos o
    left join nuevos n on n.id = o.id
    where n.id is null or (n.user_id, n.episode_id, n.watched_at)
                          is distinct from (o.user_id, o.episode_id, o.watched_at)
    union
    select n.user_id, n.episode_id from nuevos n
    left join viejos o on o.id = n.id
    where o.id is null or (n.user_id, n.episode_id, n.watched_at)
                          is distinct from (o.user_id, o.episode_id, o.watched_at)
  ) x
  join public.episodes e on e.id = x.episode_id;
  if us is not null then
    perform public.library_watch_counts_refresh(us, ts);
  end if;
  return null;
end;
$$;

drop trigger if exists watch_counts_insert on public.watch_events;
create trigger watch_counts_insert
  after insert on public.watch_events
  referencing new table as nuevos
  for each statement execute function public.watch_counts_after_insert();

drop trigger if exists watch_counts_delete on public.watch_events;
create trigger watch_counts_delete
  after delete on public.watch_events
  referencing old table as viejos
  for each statement execute function public.watch_counts_after_delete();

drop trigger if exists watch_counts_update on public.watch_events;
create trigger watch_counts_update
  after update on public.watch_events
  referencing old table as viejos new table as nuevos
  for each statement execute function public.watch_counts_after_update();

-- ============================================================
-- 4. Disparadores de episodes
-- ============================================================
create or replace function public.episode_counts_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare us uuid[]; ts uuid[];
begin
  -- Todas las filas de biblioteca de los títulos tocados, de cualquier
  -- usuario: a estas alturas la cascada ya se ha llevado los visionados y el
  -- recálculo cuenta lo que queda.
  select array_agg(le.user_id), array_agg(le.title_id) into us, ts
  from public.library_entries le
  where le.title_id in (select distinct title_id from viejos);
  if us is not null then
    perform public.library_watch_counts_refresh(us, ts);
  end if;
  return null;
end;
$$;

drop trigger if exists episode_counts_delete on public.episodes;
create trigger episode_counts_delete
  after delete on public.episodes
  referencing old table as viejos
  for each statement execute function public.episode_counts_after_delete();

-- De fila y con WHEN, no de sentencia: el refresco de episodios hace upserts de
-- cientos de filas varias veces al día y ninguna cambia título ni temporada
-- (son la clave del conflicto). Con WHEN la condición se evalúa sin entrar en
-- la función; uno por sentencia pagaría la tabla de transición entera siempre.
create or replace function public.episode_counts_after_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare us uuid[]; ts uuid[];
begin
  select array_agg(le.user_id), array_agg(le.title_id) into us, ts
  from public.library_entries le
  where le.title_id in (old.title_id, new.title_id);
  if us is not null then
    perform public.library_watch_counts_refresh(us, ts);
  end if;
  return null;
end;
$$;

drop trigger if exists episode_counts_move on public.episodes;
create trigger episode_counts_move
  after update of title_id, season_number on public.episodes
  for each row
  when (old.title_id is distinct from new.title_id
        or (old.season_number > 0) is distinct from (new.season_number > 0))
  execute function public.episode_counts_after_move();

-- ============================================================
-- 5. El guardián de library_entries
-- ============================================================
-- INVOKER a propósito: tiene que ver el rol de quien escribe. Ver «RLS» arriba.
create or replace function public.library_watch_counts_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.user_id, new.title_id) is not distinct from (old.user_id, old.title_id) then
    if current_user in ('authenticated', 'anon') then
      new.watched_count := old.watched_count;
      new.last_watched_at := old.last_watched_at;
    end if;
    return new;
  end if;
  -- Alta, o la fila cambia de dueño o de título: se cuenta desde la verdad.
  -- Como invoker y con RLS, `authenticated` solo ve sus visionados — que son
  -- los únicos que puede contar, porque la policy no le deja escribir filas
  -- de biblioteca de otro.
  select count(*)::int, max(w.watched_at)
    into new.watched_count, new.last_watched_at
  from public.watch_events w
  join public.episodes e on e.id = w.episode_id
  where w.user_id = new.user_id and e.title_id = new.title_id and e.season_number > 0;
  return new;
end;
$$;

-- ============================================================
-- 6. Backfill, idempotente
-- ============================================================
-- Antes que el guardián: su regla de UPDATE no aplica a `postgres`, pero así
-- no depende de quién ejecute la migración. Pone TODAS las filas —también las
-- que no tienen visionados, a 0/null—, así que repetirlo da lo mismo.
update public.library_entries le
set watched_count = coalesce(s.n, 0),
    last_watched_at = s.last
from public.library_entries le2
left join (
  select w.user_id, e.title_id, count(*)::int as n, max(w.watched_at) as last
  from public.watch_events w
  join public.episodes e on e.id = w.episode_id
  where e.season_number > 0
  group by w.user_id, e.title_id
) s on s.user_id = le2.user_id and s.title_id = le2.title_id
where le.user_id = le2.user_id and le.title_id = le2.title_id
  and (le.watched_count, le.last_watched_at) is distinct from (coalesce(s.n, 0), s.last);

drop trigger if exists library_watch_counts_guard on public.library_entries;
create trigger library_watch_counts_guard
  before insert or update on public.library_entries
  for each row execute function public.library_watch_counts_guard();

-- Y la comprobación: guardado contra calculado, fila a fila. Una diferencia
-- aborta la migración entera —columnas, disparadores y rollup nuevo incluidos—.
do $$
declare mal bigint; ejemplo text;
begin
  select count(*), min(x.user_id::text || '/' || x.title_id::text) into mal, ejemplo
  from public.library_entries x
  left join (
    select w.user_id, e.title_id, count(*)::int as n, max(w.watched_at) as last
    from public.watch_events w
    join public.episodes e on e.id = w.episode_id
    where e.season_number > 0
    group by w.user_id, e.title_id
  ) s on s.user_id = x.user_id and s.title_id = x.title_id
  where (x.watched_count, x.last_watched_at) is distinct from (coalesce(s.n, 0), s.last);
  if mal > 0 then
    raise exception '0100: % filas de library_entries no cuadran con watch_events (p. ej. %)', mal, ejemplo;
  end if;
end $$;

-- ============================================================
-- 7. El rollup lee las columnas
-- ============================================================
-- Idéntica a la de 0099 salvo que `seen` desaparece y `watched_count` /
-- `last_watched_at` salen de `mine`. Mismas 32 columnas, mismo orden, misma
-- firma: `create or replace`, y el grant de 0099 se conserva.
--
-- `eps` SE QUEDA, y no se puede acotar a los títulos con `aired_count` null:
-- de `eps` salen también `last_aired_datetime` y `next_air_datetime`, que no
-- tienen columna sellada y se usan para todos los títulos con episodios (las
-- pelis y los juegos llevan el suyo sintético). Acotarlo cambiaría esas dos
-- columnas en cuanto un título tuviera `aired_count` sellado. Sellarlas exigiría
-- mantenerlas contra `now()` —«próxima emisión» cambia sola con el reloj—, que
-- es otro diseño y otra rama.
create or replace function public.rpc_library_rollup(p_kind text default null)
returns table (
  title_id uuid,
  tmdb_id int,
  kind text,
  name text,
  poster_path text,
  backdrop_path text,
  first_air_date date,
  tmdb_status text,
  genres text[],
  network text,
  vote_average numeric,
  favorite boolean,
  notify boolean,
  stopped boolean,
  added_at timestamptz,
  aired_count int,
  watched_count int,
  last_watched_at timestamptz,
  last_aired_datetime timestamptz,
  next_air_datetime timestamptz,
  upcoming_season_number int,
  upcoming_season_air_date date,
  play_state text,
  minutes_played int,
  played_at timestamptz,
  release_precision text,
  platforms text[],
  beat_seconds jsonb,
  owned boolean,
  minutes_source text,
  played_platform text,
  imdb_rating numeric
)
language sql
security invoker
stable
as $$
  with mine as (
    -- Tu biblioteca, una vez, y solo del medio que se pida (0099).
    -- `auth.uid()` entre paréntesis: se evalúa una vez y no por fila.
    select le.*
    from public.library_entries le
    join public.titles tk on tk.id = le.title_id
    where le.user_id = (select auth.uid()) and le.followed
      and (p_kind is null or tk.kind = p_kind)
  ),
  eps as materialized (
    -- Acotado a los títulos que sigues del medio pedido: sin ese filtro esto
    -- recorrería la tabla de episodios ENTERA, que es de todo el mundo.
    -- `materialized` no es decorativo: sin él Postgres puede meter el agregado
    -- en el bucle y ejecutarlo por fila (la lateral de antes de 0098 otra vez).
    select
      e.title_id,
      count(*) filter (where e.air_datetime <= now()) as aired,
      max(e.air_datetime) filter (where e.air_datetime <= now()) as last_aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.season_number > 0
      and e.title_id in (select m.title_id from mine m)
    group by e.title_id
  )
  select
    t.id,
    t.tmdb_id,
    t.kind,
    t.name,
    t.poster_path,
    t.backdrop_path,
    t.first_air_date,
    t.status,
    t.genres,
    t.network,
    t.vote_average,
    le.favorite,
    le.notify,
    le.stopped,
    le.added_at,
    coalesce(t.aired_count, a.aired, 0)::int,
    -- Desde 0100, sellados en library_entries. Hasta 0099 los contaba aquí el
    -- CTE `seen` sobre todos tus visionados en cada llamada.
    le.watched_count,
    le.last_watched_at,
    a.last_aired,
    a.next_air,
    t.upcoming_season_number,
    t.upcoming_season_air_date,
    le.play_state,
    le.minutes_played,
    le.played_at,
    t.release_precision,
    t.platforms,
    t.beat_seconds,
    le.owned,
    le.minutes_source,
    le.played_platform,
    t.imdb_rating
  from mine le
  join public.titles t on t.id = le.title_id
  left join eps a on a.title_id = t.id
$$;
