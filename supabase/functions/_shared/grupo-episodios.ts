// Un grupo de episodios de TMDB como la numeración de una serie (0107).
//
// TMDB numera algunas series a su manera: Lupin son tres temporadas (la 1 junta
// las Partes 1 y 2), mientras Netflix e IMDb cuentan cuatro partes. Para esas
// series TMDB publica «grupos de episodios» —otras ordenaciones del mismo
// catálogo— y `titles.episode_group_id` dice cuál manda. Se fija A MANO, serie a
// serie: los grupos son muchos y desiguales (La casa de papel tiene cuatro) y
// elegir solo podría equivocarse en silencio.
//
// Con un grupo puesto, la base guarda SU numeración, no la de TMDB: así la
// ficha, «Continuar», el calendario, los avisos y las notas de IMDb (que se
// cruzan por número) dicen todos lo mismo. Este módulo es la única traducción:
// quien escribe temporadas o episodios —tmdb-proxy, el cron episode-refresh y el
// importador de TV Time— pide a TMDB lo de siempre y pasa la respuesta por aquí
// antes de guardarla. El resto de su código no se entera.
//
// Sin dependencias: lo importan las funciones de Deno y el importador de Node.

// deno-lint-ignore no-explicit-any
type Any = any;

export interface Grupo {
  /** Las temporadas tal como el grupo las cuenta. */
  temporadas: { number: number; name: string | null; air_date: string | null; episode_count: number }[];
  /** "temporada:episodio" de TMDB → el par en la numeración del grupo. */
  porPar: Map<string, { season: number; episode: number }>;
  /** La última temporada de TMDB que el grupo cubre. */
  ultimaTmdb: number;
  /** Lo que se suma a una temporada de TMDB posterior a esa. */
  desfase: number;
}

/** El grupo a partir de GET /tv/episode_group/:id. Cada grupo es una temporada
 *  con su `order` como número; sus episodios se numeran 1, 2, 3… por su `order`. */
export function leerGrupo(json: Any): Grupo {
  const porPar = new Map<string, { season: number; episode: number }>();
  const temporadas: Grupo["temporadas"] = [];
  let ultimaTmdb = 0;
  let ultimaNuestra = 0;
  for (const g of (json?.groups ?? []) as Any[]) {
    const n = g.order as number;
    const eps = [...((g.episodes ?? []) as Any[])].sort((a, b) => a.order - b.order);
    eps.forEach((e, i) => {
      const par = `${e.season_number}:${e.episode_number}`;
      if (!porPar.has(par)) porPar.set(par, { season: n, episode: i + 1 });
      if (e.season_number > ultimaTmdb) ultimaTmdb = e.season_number;
    });
    const fechas = eps.map((e) => e.air_date as string | null).filter((d): d is string => !!d).sort();
    temporadas.push({ number: n, name: g.name ?? null, air_date: fechas[0] ?? null, episode_count: eps.length });
    if (n > ultimaNuestra) ultimaNuestra = n;
  }
  temporadas.sort((a, b) => a.number - b.number);
  return { temporadas, porPar, ultimaTmdb, desfase: ultimaNuestra - ultimaTmdb };
}

const tieneEspeciales = (g: Grupo) => g.temporadas.some((t) => t.number === 0);

/** Dónde guarda el grupo un episodio que TMDB numera (s, e), o null si no tiene
 *  sitio.
 *
 *  Lo que el grupo lista va donde dice. Una temporada de TMDB POSTERIOR a todo
 *  lo que el grupo cubre —la Parte 5 antes de que alguien la añada al grupo—
 *  va detrás, en orden: así una serie agrupada no deja de recibir episodios
 *  nuevos porque el grupo vaya con retraso. Los especiales de TMDB siguen en la
 *  temporada 0 salvo que el grupo tenga la suya. Lo demás —un episodio de una
 *  temporada cubierta que el grupo no lista— no se guarda: cualquier número que
 *  se le diera podría pisar el de otro. */
export function renumerar(g: Grupo, s: number, e: number): { season: number; episode: number } | null {
  const listado = g.porPar.get(`${s}:${e}`);
  if (listado) return listado;
  if (s > g.ultimaTmdb) return { season: s + g.desfase, episode: e };
  if (s === 0 && !tieneEspeciales(g)) return { season: 0, episode: e };
  return null;
}

const episodioRenumerado = (g: Grupo, ep: Any) => {
  if (!ep) return null;
  const m = renumerar(g, ep.season_number, ep.episode_number);
  return m ? { ...ep, season_number: m.season, episode_number: m.episode } : null;
};

/** El detalle de /tv/:id con las temporadas y el último/próximo episodio en la
 *  numeración del grupo, para que lo que lo lee (temporadas guardadas, episodios
 *  emitidos, temporada que se estrena) funcione sin cambios. */
export function detalleAgrupado(d: Any, g: Grupo): Any {
  const propias = g.temporadas.map((t) => ({ id: null, season_number: t.number, ...t }));
  const deTmdb = ((d.seasons ?? []) as Any[])
    .filter((s) => s.season_number > g.ultimaTmdb || (s.season_number === 0 && !tieneEspeciales(g)))
    .map((s) => ({ ...s, season_number: s.season_number === 0 ? 0 : s.season_number + g.desfase }));
  return {
    ...d,
    seasons: [...propias, ...deTmdb].sort((a, b) => a.season_number - b.season_number),
    last_episode_to_air: episodioRenumerado(g, d.last_episode_to_air),
    next_episode_to_air: episodioRenumerado(g, d.next_episode_to_air),
  };
}

/** Las temporadas de TMDB de las que sale nuestra temporada n. */
export function fuentesDe(g: Grupo, n: number): number[] {
  const out = new Set<number>();
  for (const [par, m] of g.porPar) if (m.season === n) out.add(Number(par.split(":")[0]));
  if (n > g.ultimaTmdb + g.desfase) out.add(n - g.desfase);
  if (n === 0 && !tieneEspeciales(g)) out.add(0);
  return [...out].sort((a, b) => a - b);
}

/** Nuestra temporada n montada con la forma de GET /tv/:id/season/:n, a partir
 *  de las respuestas de TMDB de sus fuentes. Cada episodio lleva además
 *  `par_tmdb`, su número en TMDB, para quien tenga que casar algo numerado como
 *  TMDB (el importador de TV Time). */
export function temporadaAgrupada(g: Grupo, n: number, respuestas: Any[]): Any {
  const episodios: Any[] = [];
  for (const r of respuestas) {
    for (const e of (r?.episodes ?? []) as Any[]) {
      const m = renumerar(g, e.season_number, e.episode_number);
      if (m?.season !== n) continue;
      episodios.push({ ...e, season_number: m.season, episode_number: m.episode, par_tmdb: `${e.season_number}:${e.episode_number}` });
    }
  }
  episodios.sort((a, b) => a.episode_number - b.episode_number);
  const propia = g.temporadas.find((t) => t.number === n);
  // Una temporada que el grupo no cubre es una de TMDB entera: conserva su id.
  const entera = propia ? null : respuestas.find((r) => r) ?? null;
  return {
    id: entera?.id ?? null,
    season_number: n,
    name: propia ? propia.name : entera?.name ?? null,
    air_date: propia ? propia.air_date : entera?.air_date ?? null,
    // Los que el grupo anuncia, no los que han llegado: es lo que /title/:id/
    // season/:n compara con las filas guardadas para saber si falta alguno.
    episode_count: propia ? propia.episode_count : entera?.episode_count ?? episodios.length,
    episodes: episodios,
  };
}

/** Lo que cada escritor pide a TMDB para guardar nuestra temporada n: la
 *  respuesta canónica y la española (o null si la española falló — ver
 *  refreshSeason en tmdb-proxy). Sin grupo, las dos peticiones de siempre; con
 *  grupo, las de cada temporada fuente, ya traducidas. */
export async function temporadaParaGuardar(
  pedir: (path: string) => Promise<Any>,
  tmdbId: number,
  g: Grupo | null,
  n: number,
): Promise<[Any, Any | null]> {
  const fuentes = g ? fuentesDe(g, n) : [n];
  // Sin grupo, TMDB contesta 404 a una temporada que no existe; con grupo hay que
  // decirlo aquí, o se guardaría como temporada vacía y la ficha la enseñaría.
  if (!fuentes.length) throw new Error(`la temporada ${n} no está en el grupo de episodios`);
  const [canonicas, espanolas] = await Promise.all([
    Promise.all(fuentes.map((k) => pedir(`/tv/${tmdbId}/season/${k}`))),
    Promise.all(fuentes.map((k) => pedir(`/tv/${tmdbId}/season/${k}?language=es-ES`))).catch(() => null),
  ]);
  if (!g) return [canonicas[0], espanolas?.[0] ?? null];
  return [temporadaAgrupada(g, n, canonicas), espanolas ? temporadaAgrupada(g, n, espanolas) : null];
}

/** El grupo de una serie, pedido a TMDB. */
export async function pedirGrupo(pedir: (path: string) => Promise<Any>, grupoId: string): Promise<Grupo> {
  return leerGrupo(await pedir(`/tv/episode_group/${grupoId}`));
}
