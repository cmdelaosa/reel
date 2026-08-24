-- 0071_games.sql
-- El tercer medio: videojuegos. Esquema y columnas; la UI llega en su rama.
--
-- Esta migración es deliberadamente pequeña, y conviene decir por qué antes de
-- leerla: casi todo lo que un medio nuevo necesitaría ya lo pagó 0067 al abrir
-- el cine. Lo que queda es un `check` más ancho, cinco columnas que TMDB no
-- tenía cómo llenar, y extender a los juegos el episodio sintético.
--
-- ── Por qué el id de IGDB viaja en `tmdb_id` ───────────────────────────────
-- TMDB no tiene juegos: la fuente es IGDB, con su propio espacio de ids. La
-- reacción natural es `tmdb_id` nullable más `source` + `external_id`, y sería
-- un error. 0067 ya hizo el trabajo duro cuando descubrió que /tv/1399 y
-- /movie/1399 son cosas distintas: la identidad de un título es la pareja
-- (kind, tmdb_id), no el número suelto. Un juego con kind='game' y el id de
-- IGDB en esa columna no puede chocar con nada, porque la clave ya separa por
-- medio.
--
-- El precio es una columna mal nombrada, y se paga a sabiendas: `tmdb_id`
-- aparece en la firma de las funciones de 28 migraciones y en todo el cliente.
-- Renombrarla a `external_id` sería reescribir cada una de esas firmas para
-- que la fila diga en voz alta lo que este comentario ya dice. Léase, a partir
-- de aquí: **el id de este título en la fuente de su medio** — TMDB para
-- 'tv' y 'movie', IGDB para 'game'.
--
-- ── El episodio sintético vale igual, y las fugas ya están tapadas ─────────
-- Un juego, como una película, no tiene episodios; y como con las películas,
-- inventar una segunda forma de "hecho" obligaría a ramificar las ~27
-- funciones que leen watch_events. Así que cada juego mantiene su S1E1, por el
-- mismo trigger de 0067 — que pasa a llamarse por lo que hace y no por el
-- medio que lo estrenó.
--
-- Ese episodio se cuela donde no debe si nadie lo filtra: en su día apareció en
-- el calendario, en los avisos por correo, en el historial, en el muro de
-- amigos y en las estadísticas, y las cinco se arreglaron con `t.kind = 'tv'`
-- — el filtro positivo, no `<> 'movie'`. Esa elección es lo que hace que los
-- juegos hereden la exclusión gratis: si alguna dijera `<> 'movie'`, hoy el
-- cron mandaría correos anunciando «S1 · E1» de un videojuego, y un correo mal
-- enviado no se retira.
--
-- Gratis en DOS de las cinco, que es donde la primera versión de esta migración
-- se quedó corta. El calendario y los avisos siguen filtrados a series; el
-- muro, el historial y las estadísticas los reabrió 0069 para meter el cine, y
-- hay que volver a cerrarlos para los juegos. Eso es la sección 9, y allí está
-- contado con qué se rompía cada uno.
--
-- ── Lo que sí es nuevo ────────────────────────────────────────────────────
-- Cinco columnas, y ninguna es un capricho:
--
--   platforms           el filtro que pide un catálogo de juegos ("solo Switch")
--   release_precision   IGDB fecha un "Q4 2027" con un timestamp concreto
--   platform_releases   un juego sale cinco veces, una por plataforma
--   beat_seconds        el denominador de las horas jugadas
--   steam_appid         para la sincronización con Steam, que va aparte
--
-- La de las fechas es la que importa. IGDB acompaña cada fecha de un formato
-- (día exacto / mes / trimestre / año / TBD) y ADEMÁS devuelve siempre un
-- timestamp: para un juego anunciado como "Q4 2027" te da un día concreto de
-- octubre. Guardar solo el timestamp es inventarse el día y jurar que es
-- oficial. `first_air_date` sigue mandando en el estado (es lo que lee el
-- episodio sintético para decidir si ya salió), y `release_precision` dice
-- cuánto de esa fecha es verdad y cuánto es relleno de la fuente.

-- ============================================================
-- 1. Un medio más
-- ============================================================
alter table public.titles drop constraint if exists titles_kind_check;
alter table public.titles add constraint titles_kind_check
  check (kind in ('tv', 'movie', 'game'));

-- ============================================================
-- 2. Plataformas
-- ============================================================
-- Nombres, no ids de IGDB: es lo mismo que hace `genres` desde 0002, y por la
-- misma razón — la columna se pinta tal cual y se filtra tal cual, y guardar
-- ids obligaría a mantener un diccionario en el cliente para enseñar la lista.
-- El proxy ya traduce id → nombre contra el endpoint /platforms.
alter table public.titles add column if not exists platforms text[] not null default '{}';

-- GIN, no B-tree: la consulta es "juegos que incluyan esta plataforma"
-- (`platforms && '{Nintendo Switch}'`), que es contención de array. Un B-tree
-- solo serviría para igualdad del array entero, que nadie pregunta.
create index if not exists titles_platforms_idx
  on public.titles using gin (platforms) where kind = 'game';

-- ============================================================
-- 3. Cuánto de la fecha es verdad
-- ============================================================
-- Los siete formatos de IGDB, copiados sin interpretar. Los trimestres van
-- como 'q1'…'q4' en vez de un 'quarter' genérico a propósito: si la columna
-- solo dijera "es un trimestre", quien pinta tendría que deducir CUÁL del mes
-- del timestamp — y ese mes es justo el dato inventado del que desconfiamos.
-- Copiar la etiqueta de la fuente deja el render sin aritmética.
--
-- Null en series y películas: allí la fecha es siempre un día real y el
-- cliente ya la trata así. No es 'day' — 'day' sería afirmar sobre TMDB algo
-- que esta migración no ha comprobado.
alter table public.titles add column if not exists release_precision text;
alter table public.titles drop constraint if exists titles_release_precision_check;
alter table public.titles add constraint titles_release_precision_check
  check (release_precision is null
         or release_precision in ('day', 'month', 'q1', 'q2', 'q3', 'q4', 'year', 'tbd'));

-- ============================================================
-- 4. Una fecha por plataforma
-- ============================================================
-- Mismo trato que `providers` (0055) y `release_dates` (0068), por la misma
-- razón y con la misma forma: son varias filas de la fuente que solo se leen
-- juntas y siempre por el título que las trae, así que una tabla aparte sería
-- un join por cada ficha para no ahorrar nada.
--
--   {"PlayStation 5": {"date": "2027-03-12", "precision": "day"},
--    "Nintendo Switch 2": {"date": "2027-10-01", "precision": "q4"}}
--
-- `first_air_date` guarda la MÁS TEMPRANA de todas ellas, que es la que
-- ordena, la que entra en el calendario y la que decide si el juego ya salió.
-- Esto es para la ficha: "en PS5 ya, en Switch en otoño".
alter table public.titles add column if not exists platform_releases jsonb;

-- ============================================================
-- 5. Cuánto se tarda en terminarlo
-- ============================================================
-- IGDB publica tres medias en SEGUNDOS (hastily / normally / completely), y se
-- guardan en segundos: convertir a horas aquí sería redondear una vez para
-- siempre en la capa que no pinta.
--
--   {"hastily": 43200, "normally": 86400, "completely": 216000}
--
-- Es el denominador de las horas jugadas — lo que convierte "18 h" en "18 de
-- 24" y en una barra de progreso. Sin esto habría que raspar HowLongToBeat,
-- que no tiene API pública. Las horas del jugador (el numerador) llegan con la
-- rama del modo; esto es solo el dato del catálogo, que es de la fuente y por
-- tanto vive aquí.
alter table public.titles add column if not exists beat_seconds jsonb;

-- ============================================================
-- 6. El puente a Steam
-- ============================================================
-- La sincronización con Steam va en su propia rama, más tarde y por decisión
-- explícita: el modo tiene que funcionar a mano primero. Pero el appid viaja
-- en el mismo payload de IGDB que todo lo demás (external_games, fuente 1 =
-- Steam), y guardarlo ahora cuesta una columna. No guardarlo obligaría a
-- recorrer el catálogo entero otra vez el día que la sincronización exista,
-- pidiéndole a IGDB lo que ya tuvimos en la mano.
--
-- Nullable y sin unique: hay juegos que no están en Steam, y hay ediciones
-- distintas que IGDB mapea al mismo appid.
alter table public.titles add column if not exists steam_appid int;
create index if not exists titles_steam_appid_idx
  on public.titles (steam_appid) where steam_appid is not null;

-- ============================================================
-- 7. El episodio sintético, ahora también para los juegos
-- ============================================================
-- Cuerpo idéntico al de `movie_episode_sync` (0067) salvo la lista de medios.
-- Cambia de nombre porque el viejo ya mentía en cuanto un juego lo disparara,
-- y un trigger que dice "movie" tocando filas kind='game' es exactamente el
-- tipo de detalle que hace perder una tarde dentro de seis meses.
--
-- El nombre y la sinopsis del "episodio" siguen a los del título; la fecha
-- también, porque un lanzamiento se mueve —los juegos se retrasan más que
-- nada— y lo que cuenta como salido tiene que moverse con él.
--
-- runtime queda null en un juego: `episode_run_time` no tiene sentido aquí y
-- lo que dura terminárselo vive en beat_seconds, que no es una propiedad del
-- episodio sino del catálogo.
create or replace function public.synthetic_episode_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind not in ('movie', 'game') then
    return new;
  end if;

  insert into public.episodes (
    title_id, season_number, episode_number, name, overview, runtime,
    air_date, air_datetime, air_time_source
  )
  values (
    new.id, 1, 1, new.name, new.overview, new.episode_run_time,
    new.first_air_date,
    case when new.first_air_date is null then null
         else (new.first_air_date::timestamp at time zone 'UTC') end,
    'estimated'
  )
  on conflict (title_id, season_number, episode_number) do update
    set name         = excluded.name,
        overview     = excluded.overview,
        runtime      = excluded.runtime,
        air_date     = excluded.air_date,
        air_datetime = excluded.air_datetime;

  return new;
end;
$$;

-- El trigger viejo primero: mientras exista, la función vieja no se puede
-- borrar, y dejar las dos puestas haría el insert dos veces por fila (inocuo
-- por el on conflict, pero es trabajo doble y una pista falsa).
drop trigger if exists movie_episode_sync on public.titles;
drop function if exists public.movie_episode_sync();

drop trigger if exists synthetic_episode_sync on public.titles;
create trigger synthetic_episode_sync
  after insert or update of name, overview, episode_run_time, first_air_date, kind
  on public.titles
  for each row
  execute function public.synthetic_episode_sync();

-- Las películas ya guardadas no pierden su episodio en el cambio de trigger
-- (la fila de episodes sigue donde estaba), pero el toque las vuelve a pasar
-- por la función nueva y confirma que hace lo mismo que la vieja.
update public.titles set kind = kind where kind in ('movie', 'game');

-- ============================================================
-- 8. Documentación en la propia tabla
-- ============================================================
-- `tmdb_id` es el que más engaña de todo el esquema a partir de hoy, así que
-- lo dice también psql y no solo este fichero.
comment on column public.titles.tmdb_id is
  'Id del título en la fuente de SU medio: TMDB para kind tv/movie, IGDB para kind game. Único solo junto a kind (ver 0067).';
comment on column public.titles.poster_path is
  'TMDB: ruta relativa (/abc.jpg) para image.tmdb.org. IGDB: el image_id del cover, que construye images.igdb.com/igdb/image/upload/t_{size}/{id}.jpg. La URL la arma el cliente según el medio.';
comment on column public.titles.vote_average is
  'Nota media 0-10. IGDB puntua sobre 100 y el proxy la divide antes de escribir, para que la misma UI valga en los tres medios.';
comment on column public.titles.release_precision is
  'Cuanto de first_air_date es real: day | month | q1..q4 | year | tbd. Solo juegos (IGDB fecha un trimestre con un timestamp concreto). Null en tv y movie.';

-- ============================================================
-- 9. Las tres superficies que el cine volvió a abrir
-- ============================================================
-- Esto no estaba en la primera versión de esta migración, y la razón por la que
-- falta merece contarse: entre que se escribió y que se fusionó, 0069 metió el
-- cine en el muro, el historial y las estadísticas — LEVANTANDO el filtro
-- `kind = 'tv'` que 0067 había puesto y del que esta migración dependía sin
-- saberlo. El razonamiento de la cabecera («los juegos quedan fuera de las cinco
-- superficies sin tocar ni una línea aquí») era cierto contra main de esa mañana
-- y dejó de serlo tres PRs después.
--
-- Lo que pasaría sin este bloque, en cuanto la rama del modo permita marcar un
-- juego:
--
--   * rpc_friend_activity — el muro publicando «Vio Silksong S1 · E1».
--   * rpc_watch_history   — el historial pintándolo como «S01 · E01».
--   * rpc_user_stats      — y la peor, porque miente con un número: los minutos
--     vistos suman `coalesce(e.runtime, t.episode_run_time, 40)`, y un juego no
--     tiene ninguno de los dos. Cada juego marcado añadiría CUARENTA MINUTOS
--     inventados al contador de tiempo de la persona.
--
-- Hoy nada de esto se puede provocar: no hay UI de juegos, así que no hay forma
-- de crear un watch_event de un juego. Se cierra igualmente, porque «hoy es
-- inalcanzable» es exactamente la clase de suposición que deja de ser verdad una
-- rama después — y porque quien escriba esa rama no tiene por qué acordarse.
--
-- ── Qué es temporal y qué no ──────────────────────────────────────────────
-- El muro y el historial se filtran por lo mismo que 0067 filtró el cine, dicho
-- en su cabecera y citado por 0069: «un filtro no miente; una etiqueta prestada,
-- sí». Las palabras del cine ya existen; las de los juegos, no — no hay glifo,
-- no hay «jugado», y S1 · E1 es una etiqueta prestada de las series. La rama del
-- modo las levantará, igual que 0069 levantó las de 0067. Ese es el ritmo.
--
-- Los MINUTOS no. Ese filtro es permanente: un juego no dura cuarenta minutos ni
-- los durará nunca, y lo que se juega se mide en horas jugadas, que es otra
-- unidad y llega con su propia columna.
--
-- `coming_soon` se queda como está, contando los tres medios: la pregunta que
-- responde es «¿cuánto tengo esperando?», y esperar un lanzamiento es lo mismo
-- se llame temporada, película o juego. Es el único sitio donde juntarlos no
-- dice nada falso, que es el argumento que la propia 0069 usa para los minutos.
--
-- Los tres cuerpos son los de 0069 copiados literalmente; lo único que cambia es
-- la condición que se señala en cada uno.

-- ── el muro ────────────────────────────────────────────────────────────────
-- El filtro va DENTRO de las tres subconsultas laterales, antes de su LIMIT, y
-- no en el select final. No es lo mismo y la diferencia se ve sola: cada fuente
-- coge las p_limit filas más recientes POR PERSONA y luego el muro se queda con
-- las p_limit mejores del total. Filtrando al final, un amigo que acabe de
-- puntuar treinta juegos aporta cero filas —sus treinta se descartan después de
-- haber ocupado su cupo— y su actividad de series desaparece del muro sin que
-- nada lo diga. Filtrando dentro, el cupo se llena con lo que sí se pinta.

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
           x.at as at, ('r:' || x.fid || ':' || x.title_id) as event_key
    from circle c
    cross join lateral (
      select c.fid as fid, rr.title_id as title_id, rr.score::int as score, rr.created_at as at
      from public.ratings rr
      join public.titles tt on tt.id = rr.title_id and tt.kind in ('tv', 'movie')
      where rr.user_id = c.fid and rr.title_id is not null
      order by rr.created_at desc
      limit p_limit
    ) x
    join public.titles t on t.id = x.title_id
  ),
  added as (
    select x.fid, 'added', x.title_id, t.tmdb_id,
           t.kind,
           t.name, t.poster_path, null::int,
           null::int, null::int, null::int, null::int, 1,
           x.at, ('a:' || x.fid || ':' || x.title_id)
    from circle c
    cross join lateral (
      select c.fid as fid, le.title_id as title_id, le.added_at as at
      from public.library_entries le
      join public.titles tt on tt.id = le.title_id and tt.kind in ('tv', 'movie')
      where le.user_id = c.fid and le.followed
      order by le.added_at desc
      limit p_limit
    ) x
    join public.titles t on t.id = x.title_id
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
      join public.titles tt on tt.id = e.title_id and tt.kind in ('tv', 'movie')
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
           u.at, u.event_key
    from unioned u
    join public.profiles p on p.id = u.fid
    order by u.at desc
    limit p_limit
  ) x;
$$;

-- ── el historial ───────────────────────────────────────────────────────────
-- Una condición más en el where. Misma firma y mismas columnas que 0069, así
-- que basta un create or replace: el drop de allí era por el `kind` que añadía.
create or replace function public.rpc_watch_history(
  p_limit int default 60,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  watch_event_id uuid,
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  kind text,
  show_name text,
  poster_path text,
  network text,
  season_number int,
  episode_number int,
  episode_name text,
  watched_at timestamptz,
  source text
)
language sql
security invoker
stable
as $$
  select
    wv.id,
    e.id,
    t.id,
    t.tmdb_id,
    t.kind,
    t.name,
    t.poster_path,
    t.network,
    e.season_number,
    e.episode_number,
    e.name,
    wv.watched_at,
    wv.source
  from public.watch_events wv
  join public.episodes e on e.id = wv.episode_id
  join public.titles t on t.id = e.title_id
  where wv.user_id = (select auth.uid())
    and t.kind in ('tv', 'movie')
    and (
      p_before is null
      or wv.watched_at < p_before
      or (wv.watched_at = p_before and wv.id < p_before_id)
    )
  order by wv.watched_at desc, wv.id desc
  limit greatest(1, least(p_limit, 200))
$$;
grant execute on function public.rpc_watch_history(int, timestamptz, uuid) to authenticated;

-- ── las estadísticas ───────────────────────────────────────────────────────
-- Solo cambia el predicado de `minutes_watched`, que pasa de "es peli o tiene
-- número de episodio" a nombrar los dos medios que miden en minutos.
drop function if exists public.rpc_user_stats();
create or replace function public.rpc_user_stats()
returns table (
  episodes_watched bigint,
  movies_watched bigint,
  minutes_watched bigint,
  shows_followed bigint,
  movies_followed bigint,
  coming_soon bigint,
  avg_rating numeric,
  friends bigint
)
language sql
security invoker
stable
as $$
  select
    (select count(*)
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid()) and e.season_number > 0 and t.kind = 'tv'),
    (select count(*)
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid()) and t.kind = 'movie'),
    -- Los minutos SÍ se suman: son minutos, y no cambian de unidad al cambiar
    -- de medio. Es la única cifra de esta función que puede juntar los dos sin
    -- decir nada falso, y separarla en dos relojes solo obligaría a sumarlos de
    -- cabeza. La duración de una película vive en episode_run_time igual que la
    -- de un episodio (0067); el 40 de respaldo solo lo tocan las series.
    (select coalesce(sum(coalesce(e.runtime, t.episode_run_time, 40)), 0)::bigint
       from public.watch_events w
       join public.episodes e on e.id = w.episode_id
       join public.titles t on t.id = e.title_id
      where w.user_id = (select auth.uid())
        and (t.kind = 'movie' or (t.kind = 'tv' and e.season_number > 0))),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'tv'),
    (select count(*)
       from public.library_entries le
       join public.titles t on t.id = le.title_id
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped and t.kind = 'movie'),
    -- "Por estrenar" junta los dos a propósito: la pregunta es "¿cuánto tengo
    -- esperando?", y esperar un estreno es lo mismo se llame temporada o
    -- película. La condición es la misma para ambos porque el episodio
    -- sintético la cumple igual: nada emitido todavía.
    (select count(*)
       from public.library_entries le
      where le.user_id = (select auth.uid()) and le.followed and not le.stopped
        and not exists (
          select 1 from public.episodes e
          where e.title_id = le.title_id
            and e.season_number > 0
            and e.air_datetime <= now())),
    (select round(avg(r.score)::numeric, 1)
       from public.ratings r
      where r.user_id = (select auth.uid())),
    (select count(*)
       from public.friendships f
      where f.status = 'accepted'
        and (select auth.uid()) in (f.a, f.b))
$$;
grant execute on function public.rpc_user_stats() to authenticated;
