-- Pruebas de lo que 0094 le cambia a `rpc_steam_value_series`: que la curva
-- llega hasta la vela más vieja que haya, y que para poder llegar el tramo de
-- más de dos años va de siete en siete.
--
-- Hermano de 0092_serie_reconstruida.sql, que sigue valiendo entero: allí están
-- las reglas de siempre —cuántos tenías tal día, el arrastre del precio, la foto
-- real que manda— y aquí solo lo que 0094 añade. Se corren igual:
--
--   supabase db reset
--   docker cp supabase/sql-checks/0094_serie_hasta_el_principio.sql supabase_db_tvtime:/tmp/t.sql
--   docker exec supabase_db_tvtime psql -U postgres -f /tmp/t.sql
--
-- Todo va dentro de una transacción que termina en `rollback`, y los appid son
-- 999xxx —que no existen en Steam— por si algún día alguien se deja el rollback.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'steam-series-0094@example.com')
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
-- Un objeto y tres velas, repartidas a los dos lados de la frontera de los 730
-- días. La más vieja está a 1.200, que es más allá del tope de 1.095 que tenía
-- 0092: si el tope siguiera mandando, la serie empezaría 105 días más tarde.
insert into public.steam_holdings (user_id, appid, market_hash_name, quantity) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 999401, 'V', 1);

insert into public.steam_price_history (appid, market_hash_name, currency, day, median_cents, volume) values
  (999401, 'V', 3, current_date - 1200, 100, 1),
  (999401, 'V', 3, current_date - 900,  200, 1),
  (999401, 'V', 3, current_date - 10,   300, 1);

-- ── 1. La curva llega hasta la vela más vieja, sin tope ────────────────────
do $$
declare primero date;
begin
  select min(day) into primero from public.rpc_steam_value_series();
  assert primero = current_date - 1200,
    format('deberia empezar hace 1200 dias y empieza en %s', primero);
end $$;

-- ── 2. Y `p_days` sigue acortando para quien lo pida ───────────────────────
do $$
declare primero date;
begin
  select min(day) into primero from public.rpc_steam_value_series(3, 30);
  assert primero = current_date - 30,
    format('con p_days=30 deberia empezar hace 30 dias y empieza en %s', primero);
end $$;

-- ── 3. Dos resoluciones, y cada una donde toca ─────────────────────────────
-- Lo viejo, de siete en siete desde el primer día; lo reciente, todos los días.
-- Se comprueba la forma de la rejilla y no unas fechas concretas, porque las
-- fechas dependen de qué día se corran las pruebas.
do $$
declare desalineados bigint; recientes bigint; repetidos bigint;
begin
  select count(*) into desalineados
    from public.rpc_steam_value_series()
   where day < current_date - 730
     and (day - (current_date - 1200)) % 7 <> 0;
  assert desalineados = 0,
    format('%s puntos viejos fuera de la rejilla semanal', desalineados);

  select count(*) into recientes
    from public.rpc_steam_value_series() where day >= current_date - 730;
  assert recientes = 731,
    format('los dos ultimos anos deberian ser 731 dias seguidos, son %s', recientes);

  select count(*) into repetidos from (
    select day from public.rpc_steam_value_series() group by day having count(*) > 1
  ) d;
  assert repetidos = 0, format('%s dias repetidos en la serie', repetidos);
end $$;

-- ── 4. El precio se arrastra igual en el tramo semanal ─────────────────────
-- Es la regla que 0094 podía romper sin que se notara: la vela vieja tiene que
-- valer para todos los puntos hasta la siguiente, y ni uno más.
do $$
declare v_vieja bigint; v_media bigint; v_hoy bigint;
begin
  -- 1.193 días atrás: séptimo punto de la rejilla, con la vela de 100 arrastrada.
  select value_cents into v_vieja
    from public.rpc_steam_value_series() where day = current_date - 1193;
  assert v_vieja = 100, format('hace 1193 dias deberia valer 100 y vale %s', v_vieja);

  -- 850 días atrás: sigue en el tramo semanal (múltiplo de 7 desde el primero) y
  -- ya le toca la vela de 200.
  select value_cents into v_media
    from public.rpc_steam_value_series() where day = current_date - 850;
  assert v_media = 200, format('hace 850 dias deberia valer 200 y vale %s', v_media);

  select value_cents into v_hoy
    from public.rpc_steam_value_series() where day = current_date;
  assert v_hoy = 300, format('hoy deberia valer 300 y vale %s', v_hoy);
end $$;

-- ── 5. Menos de dos años de histórico: la rejilla es diaria entera ─────────
-- El caso de casi todo el mundo, y el que no puede cambiar de comportamiento.
do $$
declare n bigint;
begin
  delete from public.steam_price_history where appid = 999401;
  insert into public.steam_price_history (appid, market_hash_name, currency, day, median_cents, volume)
  values (999401, 'V', 3, current_date - 100, 100, 1);

  select count(*) into n from public.rpc_steam_value_series();
  assert n = 101, format('con una vela de hace 100 dias deberian salir 101 puntos, salen %s', n);
end $$;

rollback;

\echo 'Las cinco comprobaciones de 0094 han pasado.'
