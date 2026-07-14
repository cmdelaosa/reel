-- 0044_mark_series.sql
-- "Mark series watched": bulk-mark every aired, unwatched, regular-season
-- episode of a title in one statement — the detail-sheet button for adding a
-- show you've already seen without hunting for its last episode. Returns the
-- created watch_event ids so the client's Undo can delete exactly this batch
-- (same contract as rpc_mark_up_to, 0007). security INVOKER — the insert runs
-- against the caller's own RLS policy (user_id must equal auth.uid()).

create function public.rpc_mark_series(p_title_id uuid)
returns setof uuid
language sql
volatile
security invoker
as $$
  insert into public.watch_events (user_id, episode_id)
  select auth.uid(), e.id
  from public.episodes e
  where e.title_id = p_title_id
    and e.season_number > 0                                   -- specials never auto-marked
    and e.air_datetime is not null
    and e.air_datetime <= now()                               -- unaired never marked
    and not exists (
      select 1 from public.watch_events w
      where w.user_id = auth.uid() and w.episode_id = e.id
    )
  returning id;
$$;

grant execute on function public.rpc_mark_series(uuid) to authenticated;

-- rpc_title_detail_progress also reports how many aired regular-season
-- episodes the caller hasn't watched ('unwatched_aired'), so the sheet knows
-- whether to offer "Mark all watched" without downloading every episode.
create or replace function public.rpc_title_detail_progress(p_title_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with regular_seasons as (
    select s.number
    from public.seasons s
    where s.title_id = p_title_id
      and s.number > 0
      -- Announced placeholder seasons can have no count, date or episodes.
      -- They remain visible as tabs but must not become the default and leave
      -- the detail sheet on an eternal "Loading episodes…" state.
      and coalesce(s.episode_count, 0) > 0
  ),
  first_unwatched as (
    select e.season_number
    from public.episodes e
    where e.title_id = p_title_id
      and e.season_number > 0
      and e.air_datetime is not null
      and e.air_datetime <= now()
      and not exists (
        select 1
        from public.watch_events w
        where w.user_id = (select auth.uid()) and w.episode_id = e.id
      )
    order by e.season_number, e.episode_number
    limit 1
  ),
  next_upcoming as (
    select e.season_number
    from public.episodes e
    where e.title_id = p_title_id
      and e.season_number > 0
      and e.air_datetime > now()
    order by e.air_datetime, e.season_number, e.episode_number
    limit 1
  ),
  bounds as (
    select
      min(number) as first_season,
      max(number) as last_season
    from regular_seasons
  ),
  choice as (
    select coalesce(
      (select season_number from first_unwatched),
      (select season_number from next_upcoming),
      case
        when exists (
          select 1
          from public.watch_events w
          join public.episodes e on e.id = w.episode_id
          where w.user_id = (select auth.uid()) and e.title_id = p_title_id
        ) then b.last_season
        else b.first_season
      end
    ) as recommended_season
    from bounds b
  ),
  unseen as (
    select coalesce(
      jsonb_object_agg(
        s.number::text,
        (
          select count(*)
          from public.episodes e
          where e.title_id = p_title_id
            and e.season_number > 0
            and e.season_number < s.number
            and e.air_datetime is not null
            and e.air_datetime <= now()
            and not exists (
              select 1
              from public.watch_events w
              where w.user_id = (select auth.uid()) and w.episode_id = e.id
            )
        )
      ),
      '{}'::jsonb
    ) as counts
    from regular_seasons s
  )
  select jsonb_build_object(
    'recommended_season', (select recommended_season from choice),
    'unseen_before', (select counts from unseen),
    'unwatched_aired', (
      select count(*)
      from public.episodes e
      where e.title_id = p_title_id
        and e.season_number > 0
        and e.air_datetime is not null
        and e.air_datetime <= now()
        and not exists (
          select 1
          from public.watch_events w
          where w.user_id = (select auth.uid()) and w.episode_id = e.id
        )
    )
  );
$$;

grant execute on function public.rpc_title_detail_progress(uuid) to authenticated;
