-- 0087_inventario_steam.sql
-- El inventario del mercado de Steam: qué objetos tienes, cuánto valen hoy,
-- cuánto valían y qué dinero ha entrado y salido por ellos.
--
-- Cuelga de 0076, que ya dejó `profiles.steam_id` puesto por OpenID. Aquí no se
-- enlaza nada nuevo: si tienes cuenta enlazada, tienes inventario.
--
-- ── Por qué el recolector NO es una edge function ─────────────────────────
-- Es la decisión que ordena todo lo demás y no se tomó por gusto. Steam
-- estrangula `/inventory/<steamid>/<appid>/<context>` por IP y con una mano muy
-- dura: medido el 27-08-2026, la PRIMERA petición desde una IP doméstica limpia,
-- sin nada previo, ya contesta 429. Una edge function sale por una IP compartida
-- entre miles de proyectos de Supabase, así que ahí el 429 no es un riesgo: es
-- el caso normal. Eso es, literalmente, por lo que las webs que valoran
-- inventarios funcionan tan mal.
--
-- Y hay dos fuentes más que no son cuestión de IP sino de sesión:
-- `market/pricehistory` y `market/myhistory` contestan 400 sin la cookie de
-- Steam. El truco viejo de leer la serie incrustada en la página del listing
-- (`var line1=[[…]]`) ya no vale: Valve la movió al endpoint autenticado, y hoy
-- esa página son 5 MB sin una sola vela dentro. Comprobado el mismo día.
--
-- Así que el recolector vive en una pestaña de `steamcommunity.com`, con tu
-- sesión y tu IP, y lo que llega aquí es su volcado. Guardar la cookie en el
-- servidor para poder hacerlo desde dentro se descartó de entrada: un
-- `steamLoginSecure` es una credencial de toma de cuenta, y esto es una pantalla
-- para mirar gráficas.
--
-- ── Los precios: ni el navegador solo, ni el servidor ────────────────────
-- `market/priceoverview` es mucho más blando que el inventario, pero Steam sigue
-- eligiendo por IP, y hay tres respuestas distintas a la misma petición (medido
-- el 27-08-2026 contra producción):
--
--   · desde una edge function de Supabase: 429 a la primera, cero precios;
--   · desde un runner de GitHub:           5 de 5 con 200 y precios reales;
--   · desde una IP doméstica:              12 seguidas sin un corte.
--
-- De ahí el reparto final: el inventario y el historial los trae tu navegador de
-- uvas a peras, y los PRECIOS los refresca a diario `scripts/steam-prices` desde
-- un runner de GitHub Actions — no desde una edge function, que es donde la
-- primera versión los ponía y donde habría fallado en silencio cada noche.
-- Comprar un objeto es raro; que suba de precio, no.
--
-- ── Dinero: enteros de céntimos, y el signo significa algo ────────────────
-- Nada de `numeric` para dinero que se suma en pantalla: céntimos en `integer`.
-- Y en `steam_ledger.amount_cents` el SIGNO es la dirección, mirado desde tu
-- cartera: positivo entra, negativo sale. Es la convención que hace que "cuánto
-- ha entrado" sea un `sum(...) filter (where amount_cents > 0)` y no un `case`
-- de seis ramas que hay que mantener a la vez que el check de `kind`.

-- ============================================================
-- 1. La caché de precios — GLOBAL, no por usuario
-- ============================================================
-- Sin `user_id` a propósito, y es lo que hace que esto escale. Un precio de
-- mercado es del mercado, no tuyo: si tres personas tienen la misma cápsula de
-- Katowice, es UNA petición a Steam y no tres. Con el límite de ~20/min que
-- tiene `priceoverview`, esa diferencia es la que separa "tarda un minuto" de
-- "no termina nunca".
--
-- La clave lleva la moneda porque el precio de Steam ES por moneda: Valve no
-- convierte, cada mercado regional tiene su propia oferta. Mezclar EUR y USD
-- bajo una sola fila daría un total plausible y equivocado.
create table if not exists public.steam_market_prices (
  appid            integer     not null,
  market_hash_name text        not null,
  currency         integer     not null,
  -- La venta más barata que hay puesta AHORA: por lo que se vende.
  lowest_cents     integer,
  -- La mediana de lo que se ha vendido de verdad estos días: lo que vale.
  -- Las dos, porque no son la misma pregunta y la pantalla enseña ambas.
  median_cents     integer,
  -- Unidades vendidas en 24 h. Un objeto caro con volumen 0 tiene un precio
  -- que es una opinión, y la pantalla necesita poder decirlo.
  volume           integer,
  -- Null en las dos cifras es un caso real y NO es un error: un objeto sin una
  -- sola venta reciente devuelve `{"success":true}` pelado. Se guarda la fila
  -- igual, con `fetched_at`, para no reintentarlo cada hora.
  fetched_at       timestamptz not null default now(),
  -- Quién trajo este precio, y es una salvaguarda, no un dato de interés.
  --
  -- Esta tabla es GLOBAL y la usa el total de TODO el mundo, así que aceptar a
  -- ciegas un precio subido por un cliente sería dejar que cualquiera moviera el
  -- inventario de los demás. La regla, que hace cumplir la edge function:
  --   · 'server' — lo trajo el cron o la función pidiéndoselo a Steam. Es el
  --     único que se fía y el único que puede pisar una fila existente.
  --   · 'client' — lo trajo tu navegador en el volcado. Solo se acepta para un
  --     nombre que NO tenga ya precio, y el cron lo sustituye por uno 'server'
  --     en su siguiente pasada.
  -- Con eso, lo peor que puede hacer un cliente hostil es inventarse el precio
  -- de un objeto que nadie más tiene, durante menos de un día.
  source           text        not null default 'server'
                   check (source in ('server', 'client')),
  primary key (appid, market_hash_name, currency)
);

comment on table public.steam_market_prices is
  'Precio de mercado por objeto. GLOBAL y sin user_id: un precio es del mercado, y compartir la cache es lo que mantiene las peticiones a Steam por debajo de su limite.';
comment on column public.steam_market_prices.median_cents is
  'Mediana de ventas reales (lo que vale). Null si no hubo ventas recientes, que no es un fallo.';
comment on column public.steam_market_prices.lowest_cents is
  'Listing mas barato ahora mismo (por lo que se vende). Null si no hay ninguno puesto.';

-- El cron refresca por antigüedad: lo más rancio primero, y para cuando se le
-- acaba el presupuesto de peticiones. Sin este índice eso es un seq scan del
-- catálogo entero en cada tanda.
create index if not exists steam_market_prices_fetched_at_idx
  on public.steam_market_prices (fetched_at);

alter table public.steam_market_prices enable row level security;

-- Lectura para cualquiera que haya entrado. No hay nada personal en una tabla
-- de precios, y restringirla a "los objetos que tú tienes" obligaría a un join
-- con tus holdings en cada lectura para esconder... el precio público de una
-- cápsula. Escribe solo el cron, con la clave de servicio, que se salta RLS.
drop policy if exists "steam_market_prices: anyone signed in reads" on public.steam_market_prices;
create policy "steam_market_prices: anyone signed in reads"
  on public.steam_market_prices for select to authenticated
  using (true);

-- ============================================================
-- 2. La serie histórica — también global
-- ============================================================
-- Una vela por día y objeto, tal y como la da `market/pricehistory`. Steam
-- guarda años, así que esto llega de una tacada la primera vez y luego solo
-- crece por la cola.
--
-- Ojo con lo que Steam devuelve de verdad: las velas del último mes vienen POR
-- HORA, no por día. El recolector las agrega antes de subirlas — si no, un mes
-- reciente mete 720 filas donde debería haber 30 y la media diaria queda sesgada
-- hacia las horas de más actividad.
--
-- ── Esta tabla SÍ la llena un cliente, y por eso no toca ningún total ──────
-- `pricehistory` pide sesión, así que no hay forma de que el servidor la traiga:
-- lo que se guarda aquí es lo que subió el navegador de alguien, y no se puede
-- verificar. La contención es de diseño, no de confianza: esta tabla alimenta
-- ÚNICAMENTE la curva de un objeto suelto en su ficha. El valor de tu cartera
-- —el número grande y la línea de la gráfica— sale de
-- `steam_portfolio_snapshots`, que escribe el cron con precios de `source =
-- 'server'`. Un histórico inventado ensucia un dibujo; no mueve una cifra.
-- La función de ingesta además nunca pisa una vela ya escrita.
create table if not exists public.steam_price_history (
  appid            integer not null,
  market_hash_name text    not null,
  currency         integer not null,
  day              date    not null,
  median_cents     integer not null,
  volume           integer not null default 0,
  primary key (appid, market_hash_name, currency, day)
);

comment on table public.steam_price_history is
  'Vela diaria de precio por objeto, de market/pricehistory. Global. Las velas del ultimo mes llegan por hora desde Steam y el recolector las agrega a dia.';

alter table public.steam_price_history enable row level security;

drop policy if exists "steam_price_history: anyone signed in reads" on public.steam_price_history;
create policy "steam_price_history: anyone signed in reads"
  on public.steam_price_history for select to authenticated
  using (true);

-- ============================================================
-- 3. Lo que tienes
-- ============================================================
-- Agregado por `market_hash_name` y con cantidad, no una fila por `assetid`.
-- El nombre de mercado ES la unidad de precio en Steam: dos cápsulas iguales son
-- intercambiables y valen lo mismo. Guardar los assetid daría 400 filas para
-- enseñar 60 líneas y no respondería ninguna pregunta nueva. Lo que sí se pierde
-- es la trazabilidad de una unidad concreta, y no importa: el mercado tampoco la
-- tiene.
--
-- (Las skins con desgaste no son una excepción: el desgaste va DENTRO del
-- market_hash_name — "AK-47 | Redline (Field-Tested)" — así que cada corte es su
-- propia fila, que es justo lo que hace falta.)
create table if not exists public.steam_holdings (
  user_id          uuid        not null references public.profiles(id) on delete cascade,
  appid            integer     not null,
  market_hash_name text        not null,
  quantity         integer     not null check (quantity > 0),
  -- Para pintar la fila sin salir a buscar nada. El icono es el hash de Steam,
  -- no una URL entera: el prefijo del CDN lo pone la app.
  icon_url         text,
  -- "Sticker", "Base Grade Container", "Cromo"… tal y como lo llama Steam en tu
  -- idioma. Vale para agrupar y para filtrar; no se interpreta.
  item_type        text,
  -- Un objeto bloqueado por el trade hold, o no vendible, sigue siendo tuyo y
  -- sigue valiendo — pero no lo puedes realizar hoy, y la pantalla lo distingue.
  marketable       boolean     not null default true,
  collected_at     timestamptz not null default now(),
  primary key (user_id, appid, market_hash_name)
);

comment on table public.steam_holdings is
  'Tu inventario, agregado por market_hash_name con cantidad. Lo escribe el volcado del recolector (una pestana de Steam logueada), nunca el servidor: Steam contesta 429 al endpoint de inventario desde IP compartida.';
comment on column public.steam_holdings.marketable is
  'Falso en lo que no se puede vender ahora (trade hold, objeto no vendible). Vale igual, pero no se puede realizar.';

create index if not exists steam_holdings_user_idx
  on public.steam_holdings (user_id);

-- El cron pregunta "qué nombres tiene alguien" para saber qué precios refrescar.
-- Sin esto, esa pregunta recorre todos los inventarios de todo el mundo.
create index if not exists steam_holdings_name_idx
  on public.steam_holdings (appid, market_hash_name);

alter table public.steam_holdings enable row level security;

-- Solo tuyo, y en las cuatro operaciones. Esto NO se comparte con amigos aunque
-- el resto de Reel sí: el valor de tu inventario es un dato de dinero, y la
-- decisión de 0077 de enseñar actividad al muro no alcanza hasta aquí. Si algún
-- día se comparte, será con una política nueva y explícita, no por herencia.
drop policy if exists "steam_holdings: owner all" on public.steam_holdings;
create policy "steam_holdings: owner all"
  on public.steam_holdings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================
-- 4. El libro: compras, ventas y la cartera
-- ============================================================
-- De `market/myhistory` (lo del mercado) y de `store/account/history` (lo de la
-- cartera). Las dos piden sesión, así que las dos llegan por el mismo volcado.
--
-- ── El signo ──
-- `amount_cents` mirado desde TU CARTERA: positivo es dinero que entra en ella,
-- negativo dinero que sale. Vender una pegatina es positivo; comprarla,
-- negativo; recargar la cartera, positivo; comprarte un juego, negativo.
--
-- Eso deja dos preguntas distintas que la gente confunde, y por eso se separan:
--   · "cuánto he metido de mi bolsillo"  → sum de kind = 'wallet_topup'
--   · "cuánto he realizado en el mercado" → sum de kind in (market_sell,
--     market_buy), que es dinero que solo se ha movido DENTRO de Steam.
-- Sumarlas juntas daría un número que no significa nada: el dinero de la cartera
-- de Steam no se puede sacar, así que una venta no es un ingreso, es una
-- reordenación.
create table if not exists public.steam_ledger (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  happened_at  timestamptz not null,
  kind         text        not null check (kind in (
                 'market_buy',      -- compraste un objeto en el mercado
                 'market_sell',     -- vendiste uno
                 'wallet_topup',    -- metiste dinero de fuera en la cartera
                 'store_purchase',  -- gastaste cartera en la tienda (un juego)
                 'refund',          -- Valve te devolvió algo
                 'other'            -- lo que la tienda llame de otra forma
               )),
  -- Negativo sale de tu cartera, positivo entra. Ver arriba.
  amount_cents integer     not null,
  currency     integer     not null,
  -- Solo en lo del mercado. La comisión de Valve ya viene DESCONTADA en lo que
  -- recibes por una venta; se guarda aparte porque "vendí por 10 €" y "me
  -- llegaron 8,70 €" son las dos cifras que uno quiere ver, y con una sola no se
  -- puede reconstruir la otra.
  fee_cents    integer,
  appid            integer,
  market_hash_name text,
  quantity     integer     not null default 1,
  -- Lo que hace que re-volcar sea inofensivo. Steam numera cada fila de su
  -- historial (`history_row_2_…`) y ese id es estable; el volcado lo trae tal
  -- cual y aquí es la llave contra el duplicado. Sin esto, importar dos veces
  -- duplica cada venta y el realizado se va al doble sin que nada falle.
  external_id  text        not null,
  unique (user_id, external_id)
);

comment on table public.steam_ledger is
  'Compras, ventas y movimientos de cartera. amount_cents con SIGNO desde tu cartera: positivo entra, negativo sale. external_id es el id de fila de Steam y es lo que hace idempotente re-volcar.';
comment on column public.steam_ledger.fee_cents is
  'Comision de Valve en una venta. Ya viene descontada de amount_cents; se guarda aparte para poder ensenar el bruto y el neto.';

create index if not exists steam_ledger_user_when_idx
  on public.steam_ledger (user_id, happened_at desc);

-- El coste base de un objeto es "lo que pagué por él": todas sus compras.
create index if not exists steam_ledger_user_item_idx
  on public.steam_ledger (user_id, appid, market_hash_name)
  where market_hash_name is not null;

alter table public.steam_ledger enable row level security;

drop policy if exists "steam_ledger: owner all" on public.steam_ledger;
create policy "steam_ledger: owner all"
  on public.steam_ledger for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================
-- 5. La foto diaria
-- ============================================================
-- El valor total de tu inventario, un punto por día, escrito por el cron después
-- de refrescar precios.
--
-- ── Por qué existe habiendo `steam_price_history` ──
-- Porque no responden lo mismo, y confundirlas da una gráfica que miente.
-- `steam_price_history` dice qué valía UN OBJETO tal día. Reconstruir con ella
-- el valor de tu cartera en 2024 sería multiplicar el precio de 2024 por lo que
-- tienes HOY — y en 2024 no tenías esto. Sirve como aproximación y la app la
-- pinta como tal, con su rótulo; la línea de verdad es esta tabla, y empieza el
-- día que se estrena la pantalla. No hay atajo: nadie guardó esa foto entonces.
create table if not exists public.steam_portfolio_snapshots (
  user_id        uuid    not null references public.profiles(id) on delete cascade,
  day            date    not null,
  currency       integer not null,
  -- Suma de mediana × cantidad de todo lo que tenías ese día.
  value_cents    integer not null,
  -- Unidades totales y nombres distintos. Los dos, porque una caída del valor
  -- con las unidades intactas es el mercado, y con las unidades a la mitad eres
  -- tú vendiendo. La gráfica no puede distinguirlo sin esto.
  item_count     integer not null,
  distinct_items integer not null,
  -- Cuántos de esos nombres no tenían precio ese día. Un total al que le faltan
  -- 40 objetos es un total equivocado, y sin esta columna no hay forma de saber
  -- desde la pantalla que ese bache de la línea fue una tanda de precios que no
  -- llegó y no una caída del mercado.
  missing_prices integer not null default 0,
  primary key (user_id, day, currency)
);

comment on table public.steam_portfolio_snapshots is
  'Valor total del inventario, un punto por dia. Es la unica serie honesta del valor de TU cartera: steam_price_history es por objeto y reconstruir con ella el pasado usa las cantidades de hoy.';
comment on column public.steam_portfolio_snapshots.missing_prices is
  'Nombres sin precio ese dia. Un bache en la grafica con este numero alto es una tanda que no llego, no una caida.';

alter table public.steam_portfolio_snapshots enable row level security;

drop policy if exists "steam_portfolio_snapshots: owner all" on public.steam_portfolio_snapshots;
create policy "steam_portfolio_snapshots: owner all"
  on public.steam_portfolio_snapshots for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ============================================================
-- 6. Los permisos, dichos y no heredados
-- ============================================================
-- RLS decide QUÉ FILAS ve cada uno; el `grant` decide si el rol puede tocar la
-- tabla siquiera. Son dos rejas distintas y hacen falta las dos: sin grant,
-- PostgREST contesta «permission denied for table» antes de mirar una sola
-- política.
--
-- Van escritos porque 0076 los escribe y porque apoyarse en los privilegios por
-- defecto del esquema es apoyarse en cómo se inicializó cada entorno. Esta
-- migración se aplicó el 27-08-2026 en producción, donde los heredó, y en la
-- pila local, donde NO: allí las cinco tablas salieron con REFERENCES, TRIGGER y
-- TRUNCATE y sin una sola operación útil, y la ingesta murió con «permission
-- denied» en una migración que en producción funcionaba. Una migración que
-- depende del entorno no es una migración.
--
-- Quién necesita qué:
--   · `authenticated` escribe lo SUYO —el volcado sube por la función, pero la
--     app lee estas tablas directamente— y de que sea suyo ya se encarga RLS.
--   · Los precios y el histórico son de lectura para todo el mundo: los escribe
--     el cron con la clave de servicio, que se salta RLS pero NO los grants.
grant select on public.steam_market_prices to authenticated;
grant select on public.steam_price_history to authenticated;
grant select, insert, update, delete on public.steam_holdings to authenticated;
grant select, insert, update, delete on public.steam_ledger to authenticated;
grant select, insert, update, delete on public.steam_portfolio_snapshots to authenticated;

grant all on public.steam_market_prices to service_role;
grant all on public.steam_price_history to service_role;
grant all on public.steam_holdings to service_role;
grant all on public.steam_ledger to service_role;
grant all on public.steam_portfolio_snapshots to service_role;
