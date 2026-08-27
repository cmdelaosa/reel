import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Clipboard, Loader2, Upload } from "lucide-react";
import collectorSource from "@/features/games/steamCollector.js?raw";
import {
  euros,
  iconUrl,
  useSteamInventory,
  useUploadSteamDump,
  type IngestSummary,
  type InventoryRow,
  type SteamSnapshot,
} from "@/lib/steamMarket";
import { t as tr, tv } from "@/lib/i18n";
import { dateLocale } from "@/lib/locale";

/* El inventario del mercado, dentro de la pestaña Steam (0085). Lo que la
   importación de juegos es a tu biblioteca, esto es a tu dinero — y son dos
   cosas distintas, así que van en dos bloques y no en uno.

   ── Lo que esta pantalla se niega a hacer ─────────────────────────────────
   Enseñar un total redondo cuando no lo sabe. Las webs que valoran inventarios
   fallan siempre igual: se comen el 429 de Steam en la mitad de los objetos y
   pintan la suma de la otra mitad como si fuera el total. Aquí un objeto sin
   precio se cuenta aparte y se dice en la misma línea que el número grande. Un
   total con un asterisco es útil; un total equivocado no. */

export function SteamInventory() {
  const { data, isLoading } = useSteamInventory();
  const upload = useUploadSteamDump();
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <Loader2 size={18} className="spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  const empty = !data || data.rows.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="eyebrow">{tr("Market inventory")}</div>

      {empty ? (
        <Onboarding
          source={collectorSource}
          copied={copied}
          onCopy={() => {
            navigator.clipboard.writeText(collectorSource);
            setCopied(true);
          }}
          onPick={() => fileInput.current?.click()}
          uploading={upload.isPending}
        />
      ) : (
        <>
          <Totals data={data} />
          <ValueChart snapshots={data.snapshots} />
          <Cash data={data} />
          <Items rows={data.rows} />
          <Footer
            collectedAt={data.collectedAt}
            onPick={() => fileInput.current?.click()}
            onCopy={() => {
              navigator.clipboard.writeText(collectorSource);
              setCopied(true);
            }}
            copied={copied}
            uploading={upload.isPending}
          />
        </>
      )}

      {upload.error && (
        <p className="mute" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #e26)" }}>
          {String((upload.error as Error).message)}
        </p>
      )}
      {upload.data && (
        <UploadReceipt summary={upload.data} />
      )}

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          /* Se limpia para que subir DOS VECES el mismo fichero vuelva a
             disparar el change. Sin esto, re-subir el volcado corregido no hace
             nada y parece que la pantalla se ha colgado. */
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* ── El número grande ─────────────────────────────────────────────────────── */

function Totals({ data }: { data: NonNullable<ReturnType<typeof useSteamInventory>["data"]> }) {
  const { totals } = data;
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: 34, fontWeight: 850, letterSpacing: "-0.02em" }}>
        {euros(totals.valueCents)}
      </div>
      <div className="mute" style={{ fontSize: 13 }}>
        {tv("{items} items · {distinct} different · about {quick} if you sold it all today", {
          items: totals.itemCount,
          distinct: totals.distinctItems,
          quick: euros(totals.quickSellCents),
        })}
      </div>
      {/* La advertencia va PEGADA al número, no al pie de la pantalla: un total
          al que le faltan objetos solo es honesto si las dos cosas se leen a la
          vez. */}
      {totals.missingPrices > 0 && (
        <div
          className="flex items-center gap-2"
          style={{ marginTop: 10, fontSize: 12.5, color: "var(--warn, #d90)" }}
        >
          <AlertTriangle size={14} />
          {tv("{n} items have no price yet, and are not in that total.", {
            n: totals.missingPrices,
          })}
        </div>
      )}
    </div>
  );
}

/* ── La curva ─────────────────────────────────────────────────────────────── */

const W = 680;
const H = 140;
const PAD = { top: 12, right: 12, bottom: 22, left: 52 };

/** El valor de tu cartera, un punto por día.
 *
 *  Empieza el día que subiste el primer volcado, y no antes: nadie guardó esa
 *  foto. Reconstruirla con la serie de cada objeto multiplicaría los precios de
 *  entonces por las cantidades de HOY, que es otra cosa — se puede dibujar, pero
 *  no es lo que valía tu inventario, y esta gráfica no lo va a fingir. */
function ValueChart({ snapshots }: { snapshots: SteamSnapshot[] }) {
  const geo = useMemo(() => {
    if (snapshots.length < 2) return null;
    const values = snapshots.map((s) => s.value_cents);
    const min = Math.min(...values);
    const max = Math.max(...values);
    /* Un rango plano (todo igual) partiría por cero al escalar. */
    const span = max - min || Math.max(max, 1);
    const x = (i: number) =>
      PAD.left + (i / (snapshots.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) =>
      H - PAD.bottom - ((v - min) / span) * (H - PAD.top - PAD.bottom);
    return {
      min,
      max,
      points: snapshots.map((s, i) => ({ ...s, x: x(i), y: y(s.value_cents) })),
    };
  }, [snapshots]);

  if (!geo) {
    return (
      <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
        {tr(
          "The value graph starts the day you first upload: nobody recorded what your inventory was worth before that.",
        )}
      </p>
    );
  }

  const line = geo.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const first = geo.points[0];
  const last = geo.points[geo.points.length - 1];
  const change = last.value_cents - first.value_cents;
  /* Los días a los que les faltaban precios se marcan. Sin esto, un bache de la
     línea no se distingue de una tanda de precios que no llegó — y son cosas
     muy distintas para quien la mira. */
  const gaps = geo.points.filter((p) => p.missing_prices > 0);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <div className="eyebrow">{tr("Value over time")}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: change >= 0 ? "var(--ok, #3a7)" : "var(--bad, #e26)" }}>
          {change >= 0 ? "+" : "−"}
          {euros(Math.abs(change))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={tv("Inventory value from {from} to {to}", {
          from: new Date(first.day).toLocaleDateString(dateLocale()),
          to: new Date(last.day).toLocaleDateString(dateLocale()),
        })}
        style={{ width: "100%", height: "auto" }}
      >
        {[geo.max, geo.min].map((v, i) => (
          <g key={v + "-" + i}>
            <line
              className="grid-line"
              x1={PAD.left}
              y1={i === 0 ? PAD.top : H - PAD.bottom}
              x2={W - PAD.right}
              y2={i === 0 ? PAD.top : H - PAD.bottom}
            />
            <text
              className="grid-label"
              x={PAD.left - 6}
              y={i === 0 ? PAD.top : H - PAD.bottom}
              dominantBaseline="middle"
              textAnchor="end"
            >
              {euros(v)}
            </text>
          </g>
        ))}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} />
        {gaps.map((p) => (
          <circle key={p.day} cx={p.x} cy={p.y} r={2.5} fill="var(--warn, #d90)">
            <title>
              {tv("{n} items had no price on {day}", {
                n: p.missing_prices,
                day: new Date(p.day).toLocaleDateString(dateLocale()),
              })}
            </title>
          </circle>
        ))}
        <text className="grid-label" x={PAD.left} y={H - 6}>
          {new Date(first.day).toLocaleDateString(dateLocale())}
        </text>
        <text className="grid-label" x={W - PAD.right} y={H - 6} textAnchor="end">
          {new Date(last.day).toLocaleDateString(dateLocale())}
        </text>
      </svg>
    </div>
  );
}

/* ── El dinero ────────────────────────────────────────────────────────────── */

function Cash({ data }: { data: NonNullable<ReturnType<typeof useSteamInventory>["data"]> }) {
  const { cash, gain } = data;
  const tiles = [
    /* El orden cuenta una historia y por eso no es alfabético: de tu bolsillo
       hacia dentro, lo que el mercado ha dado, y lo que queda en pie. */
    { label: tr("Out of your own pocket"), value: euros(cash.toppedUpCents) },
    { label: tr("Spent on games"), value: euros(cash.spentInStoreCents) },
    {
      label: tr("Made trading"),
      value: euros(cash.realizedCents),
      tone: cash.realizedCents >= 0 ? "ok" : "bad",
    },
    {
      label: tr("Unrealised, on what you still hold"),
      value: euros(gain.gainCents),
      tone: gain.gainCents >= 0 ? "ok" : "bad",
    },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        {tiles.map((t) => (
          <div key={t.label} className="surface-2" style={{ borderRadius: "var(--r)", padding: 14 }}>
            <div
              style={{
                fontSize: 19,
                fontWeight: 800,
                color:
                  t.tone === "ok"
                    ? "var(--ok, #3a7)"
                    : t.tone === "bad"
                      ? "var(--bad, #e26)"
                      : undefined,
              }}
            >
              {t.value}
            </div>
            <div className="mute" style={{ fontSize: 12 }}>{t.label}</div>
          </div>
        ))}
      </div>
      {/* La frase que ninguna de esas cuatro cifras dice sola, y que es la que
          se quiere saber. */}
      {cash.storeFundedByMarketCents > 0 && (
        <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
          {tv("{n} of what you've spent on games didn't come from your pocket — the market paid for it.", {
            n: euros(cash.storeFundedByMarketCents),
          })}
        </p>
      )}
      {/* Sin esto, "no realizado" parece calculado sobre todo el inventario, y
          casi nunca lo está: lo que salió de una caja no tiene coste. */}
      {gain.uncoveredItems > 0 && (
        <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
          {tv(
            "Unrealised covers the {covered} items you actually bought. The other {uncovered} came out of cases or trades and never cost you anything, so there's no gain to compute.",
            { covered: gain.coveredItems, uncovered: gain.uncoveredItems },
          )}
        </p>
      )}
    </div>
  );
}

/* ── La tabla ─────────────────────────────────────────────────────────────── */

type Sort = "value" | "unit" | "quantity" | "name";

function Items({ rows }: { rows: InventoryRow[] }) {
  const [sort, setSort] = useState<Sort>("value");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => r.marketHashName.toLowerCase().includes(q))
      : rows;
    const sorted = [...filtered];
    /* Los que no tienen precio se van al final en los órdenes de dinero, en vez
       de amontonarse arriba como si valieran cero. */
    const nulls = (r: InventoryRow) => (r.medianCents === null ? 1 : 0);
    if (sort === "value") sorted.sort((a, b) => nulls(a) - nulls(b) || b.valueCents - a.valueCents);
    if (sort === "unit")
      sorted.sort((a, b) => nulls(a) - nulls(b) || (b.medianCents ?? 0) - (a.medianCents ?? 0));
    if (sort === "quantity") sorted.sort((a, b) => b.quantity - a.quantity);
    if (sort === "name") sorted.sort((a, b) => a.marketHashName.localeCompare(b.marketHashName));
    return sorted;
  }, [rows, sort, query]);

  const SORTS: { key: Sort; label: string }[] = [
    { key: "value", label: tr("Total value") },
    { key: "unit", label: tr("Unit price") },
    { key: "quantity", label: tr("How many") },
    { key: "name", label: tr("Name") },
  ];

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("Filter by name")}
          style={{
            flex: "1 1 180px",
            minWidth: 0,
            padding: "7px 10px",
            borderRadius: "var(--r)",
            border: "1px solid var(--line)",
            background: "transparent",
            color: "inherit",
          }}
        />
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={sort === s.key ? "chip chip-on" : "chip"}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr className="mute" style={{ fontSize: 11.5, textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>{tr("Item")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{tr("How many")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{tr("Worth")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{tr("Sells for")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{tr("Cost")}</th>
              <th style={{ padding: "6px 8px", textAlign: "right" }}>{tr("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.appid}:${r.marketHashName}`} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "6px 8px" }}>
                  <div className="flex items-center gap-2">
                    {iconUrl(r.iconUrl, 48) && (
                      <img
                        src={iconUrl(r.iconUrl, 48)!}
                        alt=""
                        width={28}
                        height={28}
                        loading="lazy"
                        style={{ borderRadius: 3, flexShrink: 0 }}
                      />
                    )}
                    <span>
                      {r.marketHashName}
                      {/* Un objeto que no se puede vender hoy vale igual pero no
                          se puede realizar, y eso cambia qué significa su cifra. */}
                      {!r.marketable && (
                        <span className="mute" style={{ fontSize: 11 }}> · {tr("locked")}</span>
                      )}
                      {r.provisional && (
                        <span className="mute" style={{ fontSize: 11 }}> · {tr("price not confirmed yet")}</span>
                      )}
                    </span>
                  </div>
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.quantity}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{euros(r.medianCents)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }} className="mute">
                  {euros(r.lowestCents)}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }} className="mute">
                  {euros(r.costCents)}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>
                  {r.medianCents === null ? "—" : euros(r.valueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && (
        <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>{tr("Nothing matches that.")}</p>
      )}
    </div>
  );
}

/* ── El recolector ────────────────────────────────────────────────────────── */

function CollectorSteps({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  return (
    <>
      <ol className="mute" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
        <li>{tr("Open steamcommunity.com/market in another tab, signed in.")}</li>
        <li>{tr("Open the browser console there (⌥⌘J on Chrome for Mac) and paste this.")}</li>
        <li>{tr("Wait — it asks Steam one price at a time on purpose — then press its buttons to save the files.")}</li>
        {/* El segundo pase es un paso aparte y no una nota al pie: sin él, «de
            tu bolsillo» y «gastado en juegos» salen a cero, y un cero se lee
            como un dato y no como algo que falta. Son dos orígenes distintos y
            uno no puede leer al otro. */}
        <li>{tr("Then do the same on store.steampowered.com/account/history — the wallet lives there, on the other side of a wall the first tab can't reach, and that's where \"out of your own pocket\" and \"spent on games\" come from.")}</li>
        <li>{tr("Come back here and upload the files.")}</li>
      </ol>
      <button className="btn" onClick={onCopy}>
        <Clipboard size={15} />
        {copied ? tr("Copied") : tr("Copy the collector")}
      </button>
    </>
  );
}

function Onboarding({
  copied,
  onCopy,
  onPick,
  uploading,
}: {
  source: string;
  copied: boolean;
  onCopy: () => void;
  onPick: () => void;
  uploading: boolean;
}) {
  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 14 }}>
        {tr("What your CS2 and Steam items are worth, what you paid, and what the market has given back.")}
      </p>
      {/* Por qué hay que pegar algo en una consola, dicho antes de pedirlo: sin
          el motivo, esto parece una pega de la app y no de Steam. */}
      <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
        {tr("Steam blocks servers from reading inventories — that's why the sites that do this work so badly — and your purchase history needs your own session. So the reading happens in your browser, and Reel keeps the result. Nothing of your Steam session ever leaves your machine.")}
      </p>
      <CollectorSteps onCopy={onCopy} copied={copied} />
      <button className="btn btn-primary" onClick={onPick} disabled={uploading}>
        {uploading ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
        {tr("Upload the file")}
      </button>
    </div>
  );
}

function Footer({
  collectedAt,
  onPick,
  onCopy,
  copied,
  uploading,
}: {
  collectedAt: string | null;
  onPick: () => void;
  onCopy: () => void;
  copied: boolean;
  uploading: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="mute" style={{ fontSize: 12.5 }}>
        {collectedAt
          ? tv("Your items as of {when}. Prices refresh on their own every day.", {
              when: new Date(collectedAt).toLocaleString(dateLocale()),
            })
          : tr("Prices refresh on their own every day.")}
      </div>
      <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
        <button className="btn" onClick={onPick} disabled={uploading}>
          {uploading ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
          {tr("Upload a new dump")}
        </button>
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? tr("Hide the collector") : tr("Show the collector")}
        </button>
      </div>
      {open && <CollectorSteps onCopy={onCopy} copied={copied} />}
    </div>
  );
}

function UploadReceipt({ summary }: { summary: IngestSummary }) {
  const lines = [
    summary.holdings ? tv("{n} items", { n: summary.holdings }) : null,
    summary.ledger ? tv("{n} market rows", { n: summary.ledger }) : null,
    summary.history ? tv("{n} price points", { n: summary.history }) : null,
  ].filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
        {tv("Uploaded: {what}.", { what: lines.join(" · ") })}
      </p>
      {/* Lo que se ha caído se cuenta. Una fila cuya fecha no se pudo leer se
          descarta a propósito —fecharla con hoy la metería en el realizado de
          este año— y callarlo dejaría un descuadre sin explicación. */}
      {summary.undated ? (
        <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
          {tv("{n} rows had a date Steam wrote in a way we couldn't read, and were left out rather than dated wrong.", {
            n: summary.undated,
          })}
        </p>
      ) : null}
    </div>
  );
}
