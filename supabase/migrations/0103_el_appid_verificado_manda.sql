-- 0103_el_appid_verificado_manda.sql
-- Una marca para saber quién dice el `steam_appid` de un juego, y así poder no
-- pisarlo.
--
-- ── El problema ────────────────────────────────────────────────────────────
-- `titles.steam_appid` lo pone igdb-proxy a partir de `external_games` de IGDB,
-- que cuelga de una misma ficha VARIAS apps de Steam: el juego, su playtest, la
-- banda sonora, ediciones sueltas. `steamAppid()` se queda con la primera, y la
-- primera no siempre es el juego. Medido en producción el 21-sep-2026:
--
--   Chants of Sennaar  1515190 → «Chants Of Sennaar Playtest» (0 reseñas)
--   Dead Cells         1087210 → entrada secundaria de 588650 (0 reseñas)
--   Borderlands 2       379880 → entrada secundaria de 49520  (0 reseñas)
--
-- El cron `scripts/steam-notes` ya sabe arreglarlo: cuando las reseñas salen a
-- cero le pregunta a la tienda, que o bien devuelve el appid canónico dentro de
-- `appdetails`, o bien deja ver que la ficha es un playtest y entonces se busca
-- el juego por su nombre.
--
-- Pero ese arreglo no duraba. Cada refresco del detalle de IGDB vuelve a
-- escribir `steam_appid` con lo que diga `external_games`, o sea que la
-- corrección sobrevive hasta que alguien abre la ficha — y el calentado
-- nocturno la abre solo. Peor: igdb-proxy pregunta las notas de Steam con ESE
-- appid, así que el mismo refresco podía escribir `steam_reviews = null` encima
-- del 97 % recién verificado.
--
-- ── Lo que esta columna dice, y lo que NO dice ─────────────────────────────
-- `steam_appid_source` es de dónde viene el appid que hay:
--
--   null / 'igdb'  lo puso IGDB y no lo ha verificado nadie — se puede pisar.
--   'steam'        lo confirmó la tienda contra el appid que se le preguntó.
--
-- Null es el estado de las 297 filas que ya tienen appid, y es deliberado que
-- NO se rellenen a 'igdb' ni se marquen 'steam' en masa: que un appid devuelva
-- reseñas no prueba que sea el juego correcto. El caso de Agatha Christie —IGDB
-- cuelga de la ficha del juego de 2009 de Nintendo DS el appid del remake de
-- 2016, que tiene reseñas de sobra— es exactamente eso, y está contado en la
-- cabecera de app/src/domain/steamMatch.ts. Marcar «verificado» lo que solo
-- está «contestado» congelaría ese vínculo roto para siempre.
--
-- Así que la marca la escribe UNA sola cosa: el cron, y solo sobre lo que él ha
-- corregido. Son cuatro filas hoy. Lo demás sigue siendo de IGDB y mejorable
-- por IGDB, que es como estaba.
--
-- El `check` deja pasar el null a propósito: es "no consta", que es lo que
-- dicen las filas anteriores a esta migración.

alter table public.titles
  add column if not exists steam_appid_source text
  check (steam_appid_source in ('igdb', 'steam'));

comment on column public.titles.steam_appid_source is
  'De donde viene steam_appid: ''steam'' lo verifico la tienda (lo escribe scripts/steam-notes al corregirlo) y no lo pisa el refresco de IGDB; null o ''igdb'' es lo que dijo external_games, y se puede pisar. Ver 0103.';
