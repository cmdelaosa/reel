import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Gamepad2,
  Link2Off,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  useApplyNintendoImport,
  useLinkNintendo,
  useNintendoImport,
  useNintendoLink,
  useRefreshNintendo,
  useScanNintendo,
  useUnlinkNintendo,
  type NintendoItem,
} from "@/lib/nintendo";
import type { ApplyPick, ImportState } from "@/lib/steam";
import { suggestedByDefault } from "@/domain/nintendoNames";
import { formatPlaytime } from "@/domain/gameStatus";
import { RatingStars } from "@/ui/RatingStars";
import { posterBg } from "@/ui/posterBg";
import { t as tr, tv } from "@/lib/i18n";

/* Nintendo — la otra pestaña de importar del modo Juegos. Enlazar, ver qué va a
   entrar, confirmar; y una cuarta cosa que Steam no tiene: actualizar las horas
   de lo que ya está dentro.

   ── Por qué esta pantalla es más corta que la de Steam ───────────────────
   Porque las listas no se parecen. Una cuenta de Steam son cientos de juegos y
   por eso allí hay montones, barra de tandas y una rejilla que ocupa el ancho
   entero: trescientos juegos no se deciden de uno en uno. El registro de
   Nintendo son dos docenas —lo tope Nintendo, no nosotros— y para veinte filas
   toda esa maquinaria es andamio alrededor de algo que se lee de una sentada.

   Lo que sí se conserva es lo que decide algo: la casilla por juego, el estado,
   la nota y la fila en conflicto con las dos cifras.

   ── Lo que no está, y no es un olvido ────────────────────────────────────
   No hay "terminado". Nintendo no dice cuándo jugaste por última vez, así que
   fecharlo sería ponerle a todo el día de hoy y publicarle a tus amigos que te
   acabaste seis juegos esta tarde (ver 0080). Se marca desde la ficha, donde la
   fecha la eliges tú.

   ── Y por qué el código de amigo se escribe en un campo ──────────────────
   Porque no hay login de Nintendo. Reel pregunta con una cuenta suya, y lo
   único que aporta cada persona es su código — que es público — más la
   privacidad de su registro de juego en "Todos". Eso segundo se dice ANTES de
   escribir el código y otra vez si Nintendo contesta que no: es lo que separa
   "arréglalo en la consola" de "esto no funciona". */

const hours = (minutes: number) => (minutes > 0 ? formatPlaytime(minutes) : "—");

/** Lo que se puede decir de un juego aquí: los cuatro `play_state` y ya. Sin
 *  "Lo tengo" —todo lo que sale lo tienes— y sin "Terminado", ver la cabecera. */
const STATES: { key: ImportState; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "playing", label: "Playing" },
  { key: "ongoing", label: "Ongoing" },
  { key: "dropped", label: "Dropped" },
];

export default function NintendoPage() {
  const { data: link, isPending: linkPending } = useNintendoLink();
  const { data: draft } = useNintendoImport();
  const linkAccount = useLinkNintendo();
  const unlink = useUnlinkNintendo();
  const scan = useScanNintendo();
  const apply = useApplyNintendoImport();
  const refresh = useRefreshNintendo();

  const run = draft?.run ?? null;
  const items = useMemo(() => draft?.items ?? [], [draft]);
  const busy = run?.state === "scanning" || run?.state === "applying" || scan.isPending;

  const summary = (run?.summary ?? {}) as Record<string, unknown>;
  const num = (k: string) => Number(summary[k] ?? 0);

  return (
    <div
      className="screen mq-page"
      style={{
        maxWidth: run?.state === "ready" && items.length > 0 ? "none" : 760,
        marginInline: "auto",
      }}
    >
      <h1 className="sr-only">{tr("Nintendo")}</h1>

      {/* ── Paso 1: el código de amigo ───────────────────────────────────── */}
      <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="eyebrow">{tr("Nintendo Switch")}</div>
        {linkPending ? (
          <div className="skeleton" style={{ height: 44, borderRadius: "var(--r-md)" }} />
        ) : link?.friendCode ? (
          <Connected
            friendCode={link.friendCode}
            busy={busy}
            scanned={Boolean(run)}
            refreshing={refresh.isPending}
            refreshed={refresh.data ?? null}
            onScan={() => scan.mutate()}
            onRefresh={() => refresh.mutate()}
            onUnlink={() => unlink.mutate()}
            unlinking={unlink.isPending}
          />
        ) : (
          <LinkForm
            pending={linkAccount.isPending}
            status={linkAccount.data?.status ?? null}
            onSubmit={(code) => linkAccount.mutate(code)}
          />
        )}
      </div>

      {/* ── El registro cerrado y los demás errores del escaneo ──────────── */}
      {run?.state === "error" && (
        <div className="card" style={{ padding: 20, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={20} style={{ color: "#e5484d", flex: "0 0 auto" }} />
          <div style={{ fontSize: 13.5 }}>
            {run.error === "private" ? (
              <>
                <div style={{ fontWeight: 750, marginBottom: 4 }}>
                  {tr("Nintendo won't show your play record")}
                </div>
                <p className="dim" style={{ margin: 0 }}>
                  {tr("On your Switch: System Settings → User → your account → Play Activity Settings, and set it to \"All Players\". Then look again.")}
                </p>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 750, marginBottom: 4 }}>
                  {tr("Couldn't read your play record")}
                </div>
                <p className="dim" style={{ margin: 0 }}>{tr("Nintendo didn't answer. Try again in a moment.")}</p>
              </>
            )}
          </div>
        </div>
      )}

      {run?.state === "scanning" && (
        <div className="card" style={{ padding: 20 }}>
          <div className="flex items-center gap-2.5">
            <Loader2 size={20} className="spin" style={{ color: "var(--accent)" }} />
            <div style={{ fontWeight: 750 }}>{tr("Asking Nintendo for your play record…")}</div>
          </div>
        </div>
      )}

      {/* ── Paso 2: qué va a entrar ──────────────────────────────────────── */}
      {run?.state === "ready" && items.length > 0 && (
        /* `key` con el id del intento: la lista es un componente nuevo por cada
           escaneo, así que lo marcado se siembra una vez en el useState y no
           hay que reconciliarlo con un efecto después. */
        <ReviewList
          key={run.id}
          items={items}
          pending={apply.isPending}
          onApply={(picks) => apply.mutate({ importId: run.id, items: picks })}
        />
      )}

      {run?.state === "ready" && items.length === 0 && (
        <div className="card" style={{ padding: "28px 24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {tr("Your play record came back empty. Nintendo only lists what you've played recently — play something and look again.")}
          </p>
        </div>
      )}

      {/* ── Paso 3: el recibo ────────────────────────────────────────────── */}
      {(run?.state === "applying" || run?.state === "done") && (
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="flex items-center gap-2.5">
            {run.state === "applying"
              ? <Loader2 size={20} className="spin" style={{ color: "var(--accent)" }} />
              : <CheckCircle2 size={20} style={{ color: "var(--accent)" }} />}
            <div style={{ fontWeight: 750 }}>
              {run.state === "applying" ? tr("Adding the rest…") : tr("Imported")}
            </div>
          </div>
          <p className="dim" style={{ margin: 0, fontSize: 13.5 }}>
            {tv("{n} games in your library", { n: String(num("applied") + num("resolved")) })}
            {num("rated") > 0 && ` · ${tv("{n} rated", { n: String(num("rated")) })}`}
          </p>
          {/* Lo que no entró, contado. Enseñar "importados 20" habiendo entrado
              13 es mentir en la única pantalla que se va a mirar. */}
          {typeof summary.note === "string" && summary.note && (
            <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>{summary.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Enlazar ────────────────────────────────────────────────────────────── */

function LinkForm({
  pending, status, onSubmit,
}: {
  pending: boolean;
  status: "linked" | "invalid" | "not_found" | "taken" | "error" | null;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState("");

  /* Los tres "no" que Nintendo puede dar, cada uno con su arreglo. El que más
     importa es `not_found`: el formato está bien y el código no existe, o sea
     un dígito mal — decir "ha fallado" ahí manda a alguien a mirar su consola
     cuando lo que tiene que mirar es lo que acaba de escribir. */
  const problem = status === "invalid"
    ? tr("That's not a friend code. It's twelve digits, like SW-1234-5678-9012.")
    : status === "not_found"
    ? tr("Nintendo doesn't know that friend code. Check the digits on your Switch.")
    : status === "taken"
    ? tr("That Nintendo account is already connected to another Reel account.")
    : status === "error"
    ? tr("Couldn't save it. Try again in a moment.")
    : null;

  return (
    <>
      <p className="dim" style={{ margin: 0, fontSize: 14 }}>
        {tr("Type your Switch friend code and Reel will bring in the games you've played and the hours on each. There's nothing to sign in to.")}
      </p>
      <form
        className="flex items-center gap-2 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onSubmit(code);
        }}
      >
        <input
          className="input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="SW-0000-0000-0000"
          aria-label={tr("Friend code")}
          autoComplete="off"
          spellCheck={false}
          style={{ maxWidth: 220, fontVariantNumeric: "tabular-nums" }}
        />
        <button className="btn btn-primary" type="submit" disabled={pending || !code.trim()}>
          {pending ? <Loader2 size={16} className="spin" /> : <Gamepad2 size={16} />}
          {tr("Connect")}
        </button>
      </form>
      {problem && (
        <p role="status" style={{ margin: 0, fontSize: 13, color: "#e5484d" }}>{problem}</p>
      )}
      {/* Se dice ANTES, no después de que la lista vuelva vacía: es lo único
          que hay que tocar en la consola y no se adivina. */}
      <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
        {tr("On your Switch, your play activity has to be visible to \"All Players\" — otherwise Nintendo won't show your record to anyone but you.")}
      </p>
    </>
  );
}

function Connected({
  friendCode, busy, scanned, refreshing, refreshed, onScan, onRefresh, onUnlink, unlinking,
}: {
  friendCode: string;
  busy: boolean;
  scanned: boolean;
  refreshing: boolean;
  refreshed: { updated: number; seen: number } | null;
  onScan: () => void;
  onRefresh: () => void;
  onUnlink: () => void;
  unlinking: boolean;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 size={20} style={{ color: "var(--accent)" }} />
          <div>
            <div style={{ fontWeight: 750 }}>{tr("Connected")}</div>
            <div className="mute" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
              {friendCode}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Las dos acciones son distintas y por eso son dos botones:
              actualizar toca solo las horas de lo que ya sigues y no pregunta
              nada; buscar juegos abre la pantalla de confirmar. Un solo botón
              "sincronizar" obligaría a pasar por la lista para cambiar veinte
              minutos de Mario Kart. */}
          <button className="btn" onClick={onRefresh} disabled={refreshing || busy}>
            {refreshing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            {tr("Update my hours")}
          </button>
          <button className="btn" onClick={onScan} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            {scanned ? tr("Look again") : tr("Look at my play record")}
          </button>
          {/* Desenlazar no deshace lo importado: son tus horas y tu biblioteca. */}
          <button className="btn btn-ghost" onClick={onUnlink} disabled={unlinking}>
            <Link2Off size={16} />
            {tr("Disconnect")}
          </button>
        </div>
      </div>
      {/* "0 actualizados" es una respuesta correcta y hay que poder darla sin
          que parezca que ha fallado algo. */}
      {refreshed && (
        <p role="status" className="mute" style={{ margin: 0, fontSize: 12.5 }}>
          {refreshed.updated > 0
            ? tv("{n} games updated", { n: String(refreshed.updated) })
            : tr("Nothing new — your hours were already up to date.")}
        </p>
      )}
    </>
  );
}

/* ── La lista ───────────────────────────────────────────────────────────── */

interface Choice {
  on: boolean;
  state: ImportState | null;
  rating: number;
  overwrite: boolean;
}

function ReviewList({
  items, pending, onApply,
}: {
  items: NintendoItem[];
  pending: boolean;
  onApply: (picks: ApplyPick[]) => void;
}) {
  /* Lo que viene marcado: lo que ya sigues y los juegos de verdad; las apps de
     Nintendo Switch Online y las demos no. Ver domain/nintendoNames.ts — se
     enseñan igual, solo que sin marcar. */
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      items.map((i) => [i.id, {
        on: suggestedByDefault(i),
        state: null,
        rating: 0,
        overwrite: false,
      }]),
    )
  );

  const set = (id: string, patch: Partial<Choice>) =>
    setChoices((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const chosen = items.filter((i) => choices[i.id]?.on);

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <p className="dim" style={{ margin: 0, fontSize: 13.5 }}>
          {tv("{n} of {total} selected", { n: String(chosen.length), total: String(items.length) })}
        </p>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-ghost"
            onClick={() =>
              setChoices((prev) =>
                Object.fromEntries(
                  Object.entries(prev).map(([id, c]) => [id, { ...c, on: chosen.length !== items.length }]),
                )
              )}
          >
            {chosen.length === items.length ? tr("Select none") : tr("Select all")}
          </button>
          <button
            className="btn btn-primary"
            disabled={pending || chosen.length === 0}
            onClick={() =>
              onApply(chosen.map((i) => ({
                id: i.id,
                overwrite: choices[i.id].overwrite,
                state: choices[i.id].state,
                rating: choices[i.id].rating || null,
              })))}
          >
            {pending ? <Loader2 size={16} className="spin" /> : null}
            {tv("Import {n}", { n: String(chosen.length) })}
          </button>
        </div>
      </div>

      <div className="st-cards">
        {items.map((item) => (
          <GameRow
            key={item.id}
            item={item}
            choice={choices[item.id]}
            onChange={(patch) => set(item.id, patch)}
          />
        ))}
      </div>
    </>
  );
}

function GameRow({
  item, choice, onChange,
}: {
  item: NintendoItem;
  choice: Choice;
  onChange: (patch: Partial<Choice>) => void;
}) {
  const [noArt, setNoArt] = useState(!item.image_uri);
  const conflict = item.manual_minutes !== null;

  return (
    <article className={`card st-card ${choice.on ? "" : "off"}`}>
      <div className="st-cover" style={{ background: posterBg(item.name) }}>
        {/* La carátula la manda Nintendo con cada juego: no hay plantilla que
            armar desde un id, como sí ocurre con el appid de Steam. */}
        {!noArt && item.image_uri && (
          <img src={item.image_uri} alt="" loading="lazy" onError={() => setNoArt(true)} />
        )}
        {noArt && <span className="st-cover-name">{item.name}</span>}
        <input
          type="checkbox"
          className="st-tick"
          checked={choice.on}
          onChange={() => onChange({ on: !choice.on })}
          aria-label={tv("Import {name}", { name: item.name })}
        />
      </div>

      <div className="st-card-body">
        <div className="flex items-start gap-3">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 16, fontWeight: 750, letterSpacing: "-0.01em", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.name}
            </h3>
            <div className="mute" style={{ fontSize: 12.5, marginTop: 3 }}>
              {item.in_library
                ? <span style={{ color: "var(--accent)", fontWeight: 650 }}>{tr("in Reel")}</span>
                /* Un juego que el catálogo no conoce por su nombre se resuelve
                   al confirmar, y puede no resolverse. Decirlo antes evita que
                   el recibo parezca que ha perdido cosas. */
                : item.title_id
                ? tr("new to your library")
                : tr("we'll look this one up")}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1" style={{ marginLeft: "auto", flex: "0 0 auto" }}>
            <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {hours(item.minutes)}
            </span>
            {/* La fila que decide algo: las dos cifras a la vista y su casilla.
                Sin marcar gana la tuya. */}
            {conflict && (
              <>
                <button
                  className={`chip chip-sm ${choice.overwrite ? "chip-active" : ""}`}
                  style={{ height: 26 }}
                  aria-pressed={choice.overwrite}
                  onClick={() => onChange({ overwrite: !choice.overwrite })}
                >
                  {tv("use Nintendo's {hours}", { hours: hours(item.minutes) })}
                </button>
                <span className="mute" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                  {tv("you typed {hours}", { hours: hours(item.manual_minutes ?? 0) })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: "auto" }}>
          {STATES.map((s) => (
            <button
              key={s.key}
              className={`chip chip-sm ${choice.state === s.key ? "chip-active" : ""}`}
              aria-pressed={choice.state === s.key}
              onClick={() => onChange({ state: choice.state === s.key ? null : s.key })}
            >
              {tr(s.label)}
            </button>
          ))}
          <span className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
            <RatingStars value={choice.rating} onRate={(score) => onChange({ rating: score })} />
          </span>
        </div>
      </div>
    </article>
  );
}
