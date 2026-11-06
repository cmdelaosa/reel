-- Matriz de 0107: `aplicar_grupo_de_episodios`, que pasa una serie que ya tiene
-- filas a la numeración de un grupo de episodios de TMDB. Lo que se comprueba
-- es lo que importa al usuario: que cada visionado sigue en EL MISMO episodio
-- —con otro número—, no en el que ahora ocupa su número viejo.
--
--   supabase/sql-checks/correr.sh         # todas
--   docker exec -i supabase_db_tvtime psql -U postgres -f - < supabase/sql-checks/0107_grupo_de_episodios.sql
--
-- La serie es Lupin en pequeño: en TMDB, T1 de 10 (Partes 1 y 2), T2 de 7
-- (Parte 3) y T3 de 2 (Parte 4); en el grupo, cuatro temporadas de 5, 5, 7 y 2.
-- Todo dentro de una transacción que acaba en `rollback`. Los tmdb_id son
-- 7107xx, marcados a propósito: un número alto NO es un rango seguro.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('eeeeeeee-0107-0107-0107-eeeeeeeeeeee', 'grupo-0107@example.com')
on conflict (id) do nothing;

insert into public.titles (tmdb_id, kind, name, last_refreshed_at, episodes_refreshed_at) values
  (710701, 'tv', '0107 partes', now(), now()),
  (710702, 'tv', '0107 con un episodio sin sitio', now(), now());

insert into public.seasons (title_id, number, episode_count)
select t.id, s.n, s.c from public.titles t, (values (1, 10), (2, 7), (3, 2)) s(n, c)
where t.tmdb_id in (710701, 710702);

-- Cada fila lleva en el nombre su número de TMDB, para poder seguirla.
insert into public.episodes (title_id, season_id, season_number, episode_number, name, air_datetime, imdb_id, imdb_rating)
select t.id, s.id, s.number, en, format('T%sE%s', s.number, en), now() - interval '30 days',
       format('tt%s%s', s.number, en), 7.5
from public.titles t
join public.seasons s on s.title_id = t.id
cross join lateral generate_series(1, s.episode_count) en
where t.tmdb_id in (710701, 710702);

insert into public.library_entries (user_id, title_id, followed)
select 'eeeeeeee-0107-0107-0107-eeeeeeeeeeee', t.id, true from public.titles t where t.tmdb_id = 710701;

-- Vistos: la T1·E6 de TMDB (Parte 2·E1) y la T2·E1 (Parte 3·E1). La segunda es
-- la trampa: su número viejo, 2·1, es el que el grupo da a la Parte 2·E1.
insert into public.watch_events (user_id, episode_id, watched_at)
select 'eeeeeeee-0107-0107-0107-eeeeeeeeeeee', e.id, '2026-01-10'
from public.episodes e join public.titles t on t.id = e.title_id
where t.tmdb_id = 710701 and (e.season_number, e.episode_number) in ((1, 6), (2, 1));

create function pg_temp.temporadas() returns jsonb language sql as $$
  select '[{"number":1,"name":"Part 1","episode_count":5,"air_date":"2021-01-08","tmdb_id":null},
           {"number":2,"name":"Part 2","episode_count":5,"air_date":"2021-06-11","tmdb_id":null},
           {"number":3,"name":"Part 3","episode_count":7,"air_date":"2023-10-05","tmdb_id":null},
           {"number":4,"name":"Part 4","episode_count":2,"air_date":"2026-10-23","tmdb_id":null}]'::jsonb
$$;

-- El reparto: T1·E1-5 → 1·1-5, T1·E6-10 → 2·1-5, T2 → 3, T3 → 4.
create function pg_temp.episodios() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('de', de, 'season', s, 'episode', e))
  from (
    select '1:' || n as de, case when n <= 5 then 1 else 2 end as s, case when n <= 5 then n else n - 5 end as e
    from generate_series(1, 10) n
    union all select '2:' || n, 3, n from generate_series(1, 7) n
    union all select '3:' || n, 4, n from generate_series(1, 2) n
  ) r
$$;

-- ── 1. Aplicar ────────────────────────────────────────────────────────────
do $$ declare movidas int; begin
  select public.aplicar_grupo_de_episodios(
    (select id from public.titles where tmdb_id = 710701), 'grupo-0107', pg_temp.temporadas(), pg_temp.episodios()
  ) into movidas;
  assert movidas = 19, format('tenía que mover las 19 filas y dice %s', movidas);
end $$;

-- ── 2. Cada visionado sigue en su episodio ────────────────────────────────
do $$ declare vistos text; begin
  select string_agg(format('%s·%s=%s', e.season_number, e.episode_number, e.name), ' ' order by e.season_number)
    into vistos
  from public.watch_events w join public.episodes e on e.id = w.episode_id
  where w.user_id = 'eeeeeeee-0107-0107-0107-eeeeeeeeeeee';
  assert vistos = '2·1=T1E6 3·1=T2E1', format('los visionados han cambiado de episodio: %s', vistos);
end $$;

-- ── 3. Números, temporadas y su season_id ─────────────────────────────────
do $$ declare r record; begin
  select string_agg(format('%s:%s', s.number, (select count(*) from public.episodes e where e.season_id = s.id)), ' ' order by s.number) as reparto,
         string_agg(s.name, '|' order by s.number) as nombres
    into r
  from public.seasons s join public.titles t on t.id = s.title_id where t.tmdb_id = 710701;
  assert r.reparto = '1:5 2:5 3:7 4:2', format('reparto de temporadas: %s', r.reparto);
  assert r.nombres = 'Part 1|Part 2|Part 3|Part 4', format('nombres: %s', r.nombres);

  select count(*) as n into r
  from public.episodes e join public.seasons s on s.id = e.season_id
  where e.title_id = (select id from public.titles where tmdb_id = 710701) and s.number <> e.season_number;
  assert r.n = 0, format('%s episodios cuelgan de una temporada con otro número', r.n);

  select string_agg(e.name, ' ' order by e.episode_number) as nombres into r
  from public.episodes e join public.titles t on t.id = e.title_id
  where t.tmdb_id = 710701 and e.season_number = 2;
  assert r.nombres = 'T1E6 T1E7 T1E8 T1E9 T1E10', format('la temporada 2 tiene: %s', r.nombres);
end $$;

-- ── 4. Las notas de IMDb: fuera las que cambian de número, dentro las demás ─
do $$ declare r record; begin
  select count(*) filter (where e.imdb_rating is not null) as con_nota,
         string_agg(e.name, ' ' order by e.season_number, e.episode_number) filter (where e.imdb_rating is not null) as cuales
    into r
  from public.episodes e join public.titles t on t.id = e.title_id where t.tmdb_id = 710701;
  -- Solo la Parte 1 (T1·E1-5) conserva su número, y con él su nota.
  assert r.con_nota = 5 and r.cuales = 'T1E1 T1E2 T1E3 T1E4 T1E5', format('con nota: %s (%s)', r.con_nota, r.cuales);
end $$;

-- ── 5. El contador sellado (0100) no se mueve: son los mismos dos ─────────
do $$ declare n int; begin
  select le.watched_count into n from public.library_entries le join public.titles t on t.id = le.title_id
  where t.tmdb_id = 710701 and le.user_id = 'eeeeeeee-0107-0107-0107-eeeeeeeeeeee';
  assert n = 2, format('watched_count = %s', n);
end $$;

-- ── 6. La serie queda marcada y pendiente de refresco ─────────────────────
do $$ declare r record; begin
  select episode_group_id, last_refreshed_at, episodes_refreshed_at into r from public.titles where tmdb_id = 710701;
  assert r.episode_group_id = 'grupo-0107', format('episode_group_id = %s', r.episode_group_id);
  assert r.last_refreshed_at is null and r.episodes_refreshed_at is null, 'las marcas de frescura siguen puestas';
end $$;

-- ── 7. Dos veces no: sus números ya no son los de TMDB ────────────────────
do $$ declare msg text; begin
  begin
    perform public.aplicar_grupo_de_episodios(
      (select id from public.titles where tmdb_id = 710701), 'otro', pg_temp.temporadas(), pg_temp.episodios());
  exception when others then msg := sqlerrm;
  end;
  assert msg like '%ya tiene grupo%', format('la segunda vez tenía que negarse y dice: %s', msg);
end $$;

-- ── 8. Una fila sin sitio: se niega, la nombra y no toca nada ─────────────
do $$ declare msg text; r record; begin
  insert into public.episodes (title_id, season_number, episode_number, name)
  select id, 1, 11, 'T1E11' from public.titles where tmdb_id = 710702;
  begin
    perform public.aplicar_grupo_de_episodios(
      (select id from public.titles where tmdb_id = 710702), 'grupo-0107', pg_temp.temporadas(), pg_temp.episodios());
  exception when others then msg := sqlerrm;
  end;
  assert msg like '%sin sitio%1:11%', format('tenía que nombrar el 1:11 y dice: %s', msg);
  select t.episode_group_id, (select count(*) from public.episodes e where e.title_id = t.id and e.season_number = 1) as t1
    into r from public.titles t where t.tmdb_id = 710702;
  assert r.episode_group_id is null and r.t1 = 11, format('ha tocado algo: grupo %s, T1 con %s', r.episode_group_id, r.t1);
end $$;

-- ── 8b. Una serie que no está (un tmdb_id equivocado da null): se niega ────
do $$ declare msg text; begin
  begin
    perform public.aplicar_grupo_de_episodios(
      (select id from public.titles where tmdb_id = -1), 'grupo-0107', pg_temp.temporadas(), pg_temp.episodios());
  exception when others then msg := sqlerrm;
  end;
  assert msg like '%ninguna serie%', format('tenía que negarse por la serie y dice: %s', msg);
end $$;

-- ── 9. Solo service_role ──────────────────────────────────────────────────
do $$ begin
  assert not has_function_privilege('authenticated', 'public.aplicar_grupo_de_episodios(uuid, text, jsonb, jsonb)', 'execute'),
    'authenticated puede renumerar series';
  assert not has_function_privilege('anon', 'public.aplicar_grupo_de_episodios(uuid, text, jsonb, jsonb)', 'execute'),
    'anon puede renumerar series';
end $$;

rollback;
