// El tráiler de una película, de `append_to_response=videos`.
//
// En su propio módulo y no en index.ts por lo mismo que rank.ts: index.ts abre
// el servidor en cuanto se importa, así que nada de lo que vive ahí se puede
// probar sin levantarlo.
//
// Cuesta CERO peticiones: los vídeos viajan en el mismo detalle que ya se pedía,
// igual que los proveedores o las fechas por país. La columna es la misma
// `videos` que 0086 abrió para los juegos, con la misma forma
// { name, video_id }, así que el reproductor de la ficha es el mismo
// componente en cine y en juegos.

// deno-lint-ignore no-explicit-any
type Any = any;

export type Video = { name: string; video_id: string };

/* El orden: primero lo oficial, luego un tráiler antes que un teaser. Un teaser
   oficial gana a un tráiler que no lo es —lo de fuera suele ser un montaje de
   un canal cualquiera— y por eso «oficial» pesa dos y «tráiler» uno. */
const RANGO = (v: Any): number => (v?.official ? 0 : 2) + (v?.type === "Trailer" ? 0 : 1);

/** Los vídeos de una película, con el mejor tráiler primero, o null.
 *
 *  Solo YouTube: es lo único que el reproductor sabe abrir, y un vídeo de Vimeo
 *  guardado aquí sería un botón que no lleva a ninguna parte.
 *
 *  Solo tráileres y teasers: TMDB mezcla ahí detrás de las cámaras, escenas
 *  borradas y clips, que no es lo que se viene a ver antes de decidir.
 *
 *  Cuatro y no uno, como en juegos: cuestan cuarenta bytes cada uno y ahorran un
 *  refresco entero el día que la ficha quiera ofrecer «ver más vídeos». */
export function videosDeTmdb(videos: Any): Video[] | null {
  const out = (videos?.results ?? [])
    .filter((v: Any) =>
      v?.site === "YouTube"
      && typeof v?.key === "string" && v.key
      && (v?.type === "Trailer" || v?.type === "Teaser"))
    .map((v: Any) => ({
      name: typeof v?.name === "string" && v.name ? v.name : "Trailer",
      video_id: v.key as string,
      rango: RANGO(v),
    }));
  // Ordenación ESTABLE: a igual rango manda el orden de TMDB, que pone primero
  // el vídeo de la región pedida.
  out.sort((a: Any, b: Any) => a.rango - b.rango);
  return out.length
    ? out.slice(0, 4).map(({ name, video_id }: Any) => ({ name, video_id }))
    : null;
}
