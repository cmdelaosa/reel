-- Matriz de `rpc_library_rollup`: lo que promete cada columna contada y que no
-- se ve leyendo la función. Nació con 0098, que cambió las dos `left join
-- lateral` por agregados agrupados; lo de aquí es lo que tenía que seguir
-- valiendo IGUAL después de ese cambio, y sigue valiendo para quien la toque
-- mañana. Se corre así:
--
--   supabase db reset
--   docker cp supabase/sql-checks/0098_rollup_sin_laterales.sql supabase_db_tvtime:/tmp/t.sql
--   docker exec supabase_db_tvtime psql -U postgres -f /tmp/t.sql
--
-- CÓMO SE COMPROBÓ EL CAMBIO DE 0098, que es distinto de lo que hay aquí: con
-- las dos definiciones vivas a la vez —la vieja copiada bajo otro nombre— y `EXCEPT ALL` en los DOS sentidos sobre estos mismos datos. Cero
-- diferencias, y al romper a propósito el filtro de especiales salían 1, que es
-- lo que demuestra que la comparación miraba. Eso no se puede dejar aquí
-- —después de fusionar la definición vieja ya no existe—, así que lo que queda
-- es esta matriz de comportamiento. Si algún día hay que repetir la jugada, el
-- método está en dos líneas: copiar la definición anterior con otro nombre y
-- restar los dos conjuntos en ambos sentidos.
--
-- ⚠️ Y LA ANTERIOR ES LA DEL NÚMERO MÁS ALTO, no la que uno recuerda. La primera
-- vez se copió la de 0080 cuando la vigente era la de 0083, y el EXCEPT dio cero
-- diferencias con toda la razón: comparaba dos definiciones igual de atrasadas.
-- Faltaban `backdrop_path` y `played_platform` y ninguna red lo vio. Por eso
-- existe el §0 de abajo.
--
-- Todo va dentro de una transacción que acaba en `rollback`, y los tmdb_id son
-- 7000xx —marcados a propósito, que un número alto NO es un rango seguro— por
-- si algún día alguien se deja el rollback.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'rollup-0098@example.com'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'rollup-0098-otro@example.com')
on conflict (id) do nothing;

select set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}',
  true
);
do $$ begin
  assert (select auth.uid()) = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'el claim no ha entrado: el resto del fichero no probaria nada';
end $$;

-- ── El escenario: un título por cada cosa que puede salir mal ─────────────
insert into public.titles (tmdb_id, kind, name, aired_count) values
  (700001, 'tv',    'larga con vistos y futuro',  null),
  (700002, 'tv',    'solo especiales',            null),
  (700003, 'tv',    'sin un solo episodio',       null),
  (700004, 'movie', 'peli',                       null),
  (700005, 'game',  'juego',                      null),
  (700006, 'tv',    'con aired_count sellado',    42),
  (700007, 'tv',    'de otro usuario',            null),
  (700008, 'tv',    'vista pero sin seguir',      null),
  (700009, 'tv',    'entera en el futuro',        null);

-- 700001: tres emitidos, un especial (temporada 0) y dos por emitir.
insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, s.sn, s.en, s.air from public.titles t,
  (values (1,1,now() - interval '30 days'),
          (1,2,now() - interval '23 days'),
          (1,3,now() - interval '16 days'),
          (0,1,now() - interval '40 days'),
          (1,4,now() + interval '5 days'),
          (1,5,now() + interval '12 days')) as s(sn,en,air)
where t.tmdb_id = 700001;

insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, 0, 1, now() - interval '10 days' from public.titles t where t.tmdb_id = 700002;

insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, 1, s.en, now() - interval '20 days' from public.titles t,
  (values (1),(2)) as s(en) where t.tmdb_id = 700006;

insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, 1, 1, now() - interval '9 days' from public.titles t
where t.tmdb_id in (700007, 700008);

insert into public.episodes (title_id, season_number, episode_number, air_datetime)
select t.id, 1, s.en, now() + interval '3 days' from public.titles t,
  (values (1),(2)) as s(en) where t.tmdb_id = 700009;

insert into public.library_entries (user_id, title_id, followed)
select 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', t.id, true from public.titles t
where t.tmdb_id between 700001 and 700006 or t.tmdb_id = 700009;

insert into public.library_entries (user_id, title_id, followed)
select 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', t.id, false from public.titles t
where t.tmdb_id = 700008;

insert into public.library_entries (user_id, title_id, followed)
select 'ffffffff-ffff-ffff-ffff-ffffffffffff', t.id, true from public.titles t
where t.tmdb_id = 700007;

-- Vistos: dos episodios de verdad de 700001 y también su especial, que NO cuenta.
insert into public.watch_events (user_id, episode_id, watched_at)
select 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', e.id, now() - interval '5 days'
from public.episodes e join public.titles t on t.id = e.title_id
where t.tmdb_id = 700001
  and ((e.season_number = 1 and e.episode_number in (1,2)) or e.season_number = 0);

-- Uno de una serie que no sigue, y uno del otro usuario.
insert into public.watch_events (user_id, episode_id, watched_at)
select 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', e.id, now() - interval '2 days'
from public.episodes e join public.titles t on t.id = e.title_id where t.tmdb_id = 700008;

insert into public.watch_events (user_id, episode_id, watched_at)
select 'ffffffff-ffff-ffff-ffff-ffffffffffff', e.id, now() - interval '1 day'
from public.episodes e join public.titles t on t.id = e.title_id where t.tmdb_id = 700007;

-- ── 0. Las columnas que devuelve, por nombre y en orden ───────────────────
-- Es la red que faltaba. Quitar una columna del rollup NO rompe nada a la
-- vista: las tardías son `.optional()` en el esquema del cliente, así que zod
-- calla y la pantalla pinta el respaldo —el banner de "Esta noche" con la
-- carátula estirada, el juego sin su plataforma—. Quien añada una columna
-- tiene que añadirla aquí, y eso es a propósito: la lista es el contrato.
do $$
declare hay text; debe constant text :=
  'title_id,tmdb_id,kind,name,poster_path,backdrop_path,first_air_date,tmdb_status,'
  'genres,network,vote_average,favorite,notify,stopped,added_at,aired_count,'
  'watched_count,last_watched_at,last_aired_datetime,next_air_datetime,'
  'upcoming_season_number,upcoming_season_air_date,play_state,minutes_played,'
  'played_at,release_precision,platforms,beat_seconds,owned,minutes_source,'
  'played_platform,imdb_rating';
begin
  select string_agg(a.name, ',' order by a.ord) into hay
  from pg_proc p,
       unnest(p.proargnames, p.proargmodes) with ordinality as a(name, mode, ord)
  where p.oid = 'public.rpc_library_rollup()'::regprocedure and a.mode = 't';
  assert hay = debe, format(E'el rollup no devuelve las columnas del contrato.\n  hay:  %s\n  debe: %s', hay, debe);
end $$;

-- Y que no basta con declararlas: el valor tiene que llegar. Una columna en el
-- `returns table` con otra expresión debajo en el `select` pasa el §0 entero.
update public.titles set backdrop_path = '/fondo-0098.jpg' where tmdb_id = 700005;
update public.library_entries le set played_platform = 'switch'
  from public.titles t where t.id = le.title_id and t.tmdb_id = 700005
  and le.user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
do $$
declare fondo text; plataforma text;
begin
  select r.backdrop_path, r.played_platform into fondo, plataforma
  from public.rpc_library_rollup() r where r.tmdb_id = 700005;
  assert fondo = '/fondo-0098.jpg', format('backdrop_path no viaja: llega %s', fondo);
  assert plataforma = 'switch', format('played_platform no viaja: llega %s', plataforma);
end $$;

-- ── 1. Solo lo seguido, y solo lo tuyo ────────────────────────────────────
do $$
declare n bigint;
begin
  select count(*) into n from public.rpc_library_rollup();
  assert n = 7, format('deberian salir las 7 seguidas y salen %s', n);

  select count(*) into n from public.rpc_library_rollup() r
    join public.titles t on t.id = r.title_id where t.tmdb_id = 700008;
  assert n = 0, 'una serie sin seguir no puede estar en el rollup, ni con visionado';

  select count(*) into n from public.rpc_library_rollup() r
    join public.titles t on t.id = r.title_id where t.tmdb_id = 700007;
  assert n = 0, 'la biblioteca de otro usuario no puede asomar en la tuya';
end $$;

-- ── 2. Las cuentas: emitidos y vistos ─────────────────────────────────────
-- El especial de temporada 0 no suma ni como emitido ni como visto. Es la regla
-- que los dos agregados repiten (`season_number > 0`) y la que más fácil se cae
-- al reescribirlos.
do $$
declare emitidos int; vistos int;
begin
  select r.aired_count, r.watched_count into emitidos, vistos
  from public.rpc_library_rollup() r join public.titles t on t.id = r.title_id
  where t.tmdb_id = 700001;
  assert emitidos = 3, format('3 emitidos sin contar el especial, y salen %s', emitidos);
  assert vistos = 2, format('2 vistos sin contar el especial, y salen %s', vistos);
end $$;

-- ── 3. El título sin episodios da 0, no NULL ──────────────────────────────
-- Un `group by` no devuelve fila para un título sin episodios y el LEFT JOIN
-- pone NULL; lo que lo convierte en 0 son los `coalesce` del select. Quien los
-- quite rompe esto, que es justo para lo que está.
do $$
declare fila record;
begin
  for fila in
    select t.tmdb_id, r.aired_count, r.watched_count, r.last_aired_datetime, r.next_air_datetime
    from public.rpc_library_rollup() r join public.titles t on t.id = r.title_id
    where t.tmdb_id in (700003, 700004, 700005, 700002)
  loop
    assert fila.aired_count = 0,
      format('%s no tiene episodios que cuenten: emitidos deberia ser 0 y es %s', fila.tmdb_id, fila.aired_count);
    assert fila.watched_count = 0,
      format('%s deberia tener 0 vistos y tiene %s', fila.tmdb_id, fila.watched_count);
    assert fila.last_aired_datetime is null and fila.next_air_datetime is null,
      format('%s no deberia tener fechas de emision', fila.tmdb_id);
  end loop;
end $$;

-- ── 4. El aired_count sellado en el título manda sobre el contado ─────────
-- `coalesce(t.aired_count, a.aired, 0)`: 42 sellado gana a los 2 episodios que
-- hay de verdad. Invertir ese orden es un error que nadie ve hasta que una
-- serie con episodios sin cachear enseña de menos.
do $$
declare emitidos int;
begin
  select r.aired_count into emitidos
  from public.rpc_library_rollup() r join public.titles t on t.id = r.title_id
  where t.tmdb_id = 700006;
  assert emitidos = 42, format('deberia mandar el 42 sellado y sale %s', emitidos);
end $$;

-- ── 5. Las fechas: la última emitida y la próxima ─────────────────────────
do $$
declare ultima timestamptz; proxima timestamptz;
begin
  select r.last_aired_datetime, r.next_air_datetime into ultima, proxima
  from public.rpc_library_rollup() r join public.titles t on t.id = r.title_id
  where t.tmdb_id = 700001;
  assert ultima < now(), 'la ultima emitida tiene que estar en el pasado';
  assert proxima > now(), 'la proxima tiene que estar en el futuro';
  assert ultima::date = (now() - interval '16 days')::date,
    format('la ultima emitida deberia ser la de hace 16 dias y es %s', ultima);
  assert proxima::date = (now() + interval '5 days')::date,
    format('la proxima deberia ser la de dentro de 5 dias y es %s', proxima);

  -- Una serie entera por emitir: 0 emitidos, sin ultima, pero con proxima.
  select r.last_aired_datetime, r.next_air_datetime into ultima, proxima
  from public.rpc_library_rollup() r join public.titles t on t.id = r.title_id
  where t.tmdb_id = 700009;
  assert ultima is null, 'sin nada emitido no puede haber ultima emision';
  assert proxima is not null, 'con episodios futuros tiene que haber proxima';
end $$;

-- ── 6. Sin sesión no sale nada ────────────────────────────────────────────
-- `security invoker` + `auth.uid()`: sin claim la funcion no puede devolver la
-- biblioteca de nadie.
select set_config('request.jwt.claims', '', true);
do $$
declare n bigint;
begin
  select count(*) into n from public.rpc_library_rollup();
  assert n = 0, format('sin sesion no puede salir nada y salen %s filas', n);
end $$;

rollback;

\echo 'Las siete comprobaciones del rollup de la biblioteca han pasado.'
