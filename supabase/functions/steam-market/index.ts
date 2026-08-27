// steam-market — Deno edge function. El inventario del mercado de Steam (0085).
//
// Rutas (bajo /functions/v1/steam-market):
//   POST /ingest    → { holdings, ledger, prices, history }  sube el volcado
//   POST /prices    → { refreshed, remaining }  refresca precios desde Steam
//   POST /snapshot  → { users, written }  escribe la foto del día
//
// ── Por qué hay un volcado y no una sincronización ────────────────────────
// Porque Steam no deja hacerlo de otra forma, y conviene tenerlo escrito para
// que nadie "arregle" esto convirtiéndolo en un cron. Tres barreras, medidas el
// 27-08-2026:
//
//  1. `/inventory/<steamid>/<appid>/<ctx>` está estrangulado por IP con una mano
//     durísima: la PRIMERA petición desde una IP doméstica limpia ya devuelve
//     429. Desde la IP compartida de una edge function eso no es un riesgo, es
//     el caso normal.
//  2. `market/pricehistory` y `market/myhistory` contestan 400 sin la cookie de
//     sesión. El truco viejo de leer la serie incrustada en la página del
//     listing murió: hoy son 5 MB sin una sola vela dentro.
//  3. Y el volcado no puede subirse solo desde la pestaña de Steam: su CSP trae
//     un `connect-src` de lista blanca que no incluye a Supabase.
//
// Lo único que SÍ funciona desde aquí es `market/priceoverview` — 12 seguidas
// sin un corte en la misma prueba. De ahí el reparto de esta función: /ingest
// recibe lo que el navegador no puede evitar traer a mano, y /prices y /snapshot
// hacen a diario lo único que el servidor puede hacer solo.
//
// ── La regla que protege a los demás ──────────────────────────────────────
// `steam_market_prices` es GLOBAL: alimenta el total de todo el mundo. Así que
// un precio subido por un cliente NO se acepta igual que uno pedido aquí:
//
//   · 'server' — lo trajo /prices. Es el único que puede pisar una fila.
//   · 'client' — vino en un volcado. Solo se acepta para un nombre que no tenga
//     ya precio, y /prices lo sustituye en su siguiente pasada.
//
// Lo peor que puede hacer entonces un cliente hostil es inventarse el precio de
// un objeto que nadie más tiene, durante menos de un día. `steam_price_history`
// se acepta entera porque no hay forma de que el servidor la traiga — y por eso
// no toca ningún total: solo dibuja la curva de un objeto en su ficha.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type Any = any;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Filas por escritura. PostgREST aguanta más, pero un volcado de mil objetos en
 *  una sola sentencia es una petición de megas que se cae por tiempo antes que
 *  por tamaño. */
const PAGE = 500;

// ── steam money and dates ────────────────────────────────────────────────
//
// Bloque canónico. La función `steam-market` lo copia LITERAL entre estos dos
// mismos marcadores, porque corre en Deno y no puede importar de app/ — el
// mismo arreglo que airPairing y watchProviders, y por el mismo motivo: aquí no
// hay nada que merezca la pena parafrasear, y comparar los bytes es el control
// más barato que existe. Lo hace `steamPortfolio.mirror.test.ts`.
//
// Que las dos copias se separen no daría una pantalla ligeramente distinta:
// daría un dinero distinto según lo mire la app o lo escriba la ingesta.

/** "32,93€" → 3293. También "€32.93", "$1,234.56" y "1 234,56 руб.".
 *
 *  Steam no da la cifra cruda por ningún lado: devuelve el precio ya formateado
 *  en el idioma de la cuenta, así que hay que deshacer el formato sin saber cuál
 *  es ese idioma. La regla que lo consigue: el ÚLTIMO separador con exactamente
 *  dos dígitos detrás son los decimales, y cualquier otro punto o coma es de los
 *  miles.
 *
 *  Devuelve null en lo que no trae cifra, que es un caso normal y no un fallo:
 *  un objeto sin ventas recientes viene sin precio.
 *
 *  (Repetida a propósito en features/games/steamCollector.js, que se pega entero
 *  en una consola ajena y no puede importar. Si se toca una, se tocan las dos.) */
export function priceCents(text: string | number | null | undefined): number | null {
  if (typeof text === "number") return Number.isFinite(text) ? Math.round(text * 100) : null;
  if (!text) return null;
  /* El recorte de la cola no es adorno. El rublo se escribe "1 234,56 руб." y
     el punto de esa abreviatura sobrevive al primer filtro, rompe el match de
     los decimales y manda la cifra por la rama de "no tiene decimales", que
     multiplica por cien. Un precio cien veces mayor sin que nada falle: el peor
     tipo de error que puede tener una pantalla de dinero. */
  const digits = String(text).replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
  if (!digits) return null;
  const m = digits.match(/[.,](\d{2})$/);
  if (!m) {
    const n = Number(digits.replace(/[.,]/g, ""));
    return Number.isFinite(n) ? n * 100 : null;
  }
  const whole = digits.slice(0, m.index).replace(/[.,]/g, "");
  const n = Number(whole || "0") * 100 + Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/* ── Fechas ──────────────────────────────────────────────────────────────── */

const MONTHS: Record<string, number> = {
  ene: 0, jan: 0,
  feb: 1,
  mar: 2,
  abr: 3, apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7, aug: 7,
  sep: 8, sept: 8,
  oct: 9,
  nov: 10,
  dic: 11, dec: 11,
};

export interface RawLedgerRow {
  /** El id de fila de Steam. Estable, y es lo que hace idempotente re-volcar. */
  externalId: string;
  /** Lo que ponía en la columna de fecha: "24 ago" o "24 ago, 2023". */
  rawDate: string | null;
  /** Posición en el listado, empezando en 0 y de MÁS NUEVA a más vieja. */
  order: number;
}

/** Le pone año a las fechas del historial del mercado.
 *
 *  ── El problema ──
 *  Steam escribe "24 ago" a secas en lo del año en curso y solo pone el año en
 *  lo viejo… a veces, y según el idioma. Tomar el año actual para todo lo que no
 *  lo diga mete cuatro años de compras en este, y entonces el "realizado de
 *  2026" incluye lo de 2022 sin que nada falle.
 *
 *  ── La solución ──
 *  Las filas llegan ordenadas de más nueva a más vieja, y eso es información
 *  suficiente: recorriéndolas en ese orden, la fecha nunca puede AVANZAR. En
 *  cuanto una fila cae después de la anterior, es que ha cruzado un fin de año
 *  hacia atrás, y se le resta uno. Una fila que sí traiga año manda, y además
 *  recoloca el año de las que vengan detrás.
 *
 *  Devuelve null en lo que no se pueda leer, y el que lo llame decide: perder la
 *  fila es mejor que fecharla mal. */
export function datesWithYear(rows: RawLedgerRow[], now: Date): (string | null)[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const byId = new Map<string, string | null>();
  let year = now.getUTCFullYear();
  /* La primera fila es la más reciente, así que arranca en hoy. */
  let prev = { month: now.getUTCMonth(), day: now.getUTCDate() };

  for (const row of sorted) {
    const parsed = parseDayMonth(row.rawDate);
    if (!parsed) {
      byId.set(row.externalId, null);
      continue;
    }
    if (parsed.year !== null) {
      year = parsed.year;
    } else if (
      parsed.month > prev.month ||
      (parsed.month === prev.month && parsed.day > prev.day)
    ) {
      /* Bajando por la lista la fecha solo puede retroceder: si sube, cruzamos
         el 1 de enero hacia atrás. */
      year -= 1;
    }
    prev = { month: parsed.month, day: parsed.day };
    /* Mediodía UTC y no medianoche: la fila no trae hora, y a las 00:00 un
       cambio de zona horaria mueve el día entero. A las 12:00 no lo mueve
       ninguna. */
    byId.set(
      row.externalId,
      new Date(Date.UTC(year, parsed.month, parsed.day, 12)).toISOString(),
    );
  }
  return rows.map((r) => byId.get(r.externalId) ?? null);
}

function parseDayMonth(
  raw: string | null,
): { day: number; month: number; year: number | null } | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  const day = text.match(/\b(\d{1,2})\b/);
  const month = text.match(/[a-záéíóú]{3,4}/);
  if (!day || !month) return null;
  const m = MONTHS[month[0]] ?? MONTHS[month[0].slice(0, 3)];
  if (m === undefined) return null;
  const year = text.match(/\b(\d{4})\b/);
  return { day: Number(day[1]), month: m, year: year ? Number(year[1]) : null };
}

// ── end steam money and dates ────────────────────────────────────────────

/* ─────────────────────────── Sesión ─────────────────────────────────────── */

async function userOf(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return null;
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

/** ¿Viene esto del cron y no de una persona?
 *
 *  Comparación en tiempo constante y no `===`: el bearer lo elige quien llama, y
 *  un `===` sobre un secreto filtra su prefijo por el tiempo que tarda en
 *  contestar. Cuesta tres líneas. */
function isService(req: Request): boolean {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!key || got.length !== key.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/* ─────────────────────────── /ingest ────────────────────────────────────── */

interface Dump {
  version?: number;
  currency?: number;
  holdings?: Any[];
  prices?: Any[];
  ledger?: Any[];
  history?: Any[];
}

const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Lo que tienes, tal cual lo dice el volcado.
 *
 *  Es un REEMPLAZO, no una fusión, y tiene que serlo: si se fusionara, un objeto
 *  que vendiste seguiría en la tabla para siempre y el total contaría cosas que
 *  ya no son tuyas. El precio de eso es que un volcado a medias —una pasada que
 *  se cortó— borra lo que no trajo, así que se rechaza el volcado vacío antes de
 *  llegar aquí. */
async function writeHoldings(
  admin: SupabaseClient,
  userId: string,
  rows: Any[],
): Promise<number> {
  const clean = rows
    .map((h) => ({
      user_id: userId,
      appid: int(h.appid),
      market_hash_name: String(h.market_hash_name ?? ""),
      quantity: int(h.quantity) ?? 0,
      icon_url: h.icon_url ? String(h.icon_url) : null,
      item_type: h.item_type ? String(h.item_type) : null,
      marketable: Boolean(h.marketable ?? true),
      collected_at: new Date().toISOString(),
    }))
    .filter((h) => h.appid !== null && h.market_hash_name && h.quantity > 0);

  await admin.from("steam_holdings").delete().eq("user_id", userId);
  for (const part of chunk(clean, PAGE)) {
    const { error } = await admin.from("steam_holdings").insert(part);
    if (error) throw new Error(`holdings: ${error.message}`);
  }
  return clean.length;
}

/** Compras y ventas. Idempotente por `external_id`: re-volcar no duplica.
 *
 *  El año de cada fecha lo pone AQUÍ el bloque canónico y no el navegador,
 *  porque es la cuenta que decide en qué año cae cada compra y no puede estar en
 *  el lado que cualquiera puede editar. */
async function writeLedger(
  admin: SupabaseClient,
  userId: string,
  rows: Any[],
  currency: number,
): Promise<{ written: number; undated: number }> {
  const dated = datesWithYear(
    rows.map((r, i) => ({
      externalId: String(r.external_id ?? ""),
      rawDate: r.raw_date ? String(r.raw_date) : null,
      order: int(r.order) ?? i,
    })),
    new Date(),
  );

  let undated = 0;
  const clean = rows
    .map((r, i) => {
      const at = dated[i];
      /* Una fila sin fecha legible se pierde a propósito. Fecharla con hoy la
         metería en el realizado de este año, que es justo la avería que la
         reconstrucción del año existe para evitar. */
      if (!at) {
        undated += 1;
        return null;
      }
      const amount = int(r.amount_cents);
      if (amount === null || !r.external_id) return null;
      return {
        user_id: userId,
        happened_at: at,
        kind: KINDS.has(String(r.kind)) ? String(r.kind) : "other",
        amount_cents: amount,
        currency,
        fee_cents: int(r.fee_cents),
        appid: int(r.appid),
        market_hash_name: r.market_hash_name ? String(r.market_hash_name) : null,
        quantity: int(r.quantity) ?? 1,
        external_id: String(r.external_id),
      };
    })
    .filter(Boolean) as Any[];

  for (const part of chunk(clean, PAGE)) {
    const { error } = await admin
      .from("steam_ledger")
      .upsert(part, { onConflict: "user_id,external_id" });
    if (error) throw new Error(`ledger: ${error.message}`);
  }
  return { written: clean.length, undated };
}

const KINDS = new Set([
  "market_buy",
  "market_sell",
  "wallet_topup",
  "store_purchase",
  "refund",
  "other",
]);

/** Precios del volcado. SOLO para nombres que todavía no tienen ninguno.
 *
 *  Ver la cabecera: esta tabla la lee todo el mundo, así que lo que sube un
 *  cliente rellena huecos y no pisa nada. Se leen primero los nombres que ya
 *  existen en vez de intentar un upsert con condición porque PostgREST no tiene
 *  "insert si no existe" sin pisar, y un `onConflict: ignore` en dos pasos es lo
 *  mismo con más viajes. */
async function writeClientPrices(
  admin: SupabaseClient,
  rows: Any[],
  currency: number,
): Promise<number> {
  const clean = rows
    .map((p) => ({
      appid: int(p.appid),
      market_hash_name: String(p.market_hash_name ?? ""),
      currency,
      lowest_cents: int(p.lowest_cents),
      median_cents: int(p.median_cents),
      volume: int(p.volume),
      source: "client",
      fetched_at: new Date().toISOString(),
    }))
    .filter((p) => p.appid !== null && p.market_hash_name);
  if (!clean.length) return 0;

  const known = new Set<string>();
  for (const part of chunk(clean, PAGE)) {
    const { data } = await admin
      .from("steam_market_prices")
      .select("appid, market_hash_name")
      .eq("currency", currency)
      .in("market_hash_name", part.map((p) => p.market_hash_name));
    for (const r of data ?? []) known.add(`${r.appid}:${r.market_hash_name}`);
  }

  const fresh = clean.filter((p) => !known.has(`${p.appid}:${p.market_hash_name}`));
  for (const part of chunk(fresh, PAGE)) {
    const { error } = await admin.from("steam_market_prices").insert(part);
    if (error) throw new Error(`prices: ${error.message}`);
  }
  return fresh.length;
}

/** La serie histórica. Se inserta lo que no esté; nunca se pisa una vela.
 *
 *  Sin verificar, porque no hay forma: `pricehistory` pide sesión. La contención
 *  es que esta tabla no toca ningún total — solo dibuja la curva de un objeto en
 *  su ficha. Ver la migración 0085. */
async function writeHistory(
  admin: SupabaseClient,
  rows: Any[],
  currency: number,
): Promise<number> {
  const flat: Any[] = [];
  for (const item of rows) {
    const appid = int(item.appid);
    const name = String(item.market_hash_name ?? "");
    if (appid === null || !name) continue;
    for (const [day, cents, volume] of item.days ?? []) {
      const c = int(cents);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || c === null) continue;
      flat.push({
        appid,
        market_hash_name: name,
        currency,
        day: String(day),
        median_cents: c,
        volume: int(volume) ?? 0,
      });
    }
  }
  let written = 0;
  for (const part of chunk(flat, PAGE)) {
    /* `ignoreDuplicates` es lo que hace que "no pisar" sea una sola sentencia:
       las velas ya escritas se quedan como estaban. */
    const { error, count } = await admin
      .from("steam_price_history")
      .upsert(part, {
        onConflict: "appid,market_hash_name,currency,day",
        ignoreDuplicates: true,
        count: "exact",
      });
    if (error) throw new Error(`history: ${error.message}`);
    written += count ?? 0;
  }
  return written;
}

/* ─────────────────────────── /prices ────────────────────────────────────── */

/** Cuántos precios se piden como mucho en una invocación.
 *
 *  A ~700 ms por petición, 150 son unos 105 s: cabe de sobra en el límite de la
 *  plataforma y deja margen para las escrituras. Un inventario más grande se
 *  termina en varias llamadas — la respuesta dice cuántos quedan, y quien llama
 *  vuelve a llamar. Preferible a una invocación que se muere a la mitad y deja
 *  medio catálogo sin refrescar sin decirlo. */
const PRICE_BUDGET = 150;

/** El hueco entre peticiones a Steam.
 *
 *  700 ms sale de la medida del 27-08-2026: 12 seguidas sin hueco pasaron, pero
 *  el margen no se conoce y el castigo del 429 dura minutos. Ir despacio aquí no
 *  cuesta nada, porque esto lo lanza un cron de madrugada. */
const PRICE_GAP_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function refreshPrices(
  admin: SupabaseClient,
  currency: number,
  budget: number,
): Promise<{ refreshed: number; failed: number; remaining: number }> {
  /* Qué precios hacen falta: los de lo que alguien tiene. La lista sale de
     `steam_holdings` y no del catálogo entero, que no existe. */
  const { data: held, error } = await admin
    .from("steam_holdings")
    .select("appid, market_hash_name");
  if (error) throw new Error(`holdings: ${error.message}`);

  const wanted = new Map<string, { appid: number; name: string }>();
  for (const h of held ?? []) {
    wanted.set(`${h.appid}:${h.market_hash_name}`, {
      appid: h.appid,
      name: h.market_hash_name,
    });
  }

  const { data: have } = await admin
    .from("steam_market_prices")
    .select("appid, market_hash_name, fetched_at, source")
    .eq("currency", currency);

  const freshness = new Map<string, { at: number; source: string }>();
  for (const p of have ?? []) {
    freshness.set(`${p.appid}:${p.market_hash_name}`, {
      at: Date.parse(p.fetched_at),
      source: p.source,
    });
  }

  /* El orden es la política de esta función: primero lo que no tiene precio,
     después lo que solo tiene uno de cliente —que es provisional por
     definición—, y por último lo más rancio. Sin este orden, un inventario
     grande deja objetos nuevos sin precio durante días mientras se refrescan
     cajas de tres céntimos. */
  const queue = [...wanted.entries()]
    .map(([k, v]) => {
      const f = freshness.get(k);
      return { ...v, rank: !f ? 0 : f.source === "client" ? 1 : 2, at: f?.at ?? 0 };
    })
    .sort((a, b) => a.rank - b.rank || a.at - b.at);

  let refreshed = 0;
  let failed = 0;
  const batch: Any[] = [];
  for (const item of queue.slice(0, budget)) {
    try {
      const url =
        `https://steamcommunity.com/market/priceoverview/?appid=${item.appid}` +
        `&currency=${currency}&market_hash_name=${encodeURIComponent(item.name)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        /* Un 429 aquí no es "este objeto falla": es "para de pedir". Seguir
           insistiendo alarga el bloqueo, así que se corta la tanda entera y se
           deja el resto para la siguiente. */
        if (res.status === 429) break;
        failed += 1;
        continue;
      }
      const p = await res.json();
      batch.push({
        appid: item.appid,
        market_hash_name: item.name,
        currency,
        lowest_cents: priceCents(p.lowest_price),
        median_cents: priceCents(p.median_price),
        volume: p.volume ? Number(String(p.volume).replace(/[^\d]/g, "")) : null,
        source: "server",
        fetched_at: new Date().toISOString(),
      });
      refreshed += 1;
    } catch {
      failed += 1;
    }
    await sleep(PRICE_GAP_MS);
  }

  for (const part of chunk(batch, PAGE)) {
    const { error: e } = await admin
      .from("steam_market_prices")
      .upsert(part, { onConflict: "appid,market_hash_name,currency" });
    if (e) throw new Error(`prices: ${e.message}`);
  }

  return { refreshed, failed, remaining: Math.max(0, queue.length - refreshed - failed) };
}

/* ─────────────────────────── /snapshot ──────────────────────────────────── */

/** La foto del día, para todo el que tenga inventario.
 *
 *  Un punto por día y por persona. Es la ÚNICA serie honesta del valor de una
 *  cartera: `steam_price_history` es por objeto, y reconstruir con ella el
 *  pasado multiplicaría el precio de entonces por las cantidades de hoy. Eso se
 *  puede dibujar, pero no es lo que valía tu inventario, y la app lo rotula como
 *  lo que es.
 *
 *  Se reescribe el punto de hoy si ya existe: dos pasadas el mismo día son la
 *  misma foto, mejor cuanto más tarde. */
async function writeSnapshots(
  admin: SupabaseClient,
  currency: number,
): Promise<{ users: number; written: number }> {
  const { data: held, error } = await admin
    .from("steam_holdings")
    .select("user_id, appid, market_hash_name, quantity");
  if (error) throw new Error(`holdings: ${error.message}`);

  const { data: prices } = await admin
    .from("steam_market_prices")
    .select("appid, market_hash_name, median_cents")
    .eq("currency", currency);

  const median = new Map<string, number | null>();
  for (const p of prices ?? []) {
    median.set(`${p.appid}:${p.market_hash_name}`, p.median_cents);
  }

  const byUser = new Map<string, Any>();
  for (const h of held ?? []) {
    const acc = byUser.get(h.user_id) ?? {
      value_cents: 0,
      item_count: 0,
      distinct_items: 0,
      missing_prices: 0,
    };
    acc.item_count += h.quantity;
    acc.distinct_items += 1;
    const m = median.get(`${h.appid}:${h.market_hash_name}`);
    /* Sin mediana NO se rellena con nada: se cuenta como ausente. Un total al
       que le faltan cuarenta objetos es un total equivocado, y `missing_prices`
       es lo que deja distinguir en la gráfica un bache del mercado de una tanda
       de precios que no llegó. */
    if (m == null) acc.missing_prices += 1;
    else acc.value_cents += m * h.quantity;
    byUser.set(h.user_id, acc);
  }

  const day = new Date().toISOString().slice(0, 10);
  const rows = [...byUser.entries()].map(([user_id, acc]) => ({
    user_id,
    day,
    currency,
    ...acc,
  }));
  for (const part of chunk(rows, PAGE)) {
    const { error: e } = await admin
      .from("steam_portfolio_snapshots")
      .upsert(part, { onConflict: "user_id,day,currency" });
    if (e) throw new Error(`snapshots: ${e.message}`);
  }
  return { users: byUser.size, written: rows.length };
}

/* ─────────────────────────── El router ──────────────────────────────────── */

/* 3 = EUR, el id de moneda de Valve. Steam no convierte: cada mercado regional
   tiene su propia oferta, así que esto no es una preferencia de formato, es qué
   mercado se está mirando. */
const DEFAULT_CURRENCY = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/steam-market/, "").replace(/\/+$/, "");

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (path === "/ingest") {
      const userId = await userOf(req);
      if (!userId) return json({ error: "unauthorized" }, 401);

      const dump = (await req.json()) as Dump;
      const currency = Number(dump.currency) || DEFAULT_CURRENCY;

      /* Un volcado sin inventario NO borra el que hay. Es el caso de la pasada
         que se cortó a la mitad, y es indistinguible desde aquí de "he vendido
         todo": ante la duda, no se tira nada. El volcado de solo histórico
         entra por aquí igual y toma este mismo camino. */
      const summary: Any = {};
      if (Array.isArray(dump.holdings) && dump.holdings.length) {
        summary.holdings = await writeHoldings(admin, userId, dump.holdings);
      }
      if (Array.isArray(dump.prices) && dump.prices.length) {
        summary.prices = await writeClientPrices(admin, dump.prices, currency);
      }
      if (Array.isArray(dump.ledger) && dump.ledger.length) {
        const r = await writeLedger(admin, userId, dump.ledger, currency);
        summary.ledger = r.written;
        summary.undated = r.undated;
      }
      if (Array.isArray(dump.history) && dump.history.length) {
        summary.history = await writeHistory(admin, dump.history, currency);
      }

      /* La foto de hoy, en el acto. Sin esto, subir el volcado deja la gráfica
         vacía hasta que pase el cron, y la primera impresión de la pantalla es
         que no ha funcionado. */
      if (summary.holdings) await writeSnapshots(admin, currency);

      await admin.from("job_runs").insert({
        job: "steam-market/ingest",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        ok: true,
        summary,
      }).then(() => {}, () => {});

      return json({ ok: true, ...summary });
    }

    /* Las dos de abajo las llama el cron con la clave de servicio, y también la
       app: refrescar precios es lo que hace útil el primer volcado, y esperar a
       mañana para verlos no lo es. Una persona solo puede pedir la tanda; qué
       entra en ella lo decide el orden de `refreshPrices`, no quien llama. */
    if (path === "/prices") {
      if (!isService(req) && !(await userOf(req))) return json({ error: "unauthorized" }, 401);
      const currency = Number(url.searchParams.get("currency")) || DEFAULT_CURRENCY;
      const budget = Math.min(
        Number(url.searchParams.get("budget")) || PRICE_BUDGET,
        PRICE_BUDGET,
      );
      return json(await refreshPrices(admin, currency, budget));
    }

    if (path === "/snapshot") {
      if (!isService(req)) return json({ error: "unauthorized" }, 401);
      const currency = Number(url.searchParams.get("currency")) || DEFAULT_CURRENCY;
      return json(await writeSnapshots(admin, currency));
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error("steam-market", path, (e as Error)?.message ?? e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
