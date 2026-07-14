-- 0042_invite_gate_multi_use.sql
-- is_current_user_invited() (0033) was the one-round-trip invite gate for the
-- tmdb-proxy edge function, but it still checked only invites.used_by. Multi-use
-- redemptions (0041) live in invite_redemptions, so multi-use users passed the
-- client gate (is_invited) yet got 403 from every tmdb-proxy call — search,
-- discovery and uncached title loads all failed for them. Delegate to
-- is_invited(), the single source of truth, so the two gates can't drift again.
create or replace function public.is_current_user_invited()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and public.is_invited((select auth.uid()));
$$;
