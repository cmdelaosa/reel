-- 0101_el_rollup_lee_episodios_del_indice.sql
-- `eps`, el agregado de episodios del rollup, deja de ir al heap.
--
-- LO MEDIDO, en producción el 19-sep-2026, `rpc_library_rollup('tv')` para la
-- biblioteca más grande (2.109 filas, 394 series seguidas, 16.235 episodios):
-- mismo plan y mismos buffers en todas las vueltas, ni una lectura de disco, y
-- sin embargo la primera tarda 3.191 ms y las siguientes 35. Es la instancia
-- (CPU compartida) despertando: el tiempo en frío escala con el TRABAJO, y el
-- trabajo se cuenta en buffers.
--
--     total del rollup         19.357 buffers   3.191 ms en frío
--       CTE eps                11.782 buffers   2.181 ms   ← este fichero
--       CTE mine                6.393 buffers   1.000 ms
--
-- `eps` es un Nested Loop de 394 Index Scan, uno por serie, y cada fila la va
-- a buscar al heap solo por `air_datetime`: 16.235 filas anchas (llevan las
-- sinopsis en dos idiomas y el equipo; 58 MB para 49.388 episodios, ~7 por
-- página) repartidas por la tabla.
--
-- LO QUE CAMBIA. El índice de 0002 `(title_id, air_datetime)` pasa a llevar
-- `season_number` como columna INCLUDE: con eso tiene las tres columnas que lee
-- `eps` y el recorrido es un Index Only Scan. Se SUSTITUYE, no se añade otro:
-- mismas columnas clave en el mismo orden, así que todo lo que usaba el viejo
-- usa este, y el INCLUDE solo alarga la hoja (4,1 MB hoy).
--
-- La función no se toca. Sus 32 columnas y sus valores son los mismos por
-- construcción: un índice no cambia un resultado.
--
-- ── Y la mitad que no es el índice: el mapa de visibilidad ──────────────
-- Un Index Only Scan solo se ahorra el heap en las páginas marcadas
-- all-visible. En producción lo estaban el 53 % (3.958 de 7.467). El cron
-- episode-refresh reescribe cada noche, con los mismos valores las más de las
-- veces, las dos últimas temporadas de ~110 series —justo los episodios que lee
-- el rollup—, y cada reescritura apaga el bit de su página. Lo que lo vuelve a
-- encender es un VACUUM, y el autovacuum de esta tabla no pasaba: con el umbral
-- por defecto (50 + 20 % de las filas ≈ 9.900 muertas) llevaba 9 días sin
-- correr con 7.434.
--
-- Medido en local, con datos de la forma de producción (ver el informe de la
-- PR), buffers de `eps`:
--
--                              visibilidad 100 %   visibilidad 50 %
--     índice de 0002                  17.713             17.713
--     índice con INCLUDE               1.330             10.165
--
-- O sea: el índice solo, con el mapa como está, baja `eps` un 42 %; con el mapa
-- al día, un 92 %. Por eso este fichero baja también el umbral de autovacuum de
-- `episodes` a 200 filas + 1 %: ≈ 700 muertas, que la pasada nocturna del cron
-- supera por sí sola, así que el vacuum llega minutos después de ella y no
-- nueve días después. Es barato: VACUUM solo recorre las páginas que no son ya
-- all-visible. Probado en local: una pasada como la del cron (2.200 filas
-- reescritas con los mismos valores) dejó la tabla al 59 %; el poda-al-leer
-- rebajó las muertas a 1.766, que siguen por encima del umbral, y el
-- autovacuum entró a los 25 s y la devolvió al 100 %. Con el umbral por
-- defecto no habría entrado.
--
-- La matriz supabase/sql-checks/0101_eps_sin_heap.sql vigila las dos cosas.
--
-- ── Cómo va en la migración ──────────────────────────────────────────────
-- Sin `concurrently`, con begin/commit escritos. `create index concurrently` no
-- cabe en una transacción, y aquí las migraciones corren en una en local y en
-- el CI (y sin ella en el push remoto): el mismo fichero no puede valer para
-- las dos cosas. Y no hace falta: son 49.388 filas, el índice se construye en
-- décimas de segundo, y lo que bloquea mientras tanto (SHARE) son las
-- ESCRITURAS en episodes, no las lecturas. El DROP del viejo sí toma ACCESS
-- EXCLUSIVE, pero va después de construir el nuevo y justo antes del commit, así
-- que ese bloqueo dura lo que el commit. `lock_timeout` para no quedarse en la
-- cola detrás de una lectura larga y bloquear a todos los que vengan detrás: si
-- no lo consigue en 5 s, falla entera y no deja nada a medias.
--
-- Idempotente: se puede repetir (si el registro en schema_migrations fallara
-- tras el commit, el siguiente push la repite).

begin;

set local lock_timeout = '5s';

drop index if exists public.episodes_title_air_include_idx;
create index episodes_title_air_include_idx
  on public.episodes (title_id, air_datetime) include (season_number);
drop index if exists public.episodes_title_air_idx;
alter index public.episodes_title_air_include_idx rename to episodes_title_air_idx;

alter table public.episodes set (
  autovacuum_vacuum_threshold = 200,
  autovacuum_vacuum_scale_factor = 0.01
);

commit;
