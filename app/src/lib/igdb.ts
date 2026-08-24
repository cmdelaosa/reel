import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { trackedFetch } from "@/lib/connection";
import { qk } from "@/lib/queryKeys";
import {
  gameResponseSchema,
  gameSearchResponseSchema,
  type GameResponse,
  type TitleRow,
} from "@/lib/schemas";
import type { PlayState } from "@/domain/gameStatus";

/* Cliente de la edge function igdb-proxy. Hermano de lib/tmdb.ts y con la misma
   forma: cada llamada lleva el token de la sesión (la función rechaza el anon) y
   valida la respuesta con los esquemas antes de devolverla.

   Lo único que no se parece es la construcción de imágenes. */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/igdb-proxy`;

/** URL completa de una imagen de IGDB.
 *
 *  No es tmdbImg con otro dominio: TMDB guarda una RUTA (`/abc.jpg`) y el
 *  tamaño va en el camino; IGDB guarda un HASH y el tamaño es un prefijo
 *  `t_`. Por eso `titles.poster_path` de un juego lleva el hash pelado (0071) y
 *  esta función existe aparte — pasarle un hash a tmdbImg da una URL que
 *  responde 404 sin quejarse en consola.
 *
 *  Los tamaños son los que publica IGDB; `_2x` es su retina. */
export function igdbImg(
  hash: string | null | undefined,
  size: "cover_small" | "cover_big" | "screenshot_med" | "screenshot_big" | "720p" | "1080p" = "cover_big",
): string | undefined {
  return hash ? `https://images.igdb.com/igdb/image/upload/t_${size}/${hash}.jpg` : undefined;
}

async function call(path: string): Promise<unknown> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await trackedFetch(`${FUNCTION_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) throw new Error(`igdb-proxy ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Búsqueda de juegos por nombre. El orden lo decide el proxy (rank.ts), no
 *  este lado: la relevancia de IGDB pone fan games por delante de los
 *  originales, y arreglarlo aquí sería arreglarlo una vez por pantalla. */
export async function searchGames(q: string): Promise<TitleRow[]> {
  const data = await call(`/search?q=${encodeURIComponent(q)}`);
  return gameSearchResponseSchema.parse(data).results;
}

/** El mismo buscador como hook, para las pantallas que lo usan directamente. */
export function useGameSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: qk.gameSearch(q),
    enabled: q.length >= 2,
    queryFn: () => searchGames(q),
    // La búsqueda va contra IGDB, que da 4 peticiones por segundo para TODA la
    // app (no por usuario). Un minuto de caché por término evita que volver
    // atrás y repetir la búsqueda gaste otra.
    staleTime: 60_000,
  });
}

/** La ficha de un juego, por su id de IGDB. */
export function useGame(igdbId: number | null | undefined) {
  return useQuery({
    queryKey: qk.game(igdbId ?? 0),
    enabled: igdbId != null,
    queryFn: async (): Promise<GameResponse> => {
      const data = await call(`/game/${igdbId}`);
      return gameResponseSchema.parse(data);
    },
  });
}

/* ---- Lo que la persona escribe: estado y horas ---- */

export interface GameProgress {
  titleId: string;
  playState?: PlayState | null;
  minutesPlayed?: number;
}

/** Escribe estado y/o minutos de un juego de tu biblioteca.
 *
 *  `minutes_source` se pone a 'manual' siempre que se toquen los minutos, y esa
 *  columna es toda la preparación que hay para la sincronización con Steam: el
 *  día que llegue tiene que poder distinguir lo que escribió ella de lo que
 *  corregiste tú, para no pisarte una cifra a mano (0073).
 *
 *  Optimista contra la biblioteca, como el resto de mutaciones de library.ts:
 *  cambiar de cubo o sumar media hora tiene que verse en el momento. */
export function useSetGameProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ titleId, playState, minutesPlayed }: GameProgress) => {
      const patch: Record<string, unknown> = {};
      if (playState !== undefined) patch.play_state = playState;
      if (minutesPlayed !== undefined) {
        patch.minutes_played = Math.max(0, Math.round(minutesPlayed));
        patch.minutes_source = "manual";
      }
      if (!Object.keys(patch).length) return;

      const { error } = await supabase
        .from("library_entries")
        .update(patch)
        .eq("title_id", titleId);
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.library });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}
