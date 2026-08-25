import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { trackedFetch } from "@/lib/connection";
import { qk } from "@/lib/queryKeys";
import type { PlayState } from "@/domain/gameStatus";

/* Cliente de la edge function steam-sync (0076). Hermano de lib/igdb.ts, con
   dos diferencias que vienen de que el login de Steam es POR USUARIO:

     · el enlace de la cuenta no es una llamada, es una NAVEGACIÓN: se sale de
       la app a Steam y se vuelve a /games/steam?steam=…, porque OpenID 2.0 no
       tiene otra forma;
     · el borrador de la importación se lee de la BASE y no de la respuesta de
       la función. Así sobrevive a recargar la página, que es lo que uno hace
       cuando lleva un minuto mirando una lista de trescientos juegos. */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/steam-sync`;

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await trackedFetch(`${FUNCTION_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`steam-sync ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---- La cuenta enlazada ---- */

export function useSteamLink() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.steamLink,
    enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("steam_id, steam_linked_at")
        .eq("id", session!.user.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        steamId: (data?.steam_id ?? null) as string | null,
        linkedAt: (data?.steam_linked_at ?? null) as string | null,
      };
    },
  });
}

/** Manda a la persona a Steam. No es una mutación con resultado: la pestaña se
 *  va, y lo que vuelve es una navegación a /games/steam?steam=… */
export async function startSteamLogin(): Promise<void> {
  const data = await call("/login");
  const url = z.object({ url: z.string().url() }).parse(data).url;
  window.location.assign(url);
}

/** El segundo paso del enlace: la sesión reclama el SteamID64 que Steam acaba
 *  de confirmar.
 *
 *  Existe porque la vuelta de Steam no puede escribir sola: el pagaré lo crea
 *  quien quiera, así que dejar que decidiera el perfil de destino convertiría
 *  un enlace compartido en "tu cuenta de Steam acaba en MI perfil". Aquí lo
 *  decide el JWT. Ver supabase/functions/steam-sync y la migración 0076. */
export function useConfirmSteamLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nonce: string) => {
      const data = await call("/confirm", {
        method: "POST",
        body: JSON.stringify({ nonce }),
      });
      return z
        .object({ status: z.enum(["linked", "taken", "expired", "mismatch", "error"]) })
        .parse(data).status;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.steamLink }),
  });
}

export function useUnlinkSteam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call("/unlink", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.steamLink }),
  });
}

/* ---- El borrador ---- */

export const steamImportSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(["scanning", "ready", "applying", "done", "error"]),
  error: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()).default({}),
});
export type SteamImport = z.infer<typeof steamImportSchema>;

export const steamItemSchema = z.object({
  id: z.string().uuid(),
  /* El appid, como TEXTO: desde 0080 la columna la comparten Steam y Nintendo,
     y Nintendo no tiene ningún número que poner ahí. La pantalla lo vuelve a
     número para armar la URL de la carátula, que es lo único que lo usa. */
  external_id: z.string(),
  name: z.string(),
  minutes: z.number().int(),
  title_id: z.string().uuid().nullable(),
  in_library: z.boolean(),
  /* Las horas que escribiste tú, y solo cuando Steam las contradice. Null es
     "no hay nada que decidir aquí"; un número es la fila que la pantalla
     destaca con las dos cifras y su propia casilla. */
  manual_minutes: z.number().int().nullable(),
  /* La última vez que lo jugaste según Steam (0078). Es lo que fecha el
     "terminado" que marques aquí, en vez del día de la importación. Null es
     que Steam dice que nunca lo has abierto. */
  last_played_at: z.string().nullable().default(null),
  state: z.enum(["pending", "applied", "skipped", "unresolved"]),
});
export type SteamItem = z.infer<typeof steamItemSchema>;

/** El último intento de importar, con sus filas.
 *
 *  Se sondea mientras hay trabajo en marcha (`scanning` y `applying`) porque
 *  las dos fases largas ocurren en el servidor: pedirle la lista a Steam y
 *  resolver contra IGDB lo que el catálogo no tenía. `refetchInterval` con
 *  función es lo que deja de sondear solo cuando el estado se asienta. */
export function useSteamImport() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.steamImport,
    enabled: Boolean(session),
    refetchInterval: (q) => {
      const state = (q.state.data as { run: SteamImport | null } | undefined)?.run?.state;
      return state === "scanning" || state === "applying" ? 2000 : false;
    },
    queryFn: async () => {
      const { data: runs, error } = await supabase
        .from("game_imports")
        .select("*")
        // Desde 0080 la tabla la comparten dos proveedores. Sin este filtro,
        // importar de Nintendo dejaría el último borrador arriba y esta
        // pantalla enseñaría juegos de Switch como si vinieran de Steam.
        .eq("provider", "steam")
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const run = runs?.[0] ? steamImportSchema.parse(runs[0]) : null;
      if (!run || run.state === "scanning") return { run, items: [] as SteamItem[] };

      /* PostgREST corta en 1.000 filas sin avisar, y una biblioteca de Steam de
         mil y pico juegos existe (la de One Piece nos lo enseñó con los
         episodios). Se pagina por rango y se ordena, que es lo que hace que las
         páginas no se solapen. */
      const items: SteamItem[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error: e } = await supabase
          .from("game_import_items")
          .select("*")
          .eq("import_id", run.id)
          .order("minutes", { ascending: false })
          .order("external_id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (e) throw new Error(e.message);
        const page = (data ?? []).map((r) => steamItemSchema.parse(r));
        items.push(...page);
        if (page.length < PAGE) break;
      }
      return { run, items };
    },
  });
}

/** Pide la biblioteca a Steam y prepara el borrador. */
export function useScanSteam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await call("/scan", { method: "POST" });
      return z
        .object({ import_id: z.string().uuid(), error: z.string().optional() })
        .parse(data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.steamImport }),
  });
}

/** Lo que se puede decir de un juego en la pantalla de confirmar.
 *
 *  Son los cuatro `play_state` más "terminado", que NO es un play_state sino el
 *  watch_event (0073) — viaja por el mismo campo porque para quien mira la
 *  pantalla es una opción más de la misma fila, y la función lo separa. */
export type ImportState = PlayState | "finished";

export interface ApplyPick {
  id: string;
  /** Solo importa en las filas en conflicto: ceder ESA fila a la cifra de
   *  Steam. Por fila y no un ajuste global — los conflictos son pocos y cada
   *  uno tiene su motivo. */
  overwrite: boolean;
  /** En qué punto estás. Null es lo que hacía 0076 y sigue siendo el defecto:
   *  entra como tuyo y sin estado. */
  state?: ImportState | null;
  /** 1..10, o nada. */
  rating?: number | null;
}

export function useApplySteamImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ importId, items }: { importId: string; items: ApplyPick[] }) => {
      const data = await call("/apply", {
        method: "POST",
        body: JSON.stringify({ import_id: importId, items }),
      });
      return z.object({ applied: z.number(), pending: z.number() }).parse(data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.steamImport });
      qc.invalidateQueries({ queryKey: qk.library });
      qc.invalidateQueries({ queryKey: qk.stats });
      /* Y las notas y el historial, que desde 0078 esta pantalla también
         escribe: sin esto, la nota que acabas de poner a treinta juegos no
         aparece hasta que algo más invalide su caché. */
      qc.invalidateQueries({ queryKey: qk.ratings });
      qc.invalidateQueries({ queryKey: qk.history });
    },
  });
}
