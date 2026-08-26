# FilmAffinity → Reel

Importador de un solo uso para traerse **los votos** (`myvotes.php`) y **una
lista** (`mylist.php`) de FilmAffinity al perfil de Reel: cada película votada
queda vista, con la fecha del voto y con la nota; cada película de la lista queda
en la biblioteca sin ver, que es como Reel dice «pendiente».

Solo cine. Series, miniseries, shows y episodios sueltos se quedan fuera: FA no
dice qué episodios viste, así que importarlos daría una nota suelta sin historial
detrás.

## 1. Sacar los datos de FilmAffinity

FA no tiene exportación y sus listas piden sesión, así que el scrape se hace
**desde el navegador donde ya estás dentro**, no desde aquí. En la consola de una
pestaña abierta en `filmaffinity.com`:

```js
const ex = (doc) => [...doc.querySelectorAll('.rate-movie-box')].map((box) => {
  let card = null, p = box.parentElement;
  while (p && !card) { card = p.querySelector('.row.movie-card'); p = p.parentElement; }
  const a = card?.querySelector('.mc-title a');
  return {
    id: box.getAttribute('data-movie-id'),
    rating: Number(box.getAttribute('data-user-rating')),   // ← la nota vive aquí
    date: (box.querySelector('.ts-rat')?.textContent || '').match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1] ?? null,
    title: (a?.textContent || '').trim(),
    year: (card?.querySelector('.mc-year')?.textContent || '').trim(),
    types: [...(card?.querySelectorAll('span.type') ?? [])].map((e) => e.textContent.trim()),
    director: (card?.querySelector('.mc-director .credits')?.textContent || '').trim().replace(/\s+/g, ' '),
  };
});
const votes = [];
for (let p = 1; p <= 29; p++) {                              // hasta que una página venga vacía
  const r = await fetch(`/es/myvotes.php?p=${p}&orderby=rating-date&chv=list`, { credentials: 'include' });
  votes.push(...ex(new DOMParser().parseFromString(await r.text(), 'text/html')));
  await new Promise((r) => setTimeout(r, 300));
}
```

La lista se recoge igual contra `/es/mylist.php?list_id=<id>&orderby=0&v=list&page=<n>`,
leyendo directamente los `.row.movie-card` (una lista no tiene notas). El
`orderby=0` es **Posición**, y hay que guardarla:

```js
const orden = [];
for (let p = 1; p <= 7; p++) {
  const doc = new DOMParser().parseFromString(
    await (await fetch(`/es/mylist.php?list_id=201&orderby=0&v=list&page=${p}`, { credentials: 'include' })).text(),
    'text/html',
  );
  for (const c of doc.querySelectorAll('.row.movie-card')) orden.push(c.getAttribute('data-movie-id'));
}
const posiciones = [...new Set(orden)];   // ← las páginas se solapan: dedup por PRIMERA aparición
```

**Una lista de FA no tiene fechas.** Sus órdenes son *Posición, Título, Año,
Voto, Nota media* —ninguna es una fecha— y ni la vista de lista, ni la de
edición («Modificar películas»), ni `mylists.php` traen una sola fecha en el
HTML. Lo único que hay es la posición, y la posición 1 es lo **primero** que se
añadió: comprobado el 26-08-2026 sobre una lista de 320, donde la primera página
no pasa de 2019 y la última trae estrenos de 2025 y 2026. FA añade al final.

Dos trampas, las dos costaron un intento:

- **La nota NO está en el `<select>`.** En el HTML servido el desplegable dice
  «Cargando…» y lo rellena el JS de FA al pintar; el valor de verdad viaja en
  `data-user-rating` del `.rate-movie-box`. Leyendo el select salen 1.414 notas
  a `null` sin que falle nada.
- **`innerText` no vale sobre un `DOMParser`**: un documento sin renderizar lo
  devuelve vacío. Todo lo de arriba usa `textContent`.

El resultado se guarda como `{ "votes": [...], "list": [...] }` en un JSON
**fuera del repo**, con `position` en cada fila de `list`.

## 2. Pasarlo a Reel

```bash
npm install
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<la sb_secret_…, ver abajo> \
TMDB_API_KEY=<v4 read token o clave v3> \
TARGET_USER_ID=<profiles.id> \
npx tsx index.ts /ruta/fa-export.json --dry-run
```

**La llave tiene que ser la `sb_secret_…`**, que el CLI llama
`SUPABASE_DEFAULT_KEY`, y no el JWT `service_role` legacy:

```bash
supabase projects api-keys --project-ref <ref> --reveal -o env | grep '^SUPABASE_DEFAULT_KEY=' | cut -d= -f2- | tr -d '"'
```

Las dos escriben igual de bien por PostgREST, pero `tmdb-proxy` compara el bearer
con su propio `SUPABASE_SERVICE_ROLE_KEY` inyectado —que desde la migración al
sistema nuevo de claves ES la `sb_secret_`—, así que con el JWT contesta
`403 {"error":"not invited"}` y no se cachea ni una ficha. Medido el 25-08-2026.
El guión lo comprueba de entrada y se planta antes de escribir nada.

`--dry-run` no escribe: empareja contra TMDB y deja `match-report.json` con lo
emparejado y lo que se le resiste. **Léelo antes de la pasada de verdad** — es el
único momento en que un match equivocado es barato.

Sin `--dry-run` escribe. Banderas:

- `--sin=Cortometraje,Mediometraje,TV` — deja fuera esos tipos de FA (los cortos
  de animación son los que más ruido meten en el historial).
- `--desde-informe=match-report.json` — no vuelve a emparejar: coge el resultado
  del dry run. Son ~2.700 peticiones a TMDB y veinte minutos que no cambian de
  respuesta, y además garantiza que lo que se escribe es exactamente lo que se
  revisó. Si el JSON trae filas que aquel informe no tenía, lo avisa.
- `--base-lista=<ISO>` — el momento al que se cuelgan las filas de lista (por
  defecto, ahora). Se pasa a mano para **reparar** una pasada anterior.
- `--fechas-lista` — no importa nada: solo recoloca el `added_at` de las filas de
  lista según su posición. Ni TMDB ni tmdb-proxy, así que tarda segundos.
- `--fechas-notas` — le pone a cada nota la fecha de su voto en `created_at`.
  **No necesita el JSON**: la saca de los `watch_events` que escribió la propia
  importación (`source = 'filmaffinity_import'`), así que se puede lanzar meses
  después, cuando el export ya no esté en ningún disco. Idempotente.

## Cómo empareja, y por qué así

FA da un título **en español**, un año y un director; TMDB quiere un id. El
criterio está en `lib.ts` y es duro a propósito, porque un falso positivo escribe
una nota tuya sobre una película que no viste y eso no se nota nunca:

1. El año tiene que caer a **±1** (TMDB fecha por estreno mundial, FA por año de
   producción).
2. Título **idéntico** una vez normalizado (sin acentos, sin puntuación), contra
   el título traducido o el original → vale solo.
3. Título que solo se **contiene** → hace falta que el **director** de TMDB
   confirme, una llamada más a `/movie/:id/credits`.
4. Nada de eso → sin match, a la lista de repaso del informe.

Antes de todo eso se mira `FA_ALIASES`, una tabla a mano de `id de FA → id de
TMDB` para las que no comparten NI UNA palabra con su título español
(«Operación Monumento» contra «Monuments Men», «El juego de Kobe» contra «Kobe
Doin' Work»). Ahí el parecido no es bajo: es cero, y no hay umbral que las
rescate sin colar basura por el mismo hueco. La lista crece cuando el informe
enseña una, nunca por adelantado — el precedente es `TVDB_ALIASES` en
`scripts/tvtime-import/lib.ts`.

Los números también se unifican antes de comparar (`II` ↔ `2`, `Vol.` ↔
`Volumen`, `Dr.` ↔ `Doctor`): las sagas son justo lo que se numera, y sin eso
«Misión imposible 2» y «Misión imposible II» son títulos distintos. Y a TMDB se
le pregunta por partes además de por el título entero, porque su buscador
devuelve **cero** resultados para «El Hobbit: La batalla de los cinco ejércitos»
y la película a la primera para cualquiera de sus dos mitades.

El título doble de FA («Las vidas de Grace (Short Term 12)») se prueba entero y
por mitades, porque cuál de las dos es la original cambia de ficha en ficha.

## Qué escribe

Por cada película emparejada, en este orden:

| tabla | qué |
|---|---|
| `titles` + `episodes` | **no a mano**: se pide `tmdb-proxy /movie/:id`, el mismo camino que abre una ficha en la app, y el trigger de 0067 pone el episodio sintético |
| `library_entries` | `followed = true`; `added_at` = la fecha del voto, o —en las de lista— el momento de la importación con los segundos repartidos por posición |
| `watch_events` | solo los votos: `watched_at` = fecha del voto, `source = 'filmaffinity_import'` |
| `ratings` | la nota de FA tal cual —las dos escalas son 1..10— con `created_at` = la fecha del voto, que es la que fecha el muro |

Idempotente: los `upsert` van con `ignoreDuplicates`, y una nota que ya existiera
en Reel **no se pisa** (sale contada aparte en el informe). Volver a lanzarlo no
duplica nada.

**Las fechas.** Un voto trae la suya y esa es la que se usa, en `watched_at`, en
`added_at` **y en el `created_at` de la propia nota**: el historial, el mapa de
calor y el muro de amigos cuentan cuándo lo viste de verdad, no cuándo se
importó. Esa tercera no es papeleo — es con la que `rpc_friend_activity` fecha el
verbo *rated* (0077), y dejarla en su `now()` por omisión pone mil notas de
quince años en el día de hoy: en un muro compartido eso no es un detalle tuyo,
es una avalancha que entierra la actividad de todos tus amigos bajo algo que
nunca ocurrió. Pasó en la pasada del 25-08-2026 y se reparó con `--fechas-notas`. Una fila de lista **no tiene fecha que traer** —FA no la
guarda— así que lleva el momento real de la importación, con los segundos
repartidos por su posición para que ordenar por "fecha de adición" en Reel
devuelva el orden de la lista en FA. No se inventa un pasado que nadie registró.

Para deshacer una pasada, `watch_events.source = 'filmaffinity_import'` identifica
lo que escribió este guión; `ratings` y `library_entries` no tienen columna de
origen, así que ahí el rastro es el informe.

## Pruebas

```bash
npm test
```

`lib.test.ts` cubre la clasificación por tipo, la normalización, las variantes de
título, la fecha y —lo que importa— las reglas del emparejador. No cubre las dos
funciones que llaman a TMDB: ahí la red es el sujeto.

Ojo: `scripts/` no lo mira `verificar.sh` ni el CI. Estas pruebas y el
`npm run typecheck` se lanzan a mano.
