-- 0078_steam_estado_y_nota.sql
-- La importación de Steam deja decir, juego a juego, en qué punto estás y qué
-- nota le pones — y fecha lo terminado con tu última partida, no con hoy.
--
-- ── Qué cambia y por qué ──────────────────────────────────────────────────
-- 0076 trajo las horas y nada más: lo importado entraba como `owned` y sin
-- estado, porque `playtime_forever` es de por vida y no dice nada sobre ahora.
-- Eso sigue siendo verdad y sigue siendo el defecto. Lo que cambia es que la
-- pantalla de confirmar ya no es una lista de casillas: enseña la carátula, y
-- al lado el estado y las estrellas. O sea, la persona SÍ puede decirlo, y lo
-- que dice no se deduce de ninguna cifra.
--
-- Dos cosas hacen falta para eso, y las dos están aquí.
--
-- ── 1. `last_played_at` — la fecha del "terminado" ────────────────────────
-- `GetOwnedGames` devuelve `rtime_last_played` por juego, en la MISMA llamada
-- que ya hacíamos (misma clave, misma petición, cero coste). Es la última vez
-- que lo abriste.
--
-- Sin ella, marcar 41 juegos como terminados metía 41 `watch_events` con fecha
-- de HOY: el muro de tus amigos amanecería diciendo que te acabaste Portal 2,
-- Hades y Hollow Knight esta tarde, y el historial quedaría inservible. Con
-- ella, cada uno se fecha el día que lo tocaste por última vez.
--
-- No es la fecha de los créditos y no se vende como tal: si lo rejugaste
-- después de acabarlo, la fecha se va hacia adelante. Pero "la última vez que
-- lo jugaste" es lo más cerca que Steam llega, y está a un orden de magnitud de
-- "hoy". Vale null en lo que nunca has tocado (`rtime_last_played` = 0), y ahí
-- el que confirma cae a `now()` — que es lo correcto justo en ese caso: un
-- juego con 0 h que marcas terminado a mano lo estás terminando ahora.
--
-- Se fotografía en el escaneo, como `manual_minutes`: la fila del borrador
-- tiene que poder pintarse y confirmarse sin volver a preguntarle a Steam.
--
-- ── 2. 'backlog' entra en `play_state` ────────────────────────────────────
-- Hasta hoy `play_state` eran los tres que se dicen a mano —playing, ongoing,
-- dropped— y "Pendiente" era lo DERIVADO: seguir un juego sin decir nada. Con
-- la importación por montones eso deja de bastar, y no por capricho:
-- `deriveGameStatus` devuelve 'owned' para todo lo que tienes con 0 h (por
-- 0076, para que una importación no convierta Pendientes en el catálogo de
-- Steam entero), y esa regla mira antes que 'backlog'. O sea que marcar
-- "Pendiente" en un juego recién importado no se vería por ningún lado: dirías
-- que quieres jugarlo y la app te contestaría "lo tienes".
--
-- Así que "me lo he propuesto" pasa a ser algo que se DICE, distinto de "lo
-- tengo y no he dicho nada". Es la misma asimetría que ya existe entre 'owned'
-- y 'backlog', ahora con una forma de cruzarla a propósito.
--
-- Terminado sigue SIN estar aquí, y sigue por lo de 0073: es el `watch_event`,
-- no una etiqueta. Si fuera un play_state habría dos formas de decir lo mismo y
-- algún día dirían cosas distintas.

-- ============================================================
-- 1. La última partida, en la fila del borrador
-- ============================================================
alter table public.steam_import_items
  add column if not exists last_played_at timestamptz;

comment on column public.steam_import_items.last_played_at is
  'La última vez que lo jugaste según Steam (rtime_last_played), fotografiada '
  'en el escaneo. Es la fecha con la que se escribe el watch_event de lo que '
  'marques como terminado, en vez de la de la importación. Null = Steam dice '
  'que nunca lo has abierto.';

-- ============================================================
-- 2. 'backlog' es un estado que se dice
-- ============================================================
alter table public.library_entries drop constraint if exists library_entries_play_state_check;
alter table public.library_entries add constraint library_entries_play_state_check
  check (play_state is null or play_state in ('backlog', 'playing', 'ongoing', 'dropped'));

comment on column public.library_entries.play_state is
  'Lo que la persona dice a mano sobre un juego: backlog | playing | ongoing | '
  'dropped. Null es "no ha dicho nada", que NO es lo mismo que ''backlog'': un '
  'juego tuyo con 0 h y sin estado sale como ''owned'' (0076), y ''backlog'' es '
  'haberte propuesto jugarlo. "Terminado" no está aquí a propósito: es el '
  'watch_event del episodio sintético (0071, 0073).';
