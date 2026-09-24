-- 0105_continuar_con_nota_de_imdb.sql
-- `imdb_rating` viaja en rpc_up_next.
--
-- POR QUÉ. La carátula de una serie enseña desde ahora la nota de IMDb, con la
-- de TMDB de reserva (app/src/domain/externalScore.ts), igual que la de una
-- película. La biblioteca ya la traía desde 0080. El carril Continuar de Esta
-- noche no: lee rpc_up_next, que devuelve una selección de columnas y nunca
-- incluyó esta, así que la misma serie habría salido con su 8,7 de IMDb en Tus
-- series y con el 8,2 de TMDB en Esta noche, a una pestaña de distancia. Es lo
-- mismo que arreglaron 0080 y 0102 en el rollup.
--
-- LA COLUMNA VA AL FINAL de la lista de retorno, por lo mismo que allí: el
-- cliente valida por nombre (upNextRowSchema). La lleva como opcional para que
-- un cliente desplegado antes que esta migración no rompa.
--
-- Y HAY QUE HACER `drop function`: cambiar el tipo de retorno de una función
-- que devuelve tabla no se puede con `create or replace`. El drop se lleva la
-- ACL, y por eso el `grant` va detrás. Todo en una transacción, para que no
-- haya un instante en que Esta noche pida una función que no existe.
--
-- El cuerpo es el de 0067 sin tocar, salvo la columna nueva.

begin;

drop function if exists public.rpc_up_next();
create function public.rpc_up_next()
returns table (
  title_id uuid, tmdb_id int, name text, poster_path text, backdrop_path text,
  network text, vote_average numeric, episode_id uuid, season_number int,
  episode_number int, episode_name text, runtime int, air_datetime timestamptz,
  aired_count int, watched_count int, last_watched_at timestamptz,
  imdb_rating numeric
)
language sql
security invoker
stable
as $$
  select
    t.id, t.tmdb_id, t.name, t.poster_path, t.backdrop_path, t.network, t.vote_average,
    n.id, n.season_number, n.episode_number, n.name,
    coalesce(n.runtime, t.episode_run_time), n.air_datetime,
    c.aired::int, c.watched::int, c.last_watched_at,
    t.imdb_rating
  from public.library_entries le
  join public.titles t on t.id = le.title_id
  join lateral (
    select e.id, e.season_number, e.episode_number, e.name, e.runtime, e.air_datetime
    from public.episodes e
    where e.title_id = t.id
      and e.season_number > 0
      and e.air_datetime is not null
      and e.air_datetime <= now()
      and not exists (
        select 1 from public.watch_events wv
        where wv.user_id = (select auth.uid()) and wv.episode_id = e.id
      )
    order by e.season_number, e.episode_number
    limit 1
  ) n on true
  join lateral (
    select
      count(*) filter (where e2.air_datetime <= now() and e2.season_number > 0) as aired,
      count(*) filter (where wv.id is not null) as watched,
      max(wv.watched_at) as last_watched_at
    from public.episodes e2
    left join public.watch_events wv
      on wv.episode_id = e2.id and wv.user_id = (select auth.uid()) and e2.season_number > 0
    where e2.title_id = t.id
  ) c on true
  where le.user_id = (select auth.uid())
    and le.followed
    and not le.stopped
    and t.kind = 'tv'
    and c.watched > 0
$$;
grant execute on function public.rpc_up_next() to authenticated;

commit;
