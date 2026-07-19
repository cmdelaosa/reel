import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { User, X } from "lucide-react";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { getPerson, tmdbImg } from "@/lib/tmdb";
import { useLibrary } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { dateLocale, isEs, locName, t as tr, useEsNames } from "@/lib/i18n";
import { useOpenTitle, useTitleIntent } from "@/lib/useOpenTitle";
import { deriveStatus } from "@/domain/status";
import type { PersonShow } from "@/lib/schemas";
import { posterBg } from "@/ui/posterBg";
import { Stars } from "@/ui";

/* Actor page (route /person/:id) — every TV credit of an actor, annotated with
   YOUR library status and rating so "have I seen them in something?" answers
   itself. Reached from the detail sheet's cast rail. */

const STATUS_LABEL: Record<string, { en: string; es: string }> = {
  watching: { en: "Watching", es: "Viendo" },
  caughtup: { en: "Caught up", es: "Al día" },
  watchlist: { en: "Not started", es: "Sin empezar" },
  upcoming: { en: "Upcoming", es: "Próxima" },
  finished: { en: "Finished", es: "Terminada" },
  stopped: { en: "Stopped", es: "Abandonada" },
};

function ShowRow({ s, status, myScore, onOpen }: {
  s: PersonShow;
  status: string | null;
  myScore: number | null;
  onOpen: () => void;
}) {
  const esNames = useEsNames();
  const name = locName(esNames, s.tmdb_id, s.name);
  const art = tmdbImg(s.poster_path, "w92");
  const intent = useTitleIntent(s.tmdb_id);
  const lang = dateLocale() === "es-ES" ? "es" : "en";
  return (
    <div className="card mq-row" onClick={onOpen} {...intent}>
      <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
        {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        <div className="poster-sheen" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{name}</div>
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
          <span className="badge badge-soft mute">{tr("Not in your library")}</span>
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
  const { data: ratings = [] } = useMyRatings();

  const byTmdb = useMemo(() => new Map(library.map((s) => [s.tmdb_id, s])), [library]);
  const scoreByTmdb = useMemo(() => new Map(ratings.map((r) => [r.titles.tmdb_id, r.score])), [ratings]);

  const shows = useMemo(() => {
    const rows = (data?.shows ?? []).map((s) => {
      const entry = byTmdb.get(s.tmdb_id);
      const status = entry ? (entry.stopped ? "stopped" : deriveStatus({
        airedCount: entry.aired_count,
        watchedCount: entry.watched_count,
        tmdbStatus: entry.tmdb_status,
      })) : null;
      return { s, status, myScore: scoreByTmdb.get(s.tmdb_id) ?? null };
    });
    // Your shows first (they're why you're here), then by run length.
    return rows.sort((a, b) =>
      Number(Boolean(b.status)) - Number(Boolean(a.status)) ||
      (b.s.episode_count ?? 0) - (a.s.episode_count ?? 0));
  }, [data, byTmdb, scoreByTmdb]);

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
                  age != null && !person.deathday ? (isEs() ? `${age} años` : `${age} years old`) : null,
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
                <h2 className="section-title">{tr("shows").replace(/^./, (c) => c.toUpperCase())}</h2>
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
