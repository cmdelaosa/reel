import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronDown, ChevronUp, ExternalLink, Eye, EyeOff, Library, Minus, Plus, Star, X } from "lucide-react";
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
  type PlayState,
} from "@/domain/gameStatus";
import { formatRelease, isReleased } from "@/domain/gameRelease";
import { steamReviewColor, steamReviewLabel } from "@/domain/steamReviews";
import { RatingStars } from "@/ui/RatingStars";
import { PlatformLogo } from "@/ui/PlatformLogo";
import { PlatformPicker } from "@/ui/PlatformPicker";
import { Trailer } from "@/ui/Trailer";
import { FriendsOnTitle } from "@/features/social/FriendsOnTitle";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { Lightbox } from "@/ui/Lightbox";
import { useFriendsOnTitle } from "@/lib/friendsOnTitle";

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

  /* El campo de horas es un borrador local: escribir "1" mientras tecleas "18"
     no puede escribir 1 en la base y volver. Se confirma al salir del campo o
     con Enter. Los botones de +30 min sí escriben directos, que es su gracia. */
  /* La carátula a tamaño completo, las capturas y la lista de amigos: los tres
     plegados. La media de amigos sale de las MISMAS filas que pinta
     FriendsOnTitle al desplegarla, no de la consulta de gustos, para que el
     número resuma exactamente esa lista. */
  const [coverOpen, setCoverOpen] = useState(false);
  const [shotOpen, setShotOpen] = useState<number | null>(null);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const amigos = useFriendsOnTitle({ titleId: title?.id ?? null, episodeId, kind: "game", tmdbId: title?.tmdb_id ?? 0 });
  const puntuadas = amigos.map((f) => f.score).filter((s): s is number => s != null);
  const friendsAvg = puntuadas.length
    ? puntuadas.reduce((suma, s) => suma + s, 0) / puntuadas.length
    : null;

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
  /* Para el visor, el tamaño grande de IGDB: `cover_big` mide 264px de
     ancho y a pantalla completa se ve el pixelado. */
  const coverFull = igdbImg(title?.poster_path, "1080p");
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
                    <Minus size={14} /><span className="btn-label">{tr("Remove")}</span>
                  </button>
                ) : (
                  <>
                    <button className="btn btn-sm badge-glass" style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                            onClick={() => follow.mutate(title)}>
                      <Plus size={14} /><span className="btn-label">{tr("Add")}</span>
                    </button>
                    <button
                      className="btn btn-sm badge-glass"
                      style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                      onClick={() => (isIgnored(title.tmdb_id, "game") ? unignore.mutate(title.id) : ignore.mutate(title.id))}
                    >
                      {isIgnored(title.tmdb_id, "game") ? <><Eye size={14} /><span className="btn-label">{tr("Un-ignore")}</span></> : <><EyeOff size={14} /><span className="btn-label">{tr("Ignore")}</span></>}
                    </button>
                  </>
                )}
                <button className="btn btn-icon badge-glass" style={{ color: "#fff" }} aria-label={tr("Close")} onClick={onClose}>
                  <X size={18} />
                </button>
              </div>

              <div className="detail-hero-foot">
                <div
                  className={`poster detail-poster${cover ? " zoomable" : ""}`}
                  role={cover ? "button" : undefined}
                  tabIndex={cover ? 0 : undefined}
                  aria-label={cover ? tr("View cover") : undefined}
                  onClick={cover ? () => setCoverOpen(true) : undefined}
                  onKeyDown={cover ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCoverOpen(true); } } : undefined}
                  style={{ background: posterBg(title.name + "x") }}
                >
                  {cover && <img className="poster-img" src={cover} alt="" />}
                  <div className="poster-sheen" />
                </div>
                <div className="pb-1 min-w-0 flex-1">
                  {/* «Lo tengo» encima de los logos y pegado a la carátula: es
                      lo primero que se mira de un juego —si está en tu
                      estantería o no—, y es un botón, no una etiqueta. Debajo,
                      las plataformas en las que SALE, solo como logotipos: eso
                      es un dato del juego, no algo que tú decidas. */}
                  <div className="game-badges">
                    <button
                      type="button"
                      className={`game-own ${owned ? "si" : "no"}`}
                      aria-pressed={owned}
                      disabled={!entry}
                      title={entry ? undefined : tr("Add it to your library first")}
                      onClick={() => entry && setProgress.mutate({ titleId: entry.title_id, owned: !owned })}
                    >
                      {owned ? <><Library size={12} />{tr("Owned")}</> : <><Plus size={12} />{tr("Not owned")}</>}
                    </button>
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
                      {!released && <span className="badge badge-accent">{releaseLabel}</span>}
                    </span>
                  </div>
                  <h2 className="detail-title">{title.name}</h2>
                  <div className="detail-meta">
                    {[releaseLabel, title.genres.map(tGenre).join(" · "), title.network].filter(Boolean).join(" · ")}
                  </div>
                  {edad && (
                    <div className="detail-sub">{edad.org} {edad.rating}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Cuerpo, en una sola columna */}
            <div className="detail-body">
              {/* Las notas, sobre el fondo. La tuya manda y las cuatro de fuera
                  van juntas a la derecha, con la de tus amigos a su izquierda.
                  El enlace a la tienda no es un botón aparte: es la propia
                  celda de Steam, con su flecha. */}
              <div className="detail-scores">
                <div className="detail-mine">
                  <span className="eyebrow" style={{ fontSize: 10.5 }}>{tr("My rating")}</span>
                  <RatingStars value={myRating ?? 0} size={28} onRate={(score) => rate.mutate(score)} />
                </div>
                <div className="detail-others">
                  {amigos.length > 0 && (
                    <>
                      <button
                        className="detail-cell detail-friends"
                        aria-expanded={friendsOpen}
                        onClick={() => setFriendsOpen((v) => !v)}
                      >
                        <span className="eyebrow" style={{ fontSize: 10 }}>{tr("Friends")}</span>
                        <span className="detail-cellval">
                          <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                          {friendsAvg != null ? friendsAvg.toLocaleString(dateLocale(), { maximumFractionDigits: 1 }) : "—"}
                          {friendsOpen ? <ChevronUp size={14} style={{ color: "var(--text-mute)" }} /> : <ChevronDown size={14} style={{ color: "var(--text-mute)" }} />}
                        </span>
                      </button>
                      <span className="detail-others-sep" />
                    </>
                  )}
                  <div className="detail-cell">
                    <span className="eyebrow" style={{ fontSize: 10 }}>IGDB</span>
                    <span className="detail-cellval">
                      <Star size={15} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                      {title.vote_average ? title.vote_average.toFixed(1) : "—"}
                    </span>
                  </div>
                  {title.steam_reviews && (
                    <>
                      <span className="detail-others-sep" />
                      {/* La etiqueta larga («Extremadamente positivas») pasa al
                          title: escrita bajo el número hacía esta fila más alta
                          que la de las otras dos fichas, y el porcentaje ya
                          dice lo mismo con un vistazo. */}
                      {tienda?.steam ? (
                        <a
                          className="detail-cell detail-out"
                          href={tienda.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={steamLabel ? tr(steamLabel) : tv("{votes} reviews", { votes: title.steam_reviews.count.toLocaleString(dateLocale()) })}
                        >
                          <span className="eyebrow" style={{ fontSize: 10 }}>Steam</span>
                          <span className="detail-cellval" style={{ color: steamReviewColor(title.steam_reviews.percent) }}>
                            {title.steam_reviews.percent} %
                            <ExternalLink size={12} />
                          </span>
                        </a>
                      ) : (
                        <div
                          className="detail-cell"
                          title={steamLabel ? tr(steamLabel) : tv("{votes} reviews", { votes: title.steam_reviews.count.toLocaleString(dateLocale()) })}
                        >
                          <span className="eyebrow" style={{ fontSize: 10 }}>Steam</span>
                          <span className="detail-cellval" style={{ color: steamReviewColor(title.steam_reviews.percent) }}>
                            {title.steam_reviews.percent} %
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  {title.metacritic != null && (
                    <>
                      <span className="detail-others-sep" />
                      <div className="detail-cell">
                        <span className="eyebrow" style={{ fontSize: 10 }}>Metacritic</span>
                        <span className="metacritic">{title.metacritic}</span>
                      </div>
                    </>
                  )}
                  {/* Sin Steam, la web oficial: el enlace responde «¿dónde lo
                      consigo?» y esa pregunta tiene una sola respuesta. */}
                  {tienda && !tienda.steam && (
                    <>
                      <span className="detail-others-sep" />
                      <a className="detail-cell detail-out" href={tienda.url} target="_blank" rel="noreferrer noopener">
                        <span className="eyebrow" style={{ fontSize: 10 }}>{tr("Official site")}</span>
                        <span className="detail-cellval"><ExternalLink size={14} /></span>
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/* Quién de los tuyos anda con esto, al desplegar su celda. */}
              {friendsOpen && (
                <FriendsOnTitle
                  kind="game"
                  titleId={title.id}
                  episodeId={episodeId}
                  tmdbId={title.tmdb_id}
                  released={released}
                  onOpen={(id) => { onClose(); navigate(`/friend/${id}`); }}
                />
              )}

              {/* En qué punto estás: los cuatro estados en una fila y, debajo,
                  terminarlo junto a en cuál lo juegas — las dos cosas que se
                  tocan cuando ya lo tienes. Sin rótulo «Estado» encima: las
                  cuatro palabras ya dicen lo que son. Sin el juego en la
                  biblioteca no se pinta: no hay fila donde escribir nada. */}
              {added && entry && (
                <div className="card game-state">
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
                  <div className="game-done">
                    {/* Terminado no se ofrece en un juego sin final: no tiene
                        créditos y el botón prometería algo imposible. */}
                    {episodeId && status !== "ongoing" && (
                      <button
                        className={`btn ${finished ? "btn-outline" : "btn-accent"}`}
                        disabled={markWatched.isPending || unmarkWatched.isPending}
                        onClick={() => (watchEventId ? unmarkWatched.mutate(watchEventId) : markWatched.mutate(episodeId))}
                      >
                        <Check size={16} />
                        {finished ? tr("Finished — tap to clear") : tr("Mark finished")}
                      </button>
                    )}
                    <span className="game-plat">
                      <span className="eyebrow">{tr("Platform")}:</span>
                      <PlatformPicker
                        platforms={platforms}
                        value={playedPlatform}
                        onPick={(name) => setProgress.mutate({ titleId: entry.title_id, playedPlatform: name })}
                      />
                    </span>
                  </div>
                </div>
              )}

              <div className="detail-main">
                {trailer && <Trailer videoId={trailer.video_id} name={trailer.name} portada={igdbImg(shots[0] ?? title.backdrop_path, "screenshot_big")} />}
                {shots.length > 0 && (
                  <div className="game-shots">
                    {shots.slice(0, 5).map((id, i) => (
                      <button
                        key={id}
                        type="button"
                        className="game-shot zoomable"
                        aria-label={tv("Screenshot {n}", { n: i + 1 })}
                        onClick={() => setShotOpen(i)}
                      >
                        <img src={igdbImg(id, "screenshot_med")} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}

                {title.overview && (
                  <p className="dim" style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{title.overview}</p>
                )}

                {/* Tus horas mandan y las de fuera se arriman: una tarjeta con
                    lo tuyo grande a la izquierda —y aquí, y en ningún otro
                    sitio, los controles para cambiarlo— y las tres de How Long
                    To Beat apiladas y pequeñas a la derecha.

                    Estuvieron las cuatro en fila, con una barra de progreso
                    debajo: comparar tus horas con las de una partida normal
                    pedía mirar a dos sitios, y la barra decía en porcentaje lo
                    que los dos números ya dicen mejor. */}
                {(beats.length > 0 || added) && (
                  <div className="flex flex-col gap-2.5">
                    <span className="eyebrow">{tr("My playtime")}</span>
                    <div className="ttb">
                      <div className="ttb-mine">
                        {added ? (
                          <>
                            <span className="ttb-num">{formatPlaytime(minutes)}</span>
                            <input
                              className="input"
                              style={{ width: 74, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                              inputMode="decimal"
                              aria-label={tr("Hours played")}
                              value={shownHours}
                              placeholder="0"
                              disabled={!entry}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={commitHours}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") setDraft(null);
                              }}
                            />
                            {BUMPS.map((m) => (
                              <button key={m} className="btn btn-outline btn-sm" onClick={() => bump(m)}>
                                +{formatPlaytime(m)}
                              </button>
                            ))}
                            {fromSteam && <span className="mute" style={{ fontSize: 11.5 }}>{tr("from Steam")}</span>}
                          </>
                        ) : (
                          <span className="mute" style={{ fontSize: 12.5 }}>{tr("Add it to your library first")}</span>
                        )}
                      </div>
                      {beats.length > 0 && (
                        <>
                          <span className="ttb-sep" />
                          <div className="ttb-list">
                            <span
                              className="eyebrow"
                              style={{ fontSize: 10, marginBottom: 3 }}
                              title={ttbCount != null ? tv("{n} estimates from IGDB", { n: ttbCount.toLocaleString(dateLocale()) }) : undefined}
                            >
                              How Long To Beat
                            </span>
                            {beats.map((b) => (
                              <span key={b.label} className="ttb-row">
                                <span className="mute">{tr(b.label)}</span>
                                <span>{formatPlaytime(Math.round(b.seconds / 60))}</span>
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* La ficha del juego, al pie. */}
                <div className="game-facts">
                  <div><span className="mute">{tr("Developer")}</span><span>{title.network ?? "—"}</span></div>
                  <div><span className="mute">{tr("Genres")}</span><span>{title.genres.map(tGenre).join(" · ") || "—"}</span></div>
                  <div><span className="mute">{tr("Publisher")}</span><span>{title.publisher ?? "—"}</span></div>
                  <div><span className="mute">{tr("Modes")}</span><span>{(title.game_modes ?? []).map((m) => tr(m)).join(" · ") || "—"}</span></div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* La carátula y las capturas, a tamaño completo. Las capturas comparten
          visor y se pasan con las flechas: mirarlas de una en una, cerrando y
          abriendo, era el mismo gesto cinco veces. */}
      {coverOpen && coverFull && (
        <Lightbox
          imagenes={[coverFull]}
          indice={0}
          onClose={() => setCoverOpen(false)}
          etiqueta={`${title?.name ?? ""} — ${tr("View cover")}`}
        />
      )}
      {shotOpen != null && shots.length > 0 && (
        <Lightbox
          imagenes={shots.slice(0, 5).map((id) => igdbImg(id, "1080p")!)}
          indice={shotOpen}
          onIndice={setShotOpen}
          onClose={() => setShotOpen(null)}
          etiqueta={tv("Screenshot {n}", { n: shotOpen + 1 })}
        />
      )}
    </>
  );
}
