-- 0057_imdb_ratings.sql
-- IMDb ratings, plus the per-episode TMDB scores we already fetched but threw
-- away.
--
-- Feature set: show the IMDb rating next to TMDB's on the detail sheet, a rating
-- (both sources) + synopsis per episode, and a per-season episode-rating graph.
-- None of that data lives here yet:
--   • TMDB gives a per-episode vote_average/vote_count in every season payload,
--     but the ingest dropped both columns. They're free — we already hold the
--     payload — so we start persisting them.
--   • IMDb ratings are not in TMDB at all. They come from OMDb (omdbapi.com),
--     bridged through the imdb_id TMDB hands us (0051), and are written by the
--     Edge Functions best-effort, the same way TVmaze air times are.
--
-- Season aggregates (the "season rating") are derived client-side from the
-- episode rows — OMDb exposes no season-level number — so no column for them.
--
-- All columns are nullable with no default: absent means "not resolved yet"
-- (OMDb miss, a title with no imdb_id, or simply not enriched), which the UI
-- reads as "hide", never as a zero score.

-- ── titles: the show-level IMDb rating ──────────────────────────────────────
alter table public.titles add column if not exists imdb_rating numeric;
alter table public.titles add column if not exists imdb_votes  int;

-- ── episodes: per-episode TMDB scores (now kept) + IMDb rating ──────────────
-- imdb_id is the episode's own tconst from OMDb's season listing — stored so a
-- future per-episode fetch (plot, cast) costs no extra lookup.
alter table public.episodes add column if not exists tmdb_vote_average numeric;
alter table public.episodes add column if not exists tmdb_vote_count   int;
alter table public.episodes add column if not exists imdb_rating       numeric;
alter table public.episodes add column if not exists imdb_votes        int;
alter table public.episodes add column if not exists imdb_id           text;

-- No new grants or policies: titles/episodes are already authenticated-readable
-- and service-role-writable (0002), and these columns inherit that.
