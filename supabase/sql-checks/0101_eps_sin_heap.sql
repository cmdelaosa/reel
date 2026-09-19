-- Matriz de 0101: `eps`, el agregado de episodios del rollup, se puede resolver
-- desde el índice sin ir al heap. Lo que vigila es lo que se pierde sin que
-- nada más se entere —el resultado del rollup es el mismo con el índice y sin
-- él, así que la matriz 0098 seguiría en verde—:
--
--   1. que `episodes_title_air_idx` sigue llevando `season_number` (una
--      migración que lo recree con la definición de 0002 lo devuelve al heap);
--   2. que el rollup no lee de `episodes` ninguna columna que el índice no
--      tenga (una reescritura de `eps` que lea otra lo devuelve al heap también);
--   3. que `episodes` conserva su umbral de autovacuum: sin él el mapa de
--      visibilidad se queda a medias —53 % en producción el 19-sep-2026— y el
--      Index Only Scan vuelve al heap en la mitad de las filas.
--
-- El §2 mira el TEXTO de la función y no su plan, a propósito. El plan depende
-- de las estadísticas: sobre la tabla recién creada del CI, sin un solo VACUUM,
-- el planificador no ve ventaja en el Index Only Scan y elige otro índice, y una
-- matriz que corre en una transacción no puede pasar un VACUUM. La primera
-- versión de esta matriz miraba el plan, pasó en una base local vacunada y
-- falló en otra recién vaciada. Lo que el planificador elige con datos de verdad
-- está medido en la cabecera de la migración y en su PR.
--
-- Transacción que acaba en rollback.

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

-- ── 2. El rollup solo lee de `episodes` lo que el índice tiene ───────────
-- `e` es el alias de `episodes` en `eps`, y es el único sitio de la función
-- donde se lee la tabla. `\m` es principio de palabra: `le.` y `tk.` no cuentan.
do $$
declare
  cuerpo text := pg_get_functiondef('public.rpc_library_rollup(text)'::regprocedure);
  sobran text;
begin
  if cuerpo !~ 'from public\.episodes e\M' then
    raise exception '§2: `eps` ya no lee `public.episodes e`; esta matriz no sabe qué mirar';
  end if;
  select string_agg(distinct c[1], ', ') into sobran
  from regexp_matches(cuerpo, '\me\.([a-z_]+)', 'g') c
  where c[1] not in ('title_id', 'air_datetime', 'season_number');
  if sobran is not null then
    raise exception '§2: el rollup lee de episodes columnas que el índice no tiene: %', sobran;
  end if;
end $$;

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

\echo '0101: eps cabe en el índice, y el autovacuum de episodes tiene su umbral'
rollback;
