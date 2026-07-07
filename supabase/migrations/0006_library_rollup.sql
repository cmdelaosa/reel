-- 0006_library_rollup.sql
-- rpc_library_rollup: the caller's followed library with per-title aired/watched
-- counts (specials excluded in SQL) — inputs for the pure status derivation in
-- app/src/domain/status.ts. security INVOKER: RLS scopes rows to the caller.

create function public.rpc_library_rollup()
returns table (
  title_id uuid,
  tmdb_id int,
  name text,
  poster_path text,
  first_air_date date,
  tmdb_status text,
  genres text[],
  network text,
  vote_average numeric,
  favorite boolean,
  notify boolean,
  added_at timestamptz,
  aired_count int,
  watched_count int,
  last_watched_at timestamptz,
  next_air_datetime timestamptz
)
language sql
security invoker
stable
as $$
  select
    t.id,
    t.tmdb_id,
    t.name,
    t.poster_path,
    t.first_air_date,
    t.status,
    t.genres,
    t.network,
    t.vote_average,
    le.favorite,
    le.notify,
    le.added_at,
    coalesce(a.aired, 0)::int,
    coalesce(w.watched, 0)::int,
    w.last_watched_at,
    a.next_air
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  left join lateral (
    select
      count(*) filter (where e.air_datetime <= now()) as aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.title_id = t.id and e.season_number > 0
  ) a on true
  left join lateral (
    select count(*) as watched, max(we.watched_at) as last_watched_at
    from public.watch_events we
    join public.episodes e2 on e2.id = we.episode_id
    where we.user_id = (select auth.uid())
      and e2.title_id = t.id
      and e2.season_number > 0
  ) w on true
  where le.user_id = (select auth.uid())
    and le.followed
$$;

grant execute on function public.rpc_library_rollup() to authenticated;
