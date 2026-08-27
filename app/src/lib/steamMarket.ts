import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { trackedFetch } from "@/lib/connection";
import { qk } from "@/lib/queryKeys";
import { fetchPaged } from "@/lib/paging";
import {
  cashFlow,
  costBasis,
  portfolioValue,
  priceIndex,
  unrealized,
  type CashFlow,
  type Holding,
  type PortfolioValue,
  type Price,
} from "@/domain/steamPortfolio";

/* El inventario del mercado de Steam (0085). Hermano de lib/steam.ts, del que
   se separa en lo único que importa: aquel importa JUEGOS y este mira DINERO.
   Comparten la cuenta enlazada (`profiles.steam_id`) y nada más.

   Todo lo que se lee aquí lo escribió o el volcado del recolector o el cron —
   ver features/games/steamCollector.js para por qué el navegador y no el
   servidor. La app no le pide nada a Steam. */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/steam-market`;

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
    },
  });
  if (!res.ok) throw new Error(`steam-market ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ---- Lo que hay guardado ---- */

const holdingRow = z.object({
  appid: z.number().int(),
  market_hash_name: z.string(),
  quantity: z.number().int(),
  icon_url: z.string().nullable(),
  item_type: z.string().nullable(),
  marketable: z.boolean(),
  collected_at: z.string(),
});

const priceRow = z.object({
  appid: z.number().int(),
  market_hash_name: z.string(),
  lowest_cents: z.number().int().nullable(),
  median_cents: z.number().int().nullable(),
  volume: z.number().int().nullable(),
  fetched_at: z.string(),
  source: z.enum(["server", "client"]),
});

const ledgerRow = z.object({
  happened_at: z.string(),
  kind: z.enum(["market_buy", "market_sell", "wallet_topup", "store_purchase", "refund", "other"]),
  amount_cents: z.number().int(),
  fee_cents: z.number().int().nullable(),
  appid: z.number().int().nullable(),
  market_hash_name: z.string().nullable(),
  quantity: z.number().int(),
});

const snapshotRow = z.object({
  day: z.string(),
  value_cents: z.number().int(),
  item_count: z.number().int(),
  distinct_items: z.number().int(),
  missing_prices: z.number().int(),
});

export type SteamHolding = z.infer<typeof holdingRow>;
export type SteamPrice = z.infer<typeof priceRow>;
export type SteamSnapshot = z.infer<typeof snapshotRow>;

/** Una fila de la tabla: el objeto con su precio y su cuenta ya hechas. */
export interface InventoryRow {
  appid: number;
  marketHashName: string;
  quantity: number;
  iconUrl: string | null;
  itemType: string | null;
  marketable: boolean;
  medianCents: number | null;
  lowestCents: number | null;
  volume: number | null;
  /** Precio traído por tu navegador y todavía no confirmado por el cron. Se
   *  dice en pantalla: es un precio de fiar a medias. */
  provisional: boolean;
  /** Lo que te costó cada unidad, si consta la compra. Null en lo que salió de
   *  una caja o de un regalo. */
  costCents: number | null;
  /** mediana × cantidad. */
  valueCents: number;
}

export interface Inventory {
  rows: InventoryRow[];
  totals: PortfolioValue;
  cash: CashFlow;
  gain: { gainCents: number; coveredItems: number; uncoveredItems: number };
  snapshots: SteamSnapshot[];
  /** Cuándo se subió el último volcado. Null si no hay ninguno, que es el
   *  estado de estreno de la pantalla. */
  collectedAt: string | null;
  /** Precios que todavía no ha traído el servidor. Es lo que decide si la
   *  pantalla ofrece el botón de "traer los que faltan". */
  provisionalCount: number;
}

const key = (appid: number, name: string) => `${appid}:${name}`;

/** Todo el inventario, de una lectura.
 *
 *  Las cuatro tablas se paginan: `steam_holdings` de un inventario de CS grande
 *  pasa de mil filas sin esfuerzo, y PostgREST corta en mil SIN AVISAR — la
 *  avería que ya se comió los episodios de One Piece. Ver lib/paging. */
export function useSteamInventory() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.steamInventory,
    enabled: Boolean(session),
    queryFn: async (): Promise<Inventory> => {
      const holdingRows = await fetchPaged((from, to) =>
        supabase
          .from("steam_holdings")
          .select("*")
          .eq("user_id", session!.user.id)
          .order("market_hash_name", { ascending: true })
          .range(from, to),
      );
      const holdings = holdingRows.map((r) => holdingRow.parse(r));

      /* Los precios NO se filtran por los nombres que tienes: la tabla es
         global y pequeña comparada con la lista de ids que habría que mandar en
         la URL. Trescientos nombres de mercado son diez mil caracteres de query
         string, y hay proxies que cortan por mucho menos. */
      const priceRows = await fetchPaged((from, to) =>
        supabase
          .from("steam_market_prices")
          .select("*")
          .order("market_hash_name", { ascending: true })
          .range(from, to),
      );
      const prices = priceRows.map((r) => priceRow.parse(r));

      const ledgerRows = await fetchPaged((from, to) =>
        supabase
          .from("steam_ledger")
          .select("*")
          .eq("user_id", session!.user.id)
          .order("happened_at", { ascending: false })
          .range(from, to),
      );
      const ledger = ledgerRows.map((r) => ledgerRow.parse(r));

      const snapRows = await fetchPaged((from, to) =>
        supabase
          .from("steam_portfolio_snapshots")
          .select("*")
          .eq("user_id", session!.user.id)
          .order("day", { ascending: true })
          .range(from, to),
      );
      const snapshots = snapRows.map((r) => snapshotRow.parse(r));

      const asHoldings: Holding[] = holdings.map((h) => ({
        appid: h.appid,
        marketHashName: h.market_hash_name,
        quantity: h.quantity,
      }));
      const asPrices: Price[] = prices.map((p) => ({
        appid: p.appid,
        marketHashName: p.market_hash_name,
        medianCents: p.median_cents,
        lowestCents: p.lowest_cents,
      }));
      const basis = costBasis(
        ledger.map((l) => ({
          kind: l.kind,
          amountCents: l.amount_cents,
          appid: l.appid,
          marketHashName: l.market_hash_name,
          quantity: l.quantity,
        })),
      );
      const index = priceIndex(asPrices);
      const byName = new Map(prices.map((p) => [key(p.appid, p.market_hash_name), p]));

      const rows: InventoryRow[] = holdings.map((h) => {
        const k = key(h.appid, h.market_hash_name);
        const p = byName.get(k);
        const median = index.get(k)?.medianCents ?? null;
        return {
          appid: h.appid,
          marketHashName: h.market_hash_name,
          quantity: h.quantity,
          iconUrl: h.icon_url,
          itemType: h.item_type,
          marketable: h.marketable,
          medianCents: median,
          lowestCents: p?.lowest_cents ?? null,
          volume: p?.volume ?? null,
          provisional: p?.source === "client",
          costCents: basis.get(k) ?? null,
          valueCents: (median ?? 0) * h.quantity,
        };
      });
      rows.sort((a, b) => b.valueCents - a.valueCents);

      return {
        rows,
        totals: portfolioValue(asHoldings, asPrices),
        cash: cashFlow(
          ledger.map((l) => ({ kind: l.kind, amountCents: l.amount_cents })),
        ),
        gain: unrealized(asHoldings, asPrices, basis),
        snapshots,
        collectedAt: holdings[0]?.collected_at ?? null,
        /* Los que faltan cuentan igual que los provisionales: los dos son
           "esto todavía no lo ha mirado el servidor", y es la misma acción la
           que los arregla. */
        provisionalCount: rows.filter((r) => r.provisional || r.medianCents === null).length,
      };
    },
  });
}

/* ---- Subir el volcado ---- */

export interface IngestSummary {
  holdings?: number;
  prices?: number;
  ledger?: number;
  undated?: number;
  history?: number;
}

/** Sube un fichero del recolector.
 *
 *  Acepta los dos que produce —el del inventario y el del histórico— sin
 *  distinguirlos: la función mira qué trae cada uno. Así el orden en que se
 *  suban da igual, que es lo que uno espera de dos botones. */
export function useUploadSteamDump() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<IngestSummary> => {
      const text = await file.text();
      let dump: unknown;
      try {
        dump = JSON.parse(text);
      } catch {
        throw new Error("Ese fichero no es el volcado: no es JSON válido.");
      }
      const shape = z.object({
        version: z.number().optional(),
        steam_id: z.string().optional(),
        holdings: z.array(z.unknown()).optional(),
        prices: z.array(z.unknown()).optional(),
        ledger: z.array(z.unknown()).optional(),
        history: z.array(z.unknown()).optional(),
      });
      const parsed = shape.safeParse(dump);
      if (!parsed.success) throw new Error("Ese fichero no tiene la forma del volcado.");
      if (
        !parsed.data.holdings?.length &&
        !parsed.data.ledger?.length &&
        !parsed.data.history?.length
      ) {
        /* Se corta aquí y no en el servidor para poder decir POR QUÉ. Un
           volcado vacío es casi siempre una pasada que se cortó, y subirlo no
           borra nada (la función tampoco lo dejaría) — pero el usuario merece
           saber que no ha subido lo que creía. */
        throw new Error("El volcado viene vacío. Vuelve a pasar el recolector.");
      }
      return (await call("/ingest", {
        method: "POST",
        body: JSON.stringify(dump),
      })) as IngestSummary;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.steamInventory }),
  });
}

/** Pide una tanda de precios al servidor.
 *
 *  Una tanda son 150 objetos y unos dos minutos; la respuesta dice cuántos
 *  quedan y la pantalla puede volver a llamar. Se hace por tandas y no de una
 *  porque el límite de la plataforma es de segundos y el de Steam es de
 *  peticiones por minuto: una sola llamada larga se muere a la mitad y deja
 *  medio inventario sin refrescar sin decirlo. */
export function useRefreshSteamPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await call("/prices", { method: "POST" });
      return z
        .object({
          refreshed: z.number(),
          failed: z.number(),
          remaining: z.number(),
        })
        .parse(data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.steamInventory }),
  });
}

/* ---- Formato ---- */

/** Céntimos → "1.234,56 €". Con la moneda del mercado que se está mirando, que
 *  hoy es siempre el europeo (currency 3 en Steam). */
export function euros(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

/** El icono de un objeto. Steam guarda un hash y el prefijo del CDN lo pone
 *  quien pinta — así un cambio de CDN de Valve no obliga a re-volcar nada. */
export function iconUrl(hash: string | null, size = 96): string | null {
  return hash
    ? `https://community.fastly.steamstatic.com/economy/image/${hash}/${size}fx${size}f`
    : null;
}
