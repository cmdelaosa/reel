/**
 * Pone una serie a numerarse con un grupo de episodios de TMDB (0107).
 *
 * No escribe nada: imprime la llamada SQL a `aplicar_grupo_de_episodios`, que
 * se lanza aparte contra la base que toque. Así lo que entra en producción se
 * ve antes de entrar, y la función —que es la que mueve filas, en una sola
 * transacción— se niega si algo no cuadra.
 *
 *   TMDB_API_KEY=… deno run --allow-net=api.themoviedb.org --allow-env \
 *     scripts/grupo-episodios/aplicar.ts <tmdb_id de la serie> <id del grupo> > aplicar.sql
 *   supabase db query --linked -f aplicar.sql
 *
 * Los grupos de una serie: GET /tv/<id>/episode_groups. Se elige el que cuadre
 * con cómo la cuenta IMDb (o la plataforma): las notas de IMDb se cruzan por
 * número, así que si no cuadra, se quedan sin nota.
 *
 * El reparto de cada episodio sale de `renumerar`, la misma traducción que usan
 * tmdb-proxy, el cron y el importador: si la regla cambia, cambia para todos.
 */
import { tmdbFetch } from "../../supabase/functions/_shared/tmdb.ts";
import { pedirGrupo, renumerar } from "../../supabase/functions/_shared/grupo-episodios.ts";

const [tmdbIdArg, grupoId] = Deno.args;
const key = Deno.env.get("TMDB_API_KEY");
if (!tmdbIdArg || !grupoId || !key) {
  console.error("Uso: TMDB_API_KEY=… aplicar.ts <tmdb_id> <grupo>");
  Deno.exit(2);
}
const tmdbId = Number(tmdbIdArg);

// deno-lint-ignore no-explicit-any
const pedir = async (path: string): Promise<any> => {
  const res = await tmdbFetch(key, path);
  if (!res.ok) throw new Error(`TMDB ${path}: ${res.status}`);
  return res.json();
};

const grupo = await pedirGrupo(pedir, grupoId);
const detalle = await pedir(`/tv/${tmdbId}`);

// Todos los pares que la serie tiene hoy en TMDB, especiales incluidos: son los
// números con los que están guardadas sus filas.
const episodios: { de: string; season: number; episode: number }[] = [];
const sinSitio: string[] = [];
for (const s of detalle.seasons ?? []) {
  const temporada = await pedir(`/tv/${tmdbId}/season/${s.season_number}`);
  for (const e of temporada.episodes ?? []) {
    const de = `${e.season_number}:${e.episode_number}`;
    const m = renumerar(grupo, e.season_number, e.episode_number);
    if (m) episodios.push({ de, ...m });
    else sinSitio.push(de);
  }
}
if (sinSitio.length) {
  // Si alguno está guardado, la función se negará y dirá cuál.
  console.error(`Sin sitio en el grupo (no se guardarán): ${sinSitio.join(", ")}`);
}
const temporadas = grupo.temporadas.map((t) => ({ ...t, tmdb_id: null }));

console.error(
  `${detalle.name}: ${grupo.temporadas.length} temporadas en el grupo (` +
    grupo.temporadas.map((t) => `${t.number}=${t.episode_count}`).join(", ") +
    `), ${episodios.length} episodios con sitio.`,
);

const literal = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
console.log(
  `select public.aplicar_grupo_de_episodios(\n` +
    `  (select id from public.titles where kind = 'tv' and tmdb_id = ${tmdbId}),\n` +
    `  '${grupoId.replaceAll("'", "''")}',\n` +
    `  ${literal(temporadas)},\n` +
    `  ${literal(episodios)}\n` +
    `);`,
);
