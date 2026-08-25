import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { trackedFetch } from "@/lib/connection";
import { qk } from "@/lib/queryKeys";
import type { ApplyPick } from "@/lib/steam";

/* Cliente de la edge function nintendo-sync (0080). Hermano de lib/steam.ts,
   con dos diferencias que vienen de que aquí NO hay login de Nintendo:

     · enlazar es un formulario, no una navegación. Se escribe el código de
       amigo y la función lo resuelve contra Nintendo antes de guardarlo, así
       que la respuesta ya dice si vale;
     · hay una tercera acción que Steam no tiene, `refresh`: actualizar las
       horas de lo que ya está en tu biblioteca, sin pantalla de confirmar. Es
       lo que se quiere cuando desde ayer solo han cambiado veinte minutos de
       Mario Kart. */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nintendo-sync`;

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
  if (!res.ok) throw new Error(`nintendo-sync ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---- La cuenta enlazada ---- */

export function useNintendoLink() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.nintendoLink,
    enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("nintendo_friend_code, nintendo_linked_at")
        .eq("id", session!.user.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        friendCode: (data?.nintendo_friend_code ?? null) as string | null,
        linkedAt: (data?.nintendo_linked_at ?? null) as string | null,
      };
    },
  });
}

/** Guarda el código de amigo. Lo que vuelve es el veredicto de Nintendo:
 *
 *    invalid   — no son doce dígitos. Ni se ha preguntado.
 *    not_found — el formato está bien y ese código no existe. Un dígito mal.
 *    taken     — esa cuenta de Nintendo ya está en otro perfil de Reel.
 *    linked    — hecho, y el código normalizado viene de vuelta. */
export function useLinkNintendo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (friendCode: string) => {
      const data = await call("/link", {
        method: "POST",
        body: JSON.stringify({ friend_code: friendCode }),
      });
      return z
        .object({
          status: z.enum(["linked", "invalid", "not_found", "taken", "error"]),
          friend_code: z.string().optional(),
        })
        .parse(data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.nintendoLink }),
  });
}

export function useUnlinkNintendo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => call("/unlink", { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.nintendoLink }),
  });
}

/* ---- El borrador ---- */

export const nintendoImportSchema = z.object({
  id: z.string().uuid(),
  state: z.enum(["scanning", "ready", "applying", "done", "error"]),
  error: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()).default({}),
});
export type NintendoImport = z.infer<typeof nintendoImportSchema>;

export const nintendoItemSchema = z.object({
  id: z.string().uuid(),
  /* El nsuid de la tienda, o `name:<nombre normalizado>` cuando el registro no
     trae URL. Solo sirve para reconocer la misma fila al reescanear: casar con
     el catálogo se hace por nombre. */
  external_id: z.string(),
  name: z.string(),
  minutes: z.number().int(),
  /* La carátula la manda Nintendo con cada juego, porque no hay ninguna
     plantilla con la que armarla desde un id (Steam sí la tiene). */
  image_uri: z.string().nullable().default(null),
  title_id: z.string().uuid().nullable(),
  in_library: z.boolean(),
  manual_minutes: z.number().int().nullable(),
  state: z.enum(["pending", "applied", "skipped", "unresolved"]),
});
export type NintendoItem = z.infer<typeof nintendoItemSchema>;

/** El último intento de importar de Nintendo, con sus filas.
 *
 *  Sin paginar, al revés que el de Steam: el registro de juego de Nintendo son
 *  dos docenas de entradas como mucho —él mismo tope la lista— así que las mil
 *  filas de PostgREST no son un límite que se pueda rozar aquí. */
export function useNintendoImport() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.nintendoImport,
    enabled: Boolean(session),
    refetchInterval: (q) => {
      const state = (q.state.data as { run: NintendoImport | null } | undefined)?.run?.state;
      return state === "scanning" || state === "applying" ? 2000 : false;
    },
    queryFn: async () => {
      const { data: runs, error } = await supabase
        .from("game_imports")
        .select("*")
        .eq("provider", "nintendo")
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const run = runs?.[0] ? nintendoImportSchema.parse(runs[0]) : null;
      if (!run || run.state === "scanning") return { run, items: [] as NintendoItem[] };

      const { data, error: e } = await supabase
        .from("game_import_items")
        .select("*")
        .eq("import_id", run.id)
        .order("minutes", { ascending: false })
        .order("external_id", { ascending: true });
      if (e) throw new Error(e.message);
      return { run, items: (data ?? []).map((r) => nintendoItemSchema.parse(r)) };
    },
  });
}

/** Pide el registro de juego a Nintendo y prepara el borrador. */
export function useScanNintendo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await call("/scan", { method: "POST" });
      return z
        .object({ import_id: z.string().uuid(), error: z.string().optional() })
        .parse(data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.nintendoImport }),
  });
}

export function useApplyNintendoImport() {
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
      qc.invalidateQueries({ queryKey: qk.nintendoImport });
      qc.invalidateQueries({ queryKey: qk.library });
      qc.invalidateQueries({ queryKey: qk.stats });
      qc.invalidateQueries({ queryKey: qk.ratings });
      qc.invalidateQueries({ queryKey: qk.history });
    },
  });
}

/** Actualizar las horas de lo ya importado, sin pantalla.
 *
 *  No mete juegos nuevos y no toca las horas que escribiste a mano. Devuelve
 *  cuántas filas ha cambiado, que es lo que la pantalla enseña: un "0 juegos
 *  actualizados" es una respuesta correcta y hay que poder darla sin que
 *  parezca que ha fallado algo. */
export function useRefreshNintendo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await call("/refresh", { method: "POST" });
      return z.object({ updated: z.number(), seen: z.number() }).parse(data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.library });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}
