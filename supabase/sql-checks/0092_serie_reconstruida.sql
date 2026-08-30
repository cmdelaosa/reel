-- Pruebas de rpc_steam_value_series, en SQL puro y contra una base de
-- desarrollo. Se corren a mano:
--
--   supabase db reset
--   docker cp supabase/sql-checks/0092_serie_reconstruida.sql supabase_db_tvtime:/tmp/t.sql
--   docker exec supabase_db_tvtime psql -U postgres -f /tmp/t.sql
--
-- Por qué aquí y no en supabase/migrations ni en supabase/tests: lo explica
-- 0072_movie_release_alerts.sql, que es el hermano mayor de este fichero. En
-- resumen: en migrations esto correría contra producción en cada `db push`, y en
-- tests `supabase test db` espera pgTAP y un `assert` de plpgsql le saldría como
-- cero pruebas — silencio que se lee como aprobado.
--
-- Lo que se comprueba es la regla que no se ve leyendo la función: cuántos
-- tenías tal día, caminando el libro hacia atrás. Es la misma regla que `heldOn`
-- en app/src/domain/steamSeries.ts, que sí tiene su matriz en vitest; si las dos
-- se separan, la ficha de un objeto y la curva de la cartera contarían cosas
-- distintas del mismo día y las dos parecerían correctas.
--
-- ── Por qué las fechas del escenario son múltiplos de catorce ─────────────
-- Hasta 0094 la serie traía un punto por día y aquí se podía preguntar por «la
-- víspera» de cualquier cosa. Desde 0095 no: la rejilla es mensual, quincenal en
-- los últimos seis meses, y contada hacia atrás desde hoy. Un `where day =
-- current_date - 11` no devuelve fila y el `select into` deja un null, que en un
-- `assert` se lee como fallo raro en vez de como «ese día no existe».
--
-- Así que los movimientos del escenario se ponen ENCIMA de puntos de la rejilla
-- —hoy, -14, -28, -42— y las vísperas se miran en el punto anterior. La regla
-- que se prueba es la misma: el movimiento del propio día ya cuenta.
--
-- Todo va dentro de una transacción que termina en `rollback`: la base queda
-- como estaba. Los appid son 999xxx —que no existen en Steam— por si algún día
-- alguien se deja el rollback.

\set ON_ERROR_STOP on
begin;

-- Un usuario limpio con su perfil.
insert into auth.users (id, email) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'steam-series-test@example.com')
on conflict (id) do nothing;

-- La función lee `auth.uid()`, que sale del claim del JWT. Sin esto no ve nada
-- y todas las comprobaciones pasarían con series vacías, que es la forma más
-- silenciosa de tener un fichero de pruebas que no prueba nada.
select set_config(
  'request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}',
  true
);
do $$ begin
  assert (select auth.uid()) = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    'el claim no ha entrado: el resto del fichero no probaria nada';
end $$;

-- ── El escenario ──────────────────────────────────────────────────────────
-- Tres objetos, uno por cada forma de llegar y de irse:
--   A — comprado hace 14 días. Antes de esa fecha no lo tenías.
--   B — nunca pasó por el libro: salió de una caja o de un drop. Se reconstruye
--       como si lo hubieras tenido siempre, que es la limitación conocida.
--   C — vendido hace 28 días. Hoy no está en el inventario, y hacia atrás sí.
insert into public.steam_holdings (user_id, appid, market_hash_name, quantity) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 999001, 'A', 2),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 999001, 'B', 1);

insert into public.steam_ledger
  (user_id, happened_at, kind, amount_cents, currency, appid, market_hash_name, quantity, external_id)
values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', now() - interval '14 days',
   'market_buy', -180, 3, 999001, 'A', 2, 'test_buy_a'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', now() - interval '28 days',
   'market_sell', 850, 3, 999001, 'C', 1, 'test_sell_c'),
  -- Una recarga de cartera: mueve dinero y NO mueve objetos. Si la función la
  -- contara, todas las cantidades de antes de hoy saldrían mal.
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', now() - interval '20 days',
   'wallet_topup', 2000, 3, null, null, 1, 'test_topup');

-- Las velas. A cambia de precio hace 7 días; B y C no se han movido desde hace
-- 300, y esos huecos son los que la función tiene que arrastrar.
insert into public.steam_price_history (appid, market_hash_name, currency, day, median_cents, volume) values
  (999001, 'A', 3, current_date - 300, 100, 1),
  (999001, 'A', 3, current_date - 7,   200, 1),
  (999001, 'B', 3, current_date - 300, 50,  1),
  (999001, 'C', 3, current_date - 300, 1000, 1);

-- ── 1. Hace 42 días: A todavía no era tuyo, C sí ──────────────────────────
do $$
declare v bigint; n bigint;
begin
  select value_cents, item_count into v, n
    from public.rpc_steam_value_series() where day = current_date - 42;
  -- B (1 × 50) + C (1 × 1000). A no cuenta: se compró cuatro semanas después.
  assert v = 1050, format('hace 42 dias deberian ser 1050, son %s', v);
  assert n = 2, format('hace 42 dias deberian ser 2 unidades, son %s', n);
end $$;

-- ── 2. La venta: C está en el punto anterior y ya no el día que lo vendes ──
-- El movimiento del propio día cuenta como YA ocurrido. Es la misma regla que
-- `heldOn` en app/src/domain/steamSeries.ts, y está escrita aquí porque es justo
-- la que se elige mal cuando se reescribe.
do $$
declare antes bigint; ese bigint;
begin
  select value_cents into antes
    from public.rpc_steam_value_series() where day = current_date - 42;
  select value_cents into ese
    from public.rpc_steam_value_series() where day = current_date - 28;
  assert antes = 1050, format('antes de la venta C todavia cuenta: %s', antes);
  -- Solo queda B. A sigue sin ser tuyo.
  assert ese = 50, format('el dia de la venta deberian quedar 50, hay %s', ese);
end $$;

-- ── 3. El día de la compra ya cuenta como tuyo, y con el precio arrastrado ─
do $$
declare antes bigint; ese bigint; n bigint;
begin
  select value_cents into antes
    from public.rpc_steam_value_series() where day = current_date - 28;
  select value_cents, item_count into ese, n
    from public.rpc_steam_value_series() where day = current_date - 14;
  assert antes = 50, format('la quincena anterior a la compra deberia ser 50, es %s', antes);
  -- A entra con 2 × 100, que es la vela de hace 300 días arrastrada hasta aquí
  -- —la de 200 es de hace 7 y todavía no ha pasado—, más B.
  assert ese = 250, format('el dia de la compra deberia ser 250, es %s', ese);
  assert n = 3, format('el dia de la compra deberian ser 3 unidades, son %s', n);
end $$;

-- ── 4. Y la vela nueva se nota en cuanto le toca ──────────────────────────
do $$
declare v bigint;
begin
  select value_cents into v
    from public.rpc_steam_value_series() where day = current_date;
  -- Hoy manda la vela de hace 7 días: 2 × 200 + 50.
  assert v = 450, format('hoy deberian ser 450, son %s', v);
end $$;

-- ── 5. Un objeto sin ninguna vela se cuenta como precio que falta ──────────
do $$
declare faltan bigint; v bigint;
begin
  insert into public.steam_holdings (user_id, appid, market_hash_name, quantity)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 999001, 'D', 3);
  select missing_prices, value_cents into faltan, v
    from public.rpc_steam_value_series() where day = current_date;
  assert faltan = 1, format('D no tiene precio y deberia contarse como 1 que falta, son %s', faltan);
  -- Y no se suma como cero al total, que es la avería que esa columna delata.
  assert v = 450, format('D no deberia mover el total, que es 450 y es %s', v);
  delete from public.steam_holdings
   where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' and market_hash_name = 'D';
end $$;

-- ── 6. La foto real gana donde la hay, y aunque no caiga en la rejilla ─────
-- Desde 0095 esto prueba dos cosas de una: que la foto manda, y que las fotos
-- ENTRAN en la serie aunque su día no sea un punto de la rejilla —hace 2 días no
-- lo es—, porque son exactas y leerlas no cuesta nada.
do $$
declare v bigint; s text;
begin
  insert into public.steam_portfolio_snapshots
    (user_id, day, currency, value_cents, item_count, distinct_items, missing_prices)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', current_date - 2, 3, 777777, 9, 9, 0);
  select value_cents, source into v, s
    from public.rpc_steam_value_series() where day = current_date - 2;
  assert v = 777777, format('la foto real deberia mandar, y el valor es %s', v);
  assert s = 'snapshot', format('ese dia deberia decir snapshot, dice %s', s);
  select source into s
    from public.rpc_steam_value_series() where day = current_date - 14;
  assert s = 'reconstructed', format('el dia sin foto deberia decir reconstructed, dice %s', s);
end $$;

-- ── 7. Sin histórico no hay serie: mejor vacío que una línea plana en cero ─
do $$
declare n int;
begin
  delete from public.steam_price_history where appid = 999001;
  select count(*) into n from public.rpc_steam_value_series();
  assert n = 0, format('sin velas la serie deberia venir vacia, trae %s filas', n);
end $$;

rollback;

\echo 'Las siete comprobaciones de la serie han pasado.'
