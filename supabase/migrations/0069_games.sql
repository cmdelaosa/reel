-- 0069_games.sql
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
-- Lo que esto habría costado si 0067 no hubiera pasado por aquí: el episodio
-- sintético se coló en su día en el calendario, en los avisos por correo, en
-- el historial, en el muro de amigos y en las estadísticas. Las cinco se
-- arreglaron filtrando `t.kind = 'tv'` — el filtro positivo, no `<> 'movie'`.
-- Esa elección, que entonces solo era higiene, es lo que hace que los juegos
-- queden fuera de las cinco superficies sin tocar ni una línea aquí. Si alguna
-- dijera `<> 'movie'`, hoy el cron estaría mandando correos anunciando
-- «S1 · E1» de un videojuego, y un correo mal enviado no se retira.
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
