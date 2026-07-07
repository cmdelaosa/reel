-- 0007_mark_up_to.sql
-- rpc_mark_up_to: bulk-mark every aired, unwatched, regular-season episode of
-- the target's title up to and including the target (season/episode order), in
-- ONE statement. Returns the created watch_event ids so the client's Undo can
-- delete exactly what this call created. security INVOKER — the insert runs
-- against the caller's own RLS policy (user_id must equal auth.uid()).

create function public.rpc_mark_up_to(p_episode_id uuid)
returns setof uuid
language sql
volatile
security invoker
as $$
  with target as (
    select e.title_id, e.season_number, e.episode_number
    from public.episodes e
    where e.id = p_episode_id
  )
  insert into public.watch_events (user_id, episode_id)
  select auth.uid(), e.id
  from public.episodes e
  join target t on e.title_id = t.title_id
  where e.season_number > 0                                   -- specials never auto-marked
    and e.air_datetime is not null
    and e.air_datetime <= now()                               -- unaired never marked
    and (e.season_number, e.episode_number) <= (t.season_number, t.episode_number)
    and not exists (
      select 1 from public.watch_events w
      where w.user_id = auth.uid() and w.episode_id = e.id
    )
  returning id;
$$;

grant execute on function public.rpc_mark_up_to(uuid) to authenticated;
