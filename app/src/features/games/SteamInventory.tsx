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
import {
  netLineCents,
  netOrNull,
  netTotalCents,
  netUnrealizedCents,
} from "@/domain/steamFee";
import { t as tr, tv } from "@/lib/i18n";
import { dateLocale } from "@/lib/locale";

/** Una de dos frases según la cifra. `tv` sustituye variables pero no conjuga,
 *  y esta pantalla está llena de recuentos que pueden valer uno: «1 items» y «1
 *  objetos» se leen como un fallo justo en las líneas que califican el dinero.
 *
 *  Aquí y no en lib/i18n porque el diccionario es plano a propósito —la clave ES
 *  el inglés— y meterle plurales de verdad es rehacerlo. Dos claves y esta
 *  función resuelven lo que hay, que son cuatro sitios. */
const plural = (n: number, one: string, many: string) =>
  n === 1 ? tr(one) : tv(many, { n });

/* El inventario del mercado, dentro de la pestaña Steam (0088). Lo que la
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
  /** Bruto o neto, para TODOS los euros de mercado de la pantalla a la vez: el
   *  total, el de la pestaña que estés mirando y el de cada objeto. Vive aquí
   *  arriba justamente por eso — media pantalla en bruto y media en neto no
   *  sería una opción, sería un error de lectura esperando a ocurrir. */
  const [net, setNet] = useState(false);

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
      {/* El rótulo solo en el estreno. Con la pantalla llena lo dicen ya la
          pestaña de arriba (Inventario) y el propio total, y un rótulo que
          repite lo que hay debajo se come una línea de las buenas. */}
      {empty && <div className="eyebrow">{tr("Market inventory")}</div>}

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
          {/* El total y la curva son UNA banda: dos tarjetas de la misma altura
              a lo ancho de la página. Iban una debajo de otra, y entre las dos
              y las cuatro baldosas del dinero se comían la pantalla entera
              antes de que se viera un solo objeto. */}
          <div className="steam-band">
            <Totals data={data} net={net} onNet={setNet} />
            <ValueChart snapshots={data.snapshots} net={net} />
          </div>
          <CashNotes data={data} />
          <Items rows={data.rows} net={net} />
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

/** El total, el conmutador que decide qué significa, y el dinero.
 *
 *  Debajo del número no va nada más: el recuento y el aviso de los objetos sin
 *  precio se han ido a la cabecera de la lista, que es donde ahora se lee el
 *  total de lo que estás mirando. Un número grande con tres renglones colgando
 *  hacía esta tarjeta más alta que la gráfica de al lado, y las dos comparten
 *  fila.
 *
 *  Y el conmutador está aquí, pegado al número, y no en la barra de la lista:
 *  manda sobre todos los euros de mercado de la pantalla, así que se pone donde
 *  se ve el más grande de ellos cambiar. */
function Totals({
  data,
  net,
  onNet,
}: {
  data: NonNullable<ReturnType<typeof useSteamInventory>["data"]>;
  net: boolean;
  onNet: (v: boolean) => void;
}) {
  const { totals, cash, gain, rows } = data;
  /* Las tres primeras son dinero que YA pasó por tu cartera —lo metiste, lo
     gastaste, te llegó de una venta con su comisión ya descontada—, así que el
     conmutador no las toca: no hay comisión que quitarle a lo que ya cobraste.
     La cuarta sí, porque no es dinero sino una valoración de lo que tienes: en
     neto se recalcula sobre lo que de verdad cobrarías (domain/steamFee). */
  const unrealisedCents = net ? netUnrealizedCents(rows) : gain.gainCents;
  /* El orden cuenta una historia y por eso no es alfabético: de tu bolsillo
     hacia dentro, lo que el mercado ha dado, y lo que queda en pie.

     En 2×2 y no en columna: apiladas, estas cuatro cifras hacían la tarjeta
     noventa píxeles más alta y se llevaban la gráfica con ellas. */
  const money = [
    { label: tr("Out of your own pocket"), value: euros(cash.toppedUpCents) },
    { label: tr("Spent on games"), value: euros(cash.spentInStoreCents) },
    {
      label: tr("Made trading"),
      value: euros(cash.realizedCents),
      tone: cash.realizedCents >= 0 ? "ok" : "bad",
    },
    {
      label: tr("Unrealised"),
      value: euros(unrealisedCents),
      tone: unrealisedCents >= 0 ? "ok" : "bad",
    },
  ];
  return (
    <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow">{tr("Total")}</div>
        {/* `.segmented` y no un chip: siempre hay uno de los dos encendido, que
            es la regla de la hoja de estilos para elegir entre las dos formas. */}
        <div
          className="segmented"
          role="tablist"
          title={tr("Net takes off Steam's 15% cut — what actually lands in your wallet.")}
        >
          {[
            { key: false, label: tr("Gross") },
            { key: true, label: tr("Net") },
          ].map((x) => (
            <button
              key={String(x.key)}
              role="tab"
              aria-selected={net === x.key}
              className={net === x.key ? "seg seg-active" : "seg"}
              style={{ height: 26, padding: "0 11px", fontSize: 12 }}
              onClick={() => onNet(x.key)}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div
        style={{
          fontSize: 38,
          fontWeight: 850,
          letterSpacing: "-0.025em",
          lineHeight: 1.15,
          marginTop: 4,
        }}
      >
        {/* `netTotalCents` sobre las filas, y no la comisión aplicada al total
            ya hecho: cada unidad es su propia venta y paga su propio mínimo.
            Con 532 cromos de tres céntimos, netear la suma diría casi el triple
            de lo que cobrarías — y contradiría a la vista lo que pone en cada
            ficha de la rejilla. */}
        {euros(net ? netTotalCents(rows) : totals.valueCents)}
      </div>
      <div style={{ height: 1, background: "var(--border)", margin: "14px 0 12px" }} />
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
        {money.map((m) => (
          <div key={m.label}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                lineHeight: 1.2,
                color:
                  m.tone === "ok"
                    ? "var(--ok, #3a7)"
                    : m.tone === "bad"
                      ? "var(--bad, #e26)"
                      : undefined,
              }}
            >
              {m.value}
            </div>
            <div className="mute" style={{ fontSize: 11 }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── La curva ─────────────────────────────────────────────────────────────── */

/* Más ancha y más plana que antes (era 680×140), y no por gusto: la gráfica
   comparte fila con el total, y el alto de una tarjeta cuyo SVG escala con el
   ancho lo decide esta proporción. A 6:1 las dos miden casi lo mismo en la
   página de 1.280, que es lo que hace que la banda se lea como una sola cosa. */
const W = 900;
const H = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 56 };

/** El valor de tu cartera, un punto por día.
 *
 *  Empieza el día que subiste el primer volcado, y no antes: nadie guardó esa
 *  foto. Reconstruirla con la serie de cada objeto multiplicaría los precios de
 *  entonces por las cantidades de HOY, que es otra cosa — se puede dibujar, pero
 *  no es lo que valía tu inventario, y esta gráfica no lo va a fingir. */
/** La curva se queda SIEMPRE en bruto, y lo dice.
 *
 *  Es la única cifra de la pantalla que el conmutador no puede seguir. La foto
 *  diaria (`steam_portfolio_snapshots`) guarda un total y nada más: qué objetos
 *  lo componían ese día no está en ninguna parte, y sin eso no hay forma de
 *  aplicar una comisión que tiene un mínimo POR objeto. Pasarle el 15 % al
 *  total daría una línea que no coincide ni con su propio último punto — el
 *  total de arriba, que sí se calcula objeto a objeto.
 *
 *  Así que en vez de dibujar una curva aproximada sin decirlo, se dibuja la de
 *  siempre con su etiqueta. Es la misma regla que el resto de la pantalla: un
 *  total con un asterisco es útil, uno equivocado no. */
function ValueChart({ snapshots, net }: { snapshots: SteamSnapshot[]; net: boolean }) {
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
      points: snapshots.map((s, i) => ({ ...s, x: x(i), y: y(values[i]) })),
    };
  }, [snapshots]);

  /* Con un solo día todavía no hay curva, pero sí hay hueco: la tarjeta se
     pinta igual para que la banda siga siendo dos tarjetas y el total no se
     quede solo a media página. */
  if (!geo) {
    return (
      <div className="card" style={{ padding: "16px 18px", display: "grid", alignItems: "center" }}>
        <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
          {tr(
            "The value graph starts the day you first upload: nobody recorded what your inventory was worth before that.",
          )}
        </p>
      </div>
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
    <div className="card" style={{ padding: "16px 18px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        {/* Con el neto puesto, la etiqueta dice que esta cifra no lo sigue. Sin
            ella, la última punta de la curva y el total de al lado se
            contradicen y no hay nada en pantalla que lo explique. */}
        <div className="eyebrow" title={net ? tr("The daily photo only stores a total, so there's no way to take the per-item cut off the past.") : undefined}>
          {net ? tr("Value over time · gross") : tr("Value over time")}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: change >= 0 ? "var(--ok, #3a7)" : "var(--bad, #e26)" }}>
          {change >= 0 ? "+" : "−"}
          {euros(Math.abs(change))}
        </div>
      </div>
      <svg
        className="steam-chart"
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
              {p.missing_prices === 1
                ? tv("One item had no price on {day}", {
                    day: new Date(p.day).toLocaleDateString(dateLocale()),
                  })
                : tv("{n} items had no price on {day}", {
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

/* ── Las dos frases del dinero ────────────────────────────────────────────── */

/** Lo que las cuatro cifras del dinero no dicen solas.
 *
 *  Las cifras se han ido a la tarjeta del total (2×2, arriba); aquí se quedan
 *  las dos frases, que son prosa y no caben en una baldosa. Van debajo de la
 *  banda porque califican lo de arriba, y las dos aparecen solo cuando hay algo
 *  que calificar. */
function CashNotes({ data }: { data: NonNullable<ReturnType<typeof useSteamInventory>["data"]> }) {
  const { cash, gain } = data;
  if (!cash.storeFundedByMarketCents && !gain.uncoveredItems) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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

/* ── Tus objetos ──────────────────────────────────────────────────────────── */

type Sort = "value" | "unit" | "quantity" | "name";
type View = "grid" | "list";

/** Cómo se llama cada juego, para el rótulo de su pestaña.
 *
 *  Son los dos inventarios que el recolector lee —730 es CS2 y 753 son los
 *  cromos, fondos y emoticonos de la comunidad—, y no hay una tercera fuente de
 *  la que sacar el nombre: el volcado trae el appid y nada más. De ahí el
 *  respaldo con el número en vez de un hueco: una pestaña sin nombre sigue
 *  siendo utilizable, y el día que Valve abra otro mercado se verá cuál es. */
const APP_NAMES: Record<number, string> = {
  730: "CS2",
  753: "Steam",
};
const appName = (appid: number) => APP_NAMES[appid] ?? `App ${appid}`;

function Items({ rows, net }: { rows: InventoryRow[]; net: boolean }) {
  const [sort, setSort] = useState<Sort>("value");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("grid");
  /** null es "todos". No es un appid más para que añadir un juego nuevo no
   *  obligue a tocar nada, y para que el estado de estreno sea "lo veo todo". */
  const [app, setApp] = useState<number | null>(null);

  /** Una pestaña por juego, con lo que hay dentro.
   *
   *  El orden lo pone el dinero y no el appid: la pestaña que se mira primero es
   *  la que más pesa en el total, y con dos inventarios de tamaños tan distintos
   *  —76 objetos de CS2 valen mucho más que 532 cromos— ordenar por número
   *  dejaría delante la que menos dice. El recuento va en el rótulo porque es la
   *  mitad de la pregunta que hace clic ahí. */
  const tabs = useMemo(() => {
    const by = new Map<number, { count: number; valueCents: number }>();
    for (const r of rows) {
      const acc = by.get(r.appid) ?? { count: 0, valueCents: 0 };
      acc.count += 1;
      acc.valueCents += r.valueCents;
      by.set(r.appid, acc);
    }
    return [...by.entries()]
      .map(([appid, v]) => ({ appid, ...v }))
      .sort((a, b) => b.valueCents - a.valueCents);
  }, [rows]);

  /* Con un solo juego no hay nada que elegir, y una pestaña suelta es un mando
     que no manda: ocupa una fila entera para decir lo que ya se ve. */
  const showTabs = tabs.length > 1;
  /* Un filtro que apunta a un juego que ya no está —se vendió el último objeto
     de CS2 y el volcado siguiente no lo trae— dejaría la rejilla vacía sin que
     ninguna pestaña se vea encendida. */
  const activeApp = app !== null && tabs.some((t) => t.appid === app) ? app : null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inApp = activeApp === null ? rows : rows.filter((r) => r.appid === activeApp);
    const filtered = q
      ? inApp.filter((r) => r.marketHashName.toLowerCase().includes(q))
      : inApp;
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
  }, [rows, sort, query, activeApp]);

  /* El total de lo que estás mirando, que cambia con la pestaña y con el filtro
     por nombre — «¿cuánto de esto es CS2?» es la otra mitad de la pregunta que
     hace clic ahí arriba. Y el recuento de los que no tienen precio sale de lo
     MISMO que se está sumando: un aviso global al lado de un total filtrado
     estaría hablando de otros objetos. */
  const shownTotalCents = net
    ? netTotalCents(shown)
    : shown.reduce((a, r) => a + (r.medianCents === null ? 0 : r.valueCents), 0);
  const shownMissing = shown.filter((r) => r.medianCents === null).length;

  const SORTS: { key: Sort; label: string }[] = [
    { key: "value", label: tr("Total value") },
    { key: "unit", label: tr("Unit price") },
    { key: "quantity", label: tr("How many") },
    { key: "name", label: tr("Name") },
  ];

  const VIEWS: { key: View; label: string }[] = [
    { key: "grid", label: tr("Grid") },
    { key: "list", label: tr("List") },
  ];

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Las pestañas van en su propia fila y ARRIBA del buscador: eligen de qué
          hablamos, y lo demás —filtrar, ordenar, cómo se ve— actúa sobre lo que
          hayan elegido. En una fila con lo otro parecerían un filtro más.
          `.segmented` y no chips por la regla de la hoja de estilos: un chip es
          algo que enciendes y puedes apagar; aquí siempre hay una encendida. */}
      <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
        {showTabs && (
          <div className="segmented scroll" role="tablist" style={{ flex: "0 1 auto", minWidth: 0 }}>
            <button
              role="tab"
              aria-selected={activeApp === null}
              className={activeApp === null ? "seg seg-active" : "seg"}
              onClick={() => setApp(null)}
            >
              {tr("Everything")}
              <span className="mute" style={{ fontWeight: 600 }}>{rows.length}</span>
            </button>
            {tabs.map((t) => (
              <button
                key={t.appid}
                role="tab"
                aria-selected={activeApp === t.appid}
                className={activeApp === t.appid ? "seg seg-active" : "seg"}
                onClick={() => setApp(t.appid)}
              >
                {appName(t.appid)}
                <span className="mute" style={{ fontWeight: 600 }}>{t.count}</span>
              </button>
            ))}
          </div>
        )}
        {/* Se pinta con pestañas y sin ellas: con un solo juego sigue habiendo
            un filtro por nombre, y esa suma es justo lo que no se sabía. */}
        <div className="flex items-baseline gap-2" style={{ marginLeft: "auto" }}>
          <span className="eyebrow">{tr("Total")}</span>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em" }}>
            {euros(shownTotalCents)}
          </span>
        </div>
      </div>
      {/* La advertencia que antes colgaba del número grande. Aquí califica el
          total que tiene al lado, que es el que ahora se puede filtrar — y un
          total al que le faltan objetos solo es honesto si las dos cosas se leen
          a la vez. */}
      {shownMissing > 0 && (
        <div
          className="flex items-center gap-2"
          style={{ fontSize: 12.5, color: "var(--warn, #d90)", marginTop: -4 }}
        >
          <AlertTriangle size={14} />
          {/* «1 items» le quita autoridad a la línea justo donde hace falta. */}
          {plural(
            shownMissing,
            "One item has no price yet, and is not in that total.",
            "{n} items have no price yet, and are not in that total.",
          )}
        </div>
      )}
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
            /* `--line` no existe: no está definida en ninguna hoja de la app, y
               los otros sesenta y pico sitios usan `--border`. El buscador
               llevaba desde el primer día sin caja visible, y la tabla sin
               líneas entre filas, porque el borde se resolvía a nada. */
            border: "1px solid var(--border)",
            background: "transparent",
            color: "inherit",
          }}
        />
        {SORTS.map((s) => (
          <button
            key={s.key}
            /* `chip-on` no existe en la hoja de estilos: el orden elegido nunca
               se veía elegido. La clase buena es `chip-active`. */
            className={sort === s.key ? "chip chip-active" : "chip"}
            onClick={() => setSort(s.key)}
          >
            {s.label}
          </button>
        ))}
        {/* Al final de la fila y separado: no filtra ni ordena nada, solo cambia
            la forma de lo mismo. */}
        <div className="segmented" style={{ marginLeft: "auto" }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={view === v.key ? "seg seg-active" : "seg"}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "grid" ? <ItemsGrid rows={shown} net={net} /> : <ItemsTable rows={shown} net={net} />}
      {!shown.length && (
        <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>{tr("Nothing matches that.")}</p>
      )}
    </div>
  );
}


/** La rejilla: la imagen manda y la cifra la acompaña.
 *
 *  Es la vista por defecto porque es la que cabe. Los 608 objetos en la tabla
 *  son 25.118 px de scroll y en rejilla 11.625, menos de la mitad, medido a
 *  1.280 px de ancho. Y de una fila de tabla lo único que se distingue de un
 *  vistazo es el nombre; en rejilla se reconoce el dibujo, que es como uno
 *  tiene guardado su inventario en la cabeza.
 *
 *  De las cinco cifras de la tabla aquí solo salen dos: cuántos tienes y cuánto
 *  suman. Las otras tres —unitario, mínimo, coste— son para comparar, y para
 *  comparar está la lista; apretarlas en la tarjeta la volvería ilegible sin
 *  hacerla más útil. */
function ItemsGrid({ rows, net }: { rows: InventoryRow[]; net: boolean }) {
  return (
    <div
      className="grid"
      style={{
        gap: 8,
        /* `auto-fill` y no `auto-fit`: con cuatro objetos sueltos —un filtro que
           casi no deja nada— `auto-fit` estira cada tarjeta hasta un cuarto de
           pantalla y un cromo de 96 px acaba pixelado dentro de una caja
           gigante. Con `auto-fill` las tarjetas conservan su tamaño y la fila se
           queda a medias, que es lo que uno espera de una rejilla.
           Y 96 y no 148, que es donde empezó esto: con 148 entraban CINCO
           tarjetas por fila y la rejilla ocupaba MÁS que la tabla —26.810 px
           contra 24.508 con los 608 objetos—, porque cinco tarjetas altas
           gastan más alto que cinco filas de 40 px. Con 96 entran siete y el
           total baja a 11.625. Una rejilla que no cabe mejor que una tabla no
           es una rejilla, es una tabla con fotos. */
        gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
      }}
    >
      {rows.map((r) => (
        <div
          key={`${r.appid}:${r.marketHashName}`}
          className="surface-2"
          style={{
            borderRadius: "var(--r)",
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            minWidth: 0,
          }}
        >
          {/* Alto fijo y `contain`: los iconos de Steam no comparten proporción
              —una pegatina es cuadrada y un arma es 1,4 veces más ancha que
              alta— y sin la caja las tarjetas de la misma fila acaban con la
              cifra a distinta altura, que es lo que hace que una rejilla se lea
              como un montón desordenado. */}
          <div
            style={{
              height: 42,
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
            }}
          >
            {/* 96 y no 128: la caja mide 42 px de alto, así que 96 ya sobra
                para una pantalla al doble de densidad, y aquí no se piden uno
                ni dos iconos sino los seiscientos y pico del inventario. */}
            {iconUrl(r.iconUrl, 96) ? (
              <img
                src={iconUrl(r.iconUrl, 96)!}
                alt=""
                loading="lazy"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            ) : (
              <div className="mute" style={{ fontSize: 11 }}>
                {tr("no image")}
              </div>
            )}
          </div>
          {/* Dos líneas y a partir de ahí puntos suspensivos. Los nombres de
              Steam llegan a los sesenta caracteres —"Sticker | Renegades |
              Berlin 2019"— y dejarlos crecer descuadra la fila entera; el
              nombre completo se lee en el title, y entero está en la lista. */}
          <div
            title={r.marketHashName}
            style={{
              fontSize: 11,
              lineHeight: 1.28,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              minHeight: "2.6em",
            }}
          >
            {r.marketHashName}
          </div>
          <div
            className="flex items-center"
            style={{ justifyContent: "space-between", gap: 6, fontSize: 11.5 }}
          >
            <span className="mute">×{r.quantity}</span>
            <span style={{ fontWeight: 700 }}>
              {r.medianCents === null
                ? "—"
                : euros(net ? netLineCents(r.medianCents, r.quantity) : r.valueCents)}
            </span>
          </div>
          {/* Las mismas dos advertencias que la tabla. Un objeto bloqueado vale
              lo que dice pero no se puede vender hoy, y un precio sin confirmar
              es de fiar a medias: si la rejilla se las callara, sería una vista
              más bonita que miente. */}
          {(!r.marketable || r.provisional) && (
            <div
              className="mute"
              style={{
                fontSize: 10.5,
                lineHeight: 1.25,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {!r.marketable && tr("locked")}
              {!r.marketable && r.provisional && " · "}
              {r.provisional && tr("price not confirmed yet")}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** La tabla de siempre: seis columnas y una fila por objeto.
 *
 *  Sigue aquí porque la rejilla no la sustituye, la acompaña. La rejilla enseña
 *  QUÉ tienes —la imagen es lo que reconoces— y la tabla enseña CUÁNTO, que es
 *  lo que se compara: precio unitario, coste y total, uno debajo de otro. Meter
 *  esas cinco cifras en cada tarjeta la convertiría en una fila de tabla con
 *  bordes redondeados. */
function ItemsTable({ rows, net }: { rows: InventoryRow[]; net: boolean }) {
  return (
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
            {rows.map((r) => (
              <tr key={`${r.appid}:${r.marketHashName}`} style={{ borderTop: "1px solid var(--border)" }}>
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
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  {euros(net ? netOrNull(r.medianCents) : r.medianCents)}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }} className="mute">
                  {euros(net ? netOrNull(r.lowestCents) : r.lowestCents)}
                </td>
                {/* Lo que pagaste no lleva comisión: es dinero que ya salió, y
                    descontarle un 15 % sería inventarse una compra más barata. */}
                <td style={{ padding: "6px 8px", textAlign: "right" }} className="mute">
                  {euros(r.costCents)}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>
                  {r.medianCents === null
                    ? "—"
                    : euros(net ? netLineCents(r.medianCents, r.quantity) : r.valueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      {/* `btn-accent`: `btn-primary` no existe en la hoja de estilos, así que
          el botón que cierra el estreno de esta pantalla se pintaba sin fondo
          ni borde, como si no fuera un botón. */}
      <button className="btn btn-accent" onClick={onPick} disabled={uploading}>
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
    /* A lo ancho: la fecha a la izquierda y los dos botones a la derecha, que a
       1.280 es una línea en vez de tres. Y con variantes de verdad — los dos
       eran `.btn` a secas, o sea sin fondo ni borde, y el que abre el fichero
       es la acción principal de este pie. */
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="mute" style={{ fontSize: 12.5 }}>
          {collectedAt
            ? tv("Your items as of {when}. Prices refresh on their own every day.", {
                when: new Date(collectedAt).toLocaleString(dateLocale()),
              })
            : tr("Prices refresh on their own every day.")}
        </div>
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-accent" onClick={onPick} disabled={uploading}>
            {uploading ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
            {tr("Upload a new dump")}
          </button>
          <button className="btn btn-outline" onClick={() => setOpen((v) => !v)}>
            <Clipboard size={15} />
            {open ? tr("Hide the collector") : tr("Show the collector")}
          </button>
        </div>
      </div>
      {open && <CollectorSteps onCopy={onCopy} copied={copied} />}
    </div>
  );
}

function UploadReceipt({ summary }: { summary: IngestSummary }) {
  const lines = [
    summary.holdings ? plural(summary.holdings, "one item", "{n} items") : null,
    summary.ledger ? plural(summary.ledger, "one market row", "{n} market rows") : null,
    summary.history ? plural(summary.history, "one price point", "{n} price points") : null,
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
          {plural(
            summary.undated,
            "One row had a date Steam wrote in a way we couldn't read, and was left out rather than dated wrong.",
            "{n} rows had a date Steam wrote in a way we couldn't read, and were left out rather than dated wrong.",
          )}
        </p>
      ) : null}
    </div>
  );
}
