import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
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

/* ---- Las rejillas de Explorar ---- */

/** Las cuatro rejillas que sirve el proxy. Los nombres son los de la ruta, así
 *  que esta lista y la de `POOLS` en igdb-proxy/index.ts dicen lo mismo — un
 *  nombre que no exista allí devuelve 404, no una rejilla vacía. */
export type GamePool = "anticipated" | "new" | "popular" | "top-rated";

/** Una rejilla de descubrimiento.
 *
 *  `enabled` es la puerta de la pestaña: abrir Explorar cuesta una petición y
 *  no cuatro, igual que en los otros dos modos. Aquí importa el doble — cada
 *  una que se pide de más sale del presupuesto de cuatro peticiones por segundo
 *  que IGDB da al proyecto ENTERO, del que también salen las búsquedas y las
 *  fichas de todo el mundo. El servidor la sirve de su caché de 24 h, pero un
 *  fallo de caché con cuatro consultas a la vez es exactamente lo que el
 *  estrangulador del proxy tiene que ponerse a espaciar.
 *
 *  Una hora de staleTime en el cliente sobre 24 h de caché en el servidor: lo
 *  mismo que hacen las rejillas de series y cine. */
export function useGamePool(pool: GamePool, enabled = true) {
  return useQuery({
    queryKey: qk.gamePool(pool),
    enabled,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<TitleRow[]> => {
      const data = await call(`/discover/${pool}`);
      return gameSearchResponseSchema.parse(data).results;
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
 *  Invalida y refetch, no optimista: el rollup recalcula conteos y estado a
 *  partir de la fila, y adivinarlos aquí sería mantener esa derivación en dos
 *  sitios. La escritura es una sola columna contra un índice, así que el viaje
 *  se nota poco. */
export function useSetGameProgress() {
  const qc = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ titleId, playState, minutesPlayed }: GameProgress) => {
      const patch: Record<string, unknown> = {};
      if (playState !== undefined) patch.play_state = playState;
      if (minutesPlayed !== undefined) {
        patch.minutes_played = Math.max(0, Math.round(minutesPlayed));
        patch.minutes_source = "manual";
      }
      if (!Object.keys(patch).length) return;

      // `user_id` explícito además de la RLS, como el resto de mutaciones del
      // repo. Hoy la política "owner all" ya acota el UPDATE al dueño, pero un
      // update cuyo alcance dependa SOLO de una política es un update que se
      // vuelve global el día que alguien afloje la política — y la tabla ya
      // tiene una segunda política de lectura para amigos.
      const { error } = await supabase
        .from("library_entries")
        .update(patch)
        .eq("user_id", session!.user.id)
        .eq("title_id", titleId);
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.library });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}
