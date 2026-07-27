-- 0050_avdp_multilink.sql
-- One-off provisioning: multi-use invite REEL-AVDP (same mechanism as the
-- REEL-MAES3 and REEL-TAMMERS group links, see 0041/0045). Anyone redeeming it
-- gets accepted friendships with the code creator (cmdelaosa) and with every
-- prior redeemer of the code (group effect).
--
-- Idempotent, and a portable no-op where the handle doesn't exist.

insert into public.invites (code, created_by, expires_at, multi_use)
select 'REEL-AVDP', p.id, now() + interval '30 days', true
  from public.profiles p
 where p.handle = 'cmdelaosa'
on conflict (code) do nothing;
