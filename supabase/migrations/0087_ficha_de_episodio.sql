-- 0087_ficha_de_episodio.sql
-- Lo que TMDB manda de cada episodio y hasta ahora tirábamos.
--
-- ── Por qué 0087 y no 0085, que es como nació ──────────────────────────────
-- El 27-ago-2026 esta migración se empujó como 0085 y NO se aplicó, sin que
-- nada avisara: producción ya tenía una fila 0085 —`inventario_steam`, de una
-- rama sin fusionar que se desplegó por su cuenta—, así que `db push` la dio
-- por hecha y saltó a la 0086. `supabase migration list` decía `remote` y
-- `db diff` decía «No schema changes found»: los dos comparan por número. Lo
-- único que lo destapó fue preguntarle a `information_schema.columns`.
--
-- El coste no fue solo que faltaran las columnas: el `tmdb-proxy` nuevo ya
-- escribía `still_path` y compañía, y PostgREST rechaza el upsert ENTERO
-- cuando una columna no está, así que refrescar una temporada fallaba.
--
-- Reaplicarla es inofensivo donde ya entró: las seis sentencias son
-- `add column if not exists` y no hay nada más en el fichero.
--
-- La ficha de un episodio enseñaba número, nombre, sinopsis, duración, fecha y
-- las dos notas, y nada más. El rediseño le añade el fotograma y quién lo hizo
-- —dirección, guion e invitados—, con la misma fila de caras redondas que ya
-- usa el reparto de la serie.
--
-- ── Lo importante: esto no cuesta una sola petición nueva ───────────────────
-- Los cuatro campos VIENEN YA en el payload de /tv/{id}/season/{n} que el proxy
-- pide para llenar la lista de episodios. Comprobado contra la API el
-- 27-ago-2026 con Severance: cada episodio de esa respuesta trae `still_path`,
-- `crew` (28 personas), `guest_stars` (8) y `episode_type`. `episodeRow` los
-- descartaba. Así que esto es una columna y un mapeo, no una fuente nueva ni
-- otro presupuesto de peticiones que vigilar.
--
-- ── Por qué jsonb y no tablas ──────────────────────────────────────────────
-- La tentación es normalizar: una tabla `people` y dos de unión. No sale a
-- cuenta. Estas listas se leen SIEMPRE enteras y SIEMPRE de un solo episodio —
-- la ficha las pinta y ahí se acaba—, nunca se consultan al revés ("en qué
-- episodios sale X") ni se ordenan ni se agregan por ellas. Una tabla aparte
-- añadiría dos joins a la consulta más caliente que tenemos (la lista de una
-- temporada, que ya pagina a mil filas, ver 0079) a cambio de una integridad
-- que nadie va a usar. El día que haya una página de persona con sus episodios,
-- se normaliza; hoy sería trabajo por adelantado.
--
-- El id de TMDB de cada persona SÍ se guarda dentro del json: es lo que deja
-- que una cara enlace a /person/:id, que es la página que ya existe.
--
-- ── La forma del json, y por qué se recorta en el ingest ────────────────────
-- `crew` llega con 28 personas por episodio y cada una con doce campos, casi
-- todos inútiles aquí (`adult`, `gender`, `popularity`, `known_for_department`,
-- `credit_id`). Guardarlo crudo serían decenas de kilobytes por episodio por
-- una serie larga, todos viajando en cada lectura de temporada. El proxy lo
-- recorta antes de escribir y deja lo que la ficha pinta:
--
--   crew         [{ id, name, profile_path, job }]   solo Director y guion
--   guest_stars  [{ id, name, profile_path, character }]
--
-- Nulas y sin default: ausente es "todavía no lo hemos traído" (una fila
-- escrita antes de esta migración), que la interfaz lee como "no enseñar",
-- nunca como una lista vacía. Un episodio sin emitir tampoco los tiene —TMDB
-- publica reparto y fotograma cuando se emite—, y ahí el hueco es real y la
-- ficha lo dice con palabras.

-- ── episodes ───────────────────────────────────────────────────────────────
-- El fotograma. Ruta de TMDB como las demás (poster_path, backdrop_path): la
-- pinta tmdbImg() eligiendo tamaño, aquí solo se guarda el camino.
alter table public.episodes add column if not exists still_path text;

-- 'standard' | 'premiere' | 'mid_season' | 'finale'. Es de TMDB y es lo que
-- deja decir "final de temporada" sin contar episodios ni adivinar.
alter table public.episodes add column if not exists episode_type text;

-- Dirección y guion del episodio (no de la serie), y los invitados de ese
-- episodio (no el reparto fijo, que ya sale en la ficha de la serie).
alter table public.episodes add column if not exists crew        jsonb;
alter table public.episodes add column if not exists guest_stars jsonb;

-- Sin grants ni políticas nuevas: `episodes` ya es legible por authenticated y
-- escribible solo por service_role desde 0002, y estas columnas lo heredan.
-- Sin índices: no se filtra ni se ordena por ninguna de las cuatro; se leen
-- junto al resto de la fila cuando se abre una temporada.

-- ── El episodio en español ─────────────────────────────────────────────────
-- Mismo par que `titles` tiene desde 0046, y por el mismo motivo: la columna
-- canónica guarda lo que TMDB da sin pedir idioma, y la _es solo se escribe
-- cuando hay traducción de verdad. El cliente elige con la regla que ya usa la
-- ficha, `(isEs() && overview_es) || overview`.
--
-- Y hace falta el par, no basta con pedir la temporada en es-ES: comprobado
-- contra la API el 27-ago-2026, /tv/{id}/season/{n}?language=es-ES devuelve la
-- sinopsis VACÍA cuando no hay traducción, no la inglesa. En tv 220400 un
-- episodio con sinopsis pasaba a no tenerla. O sea que pedir la temporada solo
-- en español no es una mejora: es cambiar texto en inglés por ningún texto.
--
-- El proxy pide la temporada dos veces —la canónica y la española, esta última
-- tolerante a fallo— y funde por número de episodio quedándose con lo español
-- solo cuando viene lleno. Es el mismo trato que fetchMoviePages le da a la
-- rejilla de cine.
alter table public.episodes add column if not exists name_es     text;
alter table public.episodes add column if not exists overview_es text;
