-- 0008_up_next.sql
-- rpc_up_next: for each followed show the caller has STARTED (watched > 0),
-- the earliest aired, unwatched, regular-season episode — the "up next" row.
-- Fully-caught-up shows produce no row (no aired-unwatched episode exists).
-- security INVOKER; RLS scopes watch_events/library_entries to the caller.

create function public.rpc_up_next()
returns table (
  title_id uuid,
  tmdb_id int,
  name text,
  poster_path text,
  network text,
  vote_average numeric,
  episode_id uuid,
  season_number int,
  episode_number int,
  episode_name text,
  air_datetime timestamptz,
  aired_count int,
  watched_count int,
  last_watched_at timestamptz
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
    t.network,
    t.vote_average,
    n.id,
    n.season_number,
    n.episode_number,
    n.name,
    n.air_datetime,
    c.aired::int,
    c.watched::int,
    c.last_watched_at
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  join lateral (
    select e.id, e.season_number, e.episode_number, e.name, e.air_datetime
    from public.episodes e
    where e.title_id = t.id
      and e.season_number > 0
      and e.air_datetime is not null
      and e.air_datetime <= now()
      and not exists (
        select 1 from public.watch_events wv
        where wv.user_id = (select auth.uid()) and wv.episode_id = e.id
      )
    order by e.season_number, e.episode_number
    limit 1
  ) n on true
  join lateral (
    select
      count(*) filter (where e2.air_datetime <= now() and e2.season_number > 0) as aired,
      count(*) filter (where wv.id is not null) as watched,
      max(wv.watched_at) as last_watched_at
    from public.episodes e2
    left join public.watch_events wv
      on wv.episode_id = e2.id and wv.user_id = (select auth.uid()) and e2.season_number > 0
    where e2.title_id = t.id
  ) c on true
  where le.user_id = (select auth.uid())
    and le.followed
    and c.watched > 0
$$;

grant execute on function public.rpc_up_next() to authenticated;
