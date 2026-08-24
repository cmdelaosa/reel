-- 0074_steam.sql
-- Traer de Steam las horas jugadas. La tercera y última rodaja del modo
-- Videojuegos; el catálogo lo puso 0071 y el progreso a mano 0073.
--
-- ── Lo que ya estaba puesto y aquí se cobra ───────────────────────────────
-- 0071 dejó `titles.steam_appid`, que `igdb-proxy` rellena desde el
-- `external_games` de IGDB cada vez que alguien abre una ficha. Ese es el
-- puente Steam↔IGDB, y existe precisamente para que esta rama no tenga que
-- recorrer el catálogo entero: un appid que ya esté en `titles` se casa con un
-- índice, sin salir a la red.
--
-- 0073 dejó `library_entries.minutes_source` ('manual' | 'steam'), que hasta
-- hoy siempre valía 'manual'. Toda su razón de ser es lo que se decide abajo:
-- una cifra escrita a mano no la pisa la sincronización.
--
-- ── El login de Steam es POR USUARIO, al revés que el de IGDB ─────────────
-- IGDB es de Twitch y va por *client credentials*: un par de credenciales del
-- PROYECTO. Steam no: no tiene OAuth, tiene OpenID 2.0, y lo que devuelve es
-- el SteamID64 de QUIEN se identifica. Así que hace falta guardarlo por
-- persona, y de ahí `profiles.steam_id`. La Web API key sí es del proyecto
-- (secreto `STEAM_API_KEY`, ver docs/DEPLOY.md).
--
-- ── 'Owned' no es un estado ───────────────────────────────────────────────
-- Un juego que tienes comprado y no has empezado no es lo mismo que uno que
-- has decidido jugar. `library_entries.owned` es ortogonal a `play_state`:
-- dice "este juego es mío", no "voy por aquí". Lo marca la importación en todo
-- lo que venga de Steam, y también se marca a mano desde la ficha para lo que
-- tengas en consola, en GOG o en físico — si solo lo escribiera Steam, la
-- marca mentiría por omisión en cuanto compraras algo fuera.
--
-- Lo que arrastra a la derivación (app/src/domain/gameStatus.ts): un juego
-- `owned` sin horas, sin estado y sin terminar NO cae en "Pendientes". Cae en
-- un estado propio que no tiene chip y por tanto solo se ve en "Todos". Es la
-- misma avería que ya evitamos con "Jugando": las horas de Steam son de por
-- vida, y dejar que cuarenta juegos heredados aterricen en el cubo con el que
-- decides qué jugar lo convierte en un cubo inservible.

-- ============================================================
-- 1. La cuenta de Steam, en el perfil
-- ============================================================
-- Texto y no int8 aunque quepa: es un identificador opaco, nunca se suma ni se
-- ordena, y llega de la URL de OpenID como cadena. El check son los 17 dígitos
-- del formato; validar el rango exacto de SteamID64 sería fijar en la base una
-- regla de Valve que Valve puede mover.
--
-- El índice único: dos cuentas de Reel apuntando a la misma de Steam significa
-- que alguien enlazó la de otro, y la importación escribiría en dos
-- bibliotecas desde una sola fuente. Se prefiere el error a la sorpresa.
alter table public.profiles add column if not exists steam_id text;
alter table public.profiles drop constraint if exists profiles_steam_id_check;
alter table public.profiles add constraint profiles_steam_id_check
  check (steam_id is null or steam_id ~ '^[0-9]{17}$');
create unique index if not exists profiles_steam_id_key
  on public.profiles (steam_id) where steam_id is not null;

alter table public.profiles add column if not exists steam_linked_at timestamptz;

comment on column public.profiles.steam_id is
  'SteamID64 de quien enlazo su cuenta por OpenID 2.0. Por usuario, no del proyecto: la Web API key si es del proyecto (STEAM_API_KEY).';

-- ============================================================
-- 2. 'Owned' — lo tienes comprado, lo diga Steam o lo digas tú
-- ============================================================
alter table public.library_entries add column if not exists owned boolean not null default false;

comment on column public.library_entries.owned is
  'Solo juegos: lo tienes comprado. Ortogonal a play_state. Lo escribe la importacion de Steam y tambien se marca a mano (consola, GOG, fisico).';

-- ============================================================
-- 3. El ida y vuelta de OpenID necesita un pagaré
-- ============================================================
-- Steam devuelve a la persona a una URL nuestra (`return_to`) con los
-- parámetros de OpenID, y ese viaje es una navegación del navegador: no lleva
-- la cabecera Authorization, así que en la vuelta no sabríamos QUIÉN volvió.
--
-- La tentación es meter el JWT en `return_to`. No: acabaría en el historial
-- del navegador, en el Referer y en los registros de Valve. Lo que viaja es
-- este pagaré de un solo uso, que no vale para nada más y caduca en diez
-- minutos.
--
-- ── Y por qué el pagaré NO basta para escribir `profiles.steam_id` ────────
-- Quien crea el pagaré elige el `user_id`, así que si la vuelta de Steam
-- escribiera directamente sobre él, esto sería un *login CSRF* de manual:
-- alguien con cuenta en Reel pide un pagaré, le pasa a otra persona el enlace
-- de Steam, esa persona se identifica de buena fe y su SteamID64 acaba escrito
-- en el perfil del PRIMERO — que a partir de ahí se importa la biblioteca de
-- Steam de alguien que no es él.
--
-- Por eso hay dos pasos y esta columna: la vuelta de Steam solo deja aquí el
-- SteamID64 que Valve ha confirmado, y quien lo reclama es la SESIÓN, en una
-- llamada aparte que exige que el dueño del pagaré sea quien la hace. Si el
-- pagaré es de otro, no se escribe nada.
create table if not exists public.steam_link_nonces (
  nonce       text primary key,
  user_id     uuid not null references public.profiles on delete cascade,
  -- Null hasta que Steam confirma. Con valor = verificado y esperando a que su
  -- dueño lo reclame.
  steam_id    text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes'
);
create index if not exists steam_link_nonces_expiry_idx on public.steam_link_nonces (expires_at);

-- Sin política ninguna: RLS encendida y nadie con acceso salvo service_role,
-- que la salta. Este pagaré no es dato de la persona, es fontanería del
-- protocolo, y que el navegador pudiera leerlo lo devaluaría a un parámetro.
alter table public.steam_link_nonces enable row level security;
revoke all on public.steam_link_nonces from anon, authenticated;
grant all on public.steam_link_nonces to service_role;

-- ============================================================
-- 4. La importación: una tabla para el intento y otra para sus filas
-- ============================================================
-- Existen porque la pantalla es *conectar → ver qué va a entrar → confirmar*,
-- y ese "ver" es un estado que sobrevive a recargar la página. Guardar el
-- escaneo en memoria del navegador significaría volver a pedirle a Steam la
-- lista entera cada vez que alguien se equivoca de pestaña.
--
-- Nada de esto es la biblioteca: son un borrador. Confirmar copia a
-- library_entries y deja estas filas como recibo de lo que pasó.
create table if not exists public.steam_imports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles on delete cascade,
  -- scanning: pidiéndole a Steam la lista. ready: hay filas y esperan tu visto
  -- bueno. applying: escribiendo (incluida la resolución contra IGDB de lo que
  -- no estaba en el catálogo, que va por lotes y en segundo plano). done.
  -- error: `error` dice cuál, y 'private' es el que la interfaz explica aparte.
  state       text not null default 'scanning'
                check (state in ('scanning', 'ready', 'applying', 'done', 'error')),
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  summary     jsonb not null default '{}'
);
create index if not exists steam_imports_user_idx on public.steam_imports (user_id, started_at desc);

-- Una fila por juego que Steam dice que tienes. Los hechos, no las decisiones:
-- lo que marques en la pantalla viaja en la petición de confirmar y no se
-- guarda aquí — una casilla persistida es una casilla que hay que sincronizar,
-- y esta pantalla se rellena una vez y se confirma una vez.
create table if not exists public.steam_import_items (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid not null references public.steam_imports on delete cascade,
  user_id     uuid not null references public.profiles on delete cascade,
  appid       int not null,
  steam_name  text not null,
  -- MINUTOS, que es la unidad que devuelve Steam (`playtime_forever`) y la que
  -- guarda library_entries.minutes_played. No hay conversión en ningún punto.
  minutes     int not null default 0,
  -- La fila de `titles` con la que casa, si casa. Null = no está en el
  -- catálogo todavía y hay que preguntarle a IGDB por su appid.
  title_id    uuid references public.titles on delete set null,
  in_library  boolean not null default false,
  -- Las horas que TÚ escribiste, fotografiadas en el escaneo y solo cuando las
  -- hay: es lo que deja a la pantalla enseñar "tú: 40 h · Steam: 12 h" sin una
  -- segunda consulta, y lo que convierte el conflicto en una casilla que
  -- decides en vez de en una cifra que desaparece.
  manual_minutes int,
  state       text not null default 'pending'
                check (state in ('pending', 'applied', 'skipped', 'unresolved')),
  unique (import_id, appid)
);
create index if not exists steam_import_items_import_idx on public.steam_import_items (import_id);

-- Lectura del dueño y nada más. Escribe la edge function con la clave de
-- servicio: las filas salen de Steam y de IGDB, no del navegador, y un INSERT
-- desde el cliente sería dejarle inventar qué juegos tiene.
alter table public.steam_imports enable row level security;
revoke all on public.steam_imports from anon, authenticated;
grant select on public.steam_imports to authenticated;
grant all on public.steam_imports to service_role;
create policy "steam_imports: owner reads own"
  on public.steam_imports for select
  using (user_id = (select auth.uid()));

alter table public.steam_import_items enable row level security;
revoke all on public.steam_import_items from anon, authenticated;
grant select on public.steam_import_items to authenticated;
grant all on public.steam_import_items to service_role;
create policy "steam_import_items: owner reads own"
  on public.steam_import_items for select
  using (user_id = (select auth.uid()));

-- ============================================================
-- 5. La biblioteca sirve las dos columnas nuevas
-- ============================================================
-- Cuerpo idéntico al de 0073 salvo `owned` y `minutes_source`. Se recrea
-- entera, como hizo 0073 sobre 0067, porque cambiar el `returns table` de una
-- función SQL obliga a soltarla.
--
-- `minutes_source` viaja para que la ficha pueda decir de dónde salen las
-- horas ("de Steam" frente a las tuyas) sin una consulta más: la biblioteca ya
-- se lee entera en cada pantalla, y esto es una columna de texto por fila.
drop function if exists public.rpc_library_rollup();
create function public.rpc_library_rollup()
returns table (
  title_id uuid,
  tmdb_id int,
  kind text,
  name text,
  poster_path text,
  first_air_date date,
  tmdb_status text,
  genres text[],
  network text,
  vote_average numeric,
  favorite boolean,
  notify boolean,
  stopped boolean,
  added_at timestamptz,
  aired_count int,
  watched_count int,
  last_watched_at timestamptz,
  last_aired_datetime timestamptz,
  next_air_datetime timestamptz,
  upcoming_season_number int,
  upcoming_season_air_date date,
  play_state text,
  minutes_played int,
  release_precision text,
  platforms text[],
  beat_seconds jsonb,
  owned boolean,
  minutes_source text
)
language sql
security invoker
stable
as $$
  select
    t.id,
    t.tmdb_id,
    t.kind,
    t.name,
    t.poster_path,
    t.first_air_date,
    t.status,
    t.genres,
    t.network,
    t.vote_average,
    le.favorite,
    le.notify,
    le.stopped,
    le.added_at,
    coalesce(t.aired_count, a.aired, 0)::int,
    coalesce(w.watched, 0)::int,
    w.last_watched_at,
    a.last_aired,
    a.next_air,
    t.upcoming_season_number,
    t.upcoming_season_air_date,
    le.play_state,
    le.minutes_played,
    t.release_precision,
    t.platforms,
    t.beat_seconds,
    le.owned,
    le.minutes_source
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  left join lateral (
    select
      count(*) filter (where e.air_datetime <= now()) as aired,
      max(e.air_datetime) filter (where e.air_datetime <= now()) as last_aired,
      min(e.air_datetime) filter (where e.air_datetime > now()) as next_air
    from public.episodes e
    where e.title_id = t.id and e.season_number > 0
  ) a on true
  left join lateral (
    select count(*) as watched, max(wv.watched_at) as last_watched_at
    from public.watch_events wv
    join public.episodes e2 on e2.id = wv.episode_id
    where e2.title_id = t.id and e2.season_number > 0 and wv.user_id = le.user_id
  ) w on true
  where le.user_id = (select auth.uid()) and le.followed
$$;
grant execute on function public.rpc_library_rollup() to authenticated;
