/* Cron del Metascore de los juegos que no están en Steam (0090).
 *
 * ── Por qué existe ───────────────────────────────────────────────────────
 * 0089 llena `titles.metacritic` desde la ficha de tienda de Steam, y eso deja
 * fuera todo lo que Nintendo, Sony o Microsoft no venden ahí: los Zelda,
 * Banjo-Kazooie, Bomberman. No es que Metacritic no los puntuara —Breath of the
 * Wild tiene un 97— es que Steam no tiene ficha suya que enseñar.
 *
 * RAWG publica el Metascore en su propia ficha, consola incluida. Una petición
 * por juego: la búsqueda ya trae `metacritic` en cada resultado, así que pedir
 * además el detalle sería gastar el doble de cuota para leer el mismo número
 * (comprobado el 28-08-2026: el detalle de un juego sin Metascore tampoco lo
 * tiene).
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────
 * No toca lo que ya tiene nota de Steam. Es la misma nota, ya traída, y de la
 * fuente más cercana al juego. Esto rellena huecos.
 *
 * No inventa emparejamientos: RAWG no comparte id con IGDB y unir por nombre a
 * secas trae notas de otro juego (ver lib.ts, con las tres que salieron en la
 * medida). Lo que no se puede emparejar con seguridad se queda sin nota.
 *
 * Variables (las pone el workflow desde los secretos del repo):
 *   SUPABASE_URL                — https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — la sb_secret_…, ver docs/DEPLOY.md
 *   RAWG_API_KEY                — la clave gratuita de rawg.io/apidocs
 *   MAX_ITEMS                   — tope de juegos por pasada (opcional)
 *   GAP_MS                      — hueco entre peticiones, en ms (opcional)
 */

import { createClient } from "@supabase/supabase-js";
import { emparejar, emparejarEdicion, queueFor, scoreOf, sinEdicion, type Candidato, type Game } from "./lib.ts";

const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RAWG = process.env.RAWG_API_KEY;
if (!URL_ || !KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!RAWG) {
  console.error("Falta RAWG_API_KEY (rawg.io/apidocs).");
  process.exit(1);
}

/** Tope por pasada. El plan gratuito de RAWG son 20.000 peticiones al mes, o
 *  sea unas 650 al día: 300 deja sitio de sobra y drena la biblioteca entera en
 *  dos pasadas. */
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? 300);

/** El hueco entre peticiones. RAWG no publica un límite por segundo y el
 *  gratuito se mide por mes, así que esto no es para esquivar un 429: es para
 *  no abrir trescientas conexiones seguidas contra un servicio gratuito. */
const GAP_MS = Number(process.env.GAP_MS ?? 400);

const TIMEOUT_MS = 10_000;
const PAGE = 500;

/** Cuántos juegos seguidos pueden fallar antes de dar la pasada por perdida.
 *  Una clave caducada o revocada devuelve 401 en TODAS, y sin este freno serían
 *  trescientas peticiones para descubrirlo. */
const MAX_SEGUIDOS = 10;

const db = createClient(URL_, KEY, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  what: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${(error as { message: string }).message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

/** Los candidatos de RAWG para un nombre. Devuelve null si la petición no
 *  contestó bien — que es distinto de "ha contestado y no hay nada". */
async function buscar(nombre: string): Promise<Candidato[] | null> {
  const url =
    `https://api.rawg.io/api/games?key=${RAWG}&search=${encodeURIComponent(nombre)}&page_size=10`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: Candidato[] };
  return data?.results ?? [];
}

/** La ficha de un juego ya emparejado, por su id. Sin volver a buscar por
 *  nombre: el emparejamiento es la parte cara y la que se puede equivocar, y
 *  repetirla cada mes es repetir el riesgo por un número que no se mueve.
 *
 *  Lanza si no contesta bien, y no devuelve null: aquí null significaría "este
 *  juego no está en RAWG" y el `update` de abajo borraría el emparejamiento
 *  guardado por un 500 de una tarde. La próxima pasada tendría que volver a
 *  buscar por nombre — o sea volver a arriesgarse a emparejar mal. */
async function porId(id: number): Promise<Candidato> {
  const res = await fetch(`https://api.rawg.io/api/games/${id}?key=${RAWG}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`la ficha ${id} contestó ${res.status}`);
  return (await res.json()) as Candidato;
}

const startedAt = new Date().toISOString();
let conNota = 0;
let sinNota = 0;
let sinEmparejar = 0;
let fallidos = 0;
let seguidos = 0;
let cortado = false;

/* Solo juegos de la biblioteca de alguien. `titles` guarda también todo lo que
   ha pasado por un buscador o por una rejilla de Explorar —miles de filas—, y
   gastar la cuota mensual en un juego que nadie tiene sería pagar por rellenar
   una ficha que no va a abrir nadie. Cuando alguien lo añada, entra en la cola
   por su cuenta. */
const juegos = await readAll<Game>(
  (from, to) =>
    db.from("titles")
      .select(
        "id, name, first_air_date, platforms, metacritic, metacritic_source, rawg_id, rawg_refreshed_at, library_entries!inner(title_id)",
      )
      .eq("kind", "game")
      .order("id", { ascending: true })
      .range(from, to),
  "titles",
);

/* `!inner` con una relación uno-a-muchos repite la fila del título una vez por
   entrada de biblioteca: dos personas con el mismo juego son dos filas idénticas
   que se preguntarían dos veces. Se dedupe aquí y no con un `distinct` que
   PostgREST no tiene. */
const unicos = [...new Map(juegos.map((g) => [g.id, g])).values()];

const cola = queueFor(unicos, Date.now());
console.log(
  `${unicos.length} juegos en bibliotecas, ${cola.length} sin nota de Steam en la cola de hoy.`,
);
if (cola.length > MAX_ITEMS) {
  console.log(`Tope de ${MAX_ITEMS} por pasada: ${cola.length - MAX_ITEMS} se quedan para mañana.`);
}

for (const juego of cola.slice(0, MAX_ITEMS)) {
  let elegido: Candidato | null = null;
  try {
    if (juego.rawg_id != null) {
      elegido = await porId(juego.rawg_id);
    } else {
      const candidatos = await buscar(juego.name);
      /* Una búsqueda que no contesta no es "no está": no se marca nada y el
         juego sigue a la cabeza de la cola mañana. */
      if (candidatos === null) throw new Error("la búsqueda no contestó");
      elegido = emparejar(juego, candidatos);

      /* Segunda pasada para las ediciones: "…Tears of the Kingdom - Nintendo
         Switch 2 Edition" no está en RAWG con ese nombre, pero el juego sí, y
         su Metascore es el del juego. Se busca otra vez —por el nombre a
         secas— en vez de repescar entre los candidatos de la primera: el
         buscador de RAWG ordena por lo que le pidas, y el juego base puede no
         estar entre los diez que devolvió la consulta con la coletilla.
         Solo cuando la primera no dio nada, así que no cuesta una petición más
         a los juegos que ya emparejan. */
      const base = elegido ? null : sinEdicion(juego.name);
      if (base) {
        await sleep(GAP_MS);
        const otros = await buscar(base);
        if (otros === null) throw new Error("la búsqueda del juego base no contestó");
        elegido = emparejarEdicion(juego, base, otros);
      }
    }
  } catch (e) {
    fallidos += 1;
    seguidos += 1;
    console.log(`  falla: ${juego.name} (${(e as Error).message})`);
    if (seguidos >= MAX_SEGUIDOS) {
      cortado = true;
      console.log(`${MAX_SEGUIDOS} seguidos fallando: no es el juego, es la puerta (¿la clave?). Paro.`);
      break;
    }
    await sleep(GAP_MS);
    continue;
  }
  seguidos = 0;

  const nota = scoreOf(elegido);
  /* El emparejamiento se guarda aunque no traiga nota: la parte cara es
     encontrarlo, y un juego que salió hace dos meses todavía puede recibir su
     Metascore. Con el id guardado, la próxima pasada es una petición directa. */
  const fila: Record<string, unknown> = {
    rawg_id: elegido?.id ?? null,
    rawg_refreshed_at: new Date().toISOString(),
  };
  /* La nota solo se escribe cuando la hay. Sin este `if`, un juego de 1994 que
     Metacritic nunca puntuó escribiría `metacritic_source: 'rawg'` con un null
     al lado, y el cron de Steam ya no volvería a tocarlo el día que la tienda
     empiece a venderlo. Lo que no se sabe se deja como estaba. */
  if (nota != null) {
    fila.metacritic = nota;
    fila.metacritic_source = "rawg";
  }

  const { error } = await db.from("titles").update(fila).eq("id", juego.id);
  if (error) throw new Error(`escribiendo ${juego.name}: ${error.message}`);

  if (!elegido) sinEmparejar += 1;
  else if (nota == null) sinNota += 1;
  else conNota += 1;
  if ((conNota + sinNota + sinEmparejar) % 50 === 0) {
    console.log(`  ${conNota + sinNota + sinEmparejar}/${Math.min(cola.length, MAX_ITEMS)}…`);
  }
  await sleep(GAP_MS);
}

console.log(
  `Con Metascore ${conNota}, emparejados sin nota ${sinNota}, sin emparejar ${sinEmparejar}, ` +
    `fallidos ${fallidos}${cortado ? ", cortado" : ""}.`,
);

await db.from("job_runs").insert({
  job: "rawg-metacritic",
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  /* `ok` en falso solo si no se resolvió NADA habiendo cola. Que la mayoría de
     una pasada sean juegos de los ochenta sin Metascore es el funcionamiento
     normal, no un fallo. */
  ok: conNota + sinNota + sinEmparejar > 0 || cola.length === 0,
  summary: {
    games: unicos.length,
    queue: cola.length,
    asked: Math.min(cola.length, MAX_ITEMS),
    scored: conNota,
    matched_no_score: sinNota,
    unmatched: sinEmparejar,
    failed: fallidos,
    aborted: cortado,
  },
}).then(
  () => {},
  () => {},
);

process.exit(0);
