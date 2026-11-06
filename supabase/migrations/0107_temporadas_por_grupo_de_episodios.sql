-- 0107_temporadas_por_grupo_de_episodios.sql
-- Una serie puede numerarse con un «grupo de episodios» de TMDB en vez de con
-- sus temporadas.
--
-- POR QUÉ. TMDB guarda Lupin como tres temporadas (la 1 junta las Partes 1 y 2);
-- Netflix e IMDb cuentan cuatro partes. La ficha decía «3» donde el usuario
-- buscaba la Parte 4, y las notas de IMDb, que se cruzan por número, caían
-- corridas: la Parte 2 de IMDb pintada sobre la Parte 3. TMDB publica otras
-- ordenaciones del mismo catálogo («Parts», 6074e65418864b00439afa4f), y
-- `episode_group_id` dice cuál manda en esta serie.
--
-- SE FIJA A MANO, serie a serie, con scripts/grupo-episodios: los grupos son
-- muchos y desiguales (La casa de papel tiene cuatro) y elegir solo podría
-- equivocarse en silencio. Null, lo normal, es la numeración de TMDB.
--
-- Con grupo, la base guarda SU numeración: tmdb-proxy, el cron episode-refresh y
-- el importador traducen cada respuesta de TMDB antes de escribirla
-- (supabase/functions/_shared/grupo-episodios.ts).

alter table public.titles add column episode_group_id text;

comment on column public.titles.episode_group_id is
  'Grupo de episodios de TMDB que numera esta serie (0107); null = temporadas de TMDB.';

-- Pasa a la numeración del grupo los episodios que la serie YA tiene.
--
-- No basta con poner la columna y esperar al siguiente refresco: los escritores
-- hacen upsert por (title_id, season_number, episode_number), así que el
-- refresco escribiría la Parte 2 —«T2·E1» en el grupo— ENCIMA de la fila que hoy
-- es la T2·E1 de TMDB, la Parte 3, y los visionados de esa fila pasarían a
-- decir que viste otro episodio. Las filas tienen que moverse antes, cada una
-- con lo suyo: los visionados cuelgan del id de la fila y la acompañan.
--
-- p_temporadas: [{number, name, air_date, episode_count, tmdb_id}], las del grupo.
-- p_episodios:  [{de: "s:e" de TMDB, season, episode}], TODOS los pares que la
--               serie tiene hoy en TMDB, con su sitio en el grupo. Los calcula
--               scripts/grupo-episodios con la misma traducción que los
--               escritores, para que no haya dos versiones de la regla.
--
-- Se niega —y no toca nada— si la serie ya tiene grupo (sus números ya no son los
-- de TMDB) o si alguna fila no tiene sitio en p_episodios.
create or replace function public.aplicar_grupo_de_episodios(
  p_title uuid,
  p_grupo text,
  p_temporadas jsonb,
  p_episodios jsonb
) returns integer
language plpgsql
set search_path = public
as $$
declare
  v_sin_sitio text;
  v_movidas integer;
begin
  if p_title is null or not exists (select 1 from titles where id = p_title and kind = 'tv') then
    raise exception 'no hay ninguna serie con id %', p_title;
  end if;
  if (select episode_group_id from titles where id = p_title) is not null then
    raise exception 'la serie % ya tiene grupo de episodios', p_title;
  end if;

  -- Vive hasta el final de la transacción: una segunda serie en la misma
  -- transacción la encontraría ya creada.
  if to_regclass('pg_temp.destino') is not null then
    drop table pg_temp.destino;
  end if;
  create temp table destino on commit drop as
  select e.id, (m->>'season')::int as season, (m->>'episode')::int as episode
  from episodes e
  left join jsonb_array_elements(p_episodios) m
    on m->>'de' = e.season_number || ':' || e.episode_number
  where e.title_id = p_title;

  select string_agg(e.season_number || ':' || e.episode_number, ', ')
    into v_sin_sitio
  from destino d join episodes e on e.id = d.id
  where d.season is null;
  if v_sin_sitio is not null then
    raise exception 'episodios sin sitio en el grupo: %', v_sin_sitio;
  end if;

  update titles set
    episode_group_id = p_grupo,
    -- Fuerza el refresco: la próxima apertura y el próximo cron reescriben
    -- temporadas, emitidos y la temporada que se estrena ya con el grupo.
    last_refreshed_at = null,
    episodes_refreshed_at = null
  where id = p_title;

  insert into seasons (title_id, tmdb_id, number, name, episode_count, air_date)
  select p_title, (t->>'tmdb_id')::int, (t->>'number')::int, t->>'name',
         (t->>'episode_count')::int, (t->>'air_date')::date
  from jsonb_array_elements(p_temporadas) t
  on conflict (title_id, number) do update set
    tmdb_id = excluded.tmdb_id,
    name = excluded.name,
    episode_count = excluded.episode_count,
    air_date = excluded.air_date;

  -- Dos pasos: primero cada fila a un número que nadie usa (-1 - n, negativo
  -- también para un episodio 0), luego al suyo. En uno solo, la Parte 2
  -- chocaría con la fila que aún ocupa la T2·E1.
  update episodes e set episode_number = -1 - e.episode_number
  from destino d
  where e.id = d.id;

  update episodes e set
    season_number = d.season,
    episode_number = d.episode,
    season_id = s.id,
    -- Las notas de IMDb se cruzaron con el número viejo: fuera las de las filas
    -- que cambian de número; la importación horaria las repone con el nuevo.
    imdb_id = case when e.season_number = d.season and -1 - e.episode_number = d.episode then e.imdb_id end,
    imdb_rating = case when e.season_number = d.season and -1 - e.episode_number = d.episode then e.imdb_rating end,
    imdb_votes = case when e.season_number = d.season and -1 - e.episode_number = d.episode then e.imdb_votes end
  from destino d
  join seasons s on s.title_id = p_title and s.number = d.season
  where e.id = d.id;
  get diagnostics v_movidas = row_count;

  -- Las temporadas de TMDB que el grupo ya no usa, cuando se han quedado vacías
  -- (el borrado de una temporada arrastra sus episodios: solo vacías).
  delete from seasons s
  where s.title_id = p_title
    and s.number not in (select (t->>'number')::int from jsonb_array_elements(p_temporadas) t)
    and not exists (select 1 from episodes e where e.season_id = s.id);

  return v_movidas;
end;
$$;

revoke all on function public.aplicar_grupo_de_episodios(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_grupo_de_episodios(uuid, text, jsonb, jsonb) to service_role;
