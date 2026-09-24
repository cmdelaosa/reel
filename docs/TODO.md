# Pendientes

Lo que se ha visto que hay que arreglar y todavía no se ha hecho. A diferencia de
[PLAN.md](PLAN.md), que es la historia de cómo se construyó la app, esto es una
lista viva: se añade al descubrir algo y se borra la línea en el mismo commit que
lo arregla.

Cada entrada dice **dónde**, **qué pasa** y **cómo arreglarlo**, para que se pueda
coger sin reconstruir el contexto. Las primeras son las que alguien puede notar;
las de abajo, limpieza.

## Se notan

### «Mejor valoradas» puede quedar desordenada hasta un día
- **Dónde:** `supabase/functions/tmdb-proxy/index.ts`, `resolveTopRated` y
  `resolveMovieTopRated`.
- **Qué pasa:** el orden por IMDb se calcula una vez, con las notas que hay en
  `titles` en ese momento, y se guarda 24 h en `discover_cache`. Las filas se
  sirven frescas. Si en ese tiempo llega la nota de IMDb de un título que no la
  tenía (el repaso horario de `imdb_id` más `scripts/imdb-ratings`), la carátula
  enseña la nota nueva pero el título sigue en su puesto viejo: un 7,2 encima de
  un 8,3.
- **Arreglo:** guardar en caché el conjunto de candidatos y no el orden, y
  reordenar con `byImdbFirst` al servir, leyendo las notas de las filas que
  devuelve `titlesInOrder`. El tope de no occidentales se aplica después, igual
  que ahora.

### El orden A–Z no sigue el nombre que se ve, en español
- **Dónde:** `app/src/features/shows/ShowsPage.tsx` (`az`) y
  `app/src/features/movies/MoviesPage.tsx` (`az`).
- **Qué pasa:** ordena por `name`, el original, y la carátula enseña el
  traducido (`locName` / `esNames`). «La casa de papel» sale entre las M,
  porque se ordena como «Money Heist».
- **Arreglo:** ordenar por el mismo nombre que pinta la carátula. Los nombres en
  español ya están en `useEsNames()`, así que el comparador tiene que recibirlos.

### La ficha pierde el enlace a IMDb cuando no hay nota de IMDb
- **Dónde:** `app/src/features/detail/DetailSheet.tsx` y
  `app/src/features/movies/MovieSheet.tsx`, celda de la nota de fuera.
- **Qué pasa:** el enlace solo sale si la nota que se enseña es la de IMDb. Una
  serie con `imdb_id` pero sin `imdb_rating` (menos de 20 votos, o sin importar
  todavía) enseña la de TMDB y ya no enlaza a IMDb en ningún sitio. Antes salía
  «IMDb —» con el enlace.
- **Arreglo:** si hay `imdb_id`, que la celda enlace siempre, aunque enseñe la
  de TMDB. O un enlace «IMDb ↗» aparte.

### La migración 0104 de Nintendo va a llegar fuera de orden
- **Dónde:** rama `importar-nintendo-por-codigo-de-amigo`,
  `supabase/migrations/0104_nintendo.sql`.
- **Qué pasa:** la 0105 (Continuar con nota de IMDb) llega antes a producción.
  El `supabase db push` de la 0104 parará con «Found local migration files to be
  inserted before the last migration on remote database».
- **Arreglo:** al fusionar esa rama, `supabase db push --include-all`. O
  renumerarla a la siguiente libre antes de fusionar.

## Tardan

### Cambiar un esquema persistido tira la caché de toda la biblioteca
- **Dónde:** `app/src/lib/queryPersistence.ts`, `shapeFingerprint`.
- **Qué pasa:** la huella mezcla las claves de los esquemas de la biblioteca y
  de Continuar en una sola. Añadir `imdb_rating` a `upNextRowSchema` descarta
  también la biblioteca guardada de cada usuario, que no había cambiado. La
  primera carga después de desplegar va en frío (~1,2 s; ~5 s con 2.100 filas).
- **Arreglo:** una huella por prefijo de consulta, para que solo se descarte lo
  que cambió.

### Tus series ordena de nuevo en cada tanda
- **Dónde:** `app/src/features/shows/ShowsPage.tsx`, `items`.
- **Qué pasa:** en cada comparación `byValue` vuelve a parsear fechas o a llamar
  a `externalScore`, y el filtrado y el orden se rehacen en cada render (unas 28
  tandas al hacer scroll, y al abrir o cerrar una ficha). Con ~1.700 series son
  ~5 ms por orden, unos 20 ms con la CPU a ×4.
- **Arreglo:** calcular la clave de cada fila una vez (decorar, ordenar,
  quitar) y meter el filtrado y el orden en un `useMemo`. MoviesPage y GamesPage
  tienen la misma forma.

## Limpieza

### Un solo gesto de «volver a pulsar invierte el orden»
- **Dónde:** `app/src/features/shows/ShowsPage.tsx` y
  `app/src/features/games/GamesPage.tsx`, con una tercera variante en Cine
  (`useRatedSort`, `app/src/lib/ratings.ts`).
- **Qué pasa:** el estado `{key, flipped}`, `pickSort`, la flecha y la clave de
  la tanda están copiados. Las copias ya difieren: Juegos actualiza desde `prev`
  y Series desde el render.
- **Arreglo:** un gancho junto a `flipDir` (`domain/librarySort`), usado por las
  tres. Al pasar Cine a él, además:
  - su barra con etiquetas de una palabra, contador solo en el cubo puesto y
    flecha solo en el orden puesto, como Series y Juegos;
  - borrar `useRatedSort`;
  - medir que cabe en los 1.224 px, en inglés y en español.

### La nota de fuera está pintada a mano en cinco sitios
- **Dónde:**
  - las fichas: `DetailSheet.tsx` y `MovieSheet.tsx`;
  - las insignias: `ui/Poster.tsx`, `TitlePoster` en
    `features/explore/DiscoverPieces.tsx` y `TitleListRow` en
    `features/explore/DiscoverSections.tsx`.
- **Qué pasa:** las copias ya no coinciden:
  - el `title` de los votos comprueba `imdb_votes ?` en una ficha e
    `imdb_votes != null ?` en la otra;
  - Poster calla la etiqueta en los juegos y las de Explorar no.
- **Arreglo:** un `ExternalScoreCell` para las fichas y un
  `ExternalScoreBadge` para las carátulas. De paso:
  - en `TitlePoster`, que `catalogScore` valga por omisión `kind === "movie"`
    y que se pinte una sola insignia en vez de dos condiciones exclusivas a mano;
  - en `DiscoverSections.tsx`, sacar `catalog` de `tab === "rated"` en vez de
    escribirlo en cada fila. El nombre además choca con `catalogMode`.

### La regla de la nota está escrita dos veces
- **Dónde:** `app/src/domain/externalScore.ts` y
  `supabase/functions/tmdb-proxy/rank.ts` (`byImdbFirst`).
- **Qué pasa:** el proxy no puede importar de `app/`, así que repite la regla
  («IMDb si es > 0, TMDB si no»). Si cambia una y no la otra, las listas de
  Explorar se ordenan por un número y enseñan otro, y ninguna prueba falla.
- **Arreglo:** un `externalScore.mirror.test.ts` que compare las dos con los
  mismos casos, como `airPairing.mirror.test.ts`.

### `/collection/:slug` copia `dedupeVisible` a mano
- **Dónde:** `supabase/functions/tmdb-proxy/index.ts`, la ruta de colecciones.
- **Qué pasa:** repite el bucle de `dedupeVisible`. Una regla nueva de
  ocultación no llegaría a las cuatro colecciones.
- **Arreglo:** llamar a `dedupeVisible(pages)`, como hacen los dos
  `resolve*TopRated`.

### Comentarios que ya mienten
- `app/src/features/movies/MovieSheet.tsx`, cabecera: dice que la ficha de serie
  enseña TMDB e IMDb «en paralelo». Desde que la nota de IMDb manda en todo
  enseña una sola, como la de película.
- `app/src/features/explore/DiscoverPieces.tsx`, doc de `score`: dice que una
  carátula de series no saca nota propia, y con `catalogScore` sí la saca.

## Decisiones abiertas

### Los episodios enseñan las dos notas
- **Dónde:** la lista de episodios de `DetailSheet.tsx` (`.ep-imdb` y `.ep-tmdb`)
  y `features/detail/EpisodeSheet.tsx`.
- **Qué pasa:** en todo lo demás hay una sola nota de fuera. Aquí van las dos,
  con IMDb delante.
- **Por decidir:** si la de TMDB se queda o se va.

### «Mejor valoradas» solo ve lo que TMDB ya puntúa alto
- **Dónde:** `resolveTopRated` y `resolveMovieTopRated`.
- **Qué pasa:** los candidatos son las 8 páginas mejor puntuadas por TMDB (~160).
  Un título que IMDb pone alto y TMDB no, no entra nunca. Y un título sin
  `imdb_id` todavía (no se ha abierto nunca) se ordena por la de TMDB.
- **Por decidir:** si merece la pena un grupo de candidatos más grande o un
  orden hecho en SQL sobre `titles`.

## Herramientas

### El entorno en la nube no puede correr las pruebas del proxy ni desplegar
- `deno.land` y `esm.sh` están bloqueados en la red del entorno en la nube. Las
  pruebas de `supabase/functions` que importan de `deno.land` no corren ahí:
  solo en el job `edge` del CI. Lo que importa de `jsr.io` (`rank_test.ts`) sí
  corre.
- Para que una sesión en la nube pueda desplegar hacen falta
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` y `SUPABASE_DB_PASSWORD` en la
  configuración del entorno.

### Un aviso de lint que ya estaba
- `app/src/ui/shell/TopTabs.tsx:116`: `react-hooks/exhaustive-deps`, falta
  `setOpen`.
