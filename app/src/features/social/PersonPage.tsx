import { useMemo } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { User } from "lucide-react";
import { getPerson, tmdbImg } from "@/lib/tmdb";
import { useLibrary } from "@/lib/library";
import { useMyRatings } from "@/lib/ratings";
import { dateLocale, locName, t as tr, useEsNames } from "@/lib/i18n";
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
  const photo = tmdbImg(person?.profile_path, "w342");

  return (
    <div className="screen mq-page">
      {isPending && <div className="dim">{tr("Loading…")}</div>}
      {person && (
        <>
          <div className="card p-5 flex items-center gap-4">
            <span
              className="grid place-items-center overflow-hidden"
              style={{
                width: 84, height: 84, borderRadius: "50%", background: "var(--surface-3)",
                border: "1px solid var(--border)", flex: "0 0 auto", color: "var(--text-dim)",
              }}
            >
              {photo ? (
                <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <User size={34} />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="mq-h1" style={{ fontSize: 24 }}>{person.name}</h1>
              <p className="dim" style={{ fontSize: 13, margin: "3px 0 0" }}>
                {[
                  person.birthday
                    ? new Date(person.birthday).toLocaleDateString(dateLocale(), { year: "numeric", month: "long", day: "numeric" })
                    : null,
                  person.place_of_birth,
                ].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <div className="mq-sechead">
              <div>
                <h2 className="section-title">{tr("shows").replace(/^./, (c) => c.toUpperCase())}</h2>
                <p className="mute" style={{ fontSize: 13 }}>
                  {shows.filter((r) => r.status).length} {tr("in your library")}
                </p>
              </div>
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
              {shows.map(({ s, status, myScore }) => (
                <ShowRow key={s.tmdb_id} s={s} status={status} myScore={myScore} onOpen={() => open(s.tmdb_id)} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
