-- Local dev seed — loaded by `supabase db reset` / `supabase start`. Runs as the
-- postgres superuser and NEVER in production. Two parts: open invite codes to walk
-- the redeem flow, and three ready-to-use demo accounts (all password: password123)
-- that the Playwright smoke test and manual dogfooding expect.
--
-- It seeds identity + social only. The author's real TV Time history is imported
-- separately (scripts/tvtime-import) from the gitignored GDPR export.

-- ── open invite codes ───────────────────────────────────────────────────────
insert into public.invites (code) values
  ('REEL-ALPHA'),
  ('REEL-BRAVO'),
  ('REEL-CHARLIE')
on conflict (code) do nothing;

-- ── demo accounts ───────────────────────────────────────────────────────────
-- Fixed UUIDs so re-seeds and cross-references stay stable. Created the same way
-- GoTrue would: a confirmed auth.users row + matching email identity, so the
-- password grant the e2e uses works. Idempotent via ON CONFLICT DO NOTHING; the
-- signup trigger creates each profile, which we then onboard (real handle).
do $$
declare
  demo record;
  users constant jsonb := '[
    {"id":"aa8cae89-a0db-4bde-8b01-59e9bf452205","email":"cmo@example.com","handle":"cmdelaosa","name":"Carlos"},
    {"id":"69e26959-bf65-4b45-8964-19a4c62c9e1b","email":"ana@example.com","handle":"ana","name":"Ana Ruiz"},
    {"id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","email":"leo@example.com","handle":"leo","name":"Leo Park"}
  ]'::jsonb;
begin
  for demo in select * from jsonb_to_recordset(users) as x(id uuid, email text, handle text, name text)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', demo.id, 'authenticated', 'authenticated',
      demo.email, extensions.crypt('password123', extensions.gen_salt('bf')), now(),
      now(), now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('name', demo.name), '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      extensions.gen_random_uuid(), demo.id, demo.id::text, 'email',
      jsonb_build_object('sub', demo.id::text, 'email', demo.email), now(), now(), now()
    ) on conflict do nothing;

    -- onboard: replace the signup-trigger placeholder handle with the real one
    update public.profiles set handle = demo.handle, display_name = demo.name where id = demo.id;

    -- gate: mark invited so they clear RequireInvited
    insert into public.invites (code, created_by, used_by)
    values ('SEED-' || demo.handle, demo.id, demo.id)
    on conflict (code) do nothing;
  end loop;

  -- Carlos is accepted friends with both others (canonical a < b).
  insert into public.friendships (a, b, requested_by, status, accepted_at)
  select least(c.id, o.id), greatest(c.id, o.id), o.id, 'accepted', now()
  from (values ('aa8cae89-a0db-4bde-8b01-59e9bf452205'::uuid)) c(id)
  cross join (values
    ('69e26959-bf65-4b45-8964-19a4c62c9e1b'::uuid),
    ('7c9e6679-7425-40de-944b-e07fc1f90ae7'::uuid)
  ) o(id)
  on conflict do nothing;
end $$;
