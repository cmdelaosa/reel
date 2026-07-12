-- One-call authenticated invite gate for latency-sensitive Edge routes. Calling
-- auth.getUser() and then is_invited(uid) made two serial network round trips
-- for every title and every season. PostgREST validates the JWT before invoking
-- this function; auth.uid() binds the check to that caller.
create or replace function public.is_current_user_invited()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.invites where used_by = (select auth.uid())
    );
$$;

grant execute on function public.is_current_user_invited() to authenticated;

-- Lightweight detail-sheet bootstrap. The client previously downloaded every
-- cached episode of a title, paged in 1000-row chunks, just to choose the
-- opening season and count unseen episodes before a clicked episode. Do those
-- two reductions in Postgres and return a tiny JSON object instead.

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
    'unseen_before', (select counts from unseen)
  );
$$;

grant execute on function public.rpc_title_detail_progress(uuid) to authenticated;
