import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, Gamepad2, Library, Minus, Plus, X } from "lucide-react";
import { igdbImg, useGame, useSetGameProgress } from "@/lib/igdb";
import { isEs, t as tr, tGenre, tv } from "@/lib/i18n";
import { useFollow, useGameLibrary, useUnfollow } from "@/lib/library";
import { useIgnore, useIgnored, useUnignore } from "@/lib/ignore";
import { useMyRating, useRateTitle } from "@/lib/ratings";
import { useMarkWatched, useUnmarkWatched } from "@/lib/watch";
import { useWatched } from "@/features/detail/data";
import {
  deriveGameStatus,
  formatPlaytime,
  hoursProgress,
  type PlayState,
} from "@/domain/gameStatus";
import { formatRelease, isReleased } from "@/domain/gameRelease";
import { RatingStars } from "@/ui/RatingStars";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";

/* Ficha de un juego — la tercera hermana de DetailSheet y MovieSheet, abierta
   por el parámetro global ?game= (un id de IGDB, ver 0071).

   Lo que NO tiene: temporadas, episodios, proveedores, saga. Lo que tiene en su
   lugar es lo único que las otras dos no necesitan — **en qué punto estás**:

     · el estado, que aquí no se puede derivar de contar nada (gameStatus.ts);
     · las horas, a mano, con el tiempo medio de IGDB como denominador;
     · las plataformas y su fecha, que en un juego son varias y distintas.

   La fila de notas tiene DOS celdas y no cuatro: tuya e IGDB. No hay TMDB —otro
   medio— ni IMDb, que no puntúa juegos. */

const PLAY_STATES: { key: PlayState; label: string }[] = [
  /* "Pendiente" está aquí desde 0078, y es el único de los cuatro que también
     se deriva: seguir un juego sin decir nada es tenerlo pendiente. Se puede
     DECIR porque un juego tuyo con 0 h sale como "lo tengo" —la regla que
     impide que una importación de Steam se coma esta lista— y sin poder
     decirlo no habría forma de sacarlo de ahí. Pulsarlo cuando ya está puesto
     lo quita, como los otros tres: vuelves a no haber dicho nada. */
  { key: "backlog", label: "Backlog" },
  { key: "playing", label: "Playing" },
  { key: "ongoing", label: "Ongoing" },
  { key: "dropped", label: "Dropped" },
];

/* Los saltos de las teclas rápidas. Media hora es la sesión corta de un día
   entre semana y dos horas la de un sábado; con estas dos y el campo se cubre
   todo sin convertir esto en una calculadora. */
const BUMPS = [30, 120];

export function GameSheet({ igdbId, onClose }: { igdbId: number; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const { data, isPending } = useGame(igdbId);
  const title = data?.title;
  const episodeId = data?.episode_id ?? null;

  const { data: games = [] } = useGameLibrary();
  const entry = games.find((g) => g.title_id === title?.id);
  const added = Boolean(entry);
  const follow = useFollow();
  const unfollow = useUnfollow();
  const { isIgnored } = useIgnored();
  const ignore = useIgnore();
  const unignore = useUnignore();
  const setProgress = useSetGameProgress();

  // "Terminado" es el episodio sintético (0071), así que el mapa de vistos y
  // las dos mutaciones son exactamente las de series y cine.
  const { data: watched } = useWatched(title?.id ?? null);
  const markWatched = useMarkWatched(title?.id ?? "");
  const unmarkWatched = useUnmarkWatched(title?.id ?? "");
  const watchEventId = episodeId ? watched?.get(episodeId) : undefined;
  const finished = Boolean(watchEventId);

  const { data: myRating } = useMyRating(title?.id ?? null);
  const rate = useRateTitle(title?.id ?? "");

  // Escape cierra, igual que en las otras dos fichas.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const minutes = entry?.minutes_played ?? 0;
  const playState = entry?.play_state ?? null;
  const owned = Boolean(entry?.owned);
  /* De dónde salen las horas (0076). Se dice cuando las trajo Steam, y no
     cuando las escribiste tú: lo tuyo no necesita explicación, y ver "de Steam"
     es lo que explica por qué esa cifra cambió sola. */
  const fromSteam = entry?.minutes_source === "steam";
  /* "¿Ha salido?" se pregunta al TÍTULO y no a la fila de biblioteca. El
     `aired_count` del rollup solo existe si sigues el juego, así que leerlo de
     ahí ponía en "próximo" —con su insignia de fecha futura— cualquier juego
     que abrieras sin tenerlo añadido, incluido uno de 2021. */
  const released = isReleased(
    title?.first_air_date,
    title?.release_precision,
    new Date().toISOString().slice(0, 10),
  );
  const status = deriveGameStatus({
    airedCount: released ? 1 : 0,
    watchedCount: finished ? 1 : 0,
    playState,
    // Los mismos cuatro datos que usa la biblioteca (lib/library.ts). Sin
    // `owned` y `minutesPlayed`, la ficha derivaría 'backlog' donde la rejilla
    // dice 'owned', y las dos pantallas dirían cosas distintas del mismo juego.
    owned,
    minutesPlayed: minutes,
  });
  const progress = hoursProgress(minutes, title?.beat_seconds, status);

  /* El campo de horas es un borrador local: escribir "1" mientras tecleas "18"
     no puede escribir 1 en la base y volver. Se confirma al salir del campo o
     con Enter. Los botones de +30 min sí escriben directos, que es su gracia. */
  const [draft, setDraft] = useState<string | null>(null);
  const shownHours = draft ?? (minutes > 0 ? String(+(minutes / 60).toFixed(1)) : "");

  const commitHours = () => {
    if (draft === null || !entry) return;
    const text = draft.trim();
    setDraft(null);
    // Vacío es "no he escrito nada", no "cero horas". Number("") es 0, así que
    // sin esta guarda seleccionar el campo entero y salir con el tabulador
    // borraba las horas de un juego con cuarenta encima, sin confirmación ni
    // manera de deshacerlo.
    if (!text) return;
    const parsed = Number(text.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const asMinutes = Math.round(parsed * 60);
    if (asMinutes === minutes) return;
    setProgress.mutate({ titleId: entry.title_id, minutesPlayed: asMinutes });
  };

  const bump = (delta: number) => {
    if (!entry) return;
    setDraft(null);
    setProgress.mutate({ titleId: entry.title_id, minutesPlayed: Math.max(0, minutes + delta) });
  };

  /* Pulsar el estado en el que ya estás lo quita: es la vuelta a "Pendiente",
     que no es un botón porque no es una cosa que hagas — es lo que queda cuando
     no has dicho nada. */
  const pickState = (next: PlayState) => {
    if (!entry) return;
    setProgress.mutate({ titleId: entry.title_id, playState: playState === next ? null : next });
  };

  const cover = igdbImg(title?.poster_path, "cover_big");
  const art = igdbImg(title?.backdrop_path, "screenshot_big");
  const es = isEs();
  const releaseLabel = formatRelease(title?.first_air_date, title?.release_precision, { es });
  const platforms = title?.platforms ?? [];
  const perPlatform = Object.entries(title?.platform_releases ?? {});

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ? tv("{name} details", { name: title.name }) : tr("Game details")}
        tabIndex={-1}
        className="detail-sheet sheet-center fixed z-[70] card overflow-hidden flex flex-col"
        style={{
          left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          width: "min(760px, 94vw)", maxHeight: "90vh", borderRadius: "var(--r-xl)",
        }}
      >
        {isPending || !title ? (
          <div className="overflow-y-auto p-6 flex flex-col gap-4">
            {[220, 60, 120].map((h, i) => (
              <div key={i} className="skeleton" style={{ height: h, borderRadius: "var(--r-md)" }} />
            ))}
          </div>
        ) : (
          <>
            {/* Hero */}
            <div
              className="relative"
              style={{
                height: 200, flex: "0 0 auto",
                background: art ? `url(${art}) center/cover` : posterBg(title.name),
              }}
            >
              <div className="poster-sheen" />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, var(--surface) 100%)" }} />
              <button className="btn btn-icon badge-glass absolute" style={{ top: 14, right: 14, color: "#fff" }} onClick={onClose}>
                <X size={18} />
              </button>
              <div className="absolute flex items-end gap-4" style={{ left: 24, right: 24, bottom: 16 }}>
                <div
                  className="poster"
                  style={{ width: 96, height: 144, flex: "0 0 auto", background: posterBg(title.name + "x") }}
                >
                  {cover && <img className="poster-img" src={cover} alt="" />}
                  <div className="poster-sheen" />
                </div>
                <div className="pb-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="badge badge-glass" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Gamepad2 size={12} />
                      {tr("Game")}
                    </span>
                    {!released && <span className="badge badge-accent">{releaseLabel}</span>}
                  </div>
                  <h2 style={{ fontSize: 26, fontWeight: 850, letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(0,0,0,.5)", color: "#fff", margin: 0 }}>
                    {title.name}
                  </h2>
                  <div style={{ fontSize: 13.5, color: "rgba(255,255,255,.85)" }}>
                    {[
                      releaseLabel,
                      title.genres.map(tGenre).join(" · "),
                      title.network,
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-6 flex flex-col gap-6">
              {/* En qué punto estás. Solo con el juego en la biblioteca: sin
                  seguirlo no hay fila donde escribirlo, y ofrecer los botones
                  sería ofrecer algo que no guardaría nada. */}
              {added && entry && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="segmented" role="group" aria-label={tr("Play state")}>
                      {PLAY_STATES.map((s) => (
                        <div
                          key={s.key}
                          className={`seg ${playState === s.key ? "seg-active" : ""}`}
                          onClick={() => pickState(s.key)}
                        >
                          {tr(s.label)}
                        </div>
                      ))}
                    </div>

                    {/* "Lo tengo" va aparte de los tres estados y no como un
                        cuarto segmento, porque no es lo mismo que responden:
                        los estados dicen en qué punto estás y este dice si es
                        tuyo. Lo marca sola la importación de Steam; a mano es
                        para lo que tengas en consola, en GOG o en físico. */}
                    <button
                      type="button"
                      className={`chip ${owned ? "chip-active" : ""}`}
                      aria-pressed={owned}
                      onClick={() => setProgress.mutate({ titleId: entry.title_id, owned: !owned })}
                    >
                      <Library size={13} />
                      {tr("Owned")}
                    </button>
                  </div>

                  {/* Las horas. Un juego sin final las enseña a secas: no hay
                      contra qué medirlas, y una barra al 400% no dice nada. */}
                  <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="eyebrow">
                        {tr("Time played")}
                        {fromSteam && <span className="mute"> · {tr("from Steam")}</span>}
                      </div>
                      <div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                        {formatPlaytime(minutes)}
                        {progress != null && title.beat_seconds?.normally && (
                          <span className="mute" style={{ fontWeight: 500 }}>
                            {" "}
                            {tv("of {total}", {
                              total: formatPlaytime(Math.round(title.beat_seconds.normally / 60)),
                            })}
                          </span>
                        )}
                      </div>
                    </div>

                    {progress != null && (
                      <div className="pbar pbar-inline" aria-hidden>
                        <i style={{ width: `${Math.min(progress, 100)}%` }} />
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        className="input"
                        style={{ width: 92, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                        inputMode="decimal"
                        aria-label={tr("Hours played")}
                        value={shownHours}
                        placeholder="0"
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitHours}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setDraft(null);
                        }}
                      />
                      <span className="mute" style={{ fontSize: 13 }}>{tr("hours")}</span>
                      {BUMPS.map((m) => (
                        <button key={m} className="btn btn-outline btn-sm" onClick={() => bump(m)}>
                          +{formatPlaytime(m)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Terminado. No se ofrece en un juego sin final: no tiene
                      créditos, y el botón prometería algo imposible. */}
                  {episodeId && status !== "ongoing" && (
                    <div className="flex justify-center">
                      <button
                        className={`btn ${finished ? "btn-outline" : "btn-accent"}`}
                        disabled={markWatched.isPending || unmarkWatched.isPending}
                        onClick={() => (watchEventId ? unmarkWatched.mutate(watchEventId) : markWatched.mutate(episodeId))}
                      >
                        <Check size={16} />
                        {finished ? tr("Finished — tap to clear") : tr("Mark finished")}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="action-row">
                <button
                  className={`btn ${added ? "btn-outline" : "btn-accent"}`}
                  onClick={() => (added && entry ? unfollow.mutate(entry.title_id) : follow.mutate(title))}
                >
                  {added ? <><Minus size={16} />{tr("Remove")}</> : <><Plus size={16} />{tr("Add")}</>}
                </button>
                {!added && (
                  <button
                    className={`btn ${isIgnored(title.tmdb_id) ? "btn-accent" : "btn-outline"}`}
                    onClick={() => (isIgnored(title.tmdb_id) ? unignore.mutate(title.id) : ignore.mutate(title.id))}
                  >
                    {isIgnored(title.tmdb_id) ? <><Eye size={16} />{tr("Un-ignore")}</> : <><EyeOff size={16} />{tr("Ignore")}</>}
                  </button>
                )}
              </div>

              {/* Notas: dos celdas. No hay TMDB (otro medio) ni IMDb (no puntúa
                  juegos); IGDB llega ya normalizada sobre 10 desde el proxy. */}
              <div className="ratings-row">
                <div className="ratings-cell">
                  <div className="eyebrow">{tr("Your rating")}</div>
                  <RatingStars value={myRating ?? 0} onRate={(score) => rate.mutate(score)} />
                </div>
                <div className="ratings-divider" />
                <div className="ratings-cell">
                  <div className="eyebrow">IGDB</div>
                  <div className="ratings-value">
                    {title.vote_average ? title.vote_average.toFixed(1) : "—"}
                  </div>
                </div>
              </div>

              {title.overview && (
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{title.overview}</p>
              )}

              {/* Las plataformas, con su fecha cuando IGDB la da por separado:
                  un juego sale cinco veces y "en PS5 ya, en Switch en otoño" es
                  justo lo que se viene a mirar. */}
              {platforms.length > 0 && (
                <div className="flex flex-col gap-2">
                  <div className="eyebrow">{tr("Platforms")}</div>
                  <div className="flex flex-wrap gap-2">
                    {platforms.map((p) => {
                      const own = perPlatform.find(([name]) => name === p)?.[1];
                      return (
                        <span key={p} className="chip" style={{ cursor: "default" }}>
                          {p}
                          {own && (
                            <span className="mute">
                              {formatRelease(own.date, own.precision as never, { es })}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
