-- 0102_las_resenas_de_steam_en_la_biblioteca.sql
-- `steam_reviews` viaja en el rollup de la biblioteca.
--
-- POR QUÉ. La carátula de un juego enseña desde ahora el porcentaje de reseñas
-- de Steam, y Tus juegos ofrece ordenar por él. Explorar ya podía: lee filas de
-- `titles` enteras, donde la columna existe desde 0086. La biblioteca no:
-- lee `rpc_library_rollup`, que devuelve una selección de columnas y nunca
-- incluyó esta — o sea que el mismo juego habría salido con su 96 % en
-- Explorar y mudo en Tus juegos, a dos pantallas de distancia. Es exactamente
-- lo que pasó con `imdb_rating` y lo que arregló 0080.
--
-- Viaja ENTERA, `{percent, count}`, y no solo el porcentaje: el número de
-- reseñas es lo que desempata el orden (entre dos juegos al 100 %, primero el
-- de ocho mil y luego el de tres) y lo que decide la etiqueta que el cliente
-- pone en el title de la insignia — un 97 % de treinta personas es "Positivas"
-- y el mismo 97 % de ochocientas mil es "Extremadamente positivas". Con solo
-- el porcentaje, las dos cosas se calcularían mal. Son dos enteros por fila.
--
-- La etiqueta NO se guarda ni viaja: la pone el cliente en el idioma de quien
-- mira (app/src/domain/steamReviews.ts). Y `metacritic` tampoco viaja: la
-- carátula no lo enseña —no caben tres números— y la ficha, que sí lo pone, no
-- lee el rollup sino la fila completa de igdb-proxy.
--
-- Sirve para los tres medios aunque solo lo llenen los juegos: en series y
-- películas la columna es null y quien pinta ya decide. Es una columna JSONB
-- nula en el 80 % de las filas de una biblioteca, que es lo que cuesta.
--
-- LA COLUMNA VA AL FINAL de la lista de retorno, como la de 0080 y por lo
-- mismo: el cliente valida por nombre (libraryRowSchema) y el resto de
-- consumidores nombran sus columnas, pero un `select *` posicional sobre una
-- función que devuelve tabla sí notaría un cambio de orden en medio.
--
-- Y HAY QUE HACER `drop function`, aunque los argumentos no cambien. Añadir una
-- columna al `returns table` cambia el TIPO DE RETORNO —son parámetros OUT— y
-- `create or replace` no puede con eso; contra la base local contestó
--
--     ERROR: cannot change return type of existing function
--     DETAIL: Row type defined by OUT parameters is different.
--
-- El drop se lleva la ACL entera, así que el `grant execute` a `authenticated`
-- va otra vez al final: sin él la biblioteca queda vacía para todo el mundo con
-- un 42501 que el cliente enseña como "no se pudo cargar" (es lo mismo que
-- documenta 0099, y lo que vigila el §ACL de la matriz).
--
-- Entre el drop y el create no hay nadie que pueda leer la biblioteca, así que
-- los dos van dentro de una transacción escrita: `db push` contra producción
-- manda el fichero SIN abrir una (lo aprendió 0100), y sin `begin` un fallo a
-- media migración dejaría la función borrada y la app muerta hasta arreglarlo
-- a mano.
--
-- El §0 de supabase/sql-checks/0098_rollup_sin_laterales.sql —la lista de
-- columnas del contrato— se actualiza en el mismo cambio, y es lo que impide
-- que la siguiente migración parta de una definición atrasada y la pierda.
--
-- Definición copiada de 0100, que era la del número más alto. Quien la toque
-- después: `grep -n "create function public.rpc_library_rollup"
-- supabase/migrations/*.sql` (y también `create or replace function`, que es
-- como la escribió 0100) y parte del número más alto, que es este.

begin;

drop function if exists public.rpc_library_rollup(text);
create function public.rpc_library_rollup(p_kind text default null)
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
  imdb_rating numeric,
  steam_reviews jsonb
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
    t.imdb_rating,
    t.steam_reviews
  from mine le
  join public.titles t on t.id = le.title_id
  left join eps a on a.title_id = t.id
$$;

grant execute on function public.rpc_library_rollup(text) to authenticated;

commit;
