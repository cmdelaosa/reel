-- Matriz de 0101: `eps`, el agregado de episodios del rollup, se resuelve desde
-- el índice sin ir al heap. Lo que vigila es lo que se pierde sin que nada más
-- se entere —el resultado del rollup es el mismo con el índice y sin él, así que
-- la matriz 0098 seguiría en verde—:
--
--   1. que `episodes_title_air_idx` sigue llevando `season_number` (una
--      migración que lo recree con la definición de 0002 lo devuelve al heap);
--   2. que el rollup, tal como está escrito, lo usa como Index Only Scan (una
--      reescritura de `eps` que lea otra columna de `episodes` también);
--   3. que `episodes` conserva su umbral de autovacuum: sin él el mapa de
--      visibilidad se queda a medias —53 % en producción el 19-sep-2026— y el
--      Index Only Scan vuelve al heap en la mitad de las filas.
--
-- Con cuatro filas el planificador prefiere recorrer la tabla, así que el §2 le
-- quita esa opción: lo que se pregunta es si PUEDE ir solo por el índice, no
-- cuál elige con datos de juguete. Lo que elige con datos de verdad está medido
-- en la cabecera de la migración y en su PR.
--
-- Transacción que acaba en rollback; tmdb_id 7101xx, marcados a propósito.

\set ON_ERROR_STOP on
begin;

-- ── 1. El índice lleva las tres columnas que lee `eps` ───────────────────
do $$
declare def text := (select indexdef from pg_indexes
                     where schemaname = 'public' and indexname = 'episodes_title_air_idx');
begin
  if def is null then
    raise exception '§1: no existe public.episodes_title_air_idx';
  end if;
  if def not like '%(title_id, air_datetime) INCLUDE (season_number)%' then
    raise exception '§1: episodes_title_air_idx ya no cubre `eps`: %', def;
  end if;
end $$;

-- ── 2. El rollup puede leer `eps` solo del índice ────────────────────────
insert into auth.users (id, email) values
  ('71017101-7101-7101-7101-710171017101', 'eps-0101@example.com')
on conflict (id) do nothing;
select set_config('request.jwt.claims',
  '{"sub":"71017101-7101-7101-7101-710171017101","role":"authenticated"}', true) \g /dev/null

with t as (
  insert into public.titles (tmdb_id, kind, name) values (710101, 'tv', 'serie 0101') returning id
), e as (
  insert into public.episodes (title_id, season_number, episode_number, air_datetime)
  select t.id, s, n, now() + ((2 * n - 3) || ' days')::interval
  from t, (values (0), (1)) s(s), generate_series(1, 2) n
  returning 1
)
insert into public.library_entries (user_id, title_id, followed)
select '71017101-7101-7101-7101-710171017101', t.id, true from t;

set local enable_seqscan = off;
set local enable_bitmapscan = off;
set local role authenticated;

do $$
declare l text; plan text := '';
begin
  -- Las columnas de `eps` SE LEEN: con un count(*) a secas el planificador
  -- quita el join y no hay nada que mirar (la trampa de 0098).
  for l in explain (costs off)
    select sum(aired_count), count(last_aired_datetime), count(next_air_datetime)
    from public.rpc_library_rollup('tv')
  loop
    plan := plan || l || E'\n';
  end loop;
  if plan not like '%Index Only Scan using episodes_title_air_idx on episodes%' then
    raise exception E'§2: `eps` ya no sale del índice solo. Plan:\n%', plan;
  end if;
end $$;

-- Y el resultado, que el índice no lo cambia: 1 emitido de temporada > 0 (el de
-- la 0 no cuenta), y hay último y próximo.
do $$
declare r record;
begin
  select aired_count, last_aired_datetime is not null as hay_ultimo,
         next_air_datetime is not null as hay_proximo
  into r from public.rpc_library_rollup('tv') where tmdb_id = 710101;
  if r is null or r.aired_count <> 1 or not r.hay_ultimo or not r.hay_proximo then
    raise exception '§2: el rollup de la serie de prueba no cuadra: %', r;
  end if;
end $$;

reset role;

-- ── 3. El umbral de autovacuum de `episodes` sigue puesto ────────────────
do $$
declare o text[] := (select reloptions from pg_class where oid = 'public.episodes'::regclass);
begin
  if o is null
     or not ('autovacuum_vacuum_threshold=200' = any (o))
     or not ('autovacuum_vacuum_scale_factor=0.01' = any (o)) then
    raise exception '§3: episodes perdió su umbral de autovacuum: %', o;
  end if;
end $$;

\echo '0101: eps sale del índice, y el autovacuum de episodes tiene su umbral'
rollback;
