-- 0099_el_rollup_filtra_por_medio.sql
-- El rollup deja de traer los tres medios para que el cliente tire dos.
--
-- LO MEDIDO, en producción el 18-sep-2026 en /movies/tonight, con una
-- biblioteca de 2.109 filas: el primer póster no se pide hasta t=5279 ms. No
-- porque la función sea lenta desde 0098, sino porque `useLibraryRows` lee la
-- biblioteca ENTERA —los tres medios— en tres ventanas de mil ENCADENADAS
-- (168→3269, 3273→4861, 4865→5217 ms) y filtra por medio en el cliente. O sea:
-- para pintar tu cine se leen también tus series y tus juegos, y se esperan.
--
-- Son dos desperdicios distintos y este fichero arregla el primero; el segundo
-- —las ventanas en fila india— es del lado del cliente y va en el mismo cambio
-- (lib/paging: la primera ventana trae el total y las demás van en paralelo).
--
-- LO QUE CAMBIA: un parámetro `p_kind` opcional. Null es "todo", que es lo que
-- sigue necesitando quien lee la biblioteca sin medio — las pantallas
-- compartidas de amigos, que pintan el medio del conmutador y no uno fijo.
--
-- Y ACOTA LOS TRES CTE, no solo el select final. Filtrar al final no ahorraría
-- NADA: `eps` seguiría agregando los episodios de tus 2.109 títulos y `seen`
-- seguiría cruzando tus 34.000 visionados para tirar después el 80%. Con el
-- filtro arriba, `mine` es ya solo tu cine y los otros dos lo heredan por el
-- `in (select … from mine)`. `seen` no lo tenía: se acotaba solo por tu
-- user_id, y ahora también por los títulos de `mine`. Eso no cambia ni una fila
-- del resultado —lo que sobraba lo descartaba el LEFT JOIN de abajo— pero es la
-- diferencia entre recorrer tus visionados enteros o los del medio que se pide.
--
-- CUÁNTO GANA, y conviene decirlo en el orden correcto porque lo grande no es
-- lo que parece. Medido en la pila local con una biblioteca de la forma de la
-- de producción —2.100 títulos repartidos 1.300 cine / 410 series / 390 juegos,
-- 46.790 episodios y 34.000 visionados—, leyendo las columnas de los agregados
-- para que el planificador no quite los joins (la trampa que documenta 0098):
--
--                     filas   ventanas   una llamada
--     p_kind null      2100      3         16,0 ms
--     p_kind 'movie'   1300      2         10,8 ms
--     p_kind 'tv'       410      1         20,9 ms
--     p_kind 'game'     390      1          8,6 ms
--
-- LO QUE IMPORTA ES LA COLUMNA DE LAS VENTANAS. Cada ventana es una ida y
-- vuelta por la red contra una instancia pequeña —en producción eran 3,1 s,
-- 1,6 s y 0,35 s— así que pasar de tres a una es lo que se nota, no los
-- milisegundos de CPU. Y el reparto de filas es el de la biblioteca de
-- producción: por eso /games y /shows bajan a una ventana y /movies a dos.
--
-- Y LO QUE NO GANA, dicho igual de claro: `p_kind 'tv'` no ahorra CPU, y aquí
-- sale más caro que pedirlo todo. No es un error de medida —los tiempos de
-- esta pila bailan entre 8 y 170 ms según lo que haga el Docker de al lado, y
-- estos son de una vuelta tranquila— sino lo esperable: TODO el trabajo de los
-- dos agregados es de las series (los episodios y los visionados son suyos),
-- así que filtrar a 'tv' quita 1.690 filas de biblioteca y ni un episodio.
-- Series gana por las ventanas; cine y juegos, por las dos cosas.
--
-- LA FIRMA CAMBIA, y eso tiene dos consecuencias que no se pueden saltar:
--
--   · hay que hacer `drop function` de la vieja —`create or replace` no puede
--     con un cambio de argumentos— y volver a dar el `grant execute`, que el
--     drop se lleva por delante;
--   · y el cliente nuevo pidiendo `p_kind` a la función vieja recibe un
--     PGRST202. POR ESO ESTA MIGRACIÓN SE APLICA ANTES QUE EL FRONTEND. El
--     cliente trae además el respaldo de 0084 (reintentar sin el parámetro ante
--     un PGRST202), así que el orden equivocado degrada en vez de romper — pero
--     degrada a lo de antes, que es justo lo que esto viene a arreglar.
--
-- LO QUE NO CAMBIA: las 32 columnas del retorno, su orden y la expresión de
-- cada una. Es la misma respuesta, calculada sobre menos filas. La red que lo
-- comprueba es el §0 de supabase/sql-checks/0098_rollup_sin_laterales.sql, que
-- existe porque la vez anterior se perdieron dos columnas por partir de una
-- definición vieja y NADA lo dijo.
--
-- Quien la toque después: `grep -n "create function public.rpc_library_rollup"
-- supabase/migrations/*.sql` y parte del número más alto, que es este.
drop function if exists public.rpc_library_rollup();
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
  imdb_rating numeric
)
language sql
security invoker
stable
as $$
  with mine as (
    -- Tu biblioteca, una vez, y desde 0099 solo del medio que se pida.
    -- `auth.uid()` entre paréntesis a propósito: así se evalúa una sola vez y
    -- no por fila, que es el mismo motivo por el que estaba así en el `where`
    -- de la definición vieja.
    --
    -- El medio vive en `titles`, no en `library_entries`, así que el filtro
    -- exige mirar el título. Se hace AQUÍ y no abajo para que lo hereden los
    -- dos agregados: es lo único que convierte el parámetro en trabajo
    -- ahorrado en vez de en filas descartadas al final.
    select le.*
    from public.library_entries le
    join public.titles tk on tk.id = le.title_id
    where le.user_id = (select auth.uid()) and le.followed
      and (p_kind is null or tk.kind = p_kind)
  ),
  eps as materialized (
    -- Lo que antes de 0098 era la lateral `a`. Acotado a los títulos que sigues
    -- —ahora, del medio pedido—: sin ese filtro esto recorrería la tabla de
    -- episodios ENTERA, que es de todo el mundo y no solo tuya.
    --
    -- `materialized` NO es decorativo, y es lo único de aquí que no se ve en el
    -- resultado. Sin él, Postgres puede meter este agregado dentro del bucle de
    -- la izquierda y volver a ejecutarlo por fila — con la base de pruebas
    -- vacía elegía exactamente eso: `GroupAggregate ... loops=7`. O sea, la
    -- lateral otra vez, con otra sintaxis. Con él se calcula una vez y punto.
    select
      e.title_id,
      count(*) filter (where e.air_datetime <= now()) as aired,
      max(e.air_datetime) filter (where e.air_datetime <= now()) as last_aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.season_number > 0
      and e.title_id in (select m.title_id from mine m)
    group by e.title_id
  ),
  seen as materialized (
    -- Lo que antes de 0098 era la lateral `w`. Se acota por TU user_id —lo que
    -- lo hacía barato— y desde 0099 también por los títulos de `mine`, que es
    -- lo que hace que pedir un medio no pague los visionados de los otros dos.
    -- El resultado es el mismo con o sin ese `in`: lo que quita son filas que
    -- el LEFT JOIN de abajo no habría emparejado con nada.
    select
      e2.title_id,
      count(*) as watched,
      max(wv.watched_at) as last_watched_at
    from public.watch_events wv
    join public.episodes e2 on e2.id = wv.episode_id
    where wv.user_id = (select auth.uid())
      and e2.season_number > 0
      and e2.title_id in (select m.title_id from mine m)
    group by e2.title_id
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
    coalesce(w.watched, 0)::int,
    w.last_watched_at,
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
  left join seen w on w.title_id = t.id
$$;
-- El drop de arriba se llevó el grant con la función vieja. Sin esta línea la
-- biblioteca queda vacía para todo el mundo con un 42501 que el cliente enseña
-- como "no se pudo cargar".
grant execute on function public.rpc_library_rollup(text) to authenticated;
