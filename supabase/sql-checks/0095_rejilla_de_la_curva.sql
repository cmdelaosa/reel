-- Pruebas de la REJILLA de `rpc_steam_value_series` (0095): hasta dónde llega y
-- con qué paso. Hermano de 0092_serie_reconstruida.sql, que prueba las reglas
-- —cuántos tenías tal día, el arrastre del precio, la foto que manda— y sigue
-- valiendo entero. Se corren igual:
--
--   supabase db reset
--   docker cp supabase/sql-checks/0095_rejilla_de_la_curva.sql supabase_db_tvtime:/tmp/t.sql
--   docker exec supabase_db_tvtime psql -U postgres -f /tmp/t.sql
--
-- Lo que hay aquí es lo que 0095 promete y no se ve leyendo la función: que la
-- curva llega hasta la vela más vieja que haya, y que su tamaño NO crece con lo
-- atrás que llegue. Eso segundo es la razón de ser del cambio: la versión de
-- 0094 traía un punto por día y con trece años de histórico se pasaba del
-- statement_timeout en producción, y la pantalla lo enseñaba como «todavía no
-- hay gráfica».
--
-- Todo va dentro de una transacción que termina en `rollback`, y los appid son
-- 999xxx —que no existen en Steam— por si algún día alguien se deja el rollback.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'steam-rejilla-0095@example.com')
on conflict (id) do nothing;

select set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}',
  true
);
do $$ begin
  assert (select auth.uid()) = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    'el claim no ha entrado: el resto del fichero no probaria nada';
end $$;

-- ── El escenario ──────────────────────────────────────────────────────────
-- Un objeto y trece años de velas, una cada cincuenta días. Trece años es lo que
-- Steam guarda de verdad (desde 2013) y es el caso que tiró la versión anterior.
insert into public.steam_holdings (user_id, appid, market_hash_name, quantity) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 999501, 'V', 1);

insert into public.steam_price_history (appid, market_hash_name, currency, day, median_cents, volume)
select 999501, 'V', 3, current_date - g, 100, 1
from generate_series(0, 4745, 50) g;

-- ── 1. La curva llega hasta la vela más vieja ─────────────────────────────
do $$
declare primero date;
begin
  select min(day) into primero from public.rpc_steam_value_series();
  assert primero = current_date - 4700,
    format('deberia empezar en la vela mas vieja (hace 4700 dias) y empieza en %s', primero);
end $$;

-- ── 2. Y aun así son pocos puntos: el tamaño no crece con los años ────────
-- Trece años son ~156 meses más las trece quincenas de los últimos seis meses.
-- El número exacto baila con el calendario, y lo que importa es el orden de
-- magnitud: doscientos y pico, no cuatro mil setecientos.
do $$
declare n bigint;
begin
  select count(*) into n from public.rpc_steam_value_series();
  assert n between 150 and 250,
    format('trece anos deberian caber en ~170 puntos, y salen %s', n);
end $$;

-- ── 3. El paso: mensual atrás, quincenal en los últimos seis meses ────────
-- Se comprueba la FORMA y no unas fechas concretas, porque las fechas dependen
-- de qué día se corran las pruebas. El primer día se excluye de las dos: es el
-- arranque de la curva y entra siempre, caiga donde caiga.
do $$
declare sueltos bigint;
begin
  select count(*) into sueltos
    from public.rpc_steam_value_series()
   where day < current_date - 183
     and day <> current_date - 4700
     and extract(day from day) <> 1;
  assert sueltos = 0,
    format('%s puntos viejos que no son dia 1 de mes', sueltos);

  select count(*) into sueltos
    from public.rpc_steam_value_series()
   where day >= current_date - 183
     and (current_date - day) % 14 <> 0;
  assert sueltos = 0,
    format('%s puntos recientes fuera de la quincena', sueltos);
end $$;

-- ── 4. Hoy es siempre un punto ────────────────────────────────────────────
-- La quincena se cuenta hacia atrás desde hoy justamente para esto: el último
-- punto de la curva es el valor de ahora, y no un jueves de la semana pasada.
do $$
declare hay bool;
begin
  select exists (select 1 from public.rpc_steam_value_series() where day = current_date) into hay;
  assert hay, 'hoy tendria que ser el ultimo punto de la curva y no esta';
end $$;

-- ── 5. `p_days` sigue acortando para quien lo pida ────────────────────────
do $$
declare primero date;
begin
  select min(day) into primero from public.rpc_steam_value_series(3, 30);
  assert primero = current_date - 30,
    format('con p_days=30 deberia empezar hace 30 dias y empieza en %s', primero);
end $$;

-- ── 6. Ni un día repetido ─────────────────────────────────────────────────
-- La rejilla se arma con tres `union` y las fotos se pegan aparte; un día que
-- saliera dos veces pintaría dos puntos en la misma fecha y el de abajo sería
-- invisible.
do $$
declare repetidos bigint;
begin
  select count(*) into repetidos from (
    select day from public.rpc_steam_value_series() group by day having count(*) > 1
  ) d;
  assert repetidos = 0, format('%s dias repetidos en la serie', repetidos);
end $$;

rollback;

\echo 'Las seis comprobaciones de la rejilla de 0095 han pasado.'
