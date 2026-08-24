import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMovieReleases } from "@/lib/movies";
import { useMovieLibrary, type LibraryMovie } from "@/lib/library";
import { MovieReleaseRow } from "@/features/movies/MovieReleaseRow";
import type { MovieRelease } from "@/lib/schemas";
import { dayLabel, dayOffset } from "@/domain/calendar";
import { airTimeZone } from "@/lib/region";
import { dateLocale, locName, t as tr, useEsNames } from "@/lib/i18n";
import { TabMenu } from "@/ui";
import { RowsSkeleton } from "@/ui/Skeleton";

/* Estrenos — el calendario del cine. Gemelo de CalendarPage: mismo feed
   cronológico con separadores por día, misma píldora flotante de pestañas,
   misma historia perezosa hacia atrás.

   Tres vistas, y las tres responden preguntas distintas:
     · Mis estrenos — el feed, pasado y futuro, de las películas que sigues.
     · En cines — las tuyas que YA están en salas y todavía no en casa: lo
       único de la lista que exige salir, y por tanto lo que caduca.
     · Anunciadas — las que aún no se han estrenado en ningún sitio, por mes.

   Sin lotes agrupados, al revés que el calendario de series: allí una serie
   suelta seis episodios el mismo día y hay que plegarlos; aquí cada fila es una
   película y como mucho sale dos veces, en dos días distintos. */

type View = "feed" | "theatres" | "announced";

export default function MovieReleasesPage() {
  const [view, setView] = useState<View>("feed");
  const tabs: { key: View; label: string }[] = [
    { key: "feed", label: tr("My releases") },
    { key: "theatres", label: tr("In theatres") },
    { key: "announced", label: tr("tab: Announced") },
  ];

  return (
    <div className="screen mq-page cal-page">
      <div className="cal-tabsbar">
        <div className="segmented scroll no-scrollbar">
          {tabs.map((t) => (
            <div key={t.key} className={`seg ${view === t.key ? "seg-active" : ""}`} onClick={() => setView(t.key)}>
              {t.label}
            </div>
          ))}
        </div>
        <TabMenu value={view} options={tabs} onPick={setView} menuLabel={tr("Releases")} align="center" floating />
      </div>

      {view === "feed" ? <ReleaseFeed /> : <PendingList kind={view} />}
    </div>
  );
}

/** El texto del separador de un día del feed.
 *
 *  Delega en dayLabel mientras su respuesta signifique algo —hoy, mañana y la
 *  semana que viene— y a partir de ahí escribe la fecha entera. El calendario
 *  de series nunca necesitó esto porque solo mira 60 días hacia delante; aquí la
 *  ventana son dos años y medio, que es lo que tarda en anunciarse una película.
 */
function daySeparator(key: string, now: Date, tz: string): string {
  const iso = `${key}T12:00:00Z`;
  const off = dayOffset(iso, now, tz);
  if (off <= 7) return dayLabel(off, iso, dateLocale(), tz);
  return new Date(iso)
    .toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric", timeZone: tz })
    .toUpperCase();
}

/** Agrupa por día local, igual que groupFeed hace con los episodios. Aquí no se
 *  reutiliza aquel: espera filas con episodio y temporada, y lo único que hace
 *  falta de él es la clave del día — que es una línea. */
function byDay(rows: MovieRelease[], tz: string): [string, MovieRelease[]][] {
  const days = new Map<string, MovieRelease[]>();
  for (const r of rows) {
    const key = new Date(r.release_at).toLocaleDateString("en-CA", { timeZone: tz });
    const held = days.get(key);
    if (held) held.push(r);
    else days.set(key, [r]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function ReleaseFeed() {
  const [weeksBack, setWeeksBack] = useState(8);
  const { data: rows = [], isPending, isPlaceholderData } = useMovieReleases(weeksBack);
  const now = useMemo(() => new Date(), []);
  const tz = airTimeZone();

  const topRef = useRef<HTMLDivElement | null>(null);
  const todayRef = useRef<HTMLDivElement | null>(null);
  const prevH = useRef(0);
  const anchored = useRef(false);

  const days = useMemo(() => byDay(rows, tz), [rows, tz]);
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: tz });


  /* Historia perezosa hacia atrás, con la misma mecánica que el calendario de
     series: un centinela arriba pide más semanas, y el salto que produce
     anteponer contenido se compensa a mano. Los pasos son mucho más grandes
     —ocho semanas, no tres— porque en cine hay muchos menos eventos: tres
     semanas de estrenos tuyos pueden ser cero filas, y un centinela que no
     encuentra nada que enseñar se dispara otra vez y otra. */
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (ents) => {
        const scrollable = document.documentElement.scrollHeight > window.innerHeight + 200;
        if (ents[0].isIntersecting && anchored.current && scrollable && weeksBack < 260 && !isPending) {
          prevH.current = document.documentElement.scrollHeight;
          setWeeksBack((w) => w + 8);
        }
      },
      { rootMargin: "300px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [weeksBack, isPending]);

  useLayoutEffect(() => {
    if (prevH.current) {
      const delta = document.documentElement.scrollHeight - prevH.current;
      if (delta > 0) window.scrollBy(0, delta);
      prevH.current = 0;
    }
  }, [rows]);

  // Abrir por HOY, no por el principio: lo que se viene es lo que importa, y lo
  // de atrás está ahí por si se te pasó algo.
  useLayoutEffect(() => {
    if (anchored.current || isPending || isPlaceholderData || !days.length) return;
    todayRef.current?.scrollIntoView({ block: "start" });
    anchored.current = true;
  }, [days, isPending, isPlaceholderData]);

  if (isPending) return <RowsSkeleton count={5} height={106} />;

  if (!days.length) {
    return (
      <p className="dim" style={{ fontSize: 14 }}>
        {tr("No dated releases in the movies you follow.")}
      </p>
    );
  }

  // El ancla del día de hoy es el primer día que no ha pasado: puede que hoy no
  // se estrene nada tuyo, y entonces lo siguiente es donde quieres estar.
  const anchorKey = days.find(([key]) => key >= todayKey)?.[0];

  return (
    <div className="cal-feed">
      <div ref={topRef} className="cal-sentinel">
        {weeksBack < 260 ? tr("Loading more…") : tr("That's the start of your releases.")}
      </div>
      {days.map(([key, rowsOfDay]) => (
        <div key={key} className="cal-day" ref={key === anchorKey ? todayRef : undefined}>
          <div className="cal-daysep">
            {/* dayLabel decide entre "Hoy", "Mañana", el día de la semana y la
                fecha larga — pero su día de la semana solo sirve dentro de la
                semana que viene, y aquí se mira a AÑOS vista: "miércoles" a 254
                días no dice nada. Pasada esa semana, fecha completa. */}
            <span>{daySeparator(key, now, tz)}</span>
          </div>
          {rowsOfDay.map((r) => (
            <MovieReleaseRow key={`${r.title_id}-${r.release_kind}`} r={r} now={now} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** "En cines" y "Anunciadas": dos preguntas sobre TU lista que el feed no
 *  responde de un vistazo porque las respuestas están repartidas por él. */
/* Un año hacia atrás, no cinco. Lo que estas dos listas necesitan del pasado es
   la fecha de sala de lo que SIGUE en cartelera, y una película que lleva más de
   un año estrenada ya no lo está — para eso está el feed, que sí crece hacia
   atrás cuando lo pides. Cinco años eran cuatro de filas que nadie mira. */
const PENDING_WEEKS_BACK = 52;

function PendingList({ kind }: { kind: "theatres" | "announced" }) {
  const { data: movies = [], isPending } = useMovieLibrary();
  const { data: releases = [] } = useMovieReleases(PENDING_WEEKS_BACK);
  const esNames = useEsNames();
  const now = useMemo(() => new Date(), []);
  const nowMs = now.getTime();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const id = setTimeout(() => window.scrollTo(0, 0), 0);
    return () => clearTimeout(id);
  }, [kind]);

  // Qué sabemos de cada película: si su fecha de cine ya pasó y si tiene (o no)
  // una fecha digital, que es lo que separa "ve al cine" de "espera al sofá".
  const byTitle = useMemo(() => {
    const m = new Map<string, { theatrical?: number; digital?: number }>();
    for (const r of releases) {
      const at = new Date(r.release_at).getTime();
      const held = m.get(r.title_id) ?? {};
      if (r.release_kind === "digital") held.digital = at;
      else held.theatrical = at;
      m.set(r.title_id, held);
    }
    return m;
  }, [releases]);

  const items = movies.filter((m) => {
    if (m.status === "watched") return false;
    const dates = byTitle.get(m.title_id);
    const theatrical = dates?.theatrical;
    const digital = dates?.digital;
    if (kind === "theatres") {
      // Ya en salas, y todavía no en casa: si la digital ya pasó, esto dejó de
      // ser un plan de cine.
      return theatrical != null && theatrical <= nowMs && (digital == null || digital > nowMs);
    }
    return m.status === "upcoming";
  });

  const sorted = [...items].sort((a, b) => {
    const at = byTitle.get(a.title_id)?.theatrical ?? Number(a.first_air_date ? new Date(a.first_air_date) : Infinity);
    const bt = byTitle.get(b.title_id)?.theatrical ?? Number(b.first_air_date ? new Date(b.first_air_date) : Infinity);
    if (at !== bt) return kind === "theatres" ? bt - at : at - bt;
    return locName(esNames, a.tmdb_id, a.name, "movie")
      .localeCompare(locName(esNames, b.tmdb_id, b.name, "movie"), dateLocale());
  });

  if (isPending) return <RowsSkeleton count={4} height={106} />;

  if (!sorted.length) {
    return (
      <p className="dim" style={{ fontSize: 14 }}>
        {tr(kind === "theatres"
          ? "Nothing of yours in theatres right now."
          : "Nothing announced in the movies you follow.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((m) => (
        <PendingRow key={m.title_id} m={m} kind={kind} at={byTitle.get(m.title_id)} />
      ))}
    </div>
  );
}

/** La fila de las dos listas de arriba. Reusa MovieReleaseRow fabricando el
 *  evento que le falta: son los mismos datos, vistos desde la biblioteca en vez
 *  de desde el calendario. */
function PendingRow({ m, kind, at }: {
  m: LibraryMovie;
  kind: "theatres" | "announced";
  at: { theatrical?: number; digital?: number } | undefined;
}) {
  const now = useMemo(() => new Date(), []);
  // El instante que enseña la fila. Sin ninguna fecha —una anunciada de la que
  // TMDB no dice ni el año— se usa el propio "ahora", que la fila pinta como
  // pasada y por tanto sin cuenta atrás: es lo honesto cuando no hay a qué
  // contar. Nunca cae aquí desde "En cines", que exige fecha de sala para
  // entrar en la lista.
  const when =
    kind === "theatres" ? at?.theatrical
    : at?.theatrical ?? (m.first_air_date ? new Date(m.first_air_date).getTime() : undefined);

  const release: MovieRelease = {
    title_id: m.title_id,
    tmdb_id: m.tmdb_id,
    name: m.name,
    poster_path: m.poster_path,
    genres: m.genres,
    runtime: null,
    vote_average: m.vote_average,
    release_kind: "theatrical",
    release_at: new Date(when ?? now.getTime()).toISOString(),
    watch_event_id: null,
  };
  return <MovieReleaseRow r={release} now={now} />;
}
