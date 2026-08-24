-- 0071_movie_release_alerts.sql
-- Avisos de estreno de película: LAS DOS FECHAS avisan (decisión de producto,
-- 24-ago-2026). Cuando llega a los cines y cuando llega a streaming.
--
-- Es lo único que 0069 dejó deliberadamente fuera del modo cine, y por esto:
-- «un correo diciendo que una película ya está disponible el día de su estreno
-- EN CINE sería falso para quien la espera en casa». La respuesta no era elegir
-- una de las dos fechas sino avisar de las dos, cada una diciendo lo que es.
--
-- ── El libro de sellos no distinguía dos avisos de la misma cosa ────────────
-- notifications_sent lleva por clave (user_id, episode_id), que basta cuando
-- cada fila avisable es un episodio distinto. Una película tiene UN episodio
-- sintético (0067) y DOS estrenos, así que el segundo aviso chocaba con el
-- primero y se perdía en silencio — el peor final posible, porque el sistema
-- daría por enviado algo que nadie recibió.
--
-- La clave gana una tercera columna con QUÉ se avisó. 'episode' para las series
-- (el valor por defecto, así que las filas que ya existen quedan donde estaban
-- sin tocarlas), 'theatrical' y 'digital' para los dos estrenos de una película.

alter table public.notifications_sent
  add column if not exists event text not null default 'episode';

comment on column public.notifications_sent.event is
  'Qué se avisó de esta fila: episode (series) | theatrical | digital (cine, '
  '0071). Una película tiene un solo episodio sintético y dos estrenos, así que '
  'sin esto el segundo aviso se perdía como duplicado del primero.';

alter table public.notifications_sent drop constraint notifications_sent_pkey;
alter table public.notifications_sent
  add constraint notifications_sent_pkey primary key (user_id, episode_id, event);

-- ============================================================
-- pending_movie_release_alerts — qué se estrena hoy de lo tuyo
-- ============================================================
-- Gemela de pending_new_episode_alerts, y con su misma forma: devuelve lo que
-- HAY que avisar y deja el sellado a quien avisa, que es lo que hace el proceso
-- idempotente (ver el bloque de dedupe atómico en functions/alerts).
--
-- Diferencias con la de series, y por qué:
--
--   * EL PAÍS. Las fechas de estreno son por país (0068) y el país lo elige
--     cada persona en Ajustes, así que la ventana se evalúa contra el suyo. Una
--     película que llega a los cines españoles hoy no ha llegado a los alemanes,
--     y avisar a quien no puede ir es peor que no avisar. Sin país guardado se
--     usa ES, que es el mercado desde el que se mira esta app (mismo criterio
--     que PROVIDER_COUNTRIES en el proxy).
--
--   * LO YA VISTO NO AVISA. En series el aviso es "hay algo nuevo de esto que
--     sigues"; en cine, "ya puedes verla". A quien ya la vio no le puedes decir
--     que ya puede verla. El estreno digital de una película que viste en el
--     cine tampoco avisa: la viste.
--
--   * SIN VENTANA DE GRACIA HACIA ATRÁS más allá de las 24 h, igual que series.
--     El cron corre a diario; una fecha que se mueva hacia atrás más de un día
--     (TMDB las corrige) simplemente no avisa, que es preferible a avisar de un
--     estreno de la semana pasada como si fuera de hoy.
create or replace function public.pending_movie_release_alerts()
returns table (
  user_id uuid,
  episode_id uuid,
  title_id uuid,
  tmdb_id int,
  movie_name text,
  release_kind text,
  release_on date
)
language sql
-- DEFINER, al revés que su gemela de series, y por una razón concreta: esta
-- necesita `profiles.country` para saber en qué país mirar las fechas, y
-- service_role NO tiene SELECT sobre profiles — 0001 se lo revocó a todo el
-- mundo menos a authenticated, y esa frontera no se abre por un cron. Corriendo
-- como el dueño lee la columna sin ampliar el alcance de nadie: de profiles no
-- sale nada hacia fuera, el país solo entra en el WHERE, y el grant de abajo
-- deja la función al alcance exclusivo del cron.
security definer
set search_path = public
stable
as $$
  with mine as (
    select
      le.user_id,
      t.id as title_id,
      t.tmdb_id,
      t.name,
      -- El episodio sintético: la fila con la que se sella el aviso, y la misma
      -- que marca la película como vista.
      (select e.id from public.episodes e where e.title_id = t.id limit 1) as episode_id,
      t.release_dates -> coalesce(nullif(p.country, ''), 'ES') as here
    from public.library_entries le
    join public.titles t on t.id = le.title_id
    join public.profiles p on p.id = le.user_id
    where le.followed
      and not le.stopped
      and t.kind = 'movie'
      -- Nada de lo que ya viste: el aviso dice "ya puedes verla".
      and not exists (
        select 1
        from public.watch_events wv
        join public.episodes e2 on e2.id = wv.episode_id
        where wv.user_id = le.user_id and e2.title_id = t.id
      )
  ),
  events as (
    select m.user_id, m.episode_id, m.title_id, m.tmdb_id, m.name,
           'theatrical' as release_kind, (m.here ->> 'theatrical')::date as day
    from mine m where m.here ->> 'theatrical' is not null
    union all
    select m.user_id, m.episode_id, m.title_id, m.tmdb_id, m.name,
           'digital', (m.here ->> 'digital')::date
    from mine m where m.here ->> 'digital' is not null
  )
  select e.user_id, e.episode_id, e.title_id, e.tmdb_id, e.name, e.release_kind, e.day
  from events e
  where e.episode_id is not null
    -- La misma ventana de 24 h que las series, sobre el día del estreno leído
    -- a medianoche UTC — la hora que el trigger de 0067 le pone al episodio
    -- sintético, y la que cae en el día correcto en todo el huso CET.
    and (e.day::timestamp at time zone 'UTC') <= now()
    and (e.day::timestamp at time zone 'UTC') > now() - interval '24 hours'
    and not exists (
      select 1 from public.notifications_sent ns
      where ns.user_id = e.user_id
        and ns.episode_id = e.episode_id
        and ns.event = e.release_kind
    )
$$;

grant execute on function public.pending_movie_release_alerts() to service_role;
