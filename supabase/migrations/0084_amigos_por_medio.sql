-- 0084_amigos_por_medio.sql
-- Lo que un amigo está haciendo, dicho en el medio en el que estás.
--
-- ── Lo que pasaba ─────────────────────────────────────────────────────────
-- La línea bajo el nombre de un amigo decía siempre «Viendo <lo último que
-- marcó>», y «lo último que marcó» es su último `watch_event` sea del medio que
-- sea: una película vista y un juego terminado escriben uno igual que un
-- episodio (0067, 0071). Así que la lista de amigos anunciaba «Viendo Dave the
-- Diver» —un videojuego, y encima terminado, no a medias— desde el modo Series.
--
-- Es el mismo fallo que 0079 arregló en los dos carriles de amigos de Explorar:
-- una fila correcta en la pantalla equivocada. Y con el agravante del verbo:
-- «ver» de algo que se juega es justo la etiqueta prestada que 0071 se negó a
-- publicar.
--
-- ── La forma ──────────────────────────────────────────────────────────────
-- Un parámetro `p_kind` con 'tv' por defecto, como en 0079 y por lo mismo: el
-- cliente que ya está desplegado llama sin argumentos y tiene que seguir viendo
-- exactamente lo que veía, para que esta migración pueda aplicarse ANTES que el
-- frontend sin una ventana rara en medio (docs/DEPLOY.md).
--
-- Y DROP antes del CREATE, también como en 0079: en Postgres otra lista de
-- argumentos es otra función, así que un `create or replace` dejaría viva la
-- versión sin parámetros y las llamadas sin argumentos seguirían yendo a ella.
-- El fallo sobreviviría a su propio arreglo.
--
-- ── Por qué el verbo lo decide el servidor ────────────────────────────────
-- La columna nueva es `activity`, y podría no existir: el cliente sabe en qué
-- modo está y podría poner el verbo él. Pero «viendo» y «acaba de ver» no los
-- separa el modo, los separa un dato que solo está aquí —si a esa serie le
-- queda algún episodio emitido sin ver—, y pedirlo aparte sería una consulta
-- por amigo para escribir una palabra. Cuatro valores:
--
--   'watching'      serie con algún episodio emitido y sin ver
--   'just-watched'  serie al día o terminada, y toda película
--   'playing'       juego que él mismo marcó jugando (0073) y sin créditos
--   'just-finished' juego terminado — el respaldo de cuando no juega a nada
--
-- El respaldo de juegos importa más de lo que parece: `play_state` se pone a
-- mano, así que un amigo que no lo use no tendría NADA que enseñar en el modo
-- Videojuegos, ni siquiera los juegos que se terminó. Y 'playing' gana a
-- 'just-finished' cuando hay las dos cosas, que es lo que hace
-- domain/gameStatus con «terminado manda sobre lo dicho a mano»: aquí no se
-- describe UN juego sino a la persona, y lo que está jugando ahora es más
-- reciente que lo que terminó.
--
-- ── La privacidad, una sola vez ───────────────────────────────────────────
-- Esta función es `security definer`: se salta la RLS, así que el filtro de
-- 0021 —amistad aceptada y perfil no privado— es lo único que separa la
-- actividad de un amigo privado de la pantalla. Va UNA vez, envolviendo a las
-- tres ramas, y no copiado dentro de cada una. Copiado son tres sitios donde
-- olvidarlo; envolviendo, la rama que se añada mañana nace filtrada.

drop function if exists public.rpc_my_friendships();

create or replace function public.rpc_my_friendships(p_kind text default 'tv')
returns table (
  other_id uuid,
  handle text,
  display_name text,
  avatar_url text,
  status text,
  incoming boolean,
  watching_title text,
  watching_tmdb int,
  watching_season int,
  watching_episode int,
  activity text
)
language sql
security definer
set search_path = ''
stable
as $$
  with me as (select auth.uid() as uid)
  select
    other.id,
    other.handle::text,
    other.display_name,
    other.avatar_url,
    f.status,
    (f.status = 'pending' and f.requested_by <> me.uid) as incoming,
    act.name, act.tmdb_id, act.season_number, act.episode_number, act.activity
  from me
  join public.friendships f on me.uid in (f.a, f.b)
  join public.profiles other
    on other.id = case when f.a = me.uid then f.b else f.a end
  left join lateral (
    select c.name, c.tmdb_id, c.season_number, c.episode_number, c.activity
    from (
      -- Series y cine: su último watch_event DEL MEDIO. El `t.kind = p_kind` es
      -- el arreglo — sin él, el último evento de cualquier medio se colaba aquí.
      -- `season_number > 0` deja fuera los especiales, como en todas partes.
      (select
        0 as pri,
        wv.watched_at as seen_at,
        t.name,
        t.tmdb_id,
        e.season_number,
        e.episode_number,
        case
          when p_kind = 'tv' and exists (
            select 1
            from public.episodes ne
            where ne.title_id = t.id
              and ne.season_number > 0
              and ne.air_datetime is not null
              and ne.air_datetime <= now()
              and not exists (
                select 1 from public.watch_events w2
                where w2.user_id = other.id and w2.episode_id = ne.id
              )
          ) then 'watching'
          else 'just-watched'
        end as activity
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id and e.season_number > 0
      join public.titles t on t.id = e.title_id and t.kind = p_kind
      where p_kind in ('tv', 'movie')
        and wv.user_id = other.id
      order by wv.watched_at desc
      limit 1)

      union all

      -- Juegos, lo que está jugando. No sale de contar nada: es lo que dijo a
      -- mano (0073). 'ongoing' entra con 'playing' porque también es jugarlo —
      -- lo que dice es que ese juego no se acaba, no que lo haya dejado.
      -- La fecha es `played_at` (0075), y `added_at` cuando aún no consta.
      (select
        0,
        coalesce(le.played_at, le.added_at),
        t.name,
        t.tmdb_id,
        null::int,
        null::int,
        'playing'
      from public.library_entries le
      join public.titles t on t.id = le.title_id and t.kind = 'game'
      where p_kind = 'game'
        and le.user_id = other.id
        and le.play_state in ('playing', 'ongoing')
        -- Terminado deja de ser «jugando», como en domain/gameStatus: los
        -- créditos mandan sobre la etiqueta que quedó puesta de antes.
        and not exists (
          select 1
          from public.watch_events wv
          join public.episodes e on e.id = wv.episode_id
          where wv.user_id = other.id and e.title_id = t.id
        )
      order by coalesce(le.played_at, le.added_at) desc
      limit 1)

      union all

      -- Juegos, el respaldo: lo último que se terminó.
      (select
        1,
        wv.watched_at,
        t.name,
        t.tmdb_id,
        null::int,
        null::int,
        'just-finished'
      from public.watch_events wv
      join public.episodes e on e.id = wv.episode_id
      join public.titles t on t.id = e.title_id and t.kind = 'game'
      where p_kind = 'game'
        and wv.user_id = other.id
      order by wv.watched_at desc
      limit 1)
    ) c(pri, seen_at, name, tmdb_id, season_number, episode_number, activity)
    where f.status = 'accepted'
      and not public.profile_is_private(other.id)
    order by c.pri, c.seen_at desc
    limit 1
  ) act on true
  order by (f.status = 'pending' and f.requested_by <> me.uid) desc, other.display_name
$$;

comment on function public.rpc_my_friendships(text) is
  'Mis amistades + lo que cada amigo hace EN EL MEDIO p_kind (tv | movie | game). activity: watching | just-watched | playing | just-finished, o null si no hay nada suyo de ese medio.';

grant execute on function public.rpc_my_friendships(text) to authenticated;
