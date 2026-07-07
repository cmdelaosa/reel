-- 0011_realtime_notifications.sql
-- Realtime for the notifications inbox only (ARCHITECTURE: nothing else
-- subscribes). RLS still applies to realtime, so a client receives only its
-- own rows via the owner-select policy from 0004.

alter publication supabase_realtime add table public.notifications;
