import { useMemo } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { itemSeries, type Move } from "@/domain/steamSeries";
import { netOrNull } from "@/domain/steamFee";
import {
  euros,
  iconUrl,
  marketUrl,
  useSteamItemHistory,
  type InventoryRow,
  type SteamLedgerEntry,
} from "@/lib/steamMarket";
import { t as tr, tv } from "@/lib/i18n";
import { dateLocale } from "@/lib/locale";

/* La ficha de UN objeto del mercado: qué ha hecho su precio desde que lo
   compraste.
 *
 * La pantalla de al lado contesta «cuánto vale todo esto HOY». Esta contesta la
 * otra mitad —«y qué ha hecho desde que lo compré»—, que es la pregunta que se
 * hace uno al mirar una cifra que no sabe si es buena o mala. Sin la referencia
 * de la compra, 12,40 € no dice nada.
 *
 * ── De dónde sale ─────────────────────────────────────────────────────────
 * De `steam_price_history`, que la llenó el recolector desde tu navegador — el
 * servidor no puede: `market/pricehistory` contesta 400 sin la cookie de sesión.
 * Por eso la ficha puede estar vacía teniendo el objeto delante: subiste el
 * inventario y no el histórico, que son los dos botones del recolector y el
 * segundo es el que se olvida. Cuando pasa se dice, en vez de dejar un hueco. */

const W = 720;
const H = 220;
const PAD = { top: 14, right: 14, bottom: 26, left: 62 };

/** Los movimientos de ESTE objeto, del libro entero.
 *
 *  `amount_cents` es el total de la transacción y con signo desde tu cartera;
 *  aquí interesa lo que costó CADA unidad y en positivo, que es lo que se puede
 *  comparar con una vela. Es la misma cuenta que `costBasis` en
 *  steamPortfolio.ts, ponderando por unidades y no por número de compras. */
function movesFor(ledger: SteamLedgerEntry[], row: InventoryRow): Move[] {
  return ledger
    .filter(
      (l) =>
        l.appid === row.appid &&
        l.market_hash_name === row.marketHashName &&
        (l.kind === "market_buy" || l.kind === "market_sell"),
    )
    .map((l) => ({
      day: l.happened_at.slice(0, 10),
      kind: l.kind as "market_buy" | "market_sell",
      quantity: Math.max(1, l.quantity),
      unitCents: Math.round(Math.abs(l.amount_cents) / Math.max(1, l.quantity)),
    }));
}

export function SteamItemSheet({
  row,
  ledger,
  net,
  onClose,
}: {
  row: InventoryRow;
  ledger: SteamLedgerEntry[];
  net: boolean;
  onClose: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const { data: candles, isLoading } = useSteamItemHistory(row);

  const series = useMemo(
    () =>
      itemSeries(
        (candles ?? []).map((c) => ({ day: c.day, medianCents: c.median_cents })),
        movesFor(ledger, row),
        row.quantity,
      ),
    [candles, ledger, row],
  );

  /* El eje va por FECHA y no por posición. Steam solo escribe vela los días que
     hubo ventas, así que repartir los puntos a distancias iguales estiraría un
     hueco de tres semanas hasta parecer un día — y justo esos huecos son los
     meses en que el objeto no se movió, que es información. */
  const geo = useMemo(() => {
    const pts = series.points;
    if (pts.length < 2) return null;
    const values = pts.map((p) => p.medianCents);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || Math.max(max, 1);
    const t0 = new Date(pts[0].day).getTime();
    const t1 = new Date(pts[pts.length - 1].day).getTime();
    const dt = t1 - t0 || 1;
    const x = (day: string) =>
      PAD.left + ((new Date(day).getTime() - t0) / dt) * (W - PAD.left - PAD.right);
    const y = (v: number) =>
      H - PAD.bottom - ((v - min) / span) * (H - PAD.top - PAD.bottom);
    return {
      min,
      max,
      x,
      y,
      points: pts.map((p) => ({ ...p, x: x(p.day), y: y(p.medianCents) })),
      /* Las compras se clavan a la altura de LO QUE PAGASTE, no de la vela de
         ese día: la distancia entre las dos es exactamente lo que se quiere
         ver —pagaste por encima o por debajo del mercado— y aplastarlas contra
         la línea la borraría.
         Las dos coordenadas se recortan al recuadro. La altura, porque pagar el
         triple del máximo de la curva es normal y dibujarlo fuera lo saca del
         SVG. Y la fecha, porque la curva empieza en la primera VELA a partir de
         la compra, que no es el día de la compra: si el objeto no se vendió en
         tres semanas, la primera vela es posterior y el aro se iría a la
         izquierda del eje, fuera del dibujo. El aro punteado dice que ese punto
         está recortado. */
      buys: series.buys.map((b) => {
        const bx = x(b.day);
        const by = y(b.unitCents);
        return {
          ...b,
          x: Math.min(W - PAD.right, Math.max(PAD.left, bx)),
          y: Math.min(H - PAD.bottom, Math.max(PAD.top, by)),
          offScale: bx < PAD.left || bx > W - PAD.right || by < PAD.top || by > H - PAD.bottom,
        };
      }),
    };
  }, [series]);

  const unit = net ? netOrNull(row.medianCents) : row.medianCents;
  /* Contra lo que pagaste, y solo si consta la compra. Lo que salió de una caja
     no tiene con qué compararse, y un «+100 %» calculado sobre un coste cero
     sería una cifra inventada. */
  const vsBuy =
    series.avgBuyCents !== null && row.medianCents !== null
      ? row.medianCents - series.avgBuyCents
      : null;

  return (
    <>
      <div className="backdrop" style={{ zIndex: 80 }} onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={row.marketHashName}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="sheet-center fixed z-[81] card"
        style={{
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(760px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div className="flex items-start gap-3">
          {iconUrl(row.iconUrl, 96) && (
            <img
              src={iconUrl(row.iconUrl, 96)!}
              alt=""
              width={56}
              height={56}
              style={{ objectFit: "contain", flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, lineHeight: 1.25 }}>{row.marketHashName}</div>
            <div className="mute" style={{ fontSize: 12.5 }}>
              {tv("{n} in your inventory", { n: row.quantity })}
              {!row.marketable && ` · ${tr("locked")}`}
            </div>
          </div>
          {/* El enlace al mercado de Steam, que vivía en la baldosa de la
              rejilla hasta que la baldosa pasó a abrir esta ficha. Aquí arriba y
              no al final: es el otro sitio al que se puede ir desde esta
              pantalla, y esconderlo debajo de la curva lo convertiría en un
              secreto. Pestaña nueva y `noreferrer` — es un dominio de terceros. */}
          <a
            /* `btn-ghost` y no `.btn` a secas: `.btn` sin variante es borde
               transparente y sin fondo, o sea un texto con relleno. Al lado de
               la equis, que sí se ve, parecía una etiqueta y no un enlace. */
            className="btn btn-sm btn-ghost"
            href={marketUrl(row.appid, row.marketHashName)}
            target="_blank"
            rel="noreferrer noopener"
            style={{ flexShrink: 0, textDecoration: "none", color: "inherit" }}
          >
            <ExternalLink size={14} />
            {tr("On Steam")}
          </a>
          <button className="btn btn-icon" aria-label={tr("Close")} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Las tres cifras que se comparan entre sí, y en este orden: lo que
            vale, lo que costó, y la diferencia — que es la que se venía a ver y
            por eso es la única en color. */}
        <div className="flex items-baseline gap-4" style={{ flexWrap: "wrap" }}>
          <div>
            <div className="eyebrow">{net ? tr("Worth · net") : tr("Worth")}</div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>
              {euros(unit)}
            </div>
          </div>
          <div>
            <div className="eyebrow">{tr("You paid")}</div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>
              {euros(series.avgBuyCents)}
            </div>
          </div>
          {vsBuy !== null && (
            <div>
              <div className="eyebrow">{tr("Difference")}</div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
                  color: vsBuy >= 0 ? "var(--ok, #3a7)" : "var(--bad, #e26)",
                }}
              >
                {vsBuy >= 0 ? "+" : "−"}
                {euros(Math.abs(vsBuy))}
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div style={{ padding: 24, display: "grid", placeItems: "center" }}>
            <Loader2 size={18} className="spin" style={{ color: "var(--accent)" }} />
          </div>
        ) : !geo ? (
          <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
            {tr(
              "No price history for this one yet. It comes from the collector's second button, and Steam only hands it to your own browser.",
            )}
          </p>
        ) : (
          <>
            <svg
              className="steam-chart"
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={tv("Price of {item} from {from} to {to}", {
                item: row.marketHashName,
                from: new Date(geo.points[0].day).toLocaleDateString(dateLocale()),
                to: new Date(geo.points[geo.points.length - 1].day).toLocaleDateString(dateLocale()),
              })}
              style={{ width: "100%", height: "auto" }}
            >
              {[geo.max, geo.min].map((v, i) => (
                <g key={`${v}-${i}`}>
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
              <path
                d={geo.points
                  .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                  .join(" ")}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={2}
              />
              {/* Cada compra, en su día y a su precio. El aro hueco se lee sobre
                  la línea sin taparla, que es lo que hace un punto sólido cuando
                  compraste justo al precio de mercado. */}
              {geo.buys.map((b, i) => (
                <g key={`${b.day}-${i}`}>
                  <line
                    className="grid-line"
                    x1={b.x}
                    y1={PAD.top}
                    x2={b.x}
                    y2={H - PAD.bottom}
                  />
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={4}
                    fill="var(--bg, #111)"
                    stroke="var(--ok, #3a7)"
                    strokeWidth={2}
                    strokeDasharray={b.offScale ? "2 2" : undefined}
                  >
                    <title>
                      {tv("Bought {n} at {price} on {day}", {
                        n: b.quantity,
                        price: euros(b.unitCents),
                        day: new Date(b.day).toLocaleDateString(dateLocale()),
                      })}
                    </title>
                  </circle>
                </g>
              ))}
              <text className="grid-label" x={PAD.left} y={H - 8}>
                {new Date(geo.points[0].day).toLocaleDateString(dateLocale())}
              </text>
              <text className="grid-label" x={W - PAD.right} y={H - 8} textAnchor="end">
                {new Date(geo.points[geo.points.length - 1].day).toLocaleDateString(dateLocale())}
              </text>
            </svg>

            <p className="mute" style={{ margin: 0, fontSize: 12 }}>
              {series.buys.length
                ? tv("The line starts the day you first bought it. {n} candles, gross prices — what the buyer pays.", {
                    n: series.points.length,
                  })
                : /* Sin compra en el libro no hay fecha de inicio que respetar, y
                     decir por qué evita que parezca un fallo del recolector. */
                  tv("No purchase on record — it came out of a case, a drop or a trade — so the whole history is drawn. {n} candles, gross prices.", {
                    n: series.points.length,
                  })}
            </p>
          </>
        )}
      </div>
    </>
  );
}
