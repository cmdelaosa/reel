import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { AlertTriangle, CheckCircle2, Clock, Link2, Link2Off, Loader2, RefreshCw } from "lucide-react";
import { SteamIcon } from "@/ui/icons/SteamIcon";
import {
  startSteamLogin,
  useApplySteamImport,
  useConfirmSteamLink,
  useScanSteam,
  useSteamImport,
  useSteamLink,
  useUnlinkSteam,
  type ApplyPick,
  type ImportState,
  type MatchedTitle,
  type SteamItem,
} from "@/lib/steam";
import { byName, otherEdition, type MyGame } from "@/domain/steamMatch";
import { SteamInventory } from "@/features/games/SteamInventory";
import { formatPlaytime, type GameStatus } from "@/domain/gameStatus";
import { useGameLibrary } from "@/lib/library";
import { RatingStars } from "@/ui/RatingStars";
import { posterBg } from "@/ui/posterBg";
import { dateLocale } from "@/lib/locale";
import { t as tr, tv } from "@/lib/i18n";

/* Steam — la pestaña del modo Juegos donde conectas la cuenta, ves qué va a
   entrar y lo confirmas. Tres pasos y en ese orden, porque cada uno solo tiene
   sentido con el anterior hecho.

   ── Por qué hay una pantalla de confirmar y no un botón de "sincronizar" ──
   Una cuenta de Steam tiene cientos de juegos, y muchos son una demo que
   abriste una vez en 2014. Volcarlos todos convierte tu biblioteca en el
   catálogo de Steam, que no es lo que nadie quiere ver al abrir Reel. Así que
   la lista llega SIN NADA marcado y lo que entra lo eliges tú, montón a montón,
   con las tres pastillas de marcar. Vino marcado lo que ya seguías aquí hasta
   que se vio en uso lo que eso significa: confirmar sin mirar reimportaba media
   biblioteca, y desmarcar cien juegos para importar tres es más trabajo que
   marcar los tres. Lo que ya está en Reel sigue dicho —el rótulo de la ficha,
   su montón en el raíl y "Solo lo que sigo", que lo marca de una tacada—, pero
   ya no decide por ti.

   Eso además ahorra la parte cara: el nombre y las horas los da Steam, así que
   pintar los trescientos no cuesta ni una petición a IGDB. Solo lo que marques
   Y que el catálogo no conozca se resuelve contra IGDB, en segundo plano y por
   lotes (ver supabase/functions/steam-sync).

   ── Y por qué es una pantalla entera, con carátulas ──────────────────────
   Porque son cientos de juegos y en cada uno hay TRES decisiones: si entra, en
   qué punto estás y qué nota le pones. Una lista de casillas a 760px de ancho
   servía para la primera; para las tres hace falta sitio, y sobre todo hace
   falta la carátula — reconocer un juego por su arte es instantáneo y leer 312
   nombres no lo es.

   De ahí las tres piezas: los MONTONES (lo que ya sigues, lo muy jugado, lo
   que nunca abriste, los conflictos), la barra que aplica estado y nota a todo
   un montón de golpe, y la tarjeta a dos columnas donde se afina lo que se
   salga. Trescientos juegos no se deciden uno a uno; se deciden por tandas.

   ── "Lo tengo" no es una opción, es el suelo ─────────────────────────────
   Todo lo que entra por aquí lo tienes: eso es lo que significa que esté en tu
   biblioteca de Steam. Por eso el selector no lo ofrece — ofrecerlo sería
   preguntar algo cuya respuesta ya sabemos. Sin marcar nada, un juego entra
   como `owned` y sin estado, que es exactamente lo que hacía 0076.

   ── Las horas son DE POR VIDA ────────────────────────────────────────────
   `playtime_forever` cuenta desde que abriste la cuenta. De ahí las dos reglas
   que esta pantalla hace visibles: de las horas no se DEDUCE ningún estado
   —entra como "lo tengo", que es lo único que las horas de por vida demuestran,
   y el estado lo pones tú— y una cifra que escribiste a mano no se pisa sola.
   Las filas en conflicto se destacan con las dos cifras y su propia casilla.

   ── Terminado se fecha con tu última partida ─────────────────────────────
   "Terminado" no es un estado sino el watch_event del episodio sintético
   (0073), o sea historial y muro. Marcar cuarenta juegos escribiría cuarenta
   finales con fecha de HOY, y el muro de tus amigos amanecería diciendo que te
   acabaste Portal 2, Hades y Hollow Knight esta tarde. Así que se fecha con
   `last_played_at` — la última vez que lo jugaste, que Steam da en la misma
   respuesta que las horas (0078). La tarjeta lo dice antes de confirmar. */

/** Lo que la vuelta de Steam deja en la URL. Traducido aquí y no en la función
 *  porque es lo que lee una persona, no un programa. */
const RETURN_MESSAGE: Record<string, { text: string; bad: boolean }> = {
  linked: { text: "Steam account connected.", bad: false },
  cancelled: { text: "You cancelled the Steam sign-in.", bad: true },
  expired: { text: "That sign-in attempt expired. Try again.", bad: true },
  taken: { text: "That Steam account is already connected to another Reel account.", bad: true },
  invalid: { text: "Steam couldn't confirm that sign-in. Try again.", bad: true },
  error: { text: "Couldn't save the Steam account. Try again.", bad: true },
  /* El pagaré era de otra sesión: alguien te pasó un enlace de Steam que
     enlazaba TU cuenta a SU perfil. No se ha escrito nada, y merece decirse
     por su nombre en vez de con un "ha fallado". */
  mismatch: { text: "That sign-in link was started from another account, so nothing was linked.", bad: true },
};

const hours = (minutes: number) => (minutes > 0 ? formatPlaytime(minutes) : "—");

/** Las dos mitades de Steam. Miran cosas distintas —una tus objetos y su dinero,
 *  la otra tus horas y tu biblioteca— y se usan a ritmos distintos: el
 *  inventario a diario, la importación cuando conectas la cuenta y poco más. */
type Section = "inventory" | "import";
/* El inglés en la constante y `tr()` al pintar, que es como lo hace el resto de
   la casa. Traducirlo aquí lo congelaría en el idioma que hubiera cuando se
   cargó el módulo. */
const SECTIONS: { key: Section; label: string }[] = [
  { key: "inventory", label: "Inventory" },
  { key: "import", label: "Import" },
];

export default function SteamPage() {
  const [params, setParams] = useSearchParams();
  const { data: link, isPending: linkPending } = useSteamLink();
  /** Qué mitad de Steam se está mirando. Inventario primero y por defecto: es
   *  lo que se abre a diario; importar es de una vez al año. */
  const [section, setSection] = useState<Section>("inventory");

  const { data: draft } = useSteamImport();
  const scan = useScanSteam();
  const apply = useApplySteamImport();
  const unlink = useUnlinkSteam();

  const run = draft?.run ?? null;
  const items = useMemo(() => draft?.items ?? [], [draft]);
  /* Las notas que ya le pusiste a estos juegos, por título (lib/steam). */
  const rated = useMemo(() => draft?.rated ?? new Map<string, number>(), [draft]);

  /* Y el estado que ya tienen en Reel, por título. Sale de tu biblioteca y no
     de una consulta nueva: `useGameLibrary` es la misma lectura que pinta "Tus
     juegos" —caché compartida, cero peticiones de más— y trae el estado ya
     derivado, o sea con "terminado" incluido, que no es un `play_state` sino el
     watch_event (domain/gameStatus). Cualquier otra forma de traerlo aquí
     habría sido esa derivación escrita por segunda vez. */
  const { data: myGames } = useGameLibrary();
  const knownState = useMemo(
    () => new Map((myGames ?? []).map((g) => [g.title_id, g.status] as const)),
    [myGames],
  );

  /* La ficha del catálogo con la que ha casado cada juego de Steam, y tu
     biblioteca reducida a lo que hace falta para reconocer un mal casado
     (domain/steamMatch). */
  const matched = useMemo(() => draft?.matched ?? new Map<string, MatchedTitle>(), [draft]);
  const mine = useMemo(
    () =>
      byName(
        (myGames ?? []).map((g): MyGame => ({
          titleId: g.title_id,
          name: g.name,
          year: g.first_air_date?.slice(0, 4) ?? null,
          platform: g.played_platform ?? null,
        })),
      ),
    [myGames],
  );

  /* La vuelta de Steam aterriza con ?steam=confirm&n=… y NO con la cuenta ya
     enlazada: escribirla es el segundo paso, y lo dispara esta sesión para que
     sea su JWT —y no el pagaré— quien decida en qué perfil se escribe. El ref
     es contra el doble montaje de StrictMode y contra los renders que traiga
     la propia mutación. */
  const returned = params.get("steam");
  const nonce = params.get("n");
  const confirm = useConfirmSteamLink();
  const claimed = useRef<string | null>(null);
  useEffect(() => {
    if (returned !== "confirm" || !nonce || claimed.current === nonce) return;
    claimed.current = nonce;
    confirm.mutate(nonce, {
      onSettled: (status) =>
        setParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set("steam", status ?? "error");
            next.delete("n");
            return next;
          },
          { replace: true },
        ),
    });
  }, [returned, nonce, confirm, setParams]);

  const message = returned && returned !== "confirm" ? RETURN_MESSAGE[returned] : undefined;
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
    /* Ancho entero, como el resto de la app. La columna de 760 tenía sentido
       cuando esta pantalla eran dos párrafos y cuatro botones; con el
       inventario dentro —608 objetos y su rejilla— lo que hacía era meter en
       cinco columnas lo que en cualquier otra pantalla entra en nueve, y dejar
       medio monitor en blanco a cada lado. */
    /* Y arranca 16px más arriba que el resto de páginas. Sin el h1, la fila de
       la cuenta es lo primero que se lee, y una fila de 40px de alto no pide el
       mismo aire por encima que un título de 34px: con el hueco entero se leía
       como un bloque suelto en medio del blanco. El margen es de esta pantalla
       y no del `--pad` de .mq-main, que lo comparten las nueve. */
    <div className="screen mq-page" style={{ marginTop: -16 }}>

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

      {/* ── Paso 1: la cuenta ─────────────────────────────────────────────

          Conectada, la cuenta es CABECERA y no tarjeta. Una tarjeta de veinte
          píxeles de relleno para decir «conectada» y dos botones era el bloque
          más alto de la pantalla diciendo lo que menos cambia.

          Y la cabecera ya no lleva h1 ni frase. «Steam» estaba dicho tres veces
          en cuatro centímetros —la pestaña encendida del carril, el logotipo de
          la pastilla y el título—, y el subtítulo describía la pantalla a quien
          ya la tenía delante. Lo que queda es lo único que esa franja tiene que
          resolver: en qué mitad estás y qué cuenta es. En una sola fila, porque
          las dos cosas se leen juntas y sobre la misma cuenta.

          Sin conectar sí hay tarjeta, debajo: ahí hay algo que explicar —qué se
          lee, qué no se publica y lo del perfil público— y eso son párrafos,
          no una fila de botones. Ahí la pantalla se identifica con el rótulo de
          la tarjeta y con la pestaña del carril, que es de donde vienes. */}
      {link?.steamId && (
        /* `align-items: center` y no el `flex-end` de .mq-sechead: eso alineaba
           una frase con unos botones, y aquí los dos lados son controles de
           alturas distintas —34 el segmentado, 40 los botones—. */
        <div className="mq-sechead" style={{ alignItems: "center" }}>
          {/* ── Las dos mitades ──────────────────────────────────────────
              Antes esto era una pantalla larga: la importación arriba y el
              inventario debajo, con el argumento de que las dos cuelgan de la
              misma cuenta. Con el inventario ya crecido —608 objetos, su
              gráfica y sus cuatro cifras— ese argumento se dio la vuelta: para
              llegar a lo que se mira a diario había que pasar por delante de lo
              que se usa una vez al año. Inventario primero y por defecto.

              Y siguen colgando de la misma cuenta: por eso comparten fila con
              ella y no van en una propia. Sincronizar y desconectar son de las
              dos mitades, que es lo que evita el «¿en cuál de las dos estaba
              desconectar?». */}
          <div className="segmented" role="tablist">
            {SECTIONS.map((x) => (
              <button
                key={x.key}
                role="tab"
                aria-selected={section === x.key}
                className={section === x.key ? "seg seg-active" : "seg"}
                onClick={() => setSection(x.key)}
              >
                {tr(x.label)}
              </button>
            ))}
          </div>
          {/* Con wrap, y no solo en la fila de fuera: los dos botones juntos
              piden más que un teléfono, y en móvil eso no saca barra de
              desplazamiento —encoge la página entera y se lleva el dock fuera
              del área táctil—. Ver e2e/steam-header-fit.spec.ts. */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* El id entero son diecisiete dígitos que no dicen nada a nadie y
                se comían la fila. Los cuatro de cada punta bastan para
                reconocer la cuenta, y el resto está en el title para quien lo
                necesite de verdad. */}
            <div
              className="chip"
              title={link.steamId}
              style={{
                height: "var(--ctl-h)", borderRadius: "var(--r)",
                background: "var(--surface)", color: "var(--text)", cursor: "default",
              }}
            >
              <SteamIcon size={15} style={{ color: "var(--plat-steam)" }} />
              <span style={{ fontWeight: 700 }}>{tr("Connected")}</span>
              <span className="mute" style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {`${link.steamId.slice(0, 4)}…${link.steamId.slice(-4)}`}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="btn btn-outline"
                disabled={busy}
                /* Y salta a Importar, que es donde se ve. El botón vive en la
                   fila de la cuenta —fuera de las dos secciones— pero todo
                   lo que produce, la rueda, la lista y el recibo, se pinta
                   dentro de una: pulsarlo desde Inventario dejaba la pantalla
                   igual que estaba, con el escaneo corriendo y sin una sola
                   señal de que hubiera pasado algo. */
                onClick={() => {
                  setSection("import");
                  scan.mutate();
                }}
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
        </div>
      )}

      {linkPending && (
        <div className="skeleton" style={{ height: 44, borderRadius: "var(--r)" }} />
      )}

      {!linkPending && !link?.steamId && (
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
          <div className="eyebrow">{tr("Steam account")}</div>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {tr("Connect your Steam account to bring in the hours you've already played. Reel only reads your games list — it never posts anything.")}
          </p>
          <div>
            {/* `btn-accent`, que es la variante que existe. Llevaba desde el
                primer día pidiendo `btn-primary`, que no está en ninguna hoja:
                el botón que arranca todo esto se pintaba sin fondo y sin borde,
                indistinguible de una línea de texto. */}
            <button className="btn btn-accent" onClick={() => void startSteamLogin()}>
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
        </div>
      )}

      {/* ── El inventario del mercado (0088) ──────────────────────────────── */}
      {link?.steamId && section === "inventory" && <SteamInventory />}

      {/* ── Lo de importar, de aquí abajo ─────────────────────────────────── */}
      {/* El escaneo sigue corriendo aunque estés mirando el inventario —lo lanza
          el botón de la tarjeta de la cuenta, que está fuera de las dos
          secciones—, así que lo que se esconde es la vista y no el trabajo: al
          volver a Importar está lo que haya pasado mientras. */}
      {section === "import" && (
      <>
      {/* Sin ningún intento todavía, esta sección no tiene NADA que enseñar, y
          antes daba igual porque el inventario venía justo debajo y la página
          nunca se veía vacía. Ahora es una sección entera en blanco, así que
          dice qué es y adónde ir: el botón que la arranca vive en la tarjeta de
          la cuenta, que es de las dos y no de esta. */}
      {/* `draft &&` para no decirlo antes de saberlo: mientras la consulta va,
          `run` es null igual que cuando de verdad no hay nada, y quien tiene una
          importación hecha veía "trae tus juegos" un instante antes de que el
          recibo lo desmintiera. */}
      {draft && !run && (
        <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 750 }}>{tr("Bring your Steam games into Reel")}</div>
          <p className="dim" style={{ margin: 0, fontSize: 13.5 }}>
            {tr("Reel reads the games you own and the hours you've played, and shows you a list before writing anything. Start it with \"Look at my Steam library\" up there.")}
          </p>
        </div>
      )}

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
          rated={rated}
          known={knownState}
          matched={matched}
          mine={mine}
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
            {/* Solo lo que pasó: una importación sin notas ni finales —el caso
                normal— no tiene por qué enseñar dos ceros. */}
            {[
              { label: tr("Added or updated"), value: num("applied") + num("resolved") },
              { label: tr("Marked finished"), value: num("finished") },
              { label: tr("Given a rating"), value: num("rated") },
              { label: tr("Conflicts kept as yours"), value: num("conflicts") },
            ].filter((s) => s.value > 0).map((s) => (
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
          {/* Lo que entró sin que dijeras nada, que sigue siendo el defecto y
              el grueso de una importación. */}
          <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
            {tr("Anything you didn't give a state to arrives marked as owned and undecided: Steam's hours are lifetime totals and say nothing about what you're playing now.")}
          </p>
          {num("finished") > 0 && (
            <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
              {tr("What you marked as finished is dated with your last session on Steam, not with today.")}
            </p>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

/* ── La lista ──────────────────────────────────────────────────────────── */

/** Los montones. No son filtros cualesquiera: cada uno es una tanda que se
 *  decide igual entera. "Ya en Reel" son los que quieres de verdad, "sin tocar
 *  nunca" es inventario que casi siempre entra sin estado, y los conflictos son
 *  las tres filas que hay que mirar de una en una. */
const BUCKETS: { key: string; label: string; keep: (i: SteamItem) => boolean }[] = [
  { key: "all", label: "Every game", keep: () => true },
  { key: "library", label: "Already in Reel", keep: (i) => i.in_library },
  /* El montón que faltaba, y es el que se mira primero al sincronizar: lo que
     Steam tiene y Reel todavía no. Los otros cortan por horas o por conflictos;
     este corta por lo único que separa el trabajo nuevo del repaso. */
  { key: "missing", label: "Not in Reel", keep: (i) => !i.in_library },
  { key: "played", label: "More than 10 hours", keep: (i) => i.minutes >= 600 },
  { key: "untouched", label: "Never opened", keep: (i) => i.minutes === 0 },
  { key: "conflict", label: "Hours in conflict", keep: (i) => i.manual_minutes !== null },
];

/** Lo que se puede decir de un juego aquí.
 *
 *  Los cuatro `play_state` y "terminado", que no es uno de ellos —es el
 *  watch_event (0073)— pero que para quien mira la pantalla es una opción más
 *  de la misma fila. Separarlos en dos controles sería contar una tripa.
 *
 *  Y no está "Lo tengo": todo lo que sale en esta pantalla lo tienes. */
const STATES: { key: ImportState; label: string }[] = [
  { key: "backlog", label: "Backlog" },
  { key: "playing", label: "Playing" },
  { key: "ongoing", label: "Ongoing" },
  { key: "finished", label: "Finished it" },
  { key: "dropped", label: "Dropped" },
];

/** Cómo se dice, DE UN JUEGO, el estado que ya tiene en Reel.
 *
 *  Claves propias y no las de los cubos de la pestaña Juegos, que era lo obvio y
 *  está mal: esas etiquetan una lista, así que en español van en plural —y
 *  "Finished" es además "Terminadas", el femenino de las series—. "en Reel ·
 *  Terminadas" de un solo juego es la misma avería que ya obligó a separar
 *  "Finished it" de "Finished" (ver i18n.ts). Aquí se habla de uno. */
const KNOWN_LABEL: Record<GameStatus, string> = {
  upcoming: "not out yet",
  backlog: "on your backlog",
  playing: "you're playing it",
  ongoing: "no ending",
  finished: "you finished it",
  dropped: "you dropped it",
  owned: "yours, untouched",
};

/** El chip que ese estado enciende, si tiene uno. 'owned' y 'upcoming' no lo
 *  tienen —el primero es el suelo de esta pantalla y el segundo sale de la
 *  fecha—, así que esos se cuentan en el rótulo y ahí se quedan. */
const KNOWN_CHIP: Partial<Record<GameStatus, ImportState>> = {
  backlog: "backlog",
  playing: "playing",
  ongoing: "ongoing",
  finished: "finished",
  dropped: "dropped",
};

/** La carátula de Steam por appid. Es el mismo arte que ves en tu biblioteca de
 *  Steam, servido por su CDN: ni una fila en la base, ni una petición a IGDB.
 *  Lo que no la tiene —demos, herramientas, juegos retirados— cae al degradado
 *  de siempre por el `onError`. */
const coverUrl = (appid: number) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;

const playedOn = (iso: string) =>
  new Date(iso).toLocaleDateString(dateLocale(), { day: "numeric", month: "short", year: "numeric" });

/** Lo marcado es estado de ESTA lista y no se guarda: la pantalla se rellena
 *  una vez y se confirma una vez, y una casilla persistida sería una casilla
 *  que hay que sincronizar. Vale igual para el estado y la nota que para las
 *  casillas. Y arranca vacía: nada marcado hasta que lo marques (ver la cabecera
 *  del fichero). Lo que Reel YA sabe de cada juego —tu nota y tu estado— se
 *  enseña, pero en su propio lenguaje, y no como una casilla puesta por ti. */
function ReviewList({
  items, rated: already, known, matched, mine, onApply, pending,
}: {
  items: SteamItem[];
  /** La nota que YA tiene cada título en Reel, por title_id. No se siembra en
   *  `ratings`: eso la reenviaría al confirmar y la contaría como nota nueva en
   *  el recibo. Se enseña, y se manda solo lo que toques tú. */
  rated: Map<string, number>;
  /** El estado que cada título YA tiene en Reel. Se enseña por lo mismo que la
   *  nota, y con la misma regla: no se siembra en `states`, así que confirmar
   *  sin tocarlo no reescribe nada. */
  known: Map<string, GameStatus>;
  /** Con qué ficha del catálogo ha casado cada juego, por title_id. */
  matched: Map<string, MatchedTitle>;
  /** Tus juegos indexados por nombre, para reconocer el casado que se fue a
   *  otra edición sin recorrer la biblioteca en cada fila (domain/steamMatch). */
  mine: ReadonlyMap<string, MyGame>;
  onApply: (picks: ApplyPick[]) => void;
  pending: boolean;
}) {
  const [chosen, setChosen] = useState(() => new Set<string>());
  const [overwrite, setOverwrite] = useState(() => new Set<string>());
  const [states, setStates] = useState(() => new Map<string, ImportState>());
  const [ratings, setRatings] = useState(() => new Map<string, number>());
  const [bucket, setBucket] = useState("all");

  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
  const onToggle = (id: string) => setChosen((prev) => flip(prev, id));
  const onToggleOverwrite = (id: string) => setOverwrite((prev) => flip(prev, id));

  /* Poner un estado o una nota MARCA la fila, y no es un atajo cortés: decir en
     qué punto estás de un juego que no vas a importar no significa nada, y
     dejarlo sin marcar habría convertido el trabajo de decidir en trabajo
     perdido al confirmar. */
  const setState = (id: string, next: ImportState | null) => {
    setStates((prev) => {
      const map = new Map(prev);
      if (next === null) map.delete(id);
      else map.set(id, next);
      return map;
    });
    if (next !== null) setChosen((prev) => new Set(prev).add(id));
  };
  const setRating = (id: string, score: number) => {
    setRatings((prev) => new Map(prev).set(id, score));
    setChosen((prev) => new Set(prev).add(id));
  };

  const bucketOf = (key: string) => BUCKETS.find((b) => b.key === key) ?? BUCKETS[0];
  const shown = useMemo(() => items.filter(bucketOf(bucket).keep), [items, bucket]);
  /* Los recuentos del raíl, una vez por lista y no una por render: son cinco
     pasadas sobre los mil y pico juegos de una biblioteca grande, y esto se
     vuelve a pintar con cada casilla que marcas. */
  const counts = useMemo(
    () => new Map(BUCKETS.map((b) => [b.key, items.filter(b.keep).length])),
    [items],
  );

  /* Las tres pastillas de marcar trabajan sobre el montón que miras y no sobre
     los 312: "Nada" en "sin tocar nunca" es justo la tanda que se quiere quitar
     de en medio, y si vaciara la lista entera se llevaría por delante lo que ya
     habías decidido en los otros montones. */
  const pick = (which: "mine" | "all" | "none") =>
    setChosen((prev) => {
      const next = new Set(prev);
      for (const i of shown) {
        if (which === "none") next.delete(i.id);
        else if (which === "all" || i.in_library) next.add(i.id);
        else next.delete(i.id);
      }
      return next;
    });

  const chosenHere = shown.filter((i) => chosen.has(i.id));
  const applyToBatch = (next: ImportState | null, score: number | null) => {
    if (!chosenHere.length) return;
    if (next !== null) {
      setStates((prev) => {
        const map = new Map(prev);
        for (const i of chosenHere) map.set(i.id, next);
        return map;
      });
    }
    if (score !== null) {
      setRatings((prev) => {
        const map = new Map(prev);
        for (const i of chosenHere) map.set(i.id, score);
        return map;
      });
    }
  };

  const conflicts = items.filter((i) => i.manual_minutes !== null && chosen.has(i.id));
  const decided = items.filter((i) => chosen.has(i.id) && states.has(i.id)).length;
  const rated = items.filter((i) => chosen.has(i.id) && ratings.has(i.id)).length;

  /* El mismo botón arriba y abajo, y no dos botones parecidos: con trescientos
     juegos la lista mide varias pantallas, así que el de abajo queda a un
     scroll largo de donde estás marcando. Se guarda como elemento —React los
     trata como descripciones inmutables— para que no haya forma de que las dos
     copias se separen. */
  const importButton = (
    <button
      className="btn btn-accent"
      disabled={!chosen.size || pending}
      onClick={() =>
        onApply(
          [...chosen].map((id) => ({
            id,
            overwrite: overwrite.has(id),
            state: states.get(id) ?? null,
            rating: ratings.get(id) ?? null,
          })),
        )
      }
    >
      {pending && <Loader2 size={16} className="spin" />}
      {tv("Import {n} games", { n: chosen.size })}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <BatchBar count={chosenHere.length} onApply={applyToBatch} />

      <div className="st-layout">
        <aside className="card st-rail">
          <div className="eyebrow" style={{ marginBottom: 2 }}>{tr("Piles")}</div>
          {BUCKETS.map((b) => (
            <button
              key={b.key}
              className={`chip st-bucket ${bucket === b.key ? "chip-active" : ""}`}
              aria-pressed={bucket === b.key}
              onClick={() => setBucket(b.key)}
            >
              <span>{tr(b.label)}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{counts.get(b.key) ?? 0}</span>
            </button>
          ))}

          <div className="st-rail-tail">
            <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
            <div className="eyebrow" style={{ marginBottom: 4 }}>{tr("Decided so far")}</div>
            <div className="mute" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              {tv("{n} ticked", { n: chosen.size })}<br />
              {tv("{n} with a state", { n: decided })}<br />
              {tv("{n} with a rating", { n: rated })}
            </div>
          </div>
        </aside>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div style={{ fontWeight: 750, fontSize: 14 }}>
              {tr(bucketOf(bucket).label)}{" "}
              <span className="dim" style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                · {shown.length}
              </span>
            </div>
            <div className="segmented" style={{ marginLeft: "auto" }}>
              <div className="seg" onClick={() => pick("mine")}>{tr("Only what I follow")}</div>
              <div className="seg" onClick={() => pick("all")}>{tr("All")}</div>
              <div className="seg" onClick={() => pick("none")}>{tr("None")}</div>
            </div>
            {importButton}
          </div>

          {conflicts.length > 0 && bucket !== "conflict" && (
            <p className="mute" style={{ margin: 0, fontSize: 12.5 }}>
              {tv("{n} games have hours you typed yourself. They're kept as they are unless you tick \"use Steam's\".", { n: conflicts.length })}
            </p>
          )}

          <div className="st-cards">
            {shown.map((i) => (
              <GameRow
                key={i.id}
                item={i}
                on={chosen.has(i.id)}
                state={states.get(i.id) ?? null}
                rating={ratings.get(i.id) ?? 0}
                already={(i.title_id && already.get(i.title_id)) || 0}
                knownState={(i.title_id && known.get(i.title_id)) || null}
                match={(i.title_id && matched.get(i.title_id)) || null}
                mine={mine}
                overwritten={overwrite.has(i.id)}
                onToggle={() => onToggle(i.id)}
                onState={(next) => setState(i.id, next)}
                onRate={(score) => setRating(i.id, score)}
                onOverwrite={() => onToggleOverwrite(i.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-3 flex-wrap">
        {importButton}
        <span className="mute" style={{ fontSize: 12.5 }}>
          {tr("Anything without a state comes in as yours, undecided.")}{" "}
          {tr("What you import is dated with your last session on Steam, not with today.")}
        </span>
      </div>
    </div>
  );
}

/** La barra que decide una tanda entera.
 *
 *  Existe porque una biblioteca de Steam tiene cientos de juegos y las tandas
 *  se parecen entre sí: los ciento y pico que nunca abriste entran todos igual.
 *  Aplica sobre lo MARCADO del montón que miras, y lo dice con su número — sin
 *  eso, "Aplicar" es un botón que no se sabe por encima de qué va a pasar. */
function BatchBar({
  count, onApply,
}: {
  count: number;
  onApply: (state: ImportState | null, rating: number | null) => void;
}) {
  const [state, setState] = useState<ImportState | null>(null);
  const [rating, setRating] = useState(0);

  return (
    <div className="card flex items-center gap-3 flex-wrap" style={{ padding: "12px 16px" }}>
      <span style={{ fontWeight: 750, fontSize: 13.5 }}>
        {tv("To the {n} ticked in this pile:", { n: count })}
      </span>
      <div className="segmented wrap">
        {STATES.map((s) => (
          <div
            key={s.key}
            className={`seg ${state === s.key ? "seg-active" : ""}`}
            onClick={() => setState(state === s.key ? null : s.key)}
          >
            {tr(s.label)}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="eyebrow" style={{ fontSize: 10.5 }}>{tr("and a rating")}</span>
        <RatingStars value={rating} onRate={setRating} />
      </div>
      <button
        className="btn btn-outline btn-sm"
        style={{ marginLeft: "auto" }}
        disabled={!count || (state === null && rating === 0)}
        onClick={() => onApply(state, rating || null)}
      >
        {tr("Apply to the ticked ones")}
      </button>
    </div>
  );
}

/** Un juego: carátula, horas, estado y nota.
 *
 *  La carátula va a sangre y a todo el alto porque es lo que se mira primero, y
 *  la casilla encima de ella porque la carátula ES lo que marcas. Las horas y
 *  la nota se van al margen derecho, alineadas entre sí: eran el hueco vacío de
 *  la tarjeta y ahora es donde se lee de un vistazo cuánto y qué tal. */
function GameRow({
  item, on, state, rating, already, knownState, match, mine,
  overwritten, onToggle, onState, onRate, onOverwrite,
}: {
  item: SteamItem;
  on: boolean;
  state: ImportState | null;
  rating: number;
  /** La nota que ya le habías puesto, 0 si ninguna. Manda la tuya de ahora en
   *  cuanto tocas las estrellas. */
  already: number;
  /** Lo que Reel ya tiene apuntado de este juego, null si no lo tiene. */
  knownState: GameStatus | null;
  /** La ficha del catálogo con la que ha casado. Null mientras no tenga: lo que
   *  el catálogo no conocía se resuelve contra IGDB al confirmar. */
  match: MatchedTitle | null;
  mine: ReadonlyMap<string, MyGame>;
  overwritten: boolean;
  onToggle: () => void;
  onState: (next: ImportState | null) => void;
  onRate: (score: number) => void;
  onOverwrite: () => void;
}) {
  const [noArt, setNoArt] = useState(false);
  const conflict = item.manual_minutes !== null;
  /* Solo cuando la fila NO está ya en tu biblioteca: si esta ficha es la que
     sigues, no hay dos ediciones de las que hablar. */
  const twin = item.in_library ? null : otherEdition(match, mine);

  return (
    <article className={`card st-card ${on ? "" : "off"}`}>
      <div className="st-cover" style={{ background: posterBg(item.steam_name) }}>
        {!noArt && (
          <img src={coverUrl(item.appid)} alt="" loading="lazy" onError={() => setNoArt(true)} />
        )}
        {noArt && <span className="st-cover-name">{item.steam_name}</span>}
        <input
          type="checkbox"
          className="st-tick"
          checked={on}
          onChange={onToggle}
          aria-label={tv("Import {name}", { name: item.steam_name })}
        />
      </div>

      <div className="st-card-body">
        <div className="flex items-start gap-3">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 16, fontWeight: 750, letterSpacing: "-0.01em", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.steam_name}
            </h3>
            <div className="mute" style={{ fontSize: 12.5, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.in_library && (
                <span style={{ color: "var(--accent)", fontWeight: 650 }}>
                  {tr("in Reel")}
                  {/* Con la palabra de tu biblioteca detrás: "en Reel" a secas
                      decía que el juego está, pero no en qué punto lo dejaste,
                      que es justo lo que hace falta para saber si esta fila hay
                      que tocarla o pasar de largo. */}
                  {knownState && ` · ${tr(KNOWN_LABEL[knownState])}`} ·{" "}
                </span>
              )}
              {item.last_played_at
                ? tv("last played {date}", { date: playedOn(item.last_played_at) })
                : tr("never opened")}
            </div>

            {/* Con qué ficha del catálogo casa, que es la decisión que esta
                pantalla no enseñaba. El nombre de Steam y el de IGDB casi
                siempre coinciden, así que lo que distingue una edición de otra
                es el año y la plataforma — y eso es justo lo que aquí se lee.
                Ver domain/steamMatch y lib/steam. */}
            {match && (
              <div className="mute" style={{ fontSize: 11.5, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {tv("matches {name}", { name: match.name })}
                {match.first_air_date && ` · ${match.first_air_date.slice(0, 4)}`}
                {match.platforms.length > 0 && ` · ${match.platforms.slice(0, 2).join(", ")}`}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1" style={{ marginLeft: "auto", flex: "0 0 auto" }}>
            <span style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {hours(item.minutes)}
            </span>
            {/* La fila que decide algo: las dos cifras a la vista y su propia
                casilla. Sin marcar, gana la tuya — que es el trato que
                minutes_source (0073) existe para poder cumplir. */}
            {conflict && (
              <>
                <button
                  className={`chip chip-sm ${overwritten ? "chip-active" : ""}`}
                  style={{ height: 26 }}
                  aria-pressed={overwritten}
                  onClick={onOverwrite}
                >
                  {tv("use Steam's {hours}", { hours: hours(item.minutes) })}
                </button>
                <span className="mute" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>
                  {tv("you typed {hours}", { hours: hours(item.manual_minutes ?? 0) })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: "auto" }}>
          {STATES.map((s) => {
            /* Dos cosas distintas con la misma forma, así que dos lenguajes: el
               acento (.chip-active) es lo que ELIGES ahora, y el punteado
               (.chip-known) es lo que Reel YA tenía. Mientras no toques nada no
               se manda ningún estado, así que el punteado no reescribe nada —y
               en cuanto eliges, deja de pintarse: manda lo tuyo de ahora. */
            const known = state === null && knownState !== null && KNOWN_CHIP[knownState] === s.key;
            return (
              <button
                key={s.key}
                className={`chip chip-sm ${state === s.key ? "chip-active" : ""}${known ? " chip-known" : ""}`}
                aria-pressed={state === s.key}
                title={known ? tr("what Reel already has") : undefined}
                onClick={() => onState(state === s.key ? null : s.key)}
              >
                {tr(s.label)}
              </button>
            );
          })}
          <span className="flex items-center gap-2" style={{ marginLeft: "auto" }}>
            {/* Lo que ya dijiste de este juego, dicho antes de que lo vuelvas a
                decir: las estrellas arrancan en tu nota, y el rótulo aclara que
                viene de Reel y no de lo que acabas de marcar aquí. Mientras no
                las toques no se manda nada, así que la nota no se reescribe con
                la misma cifra ni engorda el recuento del recibo. */}
            {!rating && already > 0 && (
              <span className="mute" style={{ fontSize: 11.5 }}>{tr("your rating")}</span>
            )}
            <RatingStars value={rating || already} onRate={onRate} />
          </span>
        </div>

        {/* El aviso que habría ahorrado el ABC Murders de 2009: ya sigues este
            juego, y esto ha casado con OTRA ficha. No decide nada —puede ser una
            reedición y estar bien— pero pone las dos ediciones juntas, con el
            año y con la plataforma en la que has dicho que lo juegas. */}
        {twin && (
          <div className="flex items-start gap-1.5" style={{ fontSize: 11.5, color: "#e5484d" }}>
            <AlertTriangle size={12} style={{ flex: "0 0 auto", marginTop: 2 }} />
            <span>
              {tv("you already follow this one as {year}", {
                year: twin.year ?? tr("another edition"),
              })}
              {twin.platform && tv(", and you play it on {platform}", { platform: twin.platform })}
              {". "}
              {tr("Check the edition before importing it again.")}
            </span>
          </div>
        )}

        {/* Lo que se va a escribir, dicho antes de confirmarlo: un watch_event
            con la fecha de tu última partida, y no la de hoy. */}
        {state !== null && (
          <div className="mute flex items-center gap-1.5" style={{ fontSize: 11.5 }}>
            <Clock size={12} />
            {item.last_played_at
              ? state === "finished"
                ? tv("saved as finished on {date}, your last session", { date: playedOn(item.last_played_at) })
                : tv("dated {date}, your last session", { date: playedOn(item.last_played_at) })
              : tr("Steam has no last session for this one, so it'll be saved with today's date")}
          </div>
        )}
      </div>
    </article>
  );
}
