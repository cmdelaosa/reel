-- 0086_ficha_de_juego.sql
-- El tráiler, las capturas, las dos notas que faltaban, la edad y el enlace.
--
-- La ficha de un juego enseñaba una imagen fija, la sinopsis, la nota de IGDB y
-- las plataformas. El rediseño le añade lo que la gente mira antes de decidir
-- si lo juega: el tráiler, unas capturas, qué opinan en Steam y qué le puso la
-- crítica, para quién es y a dónde ir a comprarlo.
--
-- ── Lo que ya llegaba y se tiraba ──────────────────────────────────────────
-- `screenshots.image_id` ESTÁ en DETAIL_FIELDS desde 0071 y de las dieciséis
-- que IGDB manda solo se guardaba la primera, como respaldo del arte de fondo.
-- Las otras quince se descartaban en cada refresco. Aquí dejan de hacerlo.
--
-- ── Lo que hay que pedirle a IGDB, en la MISMA consulta ────────────────────
-- Vídeos, edad, enlaces y el `url` propio del juego. Son campos más en la
-- petición que la ficha ya hace, no una llamada nueva: el límite de IGDB son
-- cuatro peticiones por segundo PARA TODA LA APP (igdb-proxy lo explica), así
-- que lo que no cabe aquí no cabe en ningún sitio.
--
-- ── Y lo que NO es de IGDB: Steam ──────────────────────────────────────────
-- El porcentaje de reseñas positivas y la nota de Metacritic no están en IGDB.
-- Salen de dos rutas públicas de la tienda de Steam, sin clave ni acuerdo:
--
--   store.steampowered.com/appreviews/<appid>?json=1   → % positivas y cuántas
--   store.steampowered.com/api/appdetails?appids=<id>  → metacritic.score
--
-- Se piden solo cuando el juego tiene `steam_appid`, que es la columna que
-- 0076 ya guarda, y se cachean con el resto de la ficha (24 h). Un juego de
-- consola sin Steam se queda sin esas dos notas, y eso es correcto: no existen.
--
-- ── Por qué jsonb otra vez, y por qué recortado ────────────────────────────
-- Mismo razonamiento que 0087 con el reparto de un episodio: estas listas se
-- leen enteras, de un solo juego, para pintarlas, y nunca al revés. Lo que sí
-- importa es el TAMAÑO: `videos` llega con nueve entradas y `screenshots` con
-- dieciséis, y esta fila viaja en la rejilla de la biblioteca y en el muro. Se
-- recorta en el ingest (igdb-proxy/normalize.ts, con pruebas) a lo que la ficha
-- pinta.

-- ── Imágenes y vídeo ───────────────────────────────────────────────────────
-- Hashes de IGDB, como `poster_path` (0071): los pinta igdbImg() eligiendo
-- tamaño. Aquí solo se guarda el hash. Recortadas a ocho; la ficha enseña cinco
-- y deja margen para que el carrusel no se quede corto.
alter table public.titles add column if not exists screenshots jsonb;

-- [{ name, video_id }] de YouTube, ORDENADAS: la primera es el mejor tráiler
-- que IGDB tenga, que es la única que la ficha pinta. El orden lo decide
-- `videosRecortados`, no el que venga en el payload — ahí el primero suele ser
-- un teaser de hace cinco años.
alter table public.titles add column if not exists videos jsonb;

-- ── Para quién es ──────────────────────────────────────────────────────────
-- [{ org, rating }] con los nombres ya resueltos ("PEGI", "18"), no los enums
-- de IGDB: quien pinta no tiene por qué saber que organization 2 es PEGI, y esa
-- tabla cambia en el proveedor, no aquí.
alter table public.titles add column if not exists age_ratings jsonb;

-- ── A dónde ir ─────────────────────────────────────────────────────────────
-- La web oficial del juego (websites tipo 1). Es el respaldo del enlace a
-- Steam para lo que no está en Steam — un exclusivo de consola, un juego de
-- itch. Solo la oficial: guardar los quince enlaces que IGDB da (Twitch,
-- Discord, Reddit, cuatro redes…) sería guardar un directorio para pintar un
-- botón.
alter table public.titles add column if not exists official_url text;

-- ── Lo que dicen los demás ─────────────────────────────────────────────────
-- { percent, count } de Steam. La etiqueta ("Extremadamente positivas") NO se
-- guarda: la calcula el cliente a partir del porcentaje y del número de
-- reseñas, porque es texto de interfaz y tiene que estar en el idioma de quien
-- mira, no en el que la tienda respondiera el día del refresco.
alter table public.titles add column if not exists steam_reviews jsonb;

-- La nota de la crítica, 0-100. Viaja gratis dentro de la respuesta de
-- appdetails que ya hay que pedir para nada más — no hay que hablar con
-- Metacritic ni acordar nada con ellos.
alter table public.titles add column if not exists metacritic int;

-- Sin grants ni políticas: `titles` ya es legible por authenticated y escribible
-- solo por service_role (0002), y estas columnas lo heredan. Sin índices: no se
-- filtra ni se ordena por ninguna; se leen con el resto de la fila.

-- ── Quién lo hizo y quién lo vende ─────────────────────────────────────────
-- `network` ya guarda el DESARROLLADOR (studio() lo resuelve así desde 0071),
-- así que la ficha tenía el estudio y lo llamaba «Estudio». La distribuidora es
-- otra empresa y a veces la que importa: en The Witcher 3 son CD Projekt RED y
-- Bandai Namco, en Elden Ring FromSoftware y Bandai Namco. IGDB marca los dos
-- papeles por separado en `involved_companies` y solo se leía uno.
--
-- Null cuando coinciden no: se guarda igual. Larian se autodistribuye y que la
-- ficha diga dos veces «Larian Studios» es información — dice que no hay
-- editora detrás.
alter table public.titles add column if not exists publisher text;

-- Un jugador, multijugador, cooperativo, pantalla partida. Es lo que responde
-- «¿esto lo puedo jugar con alguien?», que en un juego se pregunta antes que
-- casi nada. text[] y no jsonb: es una lista de nombres sin estructura dentro,
-- igual que `genres` y `platforms`, que ya son text[].
alter table public.titles add column if not exists game_modes text[];
