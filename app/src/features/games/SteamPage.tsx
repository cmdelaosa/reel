import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertTriangle, CheckCircle2, Link2, Link2Off, Loader2, RefreshCw } from "lucide-react";
import {
  startSteamLogin,
  useApplySteamImport,
  useScanSteam,
  useSteamImport,
  useSteamLink,
  useUnlinkSteam,
  type SteamItem,
} from "@/lib/steam";
import { formatPlaytime } from "@/domain/gameStatus";
import { t as tr, tv } from "@/lib/i18n";

/* Steam — la pestaña del modo Juegos donde conectas la cuenta, ves qué va a
   entrar y lo confirmas. Tres pasos y en ese orden, porque cada uno solo tiene
   sentido con el anterior hecho.

   ── Por qué hay una pantalla de confirmar y no un botón de "sincronizar" ──
   Una cuenta de Steam tiene cientos de juegos, y muchos son una demo que
   abriste una vez en 2014. Volcarlos todos convierte tu biblioteca en el
   catálogo de Steam, que no es lo que nadie quiere ver al abrir Reel. Así que
   la lista viene con marcado lo que YA sigues aquí —lo que ya dijiste que te
   importa— y el resto lo marcas tú.

   Eso además ahorra la parte cara: el nombre y las horas los da Steam, así que
   pintar los trescientos no cuesta ni una petición a IGDB. Solo lo que marques
   Y que el catálogo no conozca se resuelve contra IGDB, en segundo plano y por
   lotes (ver supabase/functions/steam-sync).

   ── Las horas son DE POR VIDA ────────────────────────────────────────────
   `playtime_forever` cuenta desde que abriste la cuenta. De ahí las dos reglas
   que esta pantalla hace visibles: lo importado no toca "en qué punto estás"
   —entra como "lo tengo", que es lo único que las horas de por vida
   demuestran— y una cifra que escribiste a mano no se pisa sola. Las filas en
   conflicto se destacan con las dos cifras y su propia casilla. */

/** Lo que la vuelta de Steam deja en la URL. Traducido aquí y no en la función
 *  porque es lo que lee una persona, no un programa. */
const RETURN_MESSAGE: Record<string, { text: string; bad: boolean }> = {
  linked: { text: "Steam account connected.", bad: false },
  cancelled: { text: "You cancelled the Steam sign-in.", bad: true },
  expired: { text: "That sign-in attempt expired. Try again.", bad: true },
  taken: { text: "That Steam account is already connected to another Reel account.", bad: true },
  invalid: { text: "Steam couldn't confirm that sign-in. Try again.", bad: true },
  error: { text: "Couldn't save the Steam account. Try again.", bad: true },
};

const hours = (minutes: number) => (minutes > 0 ? formatPlaytime(minutes) : "—");

export default function SteamPage() {
  const [params, setParams] = useSearchParams();
  const { data: link, isPending: linkPending } = useSteamLink();
  const { data: draft } = useSteamImport();
  const scan = useScanSteam();
  const apply = useApplySteamImport();
  const unlink = useUnlinkSteam();

  const run = draft?.run ?? null;
  const items = useMemo(() => draft?.items ?? [], [draft]);

  const returned = params.get("steam");
  const message = returned ? RETURN_MESSAGE[returned] : undefined;
  const dismiss = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("steam");
        return next;
      },
      { replace: true },
    );

  const busy = run?.state === "scanning" || run?.state === "applying" || scan.isPending;
  const summary = (run?.summary ?? {}) as Record<string, unknown>;
  const num = (k: string) => Number(summary[k] ?? 0);

  return (
    <div className="screen mq-page" style={{ maxWidth: 760, marginInline: "auto" }}>
      <h1 className="sr-only">{tr("Steam")}</h1>

      {message && (
        <p
          role="status"
          className="card"
          style={{
            padding: "12px 16px", margin: 0, fontSize: 13.5,
            color: message.bad ? "#e5484d" : "var(--text)",
          }}
          onClick={dismiss}
        >
          {tr(message.text)}
        </p>
      )}

      {/* ── Paso 1: la cuenta ────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="eyebrow">{tr("Steam account")}</div>
        {linkPending ? (
          <div className="skeleton" style={{ height: 44, borderRadius: "var(--r-md)" }} />
        ) : link?.steamId ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 size={20} style={{ color: "var(--accent)" }} />
              <div>
                <div style={{ fontWeight: 750 }}>{tr("Connected")}</div>
                <div className="mute" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                  {link.steamId}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="btn"
                disabled={busy}
                onClick={() => scan.mutate()}
              >
                {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                {run ? tr("Sync again") : tr("Look at my Steam library")}
              </button>
              {/* Desenlazar no deshace lo importado: son tus horas y tu
                  biblioteca. Deja de poder sincronizar, nada más. */}
              <button className="btn btn-ghost" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
                <Link2Off size={16} />
                {tr("Disconnect")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="dim" style={{ margin: 0, fontSize: 14 }}>
              {tr("Connect your Steam account to bring in the hours you've already played. Reel only reads your games list — it never posts anything.")}
            </p>
            <div>
              <button className="btn btn-primary" onClick={() => void startSteamLogin()}>
                <Link2 size={16} />
                {tr("Connect Steam")}
              </button>
            </div>
            {/* El perfil privado devuelve una lista vacía SIN error, así que
                más vale decirlo antes que después de que parezca que la cuenta
                no tiene juegos. */}
            <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
              {tr("Your Steam profile's game details have to be public, or Steam sends back an empty list.")}
            </p>
          </>
        )}
      </div>

      {/* ── El perfil cerrado y los demás errores del escaneo ─────────────── */}
      {run?.state === "error" && (
        <div className="card" style={{ padding: 20, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <AlertTriangle size={20} style={{ color: "#e5484d", flex: "0 0 auto" }} />
          <div style={{ fontSize: 13.5 }}>
            {run.error === "private" ? (
              <>
                <div style={{ fontWeight: 750, marginBottom: 4 }}>{tr("Steam sent back an empty list")}</div>
                <p className="dim" style={{ margin: 0 }}>
                  {tr("That's what a private profile looks like — Steam answers with no games and no error. In Steam: Profile → Edit profile → Privacy Settings, and set \"Game details\" to Public. Then sync again.")}
                </p>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 750, marginBottom: 4 }}>{tr("Couldn't read your Steam library")}</div>
                <p className="dim" style={{ margin: 0 }}>{tr("Steam didn't answer. Try again in a moment.")}</p>
              </>
            )}
          </div>
        </div>
      )}

      {run?.state === "scanning" && (
        <div className="card" style={{ padding: 20 }}>
          <div className="flex items-center gap-2.5">
            <Loader2 size={20} className="spin" style={{ color: "var(--accent)" }} />
            <div style={{ fontWeight: 750 }}>{tr("Asking Steam for your games…")}</div>
          </div>
        </div>
      )}

      {/* ── Paso 2: qué va a entrar ──────────────────────────────────────── */}
      {run?.state === "ready" && items.length > 0 && (
        /* `key` con el id del intento, y es lo que hace que lo marcado se
           siembre solo: la lista es un componente nuevo por cada escaneo, así
           que su estado inicial se calcula una vez en el useState y no hay que
           reconciliarlo con un efecto después. */
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
            {tr("Your Steam library came back empty, and the profile is public — so there's nothing to import.")}
          </p>
        </div>
      )}

      {/* ── Paso 3: el recibo ────────────────────────────────────────────── */}
      {(run?.state === "applying" || run?.state === "done") && (
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="flex items-center gap-2.5">
            {run.state === "applying"
              ? <Loader2 size={20} className="spin" style={{ color: "var(--accent)" }} />
              : <CheckCircle2 size={20} style={{ color: "var(--accent)" }} />}
            <div style={{ fontWeight: 750 }}>
              {run.state === "applying"
                ? tv("Looking up {n} games IGDB didn't have yet…", { n: num("pending") })
                : tr("Import complete")}
            </div>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
            {[
              { label: tr("Added or updated"), value: num("applied") + num("resolved") },
              { label: tr("Conflicts kept as yours"), value: num("conflicts") },
            ].map((s) => (
              <div key={s.label} className="surface-2" style={{ borderRadius: "var(--r)", padding: 14 }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{s.value}</div>
                <div className="mute" style={{ fontSize: 12 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {/* Demos, herramientas y juegos retirados: IGDB no los tiene fichados
              por su appid de Steam. Se dice, porque "importados 40" habiendo
              entrado 38 es mentir en la única pantalla que se mira. */}
          {typeof summary.note === "string" && summary.note && (
            <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>{summary.note}</p>
          )}
          <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
            {tr("Imported games arrive marked as owned, with no play state: Steam's hours are lifetime totals and say nothing about what you're playing now.")}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── La lista ──────────────────────────────────────────────────────────── */

/** Lo marcado es estado de ESTA lista y no se guarda: la pantalla se rellena
 *  una vez y se confirma una vez, y una casilla persistida sería una casilla
 *  que hay que sincronizar. La semilla —lo que ya sigues en Reel— se calcula en
 *  el estado inicial, que es lo que el `key` del padre deja hacer bien. */
function ReviewList({
  items, onApply, pending,
}: {
  items: SteamItem[];
  onApply: (picks: { id: string; overwrite: boolean }[]) => void;
  pending: boolean;
}) {
  const [chosen, setChosen] = useState(
    () => new Set(items.filter((i) => i.in_library).map((i) => i.id)),
  );
  const [overwrite, setOverwrite] = useState(() => new Set<string>());

  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const onToggle = (id: string) => setChosen((prev) => flip(prev, id));
  const onToggleOverwrite = (id: string) => setOverwrite((prev) => flip(prev, id));
  const onAll = (on: boolean) => setChosen(on ? new Set(items.map((i) => i.id)) : new Set());
  const onlyMine = () => setChosen(new Set(items.filter((i) => i.in_library).map((i) => i.id)));

  const conflicts = items.filter((i) => i.manual_minutes !== null && chosen.has(i.id));

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">{tr("What's coming in")}</div>
          <div className="mute" style={{ fontSize: 12.5 }}>
            {tv("{n} of {total} selected", { n: chosen.size, total: items.length })}
          </div>
        </div>
        <div className="segmented">
          <div className="seg" onClick={onlyMine}>{tr("Only what I follow")}</div>
          <div className="seg" onClick={() => onAll(true)}>{tr("All")}</div>
          <div className="seg" onClick={() => onAll(false)}>{tr("None")}</div>
        </div>
      </div>

      {conflicts.length > 0 && (
        <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
          {tv("{n} games have hours you typed yourself. They're kept as they are unless you tick \"use Steam's\".", { n: conflicts.length })}
        </p>
      )}

      <div
        style={{
          maxHeight: "52vh", overflowY: "auto", display: "flex", flexDirection: "column",
          gap: 2, marginInline: -6,
        }}
      >
        {items.map((i) => {
          const on = chosen.has(i.id);
          const conflict = i.manual_minutes !== null;
          return (
            <label
              key={i.id}
              className="surface-2"
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                borderRadius: "var(--r)", cursor: "pointer",
                opacity: on ? 1 : 0.55,
              }}
            >
              <input type="checkbox" checked={on} onChange={() => onToggle(i.id)} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {i.steam_name}
                {i.in_library && (
                  <span className="badge" style={{ marginLeft: 8 }}>{tr("In your library")}</span>
                )}
              </span>

              {conflict ? (
                /* La fila que decide algo: las dos cifras a la vista y su
                   propia casilla. Sin marcar, gana la tuya — que es el trato
                   que minutes_source (0073) existe para poder cumplir. */
                <span className="flex items-center gap-2" style={{ fontSize: 12.5 }}>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {tv("you: {yours} · Steam: {theirs}", {
                      yours: hours(i.manual_minutes ?? 0),
                      theirs: hours(i.minutes),
                    })}
                  </span>
                  <span
                    className={`chip ${overwrite.has(i.id) ? "chip-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); onToggleOverwrite(i.id); }}
                  >
                    {tr("use Steam's")}
                  </span>
                </span>
              ) : (
                <span className="mute" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                  {hours(i.minutes)}
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          className="btn btn-primary"
          disabled={!chosen.size || pending}
          onClick={() => onApply([...chosen].map((id) => ({ id, overwrite: overwrite.has(id) })))}
        >
          {pending && <Loader2 size={16} className="spin" />}
          {tv("Import {n} games", { n: chosen.size })}
        </button>
      </div>
    </div>
  );
}
