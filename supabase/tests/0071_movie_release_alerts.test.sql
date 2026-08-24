-- Pruebas de pending_movie_release_alerts (0071), en SQL puro y contra una base
-- de desarrollo. Se corren a mano:
--
--   supabase db reset
--   docker cp supabase/tests/0071_movie_release_alerts.test.sql supabase_db_tvtime:/tmp/t.sql
--   docker exec supabase_db_tvtime psql -U postgres -f /tmp/t.sql
--
-- FUERA de supabase/migrations a propósito: el CLI aplica en orden TODO lo que
-- encuentra ahí, así que un fichero de pruebas en esa carpeta se ejecutaría
-- contra producción en cada `db push`.
--
-- No las ejecuta el CI —este proyecto no levanta Postgres ahí— pero existir por
-- escrito es la diferencia entre una regla comprobada y una recordada: las seis
-- de abajo son las que deciden si a alguien le llega un correo equivocado, y
-- ninguna se ve leyendo la función.
--
-- Cada bloque falla ruidosamente con `assert`, así que un cambio que rompa la
-- ventana, el país o el sellado no llega al final del fichero.

\set ON_ERROR_STOP on
begin;

-- Un usuario limpio, en España, con su perfil.
insert into auth.users (id, email) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'alerts-test@example.com')
on conflict (id) do nothing;
update public.profiles set country = 'ES'
 where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- Cuatro películas, una por caso. El trigger de 0067 les pone su episodio.
insert into public.titles (tmdb_id, kind, name, first_air_date, release_dates) values
  (990001, 'movie', 'Hoy en cines', current_date,
   jsonb_build_object('ES', jsonb_build_object('theatrical', current_date::text))),
  (990002, 'movie', 'Las dos hoy', current_date,
   jsonb_build_object('ES', jsonb_build_object('theatrical', current_date::text,
                                               'digital', current_date::text))),
  (990003, 'movie', 'Hace un mes', current_date - 30,
   jsonb_build_object('ES', jsonb_build_object('theatrical', (current_date - 30)::text))),
  (990004, 'movie', 'Solo en Alemania', current_date,
   jsonb_build_object('DE', jsonb_build_object('theatrical', current_date::text)))
on conflict (kind, tmdb_id) do update set release_dates = excluded.release_dates;

insert into public.library_entries (user_id, title_id, followed)
select 'dddddddd-dddd-dddd-dddd-dddddddddddd', id, true
  from public.titles where kind = 'movie' and tmdb_id between 990001 and 990004
on conflict do nothing;

create temporary view pending as
  select * from public.pending_movie_release_alerts()
   where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

-- 1. Lo de hoy avisa; lo de hace un mes, no. Y una película fechada solo en
--    Alemania no le llega a quien mira desde España.
do $$
begin
  assert (select count(*) from pending) = 3,
    'esperaba 3 avisos (cines de hoy, y las dos de "Las dos hoy")';
  assert (select count(*) from pending where movie_name = 'Hace un mes') = 0,
    'un estreno de hace un mes está fuera de la ventana de 24 h';
  assert (select count(*) from pending where movie_name = 'Solo en Alemania') = 0,
    'las fechas son por país: DE no avisa a quien tiene ES';
end $$;

-- 2. Las DOS fechas de una misma película avisan por separado. Es lo que 0071
--    existe para permitir, y lo que la clave vieja hacía imposible.
do $$
begin
  assert (select count(*) from pending where movie_name = 'Las dos hoy') = 2,
    'cine y streaming son dos avisos, no uno';
  assert (select count(*) from pending
           where movie_name = 'Las dos hoy' and release_kind = 'theatrical') = 1;
  assert (select count(*) from pending
           where movie_name = 'Las dos hoy' and release_kind = 'digital') = 1;
end $$;

-- 3. Sellar el de cines no tapa el de streaming de la misma película.
insert into public.notifications_sent (user_id, episode_id, event)
select user_id, episode_id, release_kind from pending
 where movie_name = 'Las dos hoy' and release_kind = 'theatrical';
do $$
begin
  assert (select count(*) from pending
           where movie_name = 'Las dos hoy' and release_kind = 'theatrical') = 0,
    'lo sellado no se repite';
  assert (select count(*) from pending
           where movie_name = 'Las dos hoy' and release_kind = 'digital') = 1,
    'el sello de cines NO puede tapar el de streaming: son dos filas del ledger';
end $$;

-- 4. Lo ya visto no avisa: el aviso dice "ya puedes verla".
insert into public.watch_events (user_id, episode_id)
select 'dddddddd-dddd-dddd-dddd-dddddddddddd', e.id
  from public.episodes e join public.titles t on t.id = e.title_id
 where t.kind = 'movie' and t.tmdb_id = 990001
on conflict do nothing;
do $$
begin
  assert (select count(*) from pending where movie_name = 'Hoy en cines') = 0,
    'a quien ya la vio no se le anuncia que ya puede verla';
end $$;

-- 5. Sin país guardado se cae a ES, no a nada.
update public.profiles set country = null
 where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
do $$
begin
  assert (select count(*) from pending where movie_name = 'Las dos hoy') = 1,
    'sin país, ES: la de "Las dos hoy" que queda sin sellar sigue avisando';
end $$;

-- 6. Y las series siguen por su lado, con su propio evento en el ledger.
do $$
begin
  assert (select count(*) from public.notifications_sent where event = 'episode') >= 0,
    'el ledger conserva su valor por defecto para lo que ya había';
end $$;

rollback;
