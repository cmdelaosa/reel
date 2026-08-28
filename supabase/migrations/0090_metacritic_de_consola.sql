-- 0090_metacritic_de_consola.sql
-- La nota de la crítica para lo que no se vende en Steam.
--
-- ── El agujero ────────────────────────────────────────────────────────────
-- 0089 puso `titles.metacritic` a llenarse desde un cron, y funcionó: 181 de
-- los 294 juegos con `steam_appid` tienen nota. Pero la nota viaja DENTRO de la
-- ficha de la tienda de Steam, así que un juego que Nintendo no vende ahí no
-- tiene de dónde sacarla. Los 97 juegos de consola de la biblioteca —los Zelda,
-- Banjo-Kazooie, Bomberman— se quedaban con la celda vacía para siempre, y no
-- porque Metacritic no los puntuara: Breath of the Wild tiene un 97 en
-- metacritic.com y ninguna respuesta de Steam lo menciona.
--
-- ── La fuente que sí los cubre ────────────────────────────────────────────
-- RAWG (rawg.io) publica el Metascore en su propia ficha de juego, consola
-- incluida, con una clave gratuita. Comprobado contra su API el 28-08-2026 con
-- 25 juegos de consola de esta biblioteca: 24 emparejados, 9 con Metascore. Los
-- 15 sin nota no son un fallo del emparejamiento — son de los ochenta y los
-- noventa, y Metacritic no existía hasta 2001.
--
-- OpenCritic se descartó por dar SU nota y no la de Metacritic, y raspar
-- metacritic.com por no tener API pública.
--
-- ── Por qué hacen falta tres columnas y no una ───────────────────────────
-- Porque ahora hay DOS fuentes escribiendo la misma celda, y sin saber de cuál
-- vino el número se pisan: el cron de Steam pregunta por un juego sin Metascore
-- en la tienda, escribe null, y le borra cada semana lo que RAWG acababa de
-- poner. Un parpadeo semanal que nadie relacionaría con esto.

-- El id de RAWG del juego, que es el emparejamiento ya resuelto. Se guarda para
-- no volver a buscar por nombre en cada pasada: la búsqueda es la parte cara y
-- la que se puede equivocar, y repetirla cada semana es repetir el riesgo.
-- Null con `rawg_refreshed_at` puesto significa "buscado y no está", que es
-- distinto de "aún no se ha buscado".
alter table public.titles add column if not exists rawg_id int;

-- La contabilidad del cron nuevo, igual que `steam_notes_refreshed_at` (0089)
-- es la del suyo. Tercera marca de frescura y por el mismo motivo que aquella:
-- `last_refreshed_at` significa "cuándo se trajo el detalle de IGDB" y es la
-- que decide si igdb-proxy sirve la caché.
alter table public.titles add column if not exists rawg_refreshed_at timestamptz;

-- De dónde salió el número que hay en `metacritic`: 'steam' o 'rawg'. No es
-- adorno de auditoría, es lo que impide que las dos fuentes se pisen — y es lo
-- que la ficha necesita para saber cuándo tiene que acreditar a RAWG, que su
-- plan gratuito lo exige.
alter table public.titles add column if not exists metacritic_source text;

-- Las filas que ya tienen nota la tienen de Steam: es la única fuente que ha
-- escrito esa columna hasta hoy. Sin esto, la primera pasada del cron nuevo
-- vería 181 juegos con nota y sin procedencia, y no podría distinguir los que
-- puede reemplazar de los que no.
update public.titles
   set metacritic_source = 'steam'
 where kind = 'game' and metacritic is not null and metacritic_source is null;

-- Sin índices: la cola se arma sobre los juegos de la biblioteca —unos cientos—
-- y se ordena en memoria, igual que en 0089. Sin grants ni políticas: `titles`
-- ya es legible por authenticated y escribible solo por service_role (0002).
--
-- `metacritic_source` SÍ viaja al cliente (app/src/lib/schemas.ts): la ficha lo
-- lee para poner el crédito de RAWG donde su licencia lo pide. `rawg_id` y
-- `rawg_refreshed_at` no: son contabilidad del cron.
