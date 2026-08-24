-- 0077_added_agrupado.sql
-- El muro pliega lo añadido: "añadió 39 juegos a su biblioteca" en vez de 39
-- filas idénticas.
--
-- ── Por qué ahora ─────────────────────────────────────────────────────────
-- 0076 abrió la importación de Steam, y la primera importación de verdad
-- (24-ago-2026, 39 juegos) dejó el muro así:
--
--     Añadiste F1 2018 a tus pendientes      · hace 2 min
--     Añadiste House Party a tus pendientes  · hace 2 min
--     Añadiste Rocket League a tus pendientes · hace 2 min
--     …
--
-- No es solo ruido: `added` coge las p_limit filas más recientes POR PERSONA,
-- así que 39 juegos de golpe se comen el cupo entero de esa persona y su
-- actividad de series y cine desaparece del muro sin que nada lo diga. El mismo
-- fallo que 0058 arregló para las rachas de episodios, con la misma forma.
--
-- Y no se arregla borrando: el muro NO tiene tabla de eventos. Es una vista de
-- `ratings.created_at`, `library_entries.added_at` y `watch_events.watched_at`,
-- así que "quitar del muro" sería borrar las filas de la biblioteca — o sea,
-- perder los juegos. Al ser derivado, plegarlo aquí arregla también lo ya
-- publicado, que es la propiedad bonita de no tener tabla de eventos.
--
-- ── La forma es la de 0058, deliberadamente ───────────────────────────────
-- Dos etapas, igual que `watched`: una ventana acotada para DESCUBRIR qué
-- grupos (persona, día, lista) son recientes, y después un recuento exacto
-- sobre el día entero de los pocos que sobreviven. Contar dentro de la ventana
-- de descubrimiento diría "12 juegos" de un día de 39 en cuanto la ventana lo
-- partiera por la mitad.
--
-- ── La tercera lista: 'library' ───────────────────────────────────────────
-- Hasta hoy había dos destinos y los nombraba el medio: a la *watchlist* van
-- series y películas, a los *pendientes* los juegos (0074, domain/mediumCopy).
-- 0076 abrió un tercero y lo nombra la FILA, no el medio: un juego con
-- `library_entries.owned` no está en Pendientes — se queda fuera de ese cubo a
-- propósito, para que una importación no se coma la lista que la persona
-- elige— así que decir "lo añadió a sus pendientes" sería mentir sobre dónde
-- cayó. Va a su biblioteca, y eso es lo que dice.
--
-- Por eso la lista entra en la CLAVE del grupo: dos juegos añadidos el mismo
-- día, uno a mano y otro importado, son dos frases distintas y no una.

-- ============================================================
-- 1. Dónde cayó: una función, y en un solo sitio
-- ============================================================
-- La usan TRES sitios de este fichero —la ventana, el recuento exacto y el
-- detalle— y los tres tienen que decir lo mismo o el grupo cuenta filas que no
-- lista, o lista filas que no contó. Escrita tres veces con un `case` sería
-- una divergencia esperando a que alguien toque una sola de las copias.
--
-- `immutable` porque solo mira sus argumentos: eso deja al planificador usarla
-- dentro del `where` sin reevaluarla por fila más de lo necesario.
create or replace function public.added_list_of(p_kind text, p_owned boolean)
returns text
language sql
immutable
as $$
  select case
    -- Un juego marcado "Lo tengo" no está en Pendientes (0076): el estado
    -- 'owned' existe precisamente para sacarlo de ese cubo. Decir que se añadió
    -- a los pendientes sería mentir sobre dónde cayó.
    when p_kind = 'game' and coalesce(p_owned, false) then 'library'
    when p_kind = 'game' then 'backlog'
    else 'watchlist'
  end;
$$;

-- ============================================================
-- 2. El muro, con `added` plegado
-- ============================================================
-- `create or replace` y no drop+create: sigue devolviendo jsonb, así que las
-- dos columnas nuevas del union viajan sin cambiar ninguna firma. Un cliente
-- desplegado antes que esta migración las lee como ausentes y pinta lo de
-- siempre (ver el esquema de app/src/lib/explore.ts, que las tiene opcionales).
create or replace function public.rpc_friend_activity(p_limit int default 30)
returns jsonb
language sql
security invoker
stable
as $$
  with circle as (
    select case when f.a = (select auth.uid()) then f.b else f.a end as fid
    from public.friendships f
    where f.status = 'accepted' and (select auth.uid()) in (f.a, f.b)
    union
    select (select auth.uid())
  ),
  -- Every source takes its rows per circle member, not from one global window:
  -- one person marking a 500-episode show watched must not evict everyone else
  -- from the feed.
  rated as (
    select x.fid as fid, 'rated' as verb, x.title_id as title_id, t.tmdb_id as tmdb_id,
           t.kind as kind,
           t.name as name, t.poster_path as poster_path, x.score as score,
           null::int as season_number, null::int as episode_number,
           null::int as to_season, null::int as to_episode, 1 as ep_count,
           null::int as added_count, null::text as added_list,
           x.at as at, ('r:' || x.fid || ':' || x.title_id) as event_key
    from circle c
    cross join lateral (
      select c.fid as fid, rr.title_id as title_id, rr.score::int as score, rr.created_at as at
      from public.ratings rr
      where rr.user_id = c.fid and rr.title_id is not null
      order by rr.created_at desc
      limit p_limit
    ) x
    join public.titles t on t.id = x.title_id
  ),
  -- Etapa 1: qué grupos (persona, día, lista) son recientes. La ventana es
  -- p_limit * 8, la misma que `watched`, y por el mismo motivo: tiene que
  -- caber una ráfaga entera para que el grupo se descubra completo.
  added_window as (
    select a.fid, a.day, a.kind, a.list, max(a.at) as at
    from circle c
    cross join lateral (
      select c.fid as fid, le.added_at as at,
             (le.added_at at time zone 'Europe/Madrid')::date as day,
             t.kind as kind,
             public.added_list_of(t.kind, le.owned) as list
      from public.library_entries le
      join public.titles t on t.id = le.title_id
      where le.user_id = c.fid and le.followed
      order by le.added_at desc
      limit p_limit * 8
    ) a
    -- El MEDIO entra en la clave del grupo además de la lista, y no es
    -- redundante: los juegos ya se separan solos (van a backlog o a library),
    -- pero series y películas comparten watchlist. Sin esto, tres series y dos
    -- pelis el mismo día salen como "añadió 5 series" — y con el glifo de una
    -- sola de las dos, que la fila usa el medio del representante.
    group by a.fid, a.day, a.kind, a.list
    order by max(a.at) desc
    limit p_limit
  ),
  -- Etapa 2: el recuento exacto sobre el día entero, y el título que
  -- representa al grupo. El representante es el MÁS RECIENTE del día, que es
  -- el que la fila sin plegar habría enseñado: con uno solo, la fila queda
  -- idéntica a la de antes de esta migración.
  added as (
    select g.fid, 'added', f.title_id, f.tmdb_id,
           g.kind,
           f.name, f.poster_path, null::int,
           null::int, null::int, null::int, null::int, 1,
           f.n, g.list,
           g.at,
           /* ── La clave, y por qué NO lleva la lista dentro ────────────────
              `activity_reactions` (0058) no se traga cualquier texto: su CHECK
              exige '<verbo>:<uuid>:<uuid>[:fecha]', un trigger saca de ahí el
              actor y el TÍTULO —los dos not null, los dos con clave ajena— y la
              RLS pregunta por la fila que la clave nombra. Una clave como
              'a:<uuid>:library:<fecha>' revienta ese CHECK, así que reaccionar
              a una fila plegada habría sido un error de la base en la cara de
              quien pulsa el emoji.

              Así que el hueco de en medio lo ocupa el TÍTULO REPRESENTANTE, que
              es lo que la clave siempre ha llevado ahí, y la lista se deduce de
              él cuando hace falta (rpc_added_batch). Sigue siendo única: dos
              grupos del mismo día tienen representantes distintos.

              Y el sufijo de fecha SOLO cuando hay grupo. Con n = 1 la clave
              queda byte a byte la de antes de esta migración, así que las
              reacciones que ya existen sobre filas de "añadió" siguen
              apuntando a su fila en vez de quedarse huérfanas. */
           ('a:' || g.fid || ':' || f.title_id ||
            case when f.n > 1 then ':' || to_char(g.day, 'YYYY-MM-DD') else '' end)
    from added_window g
    cross join lateral (
      select count(*)::int as n,
             (array_agg(le2.title_id  order by le2.added_at desc))[1] as title_id,
             (array_agg(t2.tmdb_id    order by le2.added_at desc))[1] as tmdb_id,
             (array_agg(t2.name       order by le2.added_at desc))[1] as name,
             (array_agg(t2.poster_path order by le2.added_at desc))[1] as poster_path
      from public.library_entries le2
      join public.titles t2 on t2.id = le2.title_id
      where le2.user_id = g.fid and le2.followed
        and le2.added_at >= (g.day::timestamp at time zone 'Europe/Madrid')
        and le2.added_at <  ((g.day + 1)::timestamp at time zone 'Europe/Madrid')
        and t2.kind = g.kind
        and public.added_list_of(t2.kind, le2.owned) = g.list
    ) f
  ),
  -- Two stages for the bursts: a bounded window to DISCOVER which (person,
  -- show, day) rows are recent…
  watched_window as (
    select w.fid, w.title_id, w.day, max(w.watched_at) as at
    from circle c
    cross join lateral (
      select c.fid as fid, e.title_id as title_id, wv.watched_at as watched_at,
             (wv.watched_at at time zone 'Europe/Madrid')::date as day
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id and e.season_number > 0
      where wv.user_id = c.fid
      order by wv.watched_at desc
      limit p_limit * 8
    ) w
    group by w.fid, w.title_id, w.day
    order by max(w.watched_at) desc
    limit p_limit
  ),
  -- …then an exact count over the WHOLE day for the few rows that survive.
  -- Counting inside the discovery window instead would report "E7–E12 · 6" for
  -- a twelve-episode day whenever the window happened to cut it in half.
  watched as (
    select g.fid, 'watched', g.title_id, t.tmdb_id,
           t.kind,
           t.name, t.poster_path, null::int,
           f.from_season, f.from_episode, f.to_season, f.to_episode, f.ep_count,
           null::int, null::text,
           g.at, ('w:' || g.fid || ':' || g.title_id || ':' || to_char(g.day, 'YYYY-MM-DD'))
    from watched_window g
    join public.titles t on t.id = g.title_id
    cross join lateral (
      select (array_agg(e.season_number  order by e.season_number, e.episode_number))[1] as from_season,
             (array_agg(e.episode_number order by e.season_number, e.episode_number))[1] as from_episode,
             (array_agg(e.season_number  order by e.season_number desc, e.episode_number desc))[1] as to_season,
             (array_agg(e.episode_number order by e.season_number desc, e.episode_number desc))[1] as to_episode,
             count(*)::int as ep_count
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id and e.season_number > 0
      where wv.user_id = g.fid
        and e.title_id = g.title_id
        and wv.watched_at >= (g.day::timestamp at time zone 'Europe/Madrid')
        and wv.watched_at <  ((g.day + 1)::timestamp at time zone 'Europe/Madrid')
    ) f
  ),
  unioned as (
    select * from rated
    union all select * from added
    union all select * from watched
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc), '[]'::jsonb)
  from (
    select p.id as friend_id, p.display_name as friend_name, p.avatar_url as friend_avatar,
           u.verb, u.tmdb_id, u.kind, u.title_id, u.name as title_name, u.poster_path, u.score,
           u.season_number, u.episode_number, u.to_season, u.to_episode, u.ep_count,
           u.added_count, u.added_list,
           u.at, u.event_key
    from unioned u
    join public.profiles p on p.id = u.fid
    order by u.at desc
    limit p_limit
  ) x;
$$;
grant execute on function public.rpc_friend_activity(int) to authenticated;

-- ============================================================
-- 3. El detalle: qué juegos son esos 39
-- ============================================================
-- Se pide al desplegar la fila y no viaja en el muro. Un muro de treinta filas
-- con la lista completa de cada grupo dentro puede ser un payload de miles de
-- títulos para enseñar tres frases; y el caso normal es que nadie despliegue
-- ninguna.
--
-- Recibe la CLAVE DEL EVENTO y no (persona, día, lista) sueltos, porque la
-- clave ya es el identificador de esa fila en todo lo demás — es lo que 0058
-- usa como destino de las reacciones — y partirla en tres parámetros sería
-- inventar una segunda forma de nombrar lo mismo.
--
-- La clave es 'a:<persona>:<título representante>:<día>'. La LISTA no viaja en
-- ella (el CHECK de activity_reactions solo admite uuids en ese hueco, ver
-- arriba), así que se deduce de la fila del representante: está dentro del
-- grupo, luego su lista ES la del grupo.
--
-- `security invoker`: la RLS de `library_entries` ya decide quién puede leer
-- las filas de quién (0015, "library_entries: friends read"). Con `definer`
-- habría que reimplementar aquí el círculo de amistades, que es exactamente la
-- clase de copia que un día dice algo distinto de la política.
create or replace function public.rpc_added_batch(p_event_key text)
returns jsonb
language sql
security invoker
stable
as $$
  with parts as (
    -- Comparación de texto y casts solo cuando la forma casa, por lo mismo que
    -- activity_event_exists lo hace así: una clave malformada tiene que
    -- devolver vacío, no reventar con un error de cast.
    select split_part(p_event_key, ':', 2) as fid,
           split_part(p_event_key, ':', 3) as rep,
           split_part(p_event_key, ':', 4) as day
    where p_event_key ~ '^a:[0-9a-f-]{36}:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}$'
  ),
  -- El grupo que nombra esa clave, deducido del representante. Si quien pregunta
  -- no puede ver esa fila —la RLS de library_entries—, aquí no sale nada y el
  -- detalle entero queda vacío, que es lo correcto.
  grp as (
    select pa.fid::uuid as fid, pa.day::date as day, t.kind as kind,
           public.added_list_of(t.kind, le.owned) as list
    from parts pa
    join public.library_entries le
      on le.user_id = pa.fid::uuid and le.title_id = pa.rep::uuid and le.followed
    join public.titles t on t.id = le.title_id
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.added_at desc), '[]'::jsonb)
  from grp,
  lateral (
    select t.tmdb_id, t.kind, t.name, t.poster_path, le.added_at
    from public.library_entries le
    join public.titles t on t.id = le.title_id
    where le.user_id = grp.fid
      and le.followed
      and le.added_at >= (grp.day::timestamp at time zone 'Europe/Madrid')
      and le.added_at <  ((grp.day + 1)::timestamp at time zone 'Europe/Madrid')
      and t.kind = grp.kind
      and public.added_list_of(t.kind, le.owned) = grp.list
    -- Tope de cortesía: una importación de mil juegos no puede convertir un
    -- clic en un payload de un mega. Con este número la lista desplegada ya no
    -- se lee, y el cliente dice cuántos se quedaron fuera.
    limit 200
  ) r;
$$;
grant execute on function public.rpc_added_batch(text) to authenticated;
