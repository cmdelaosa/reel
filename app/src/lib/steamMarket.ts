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

/* El inventario del mercado de Steam (0088). Hermano de lib/steam.ts, del que
   se separa en lo único que importa: aquel importa JUEGOS y este mira DINERO.
   Comparten la cuenta enlazada (`profiles.steam_id`) y nada más.

   Todo lo que se lee aquí lo escribió o el volcado del recolector o el cron —
   ver features/games/steamCollector.js para por qué el navegador y no el
   servidor. La app no le pide nada a Steam. */

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/steam-market`;

/** El id de moneda de Valve del mercado que mira esta pantalla. 3 es el euro, y
 *  no es un formato: Steam no convierte, así que la moneda ES qué mercado se
 *  está leyendo. El cron (scripts/steam-prices) usa el mismo por defecto. */
const MARKET_CURRENCY = 3;

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

export type SteamLedgerEntry = z.infer<typeof ledgerRow>;

/* Un punto de la curva del valor. Lo devuelve `rpc_steam_value_series` (0092) y
   NO se lee ya de `steam_portfolio_snapshots`: la función mezcla las dos cosas
   —la foto real donde la hay, la reconstrucción donde no— y `source` dice cuál
   es cuál. Leer la tabla además de la función sería pedir dos veces lo mismo. */
const seriesRow = z.object({
  day: z.string(),
  value_cents: z.number().int(),
  item_count: z.number().int(),
  distinct_items: z.number().int(),
  missing_prices: z.number().int(),
  source: z.enum(["snapshot", "reconstructed"]),
});

const candleRow = z.object({
  day: z.string(),
  median_cents: z.number().int(),
  volume: z.number().int(),
});

export type SteamHolding = z.infer<typeof holdingRow>;
export type SteamPrice = z.infer<typeof priceRow>;
export type SteamSeriesPoint = z.infer<typeof seriesRow>;

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
  /** El libro entero, tal cual. Lo usa la ficha de un objeto para clavar sus
   *  compras en la curva; ya está leído aquí, así que abrir una ficha no cuesta
   *  ni una petición más. */
  ledger: SteamLedgerEntry[];
  /** Cuándo se subió el último volcado. Null si no hay ninguno, que es el
   *  estado de estreno de la pantalla. */
  collectedAt: string | null;
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
        ledger,
        collectedAt: holdings[0]?.collected_at ?? null,
      };
    },
  });
}

/** La curva del valor de tu cartera, hacia atrás.
 *
 *  Una llamada a `rpc_steam_value_series` (0092) y no una lectura de tablas: la
 *  suma son cuarenta mil velas y se hace donde están. Lo que vuelve son los mil
 *  puntos de la línea, cada uno diciendo si es foto real o reconstrucción.
 *
 *  Va en su propia consulta, aparte del inventario, porque tarda más y porque
 *  la pantalla puede —y debe— enseñar el total mientras la curva llega. */
export function useSteamValueSeries() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.steamValueSeries,
    enabled: Boolean(session),
    queryFn: async (): Promise<SteamSeriesPoint[]> => {
      const { data, error } = await supabase.rpc("rpc_steam_value_series", {});
      if (error) throw new Error(error.message);
      return (data ?? []).map((r: unknown) => seriesRow.parse(r));
    },
  });
}

/** El histórico de UN objeto: una vela por día, tal y como la dio Steam.
 *
 *  `steam_price_history` es global y la lee cualquiera que haya iniciado sesión
 *  —no es de nadie, es lo que valía un objeto—, así que aquí no hay filtro por
 *  usuario. Lo que sí hay es paginado: dos años de un objeto que se mueve todos
 *  los días son 730 filas, y los mil de PostgREST se alcanzan antes de lo que
 *  parece.
 *
 *  Solo se pide cuando hay una ficha abierta. Cargar los históricos de
 *  seiscientos objetos por si acaso es exactamente lo que esta pantalla no
 *  hace. */
export function useSteamItemHistory(item: { appid: number; marketHashName: string } | null) {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.steamItemHistory(item?.appid ?? 0, item?.marketHashName ?? ""),
    enabled: Boolean(session && item),
    queryFn: async () => {
      const rows = await fetchPaged((from, to) =>
        supabase
          .from("steam_price_history")
          .select("day, median_cents, volume")
          .eq("appid", item!.appid)
          .eq("market_hash_name", item!.marketHashName)
          /* Sin esto se mezclarían las velas de dos mercados distintos —Steam no
             convierte, cada moneda es su propio mercado— y la curva daría saltos
             de escalón que nadie pagó. `euros()` de abajo dice el mismo 3. */
          .eq("currency", MARKET_CURRENCY)
          .order("day", { ascending: true })
          .range(from, to),
      );
      return rows.map((r) => candleRow.parse(r));
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
  swept?: number;
}

/** Cuántas velas caben en una llamada a `/ingest`.
 *
 *  El histórico de sesenta objetos son cuarenta mil velas, y la función las
 *  escribe en tandas de 500 una detrás de otra: ochenta y cinco viajes a la
 *  base dentro de una sola invocación, que se pasa del tiempo que le dan y
 *  devuelve un 5xx con todo el fichero ya subido. Troceado aquí, cada llamada
 *  son quince tandas largas. El corte es por VELAS y no por objetos porque lo
 *  que tarda son las filas: un objeto trae dos años de curva y otro dos
 *  semanas. Y repetir es inofensivo — el upsert del histórico ignora las velas
 *  que ya están—, así que un corte a la mitad se arregla volviendo a subir. */
const CANDLES_PER_CALL = 8000;

/** Parte el histórico en volcados que quepan de uno en uno. */
function splitHistory(history: unknown[]): unknown[][] {
  const parts: unknown[][] = [];
  let current: unknown[] = [];
  let candles = 0;
  for (const item of history) {
    const n = Array.isArray((item as { days?: unknown[] }).days)
      ? (item as { days: unknown[] }).days.length
      : 0;
    /* Un objeto no se parte por dentro: 730 velas es un objeto entero y cabe de
       sobra. Lo que se corta es dónde empieza el siguiente volcado. */
    if (current.length && candles + n > CANDLES_PER_CALL) {
      parts.push(current);
      current = [];
      candles = 0;
    }
    current.push(item);
    candles += n;
  }
  if (current.length) parts.push(current);
  return parts;
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
      /* Lo que no es histórico va en una llamada, y el histórico en las suyas.
         Se manda `dump` sin tocar salvo por el troceo: la función mira qué trae
         cada volcado y escribe solo eso, así que un volcado sin `history` no
         borra ningún histórico ni uno de solo `history` toca el inventario. */
      const raw = dump as Record<string, unknown>;
      const history = Array.isArray(raw.history) ? (raw.history as unknown[]) : [];
      const rest = { ...raw };
      delete rest.history;
      const payloads: Record<string, unknown>[] = [];
      if (parsed.data.holdings?.length || parsed.data.ledger?.length || parsed.data.prices?.length) {
        payloads.push(rest);
      }
      /* Los trozos de histórico llevan la cabecera —versión, moneda, steam_id— y
         NADA más. Con `rest` entero dentro, cada trozo re-escribía el inventario
         y el libro otra vez: seis llamadas, seis barridos y un recibo diciendo
         que has subido seis veces tus objetos. */
      const header = { version: raw.version, steam_id: raw.steam_id, currency: raw.currency, collected_at: raw.collected_at };
      for (const part of splitHistory(history)) payloads.push({ ...header, history: part });

      /* En serie y no en paralelo: son escrituras a la misma tabla, y media
         docena de llamadas a la vez es la forma de que la función se quede sin
         conexiones justo cuando el fichero es grande, que es el caso que esto
         viene a arreglar. */
      const total: IngestSummary = {};
      for (const payload of payloads) {
        const part = (await call("/ingest", {
          method: "POST",
          body: JSON.stringify(payload),
        })) as IngestSummary;
        for (const k of ["holdings", "prices", "ledger", "undated", "history", "swept"] as const) {
          if (typeof part[k] === "number") total[k] = (total[k] ?? 0) + part[k];
        }
      }
      return total;
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

/** La ficha del objeto en el mercado de Steam, para poder abrirla desde su
 *  ficha de aquí.
 *
 *  Colgaba de la baldosa entera de la rejilla hasta 0092, y se mudó dentro de la
 *  ficha cuando la baldosa pasó a abrirla: el gráfico que se iba a buscar a
 *  Steam ya está en casa, y a Steam se va ahora para lo que solo hay allí —las
 *  ofertas de verdad y el botón de vender.
 *
 *  El nombre va dentro de la ruta y hay que codificarlo entero: casi todos
 *  llevan barra vertical y espacios —"AK-47 | Redline (Field-Tested)"— y sin
 *  escapar la barra Steam no da la ficha del objeto, da una búsqueda vacía. */
export function marketUrl(appid: number, marketHashName: string): string {
  return `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(marketHashName)}`;
}
