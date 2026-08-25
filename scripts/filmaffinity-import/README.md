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

La lista se recoge igual contra `/es/mylist.php?list_id=<id>&v=list&page=<n>`,
leyendo directamente los `.row.movie-card` (una lista no tiene notas).

Dos trampas, las dos costaron un intento:

- **La nota NO está en el `<select>`.** En el HTML servido el desplegable dice
  «Cargando…» y lo rellena el JS de FA al pintar; el valor de verdad viaja en
  `data-user-rating` del `.rate-movie-box`. Leyendo el select salen 1.414 notas
  a `null` sin que falle nada.
- **`innerText` no vale sobre un `DOMParser`**: un documento sin renderizar lo
  devuelve vacío. Todo lo de arriba usa `textContent`.

El resultado se guarda como `{ "votes": [...], "list": [...] }` en un JSON
**fuera del repo**.

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

El título doble de FA («Las vidas de Grace (Short Term 12)») se prueba entero y
por mitades, porque cuál de las dos es la original cambia de ficha en ficha.

## Qué escribe

Por cada película emparejada, en este orden:

| tabla | qué |
|---|---|
| `titles` + `episodes` | **no a mano**: se pide `tmdb-proxy /movie/:id`, el mismo camino que abre una ficha en la app, y el trigger de 0067 pone el episodio sintético |
| `library_entries` | `followed = true`, `added_at` = la fecha del voto |
| `watch_events` | solo los votos: `watched_at` = fecha del voto, `source = 'filmaffinity_import'` |
| `ratings` | la nota de FA tal cual — las dos escalas son 1..10 |

Idempotente: los `upsert` van con `ignoreDuplicates`, y una nota que ya existiera
en Reel **no se pisa** (sale contada aparte en el informe). Volver a lanzarlo no
duplica nada.

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
