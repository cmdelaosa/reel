import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { regionCode } from "@/lib/region";
import { movieReleaseSchema, type MovieRelease } from "@/lib/schemas";
import { useSettings } from "@/lib/settings";
import {
  getMovieNewToStream, getMovieNowPlaying, getMoviePopular, getMovieProviders,
  getMovieTopRated, getMovieTrending, getMovieUpcoming,
} from "@/lib/tmdb";
import type { TitleRow } from "@/lib/schemas";

/* Los datos que solo el cine necesita: el feed de estrenos y las cuatro
   rejillas de descubrimiento. Lo demás —biblioteca, ficha, notas— lo comparte
   con las series y vive donde siempre. */

const WEEK_MS = 7 * 24 * 3600 * 1000;
/* Hacia delante se mira mucho más lejos que en series, y no es un capricho: un
   episodio se anuncia con semanas y una película con AÑOS. Dune: Part Three
   tenía fecha dos años antes de rodarse. Hacia atrás, en cambio, el mismo gesto
   que el calendario de series: lo justo para ver lo que se te ha pasado, y más
   historia solo si la pides. */
const FORWARD_WEEKS = 130;

/** Los estrenos de TUS películas en una ventana. Una peli con fecha de cine y
 *  de streaming devuelve DOS filas, que es lo que se quiere ver en un
 *  calendario: son dos días distintos en los que hacer dos cosas distintas. */
export function useMovieReleases(weeksBack: number) {
  const country = regionCode();
  return useQuery({
    queryKey: ["movieReleases", country, weeksBack],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<MovieRelease[]> => {
      const now = Date.now();
      const { data, error } = await supabase.rpc("rpc_movie_releases", {
        p_country: country,
        p_from: new Date(now - weeksBack * WEEK_MS).toISOString(),
        p_to: new Date(now + FORWARD_WEEKS * WEEK_MS).toISOString(),
      });
      if (error) throw error;
      return z.array(movieReleaseSchema).parse(data);
    },
  });
}

/* Las cuatro rejillas. staleTime de una hora como las de series: el proxy ya
   cachea el ORDEN 24 h en su lado, así que esto solo evita repetir la llamada
   mientras te mueves por la app. */
const GRID_STALE_MS = 60 * 60 * 1000;

/* `enabled` no tiene valor por defecto a propósito, y no es ceremonia: las tres
   rejillas viven en la misma pantalla y solo se ve una. Sin la puerta, abrir
   Explorar dispara las tres contra un edge que puede estar frío — que es
   exactamente lo que el cron de calentado existe para que nadie pague. Cada
   pantalla dice cuál está mirando. */
const grid = (key: readonly unknown[], enabled: boolean, fn: () => Promise<TitleRow[]>) => ({
  queryKey: key,
  enabled,
  staleTime: GRID_STALE_MS,
  queryFn: fn,
});

export function useMovieTrending() {
  // El carrusel se ve siempre, en las tres pestañas: no hay puerta que poner.
  return useQuery(grid(["movieTrending"], true, getMovieTrending));
}

export function useMovieNowPlaying(enabled: boolean) {
  // El país entra en la clave: cambiarlo en Ajustes recarga la app, pero la
  // caché persistida sobrevive a la recarga, y sin el país serviría la
  // cartelera del país anterior.
  const region = regionCode();
  return useQuery(grid(["movieNowPlaying", region], enabled, () => getMovieNowPlaying(region)));
}

export function useMovieUpcoming(enabled: boolean) {
  const region = regionCode();
  return useQuery(grid(["movieUpcoming", region], enabled, () => getMovieUpcoming(region)));
}

/** Nuevo en streaming. Las plataformas entran en la CLAVE además de en la
 *  petición: marcar una en Ajustes tiene que repintar el carril, y con la clave
 *  fija seguiría sirviendo la lista de antes hasta que caducara la hora. */
export function useMovieNewToStream(enabled: boolean) {
  const region = regionCode();
  const services = [...useSettings().services].sort((a, b) => a - b);
  return useQuery(
    grid(["movieNewToStream", region, services], enabled,
      () => getMovieNewToStream(region, services)),
  );
}

/** Las plataformas que ofrece tu país, para el selector de Ajustes. Un día de
 *  frescura: esta lista cambia cuando nace o muere un servicio de streaming. */
export function useProviderOptions(enabled: boolean) {
  const region = regionCode();
  return useQuery({
    queryKey: ["providerOptions", region],
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: () => getMovieProviders(region),
  });
}

export function useMoviePopular(from: number | null, to: number | null, enabled: boolean) {
  return useQuery(grid(["moviePopular", from, to], enabled, () => getMoviePopular(from, to)));
}

export function useMovieTopRated(
  from: number | null, to: number | null, genreIds: number[], enabled: boolean,
) {
  return useQuery(
    grid(["movieTopRated", from, to, [...genreIds].sort()], enabled,
      () => getMovieTopRated(from, to, genreIds)),
  );
}
