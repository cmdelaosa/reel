-- Local dev seed — loaded by `supabase db reset`. Never runs in production.
-- Three open invite codes so you can walk the redeem flow locally.
insert into public.invites (code) values
  ('REEL-ALPHA'),
  ('REEL-BRAVO'),
  ('REEL-CHARLIE')
on conflict (code) do nothing;
