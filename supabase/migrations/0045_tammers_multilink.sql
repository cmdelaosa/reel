-- 0045_tammers_multilink.sql
-- One-off provisioning: multi-use invite REEL-TAMMERS (same mechanism as the
-- REEL-MAES3 group link, see 0041). Anyone redeeming it gets accepted
-- friendships with the code creator (cmdelaosa) and with every prior redeemer
-- of the code — kman is seeded as a redemption row so day-one joiners befriend
-- him too, and later joiners also befriend each other (group effect).
--
-- Idempotent, and a portable no-op where the handles don't exist.

insert into public.invites (code, created_by, expires_at, multi_use)
select 'REEL-TAMMERS', p.id, now() + interval '30 days', true
  from public.profiles p
 where p.handle = 'cmdelaosa'
on conflict (code) do nothing;

-- Seeding kman here is what puts him in redeem_invite's friendship fan-out;
-- it also (harmlessly) counts as his invite-gate pass in is_invited.
insert into public.invite_redemptions (code, redeemed_by)
select 'REEL-TAMMERS', p.id
  from public.profiles p
 where p.handle = 'kman'
   and exists (select 1 from public.invites i where i.code = 'REEL-TAMMERS')
on conflict (code, redeemed_by) do nothing;
