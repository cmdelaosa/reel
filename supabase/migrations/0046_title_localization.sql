-- 0046: Spanish localization + original title (P-friends: idioma es/en).
--
-- Additive, nullable columns on the shared metadata cache. The client shows
-- name_es/overview_es when the account language is "es" and falls back to the
-- canonical (TMDB default, effectively English) columns; original_name feeds
-- the "original title" line on the detail sheet in both languages.
--
-- Rows fill lazily: tmdb-proxy title refreshes and the daily episode-refresh
-- cron fetch TMDB with append_to_response=translations and write all three
-- columns; search (lang=es) patches name_es/original_name. Nothing here needs
-- backfilling up front — absent values simply render the canonical name.

alter table public.titles
  add column if not exists original_name text,
  add column if not exists name_es text,
  add column if not exists overview_es text;
