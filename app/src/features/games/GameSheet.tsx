import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, ExternalLink, Eye, EyeOff, Library, Minus, Plus, X } from "lucide-react";
import { igdbImg, useGame, useSetGameProgress } from "@/lib/igdb";
import { dateLocale, isEs, t as tr, tGenre, tv } from "@/lib/i18n";
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
import { steamReviewColor, steamReviewLabel } from "@/domain/steamReviews";
import { RatingStars } from "@/ui/RatingStars";
import { PlatformLogo } from "@/ui/PlatformLogo";
import { PlatformPicker } from "@/ui/PlatformPicker";
import { Trailer } from "@/ui/Trailer";
import { SteamIcon } from "@/ui/icons/SteamIcon";
import { FriendsOnTitle } from "@/features/social/FriendsOnTitle";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";

/* Ficha de un juego — la tercera hermana de DetailSheet y MovieSheet, abierta
   por el parámetro global ?game= (un id de IGDB, ver 0071).

   Lo que NO tiene: temporadas, episodios, proveedores, saga. Lo que tiene en su
   lugar es lo único que las otras dos no necesitan — **en qué punto estás**:

     · el estado, que aquí no se puede derivar de contar nada (gameStatus.ts);
     · las horas, a mano, con el tiempo medio de IGDB como denominador;
     · en cuál lo juegas TÚ (0083), que es lo que hace falta para volver a
       ponerte: un juego que tienes en Switch y en PS5 no se retoma igual;
     · las plataformas y su fecha, que en un juego son varias y distintas. Se
       enseñan como LOGOTIPOS (ui/PlatformLogo) y no como una fila de nombres:
       ocho nombres con ocho fechas detrás son dos renglones de texto que nadie
       lee, y las ocho marcas se reconocen de un vistazo. El nombre y la fecha
       están al pasar por encima, que es donde caben sin ocupar sitio.

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

/* Cuánto puede pasarse el «al 100 %» de la cifra normal antes de que deje de
   creerse. Cuatro veces es generoso —hay juegos donde completarlo de verdad
   triplica la historia— y aun así deja fuera lo que no hay por dónde coger:
   Baldur's Gate 3 devuelve 5.650 h contra 132 de media, cuarenta y tres veces.
   El origen del disparate es que IGDB tiene pocas estimaciones por juego y no
   recorta atípicos; nosotros sí. */
const ATIPICO = 4;

export function GameSheet({ igdbId, onClose }: { igdbId: number; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const navigate = useNavigate();
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
  const playedPlatform = entry?.played_platform ?? null;
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


  /* ── Lo que la ficha ampliada necesita derivar (0086) ─────────────────── */

  /** El tráiler que se pinta: el primero, que `videosRecortados` ya ha puesto
   *  ahí por ser el mejor (el de lanzamiento antes que el teaser del anuncio). */
  const trailer = title?.videos?.[0] ?? null;
  const shots = title?.screenshots ?? [];

  /** La etiqueta de Steam se calcula, no se guarda: viene de dos números y
   *  tiene que estar en el idioma de quien mira (domain/steamReviews). */
  const steamLabel = steamReviewLabel(title?.steam_reviews);

  /** A dónde manda el botón: Steam si el juego está en Steam, y si no la web
   *  oficial. Nunca los dos — la pregunta es «¿dónde lo consigo?» y tiene una
   *  respuesta. Sin ninguna de las dos no hay botón, en vez de uno muerto. */
  const tienda = title?.steam_appid
    ? { url: `https://store.steampowered.com/app/${title.steam_appid}/`, steam: true }
    : title?.official_url
      ? { url: title.official_url, steam: false }
      : null;

  /** La clasificación por edad que se enseña: PEGI por ser la de aquí, con ESRB
   *  de respaldo para lo que solo esté clasificado en América. Se guardan todas
   *  (0086) precisamente para que esta preferencia viva aquí y no en el ingest. */
  const edad = (title?.age_ratings ?? []).find((a) => a.org === "PEGI")
    ?? (title?.age_ratings ?? []).find((a) => a.org === "ESRB")
    ?? null;

  /* Las tres estimaciones de IGDB, con la del 100 % descartada cuando es un
     disparate. `completely` llega a veces con datos de risa —Baldur's Gate 3
     devuelve 5.650 h, cuarenta y tres veces su propia media— porque son pocas
     estimaciones y sin recorte de atípicos, y pintarlo daría por bueno un
     número que no lo es. El umbral se mide contra `normally`, que es la cifra
     sólida de las tres. */
  const beats = (() => {
    const b = title?.beat_seconds;
    if (!b) return [] as { label: string; seconds: number }[];
    const normal = b.normally ?? null;
    const out: { label: string; seconds: number }[] = [];
    if (b.hastily) out.push({ label: "Rushed", seconds: b.hastily });
    if (normal) out.push({ label: "Normal", seconds: normal });
    if (b.completely && (!normal || b.completely <= normal * ATIPICO)) {
      out.push({ label: "Completionist", seconds: b.completely });
    }
    return out;
  })();
  /** Cuántas personas sostienen esas cifras. Se enseña SIEMPRE que la haya: sin
   *  ese número, tres cifras redondas se leen como un hecho, y aquí son a veces
   *  veintiocho estimaciones. */
  const ttbCount = title?.beat_seconds?.count ?? null;

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
          width: "min(1180px, 94vw)", maxHeight: "90vh", borderRadius: "var(--r-xl)",
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
            {/* Héroe */}
            <div
              className="relative detail-hero"
              style={{ background: art ? `url(${art}) center/cover` : posterBg(title.name) }}
            >
              <div className="poster-sheen" />
              {/* Dos velos, no uno. El de siempre funde el arte con la hoja; el
                  oscuro es lo que hace legible el título — y hace falta AQUÍ
                  más que en series o en cine, porque la portada de un juego es
                  su logotipo sobre un fondo claro y no un fotograma, así que el
                  blanco sobre blanco es el caso normal y no la excepción.
                  Se vio con Baldur's Gate 3, cuyo arte es dorado: el título no
                  se leía. */}
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 30%, var(--surface) 100%)" }} />
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(6,8,12,.28) 0%, rgba(6,8,12,.46) 46%, rgba(6,8,12,.84) 100%)" }} />
              {/* Las de gestión, agrupadas con la de salir y fuera del cuerpo. */}
              <div className="detail-hero-actions">
                {added && entry ? (
                  <button className="btn btn-sm badge-glass" style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                          onClick={() => unfollow.mutate(entry.title_id)}>
                    <Minus size={14} />{tr("Remove")}
                  </button>
                ) : (
                  <>
                    <button className="btn btn-sm badge-glass" style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                            onClick={() => follow.mutate(title)}>
                      <Plus size={14} />{tr("Add")}
                    </button>
                    <button
                      className="btn btn-sm badge-glass"
                      style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                      onClick={() => (isIgnored(title.tmdb_id, "game") ? unignore.mutate(title.id) : ignore.mutate(title.id))}
                    >
                      {isIgnored(title.tmdb_id, "game") ? <><Eye size={14} />{tr("Un-ignore")}</> : <><EyeOff size={14} />{tr("Ignore")}</>}
                    </button>
                  </>
                )}
                <button className="btn btn-icon badge-glass" style={{ color: "#fff" }} aria-label={tr("Close")} onClick={onClose}>
                  <X size={18} />
                </button>
              </div>

              <div className="absolute flex items-end gap-5" style={{ left: 26, right: 26, bottom: 16 }}>
                <div
                  className="poster"
                  style={{ width: 152, height: 228, flex: "0 0 auto", aspectRatio: "auto", background: posterBg(title.name + "x") }}
                >
                  {cover && <img className="poster-img" src={cover} alt="" />}
                  <div className="poster-sheen" />
                </div>
                <div className="pb-1 min-w-0 flex-1">
                  {/* «Lo tengo» pegado al título, no perdido entre los controles
                      (0083 lo dejaba abajo), y a su derecha las plataformas en
                      las que SALE, solo como logotipos: es un dato del juego, no
                      algo que tú decidas. */}
                  <div className="flex items-center gap-2.5 mb-2">
                    <button
                      type="button"
                      className={`chip${owned ? " chip-active" : ""}`}
                      style={{ height: 26, fontSize: 11.5, padding: "0 11px" }}
                      aria-pressed={owned}
                      disabled={!entry}
                      title={entry ? undefined : tr("Add it to your library first")}
                      onClick={() => entry && setProgress.mutate({ titleId: entry.title_id, owned: !owned })}
                    >
                      {owned ? <><Library size={12} />{tr("Owned")}</> : <><Plus size={12} />{tr("Not owned")}</>}
                    </button>
                    {platforms.length > 0 && (
                      <span className="flex items-center gap-1.5">
                        {platforms.map((p) => (
                          <PlatformLogo
                            key={p}
                            name={p}
                            size={16}
                            hint={perPlatform.find(([name]) => name === p)?.[1]
                              ? formatRelease(perPlatform.find(([name]) => name === p)![1].date, perPlatform.find(([name]) => name === p)![1].precision as never, { es })
                              : null}
                          />
                        ))}
                      </span>
                    )}
                    {!released && <span className="badge badge-accent">{releaseLabel}</span>}
                  </div>
                  <h2 style={{ fontSize: 32, fontWeight: 850, letterSpacing: "-0.02em", textShadow: "0 2px 12px rgba(0,0,0,.5)", color: "#fff", margin: 0 }}>
                    {title.name}
                  </h2>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,.85)", marginTop: 2 }}>
                    {[releaseLabel, title.genres.map(tGenre).join(" · "), title.network].filter(Boolean).join(" · ")}
                  </div>

                  {/* Mi nota la primera y en caja de acento —se pone, no se
                      lee—; las ajenas juntas en una oscura al lado. */}
                  <div className="detail-scores">
                    <div className="detail-mine">
                      <div className="eyebrow" style={{ fontSize: 10, color: "#fff" }}>{tr("My rating")}</div>
                      <RatingStars value={myRating ?? 0} size={30} onRate={(score) => rate.mutate(score)} />
                    </div>
                    <div className="detail-others">
                      <div className="ratings-cell">
                        <div className="eyebrow" style={{ fontSize: 10, color: "rgba(255,255,255,.7)" }}>IGDB</div>
                        <div className="ratings-value" style={{ color: "#fff" }}>
                          {title.vote_average ? title.vote_average.toFixed(1) : "—"}
                        </div>
                      </div>
                      {title.steam_reviews && (
                        <>
                          <span className="detail-others-sep" />
                          <div className="ratings-cell">
                            <div className="eyebrow" style={{ fontSize: 10, color: "rgba(255,255,255,.7)" }}>Steam</div>
                            <div className="ratings-value" style={{ color: steamReviewColor(title.steam_reviews.percent) }}>
                              {title.steam_reviews.percent} %
                            </div>
                            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,.55)" }}>
                              {steamLabel ? tr(steamLabel) : tv("{votes} reviews", { votes: title.steam_reviews.count.toLocaleString(dateLocale()) })}
                            </div>
                          </div>
                        </>
                      )}
                      {title.metacritic != null && (
                        <>
                          <span className="detail-others-sep" />
                          <div className="ratings-cell">
                            <div className="eyebrow" style={{ fontSize: 10, color: "rgba(255,255,255,.7)" }}>Metacritic</div>
                            <span className="metacritic">{title.metacritic}</span>
                          </div>
                        </>
                      )}
                    </div>
                    {/* Steam si lo hay; si no, la web oficial. Nunca los dos:
                        el botón responde «¿dónde lo consigo?» y esa pregunta
                        tiene una respuesta. */}
                    {tienda && (
                      <a className="btn btn-outline btn-sm detail-out" href={tienda.url} target="_blank" rel="noreferrer noopener">
                        {tienda.steam ? <SteamIcon size={14} /> : <ExternalLink size={13} />}
                        {tienda.steam ? tr("View on Steam") : tr("Official site")}
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Cuerpo — lo tuyo a la izquierda, el juego a la derecha */}
            {/* Sin la tarjeta de Estado —o sea, con un juego que no tienes
                añadido— el carril se queda con los amigos y a veces con nada, y
                una columna vacía de 296 px al lado del tráiler es puro hueco.
                Ahí la ficha pasa a UNA columna y el tráiler ocupa el ancho, que
                es lo que se viene a ver de un juego que aún no es tuyo. */}
            <div className={`detail-body${added && entry ? "" : " detail-body-sola"}`}>
              <div className="detail-rail">
                {/* «Estado», una palabra: la tarjeta no lleva solo el estado,
                    lleva también dónde lo juegas y el botón de terminarlo, y es
                    lo que se toca. Sin el juego en la biblioteca no se pinta: no
                    hay fila donde escribir nada. */}
                {added && entry && (
                  <div className="card game-state">
                    <span className="eyebrow">{tr("Status")}</span>
                    <div className="game-states">
                      {PLAY_STATES.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          className={`chip${playState === s.key ? " chip-active" : ""}`}
                          aria-pressed={playState === s.key}
                          onClick={() => pickState(s.key)}
                        >
                          {tr(s.label)}
                        </button>
                      ))}
                    </div>
                    {/* Terminado no se ofrece en un juego sin final: no tiene
                        créditos y el botón prometería algo imposible. */}
                    {episodeId && status !== "ongoing" && (
                      <button
                        className={`btn ${finished ? "btn-outline" : "btn-accent"} w-full`}
                        disabled={markWatched.isPending || unmarkWatched.isPending}
                        onClick={() => (watchEventId ? unmarkWatched.mutate(watchEventId) : markWatched.mutate(episodeId))}
                      >
                        <Check size={16} />
                        {finished ? tr("Finished — tap to clear") : tr("Mark finished")}
                      </button>
                    )}
                    <div style={{ height: 1, background: "var(--border)" }} />
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="eyebrow" style={{ fontSize: 11 }}>{tr("Platform")}</span>
                      <PlatformPicker
                        platforms={platforms}
                        value={playedPlatform}
                        onPick={(name) => setProgress.mutate({ titleId: entry.title_id, playedPlatform: name })}
                        width={150}
                      />
                    </div>
                  </div>
                )}

                {/* Quién de los tuyos anda con esto. La media va junto al
                    rótulo, que es lo que resume la lista de debajo. */}
                <FriendsOnTitle
                  kind="game"
                  titleId={title.id}
                  episodeId={episodeId}
                  tmdbId={title.tmdb_id}
                  released={released}
                  onOpen={(id) => { onClose(); navigate(`/friend/${id}`); }}
                />
              </div>

              <div className="detail-main">
                {trailer && <Trailer videoId={trailer.video_id} name={trailer.name} still={shots[0] ?? title.backdrop_path} />}
                {shots.length > 0 && (
                  <div className="game-shots">
                    {shots.slice(0, 5).map((id) => (
                      <span key={id} className="game-shot">
                        <img src={igdbImg(id, "screenshot_med")} alt="" loading="lazy" />
                      </span>
                    ))}
                  </div>
                )}

                {title.overview && (
                  <p className="dim" style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{title.overview}</p>
                )}

                {/* Time to beat: las estimaciones de IGDB y tus horas juntas, y
                    aquí —y en ningún otro sitio— los controles para cambiarlas.
                    Salían dos veces, en el carril y aquí. */}
                {(beats.length > 0 || added) && (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-baseline justify-between gap-2.5">
                      <span className="eyebrow">Time to beat</span>
                      {ttbCount != null && (
                        <span className="mute" style={{ fontSize: 11 }}>
                          {tv("{n} estimates from IGDB", { n: ttbCount.toLocaleString(dateLocale()) })}
                        </span>
                      )}
                    </div>
                    <div className="ttb">
                      {beats.map((b) => (
                        <div key={b.label} className="ttb-cell">
                          <span className="ttb-num">{formatPlaytime(Math.round(b.seconds / 60))}</span>
                          <span className="mute" style={{ fontSize: 11 }}>{tr(b.label)}</span>
                        </div>
                      ))}
                      {added && (
                        <div className="ttb-cell mine">
                          <span className="ttb-num">{formatPlaytime(minutes)}</span>
                          <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>{tr("My playtime")}</span>
                        </div>
                      )}
                    </div>
                    {progress != null && (
                      <div className="flex items-center gap-2">
                        <span className="pbar pbar-inline flex-1"><i style={{ width: `${Math.min(progress, 100)}%` }} /></span>
                        <span className="mute" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{progress} %</span>
                      </div>
                    )}
                    {added && entry && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          className="input"
                          style={{ width: 74, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
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
                        <span className="mute" style={{ fontSize: 12.5 }}>
                          {tr("hours played")}
                          {fromSteam && <span style={{ fontSize: 11.5 }}> · {tr("from Steam")}</span>}
                        </span>
                        {BUMPS.map((m) => (
                          <button key={m} className="btn btn-outline btn-sm" onClick={() => bump(m)}>
                            +{formatPlaytime(m)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* La edad y la ficha, en una línea al pie. */}
                <div className="game-foot">
                  {edad && (
                    <span className="age">
                      <span className="age-box">{edad.rating}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{edad.org} {edad.rating}</span>
                    </span>
                  )}
                  {edad && <span className="game-foot-sep" />}
                  <div className="game-facts">
                    <div><span className="mute">{tr("Developer")}</span><span>{title.network ?? "—"}</span></div>
                    <div><span className="mute">{tr("Publisher")}</span><span>{title.publisher ?? "—"}</span></div>
                  </div>
                  <span className="game-foot-sep" />
                  <div className="game-facts">
                    <div><span className="mute">{tr("Genres")}</span><span>{title.genres.map(tGenre).join(" · ") || "—"}</span></div>
                    <div><span className="mute">{tr("Modes")}</span><span>{(title.game_modes ?? []).map((m) => tr(m)).join(" · ") || "—"}</span></div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
