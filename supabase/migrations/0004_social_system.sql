-- 0004_social_system.sql
-- Social & system: friendships, notifications, notification_prefs, import_jobs.
-- See docs/ARCHITECTURE.md → Social & system.
--
-- Friendship state machine (enforced by RLS):
--   requester inserts a `pending` row (canonical a < b) → the OTHER participant
--   flips it to `accepted` → either participant may delete (decline/unfriend).
--   The requester cannot accept their own request.

-- ============================================================
-- friendships — one row per pair, canonical order a < b.
-- ============================================================
create table public.friendships (
  a            uuid not null references public.profiles on delete cascade,
  b            uuid not null references public.profiles on delete cascade,
  requested_by uuid not null references public.profiles on delete cascade,
  status       text not null check (status in ('pending','accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (a, b),
  check (a < b),
  check (requested_by in (a, b))
);
create index friendships_b_idx on public.friendships (b);  -- pk covers a=me; this covers b=me

alter table public.friendships enable row level security;

revoke all on public.friendships from anon, authenticated;
grant select, insert, update, delete on public.friendships to authenticated;
grant all on public.friendships to service_role;

-- Both participants can see the row.
create policy "friendships: participants read"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (a, b));

-- Only a participant may open a request, as themselves, and only pending.
create policy "friendships: requester opens pending"
  on public.friendships for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and (select auth.uid()) in (a, b)
    and status = 'pending'
  );

-- Accept: only the OTHER participant may flip a pending row to accepted.
-- USING (old row) gates who/what can be updated; WITH CHECK (new row) gates the
-- result. Requester fails USING → cannot self-accept.
create policy "friendships: other accepts"
  on public.friendships for update to authenticated
  using (
    (select auth.uid()) in (a, b)
    and requested_by <> (select auth.uid())
    and status = 'pending'
  )
  with check (
    (select auth.uid()) in (a, b)
    and requested_by <> (select auth.uid())
    and status = 'accepted'
  );

-- Either participant may decline (pending) or unfriend (accepted).
create policy "friendships: participant deletes"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (a, b));

-- Accepted friendship test (either order). security definer so it can read
-- friendships past RLS; used by Phase 4 friend-read policies + RPCs.
create function public.is_friend(u1 uuid, u2 uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and a = least(u1, u2)
       and b = greatest(u1, u2)
  );
$$;

grant execute on function public.is_friend(uuid, uuid) to authenticated;

-- ============================================================
-- notifications — system-generated inbox. Users read / mark read / delete
-- their own; only the service role (Edge Functions) inserts.
-- ============================================================
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  type       text not null,                         -- new_episode | premiere | friend_request | import_done | …
  payload    jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

revoke all on public.notifications from anon, authenticated;
grant select, update, delete on public.notifications to authenticated;   -- no insert: system-generated
grant all on public.notifications to service_role;

create policy "notifications: owner reads"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications: owner marks read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "notifications: owner deletes"
  on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- notification_prefs — per-type in-app/email toggles, user-owned.
-- ============================================================
create table public.notification_prefs (
  user_id uuid not null references public.profiles on delete cascade,
  type    text not null,
  inapp   boolean not null default true,
  email   boolean not null default false,
  primary key (user_id, type)
);

alter table public.notification_prefs enable row level security;

revoke all on public.notification_prefs from anon, authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;
grant all on public.notification_prefs to service_role;

create policy "notification_prefs: owner all"
  on public.notification_prefs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================
-- import_jobs — a user kicks one off (insert); the worker (service role)
-- advances status + report.
-- ============================================================
create table public.import_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles on delete cascade,
  kind        text not null default 'tvtime_zip',
  status      text not null default 'pending' check (status in ('pending','running','done','error')),
  report      jsonb not null default '{}',           -- matched/unmatched counts, per-show results
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index import_jobs_user_created_idx on public.import_jobs (user_id, created_at desc);

alter table public.import_jobs enable row level security;

revoke all on public.import_jobs from anon, authenticated;
grant select, insert on public.import_jobs to authenticated;   -- no update/delete: worker advances it
grant all on public.import_jobs to service_role;

create policy "import_jobs: owner reads"
  on public.import_jobs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "import_jobs: owner inserts own"
  on public.import_jobs for insert to authenticated
  with check (user_id = (select auth.uid()));
