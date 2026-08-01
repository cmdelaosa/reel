-- 0059_alerts_by_show_status.sql
-- New-episode alerts follow the show's status, instead of firing for every
-- followed title.
--
-- Before this, pending_new_episode_alerts() (0012) asked one question: is the
-- title followed? So a library of 390 shows alerted on all 390 — including the
-- ones sitting untouched in the backlog, and the ones explicitly stopped, even
-- though 0022 claims stopping a show turns its notifications off. It never did;
-- this migration is what makes that comment true.
--
-- The buckets are app/src/domain/status.ts (aired vs watched, plus TMDB's
-- status): upcoming | watchlist | watching | caughtup | finished. Alerts now
-- fire for **watching, caughtup and upcoming** and stay quiet for watchlist and
-- finished.
--
-- The catch, and why this isn't a literal transcription of deriveStatus: by the
-- time the job runs, the episode has already aired, so the show has already
-- moved bucket. A premiere turns an `upcoming` show into `watchlist` (1 aired,
-- 0 watched) at that exact moment — filtering on the *current* bucket would
-- swallow precisely the premieres we mean to announce. So the status is judged
-- as it was **immediately before this episode aired**, which collapses to two
-- cheap predicates:
--
--   watched at least one episode  → was watching / caughtup (or a revived
--                                   finished show, which the app re-labels
--                                   `watching` the moment this episode lands)
--   nothing aired before this one → was upcoming: this is the series premiere
--
-- and their complement is exactly the two buckets we want silent: a show with
-- earlier aired episodes and nothing watched is the untouched backlog
-- (`watchlist`), and a fully-watched Ended show only reaches here if it came
-- back, which is not the `finished` case but a revival.
--
-- Specials (season 0) stay excluded on both sides of the comparison, the way
-- rpc_library_rollup counts them.

create or replace function public.pending_new_episode_alerts()
returns table (
  user_id uuid,
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  show_name text,
  season_number int,
  episode_number int,
  episode_name text
)
language sql
security invoker
stable
as $$
  select le.user_id, e.id, t.id, t.tmdb_id, t.name, e.season_number, e.episode_number, e.name
  from public.episodes e
  join public.titles t on t.id = e.title_id
  join public.library_entries le on le.title_id = t.id and le.followed
  where e.season_number > 0
    and e.air_datetime > now() - interval '24 hours'
    and e.air_datetime <= now()
    and not le.stopped
    and (
      -- watching / caught up: the user has started this show
      exists (
        select 1
        from public.watch_events we
        join public.episodes we_e on we_e.id = we.episode_id
        where we.user_id = le.user_id
          and we_e.title_id = t.id
          and we_e.season_number > 0
      )
      -- upcoming: nothing of this show had aired yet, so this is the premiere
      or not exists (
        select 1
        from public.episodes e2
        where e2.title_id = t.id
          and e2.season_number > 0
          and e2.air_datetime < e.air_datetime
          and e2.air_datetime <= now()
      )
    )
    and not exists (
      select 1 from public.notifications_sent ns
      where ns.user_id = le.user_id and ns.episode_id = e.id
    )
$$;

grant execute on function public.pending_new_episode_alerts() to service_role;

-- ── friend requests now honour the preference that claimed to control them ───
-- The Settings toggle has always written notification_prefs, but this trigger
-- never read it, so turning "Friend requests / App" off did nothing at all.
-- Same shape as the reaction trigger in 0058: absent row = on.
create or replace function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := case when new.a = new.requested_by then new.b else new.a end;
  v_handle text;
  v_name text;
begin
  if new.status <> 'pending' then return new; end if;

  if not coalesce(
       (select inapp from public.notification_prefs
         where user_id = v_target and type = 'friend_request'), true) then
    return new;
  end if;

  select handle::text, display_name into v_handle, v_name
    from public.profiles where id = new.requested_by;
  insert into public.notifications (user_id, type, payload)
  values (v_target, 'friend_request',
          jsonb_build_object('from_id', new.requested_by, 'from_handle', v_handle, 'from_name', v_name));
  return new;
end;
$$;

-- ── retire the `premiere` type ───────────────────────────────────────────────
-- It has had two toggles in Settings since 0004 and no producer has ever
-- emitted one: "when a followed upcoming show gets a date" was never built, and
-- a premiere that airs is now covered by the upcoming branch above. Drop the
-- rows so the table stops implying the feature exists.
delete from public.notification_prefs where type = 'premiere';
