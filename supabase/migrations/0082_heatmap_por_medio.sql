-- 0082_heatmap_por_medio.sql
-- La rejilla de actividad deja de ser monocroma: cada día dice DE QUÉ fue.
--
-- ── Lo que ya pasaba ──────────────────────────────────────────────────────
-- `rpc_watch_heatmap` (0047, ampliada en 0048) lleva desde el primer día
-- contando los tres medios sin saberlo. Ver una película y terminar un juego
-- escriben un `watch_event` sobre el episodio sintético S1E1 que 0067 y 0071 les
-- dan, así que la función los sumaba a los episodios de verdad y devolvía un
-- número por día bajo una sola palabra —"N episodios"— y un solo color.
--
-- O sea: el dato estaba, la pregunta no. Esto la hace.
--
-- ── Por qué una función NUEVA y no recrear la de siempre ──────────────────
-- 0048 recreó la suya en vez de sobrecargarla, y lo argumentó: una sola firma
-- que mantener. Aquí no vale, y la diferencia es el TIPO DE RETORNO.
--
-- El frontend se despliega solo al fusionar y esta migración se aplica a mano
-- después. En esa ventana el cliente nuevo habla con la base vieja, que es un
-- caso conocido y cubierto (PGRST202 → respaldo). Pero recrear la función
-- añadiéndole `kind` abre la ventana CONTRARIA, que no tiene respaldo posible:
-- un cliente ya cargado en el navegador de alguien —o cacheado— seguiría
-- pidiendo la de siempre y recibiría cada día repetido una vez por medio,
-- pintando tres cuadraditos donde hay uno.
--
-- Con una función al lado no hay ventana que cubrir en ninguna de las dos
-- direcciones: la vieja sigue respondiendo exactamente lo que respondía, y el
-- cliente nuevo pide la nueva y cae a la vieja mientras esto no esté aplicado
-- (rejilla monocroma, sin un solo error en pantalla).
--
-- ── Qué cuenta, y qué no ──────────────────────────────────────────────────
-- Exactamente lo mismo que la de siempre: `watch_events`, sin filtrar por
-- temporada. El total de un día tiene que salir idéntico al de la función vieja
-- o el respaldo dejaría de ser un respaldo y sería otra rejilla.
--
-- En particular NO se filtra `e.season_number > 0`, que es lo que hacen las
-- funciones de progreso. Aquí los especiales cuentan, porque verlos es verlos, y
-- porque así lo venía haciendo esto.
--
-- Lo añadido y lo puntuado se quedan fuera, como estaban: la rejilla es de "qué
-- consumiste", que es lo que hace comparables un martes y otro. Sumarle las
-- altas convertiría el día de la importación de FilmAffinity (1.325 películas)
-- en el máximo del año, y el año entero, por comparación, en el escalón más
-- bajo.
--
-- ── Seguridad ─────────────────────────────────────────────────────────────
-- `security invoker`, como la de 0048 y por lo mismo: la política "watch_events:
-- friends read" de 0015 (amigo aceptado Y perfil no privado) es la que filtra,
-- así que apuntar `p_user` a un desconocido devuelve una rejilla vacía en vez de
-- una fuga. Las uniones a `episodes` y `titles` no aflojan eso: las dos son
-- tablas de metadatos legibles por cualquier autenticado, y de ellas solo sale
-- el medio de algo que quien pregunta ya podía ver.

create or replace function public.rpc_watch_heatmap_kinds(
  days int default 182,
  tz text default 'UTC',
  p_user uuid default null
)
returns table (day date, kind text, n bigint)
language sql
security invoker
stable
as $$
  select
    (w.watched_at at time zone tz)::date as day,
    t.kind::text as kind,
    count(*)::bigint as n
  from public.watch_events w
  join public.episodes e on e.id = w.episode_id
  join public.titles t on t.id = e.title_id
  where w.user_id = coalesce(p_user, (select auth.uid()))
    and w.watched_at >= now() - make_interval(days => days)
  group by 1, 2
  order by 1
$$;

grant execute on function public.rpc_watch_heatmap_kinds(int, text, uuid) to authenticated;
