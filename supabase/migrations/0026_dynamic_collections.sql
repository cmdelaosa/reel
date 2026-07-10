-- 0024_dynamic_collections.sql
-- Collections go dynamic: contents now come live from TMDB discover via the
-- tmdb-proxy /collection/:slug route (criteria keyed by slug in the function),
-- so the static collection_titles seed (12 rows per collection, frozen at
-- migration time) is dead weight — drop it. The collections table stays as the
-- source of tile name/sub/hue/order.

drop table public.collection_titles;

-- No longer decade-bound: the dynamic query ranks the whole catalog.
update public.collections
set sub = 'The best-reviewed of all time'
where slug = 'critically-acclaimed';
