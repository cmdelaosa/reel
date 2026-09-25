-- 0106_service_role_explicito.sql
-- `service_role` recibe permisos explícitos en las cuatro tablas de public que
-- no se los daban.
--
-- POR QUÉ. Desde el 2026-10-30 Supabase deja de conceder solo el acceso de la
-- Data API a las tablas nuevas de public. Eso incluye las que se crean al
-- aplicar migraciones desde cero: `supabase db reset` en local, ramas de
-- preview o un proyecto nuevo. Casi todas las migraciones ya hacían «revoke
-- all y luego grant», pero en estas cuatro el grant a service_role faltaba y
-- dependía del permiso automático:
--
--   profiles            — steam-sync y nintendo-sync la leen y la escriben con
--                         la clave de service_role. Sin el grant, vincular
--                         Steam o Nintendo fallaría con «permission denied».
--   invites
--   invite_redemptions  — no tenía grant para nadie; solo la tocan funciones
--                         security definer, que siguen funcionando.
--   activity_reactions
--
-- En producción no cambia nada: estas tablas ya tienen el permiso heredado, así
-- que el grant no hace nada. anon sigue sin acceso, igual que en el resto del
-- esquema.

grant all on public.profiles           to service_role;
grant all on public.invites            to service_role;
grant all on public.invite_redemptions to service_role;
grant all on public.activity_reactions to service_role;
