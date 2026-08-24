import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { User, X } from "lucide-react";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { getPerson, tmdbImg } from "@/lib/tmdb";
import { useLibrary, useMovieLibrary } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { dateLocale, isEs, locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { useOpenTitle, useTitleIntent } from "@/lib/useOpenTitle";
import { deriveStatus } from "@/domain/status";
import { deriveMovieStatus } from "@/domain/movieStatus";
import type { LibraryRow, PersonShow } from "@/lib/schemas";
import { MediumGlyph } from "@/ui/MediumGlyph";
import { posterBg } from "@/ui/posterBg";
import { Stars } from "@/ui";

/* Actor page (route /person/:id) — every credit of a person, annotated with
   YOUR library status and rating so "have I seen them in something?" answers
   itself. Reached from the cast rail of either detail sheet, and desde 0069
   también desde la dirección de una película.

   UNA LISTA, los dos medios, con el glifo por fila (decisión de producto,
   24-ago-2026). No dos secciones ni dos pestañas: la mayoría de la gente solo
   tiene un medio, y quien tiene los dos —Villeneuve, Fincher— suele venir justo
   a ver la carrera entera de una vez. */

const STATUS_LABEL: Record<string, { en: string; es: string }> = {
  watching: { en: "Watching", es: "Viendo" },
  caughtup: { en: "Caught up", es: "Al día" },
  watchlist: { en: "Not started", es: "Sin empezar" },
  upcoming: { en: "Upcoming", es: "Próxima" },
  finished: { en: "Finished", es: "Terminada" },
  stopped: { en: "Stopped", es: "Abandonada" },
  // Los tres del cine (domain/movieStatus). "watchlist" y "upcoming" los
  // comparte con las series y ya están arriba; solo falta el suyo propio.
  watched: { en: "Watched", es: "Vista" },
};

function ShowRow({ s, status, myScore, onOpen }: {
  s: PersonShow;
  status: string | null;
  myScore: number | null;
  onOpen: () => void;
}) {
  const esNames = useEsNames();
  const name = locName(esNames, s.tmdb_id, s.name, s.kind === "game" ? "tv" : s.kind);
  const art = tmdbImg(s.poster_path, "w92");
  // Solo en series: lo que precarga son temporadas y episodios.
  const intent = useTitleIntent(s.kind === "tv" ? s.tmdb_id : undefined);
  const lang = dateLocale() === "es-ES" ? "es" : "en";
  return (
    <div className="card mq-row" onClick={onOpen} {...intent}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <MediumGlyph kind={s.kind} size={12} />
          <span className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{name}</span>
        </div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {[s.first_air_date?.slice(0, 4), s.character].filter(Boolean).join(" · ")}
        </div>
        {myScore != null && <div style={{ marginTop: 4 }}><Stars score={myScore} size={13} /></div>}
      </div>
      <div className="flex flex-col items-end gap-1.5" style={{ flex: "0 0 auto" }}>
        {status ? (
          <span className="badge badge-accent" style={{ fontWeight: 700 }}>
            {STATUS_LABEL[status]?.[lang] ?? status}
          </span>
        ) : (
          /* "Not in your library" / "No está en tu biblioteca" was 175px of a
             328px row, which left the show title 47px — every credit you don't
             follow rendered as "Uncl…". Two words in the same family as the
             status labels beside it ("Not started", "Not following") fit the
             same column as those do, so the title gets the width back at every
             size rather than only under a breakpoint, and nothing is lost: the
             app already calls these "the shows you follow". */
          <span className="badge badge-soft mute">{tr("Not following")}</span>
        )}
        {myScore != null && <span className="mq-score" style={{ fontSize: 15 }}>{myScore}<span>/10</span></span>}
      </div>
    </div>
  );
}

export default function PersonPage() {
  const { id } = useParams();
  const personId = Number(id);
  const open = useOpenTitle();
  const { data, isPending } = useQuery({
    queryKey: ["person", personId],
    enabled: Number.isFinite(personId),
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: () => getPerson(personId),
  });
  const { data: library = [] } = useLibrary();
  const { data: movies = [] } = useMovieLibrary();
  const { data: ratings = [] } = useMyRatings();

  /* Las claves llevan el medio: un id de TMDB solo es único dentro del suyo
     (0067), y aquí conviven los dos en la misma lista — sin él, la película
     1399 saldría marcada con el estado de la serie 1399. */
  const byKey = useMemo(() => {
    // LibraryRow, no LibraryShow ni LibraryMovie: de las dos solo se leen las
    // columnas que comparten (los recuentos, stopped, el estado de TMDB), y el
    // estado se deriva aquí abajo con la función de cada medio.
    const m = new Map<string, LibraryRow>();
    for (const s of library) m.set(`tv:${s.tmdb_id}`, s);
    for (const x of movies) m.set(`movie:${x.tmdb_id}`, x);
    return m;
  }, [library, movies]);
  const scoreByKey = useMemo(
    () => new Map(ratings.map((r) => [`${r.titles.kind}:${r.titles.tmdb_id}`, r.score])),
    [ratings],
  );

  const shows = useMemo(() => {
    const rows = (data?.shows ?? []).map((s) => {
      const key = `${s.kind}:${s.tmdb_id}`;
      const entry = byKey.get(key);
      /* `stopped` se mira solo en series: es una columna de library_entries
         que existe para los dos medios, pero el cine no tiene ese estado —una
         peli no se deja a medias— y una fila marcada en la época en que el
         botón existía pintaría aquí una etiqueta que el modo cine eliminó. */
      const status = !entry ? null
        : entry.stopped && s.kind === "tv" ? "stopped"
        : s.kind === "movie"
          ? deriveMovieStatus({ airedCount: entry.aired_count, watchedCount: entry.watched_count })
          : deriveStatus({
              airedCount: entry.aired_count,
              watchedCount: entry.watched_count,
              tmdbStatus: entry.tmdb_status,
            });
      return { s, status, myScore: scoreByKey.get(key) ?? null };
    });
    /* Lo tuyo primero (es a lo que vienes), y después las dos carreras
       ENTRELAZADAS, no encadenadas.

       El proxy manda los créditos ya ordenados, cada medio por su vara —una
       serie por los episodios que hizo, una película por su popularidad— pero
       los manda seguidos: primero todas las series, luego todas las películas.
       Respetar ese orden tal cual enterraba la filmografía de cine de cualquiera
       con veinte créditos de televisión, que es justo lo que esta pantalla
       acaba de dejar de hacer.

       Así que cada crédito compite por su POSICIÓN dentro de su propio medio: el
       mejor de series junto al mejor de cine, el segundo con el segundo. Es la
       única comparación honesta entre dos escalas que no comparten unidad, y
       deja arriba lo que de verdad conoces de esa persona en cualquiera de los
       dos. Empates, a lo más reciente. */
    const rank = new Map<string, number>();
    const seenPerKind: Record<string, number> = { tv: 0, movie: 0 };
    for (const r of rows) {
      const key = `${r.s.kind}:${r.s.tmdb_id}`;
      rank.set(key, seenPerKind[r.s.kind]++);
    }
    const rankOf = (r: (typeof rows)[number]) => rank.get(`${r.s.kind}:${r.s.tmdb_id}`) ?? 0;
    return rows.sort((a, b) =>
      Number(Boolean(b.status)) - Number(Boolean(a.status)) ||
      rankOf(a) - rankOf(b) ||
      (b.s.first_air_date ?? "").localeCompare(a.s.first_air_date ?? ""));
  }, [data, byKey, scoreByKey]);

  const person = data?.person;
  const photo = tmdbImg(person?.profile_path, "h632");
  // The bio stays clamped in the card; the full text opens in a dialog instead of
  // pushing the header taller — a long biography doubled the card's height and
  // shoved the credits below the fold.
  const [bioOpen, setBioOpen] = useState(false);
  const [bioClamped, setBioClamped] = useState(false);

  const fmtLong = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale(), { year: "numeric", month: "long", day: "numeric" });
  // Age today, or at death when there's a deathday.
  const age = person?.birthday ? (() => {
    const b = new Date(person.birthday!);
    const end = person.deathday ? new Date(person.deathday) : new Date();
    let a = end.getFullYear() - b.getFullYear();
    if (end.getMonth() - b.getMonth() < 0 || (end.getMonth() === b.getMonth() && end.getDate() < b.getDate())) a--;
    return a;
  })() : null;
  const bio = person ? ((isEs() && person.biography_es) || person.biography || null) : null;

  return (
    <div className="screen mq-page">
      {isPending && <div className="dim">{tr("Loading…")}</div>}
      {person && (
        <>
          <div className="card p-5 flex items-start gap-5">
            <div
              className="grid place-items-center overflow-hidden"
              style={{
                width: "min(170px, 32vw)", aspectRatio: "2 / 3", borderRadius: "var(--r-lg)",
                background: "var(--surface-3)", border: "1px solid var(--border)",
                flex: "0 0 auto", color: "var(--text-dim)",
              }}
            >
              {photo ? (
                <img src={photo} alt={person.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                <User size={44} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="mq-h1" style={{ fontSize: 24 }}>{person.name}</h1>
              {person.known_for_department && (
                <p className="mute" style={{ fontSize: 12.5, fontWeight: 650, margin: "2px 0 0" }}>
                  {tr("Known for")}: {tr(person.known_for_department)}
                </p>
              )}
              <p className="dim" style={{ fontSize: 13, margin: "4px 0 0" }}>
                {[
                  person.birthday
                    ? person.deathday
                      ? `${fmtLong(person.birthday)} – ${fmtLong(person.deathday)}`
                      : fmtLong(person.birthday)
                    : null,
                  age != null && !person.deathday ? tv("{age} years old", { age }) : null,
                  person.place_of_birth,
                ].filter(Boolean).join(" · ")}
              </p>
              {bio && (
                <div style={{ marginTop: 12 }}>
                  <p
                    className="dim"
                    // The toggle only shows when the clamp actually cut something.
                    ref={(el) => { if (el) setBioClamped(el.scrollHeight > el.clientHeight + 1); }}
                    style={{
                      fontSize: 13.5, lineHeight: 1.6, margin: 0, whiteSpace: "pre-line",
                      display: "-webkit-box", WebkitLineClamp: 6, WebkitBoxOrient: "vertical" as const, overflow: "hidden",
                    }}
                  >
                    {bio}
                  </p>
                  {bioClamped && (
                    <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, marginLeft: -10 }} onClick={() => setBioOpen(true)}>
                      {tr("Read more")}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <div className="mq-sechead">
              <div>
                <h2 className="section-title">{tr("Filmography")}</h2>
              </div>
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
              {shows.map(({ s, status, myScore }) => (
                <ShowRow key={s.tmdb_id} s={s} status={status} myScore={myScore} onOpen={() => open(s.tmdb_id)} />
              ))}
            </div>
          </section>

          {bioOpen && bio && (
            <BioDialog name={person.name} bio={bio} onClose={() => setBioOpen(false)} />
          )}
        </>
      )}
    </div>
  );
}

/** Full biography in a dialog. Same idiom as the other modals in the app:
 *  .backdrop + .sheet-center, focus trapped, Escape to close. */
function BioDialog({ name, bio, onClose }: { name: string; bio: string; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        className="sheet-center fixed z-[70] card flex flex-col"
        style={{
          left: "50%", top: "50%", transform: "translate(-50%,-50%)",
          width: "min(620px, 92vw)", maxHeight: "82vh", borderRadius: "var(--r-xl)",
        }}
      >
        <div
          className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="truncate" style={{ fontWeight: 800, fontSize: 16 }}>{name}</div>
          <button className="btn btn-ghost btn-icon" aria-label={tr("Close")} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {/* The dialog scrolls, not the page behind it — a long bio would otherwise
            grow the card past the viewport again, which is the thing being fixed. */}
        <div className="px-5 py-4" style={{ overflowY: "auto" }}>
          <p className="dim" style={{ fontSize: 14, lineHeight: 1.7, margin: 0, whiteSpace: "pre-line" }}>
            {bio}
          </p>
        </div>
      </div>
    </>
  );
}
