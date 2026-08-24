import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGameLibrary, type LibraryGame } from "@/lib/library";
import { GameReleaseRow } from "@/features/games/GameReleaseRow";
import { formatRelease, groupReleases, type ReleaseGroup } from "@/domain/gameRelease";
import { dayLabel, dayOffset } from "@/domain/calendar";
import { airTimeZone } from "@/lib/region";
import { dateLocale, isEs, t as tr } from "@/lib/i18n";
import { TabMenu } from "@/ui";
import { RowsSkeleton } from "@/ui/Skeleton";

/* Lanzamientos — el calendario de los juegos que sigues. Primo de Estrenos (el
   de cine) y del calendario de series, y el que menos se les parece por dentro
   por una razón concreta: aquí la fecha no siempre es un día.

   IGDB fecha buena parte del catálogo por trimestre o por año (0071), así que
   un feed con separadores de día no puede colocar un "Q4 2027" sin inventarse
   el día — el 31 de diciembre que se guarda es para poder ordenar. La solución
   no es esconder esas filas ni fingirles un día: es que el separador tenga la
   granularidad de lo que la fuente dijo. Un feed que va "MAÑANA", "MARZO 2027",
   "Q4 2027", "2028", "SIN FECHA" es exactamente lo que un catálogo de juegos
   sabe, y es como lo escribe la industria. La agrupación vive en
   domain/gameRelease, con sus pruebas.

   ── Dos vistas y no tres ──────────────────────────────────────────────────
   Cine tiene una tercera, "En cines", porque una película en cartelera es algo
   que caduca: o vas o la esperas en casa. Un juego no tiene ese estado — sale y
   se queda—, así que una tercera pestaña estaría respondiendo una pregunta que
   nadie hace.

   ── Sin historia perezosa ─────────────────────────────────────────────────
   El calendario de series pagina hacia atrás y el de cine también, porque los
   dos leen un RPC con ventana. Este no lee ninguno: los lanzamientos de tus
   juegos son las filas de tu biblioteca, que ya están todas en memoria desde
   que se abrió la app. Cien juegos son cien filas. */

type View = "feed" | "announced";

export default function GameReleasesPage() {
  const [view, setView] = useState<View>("feed");
  const tabs: { key: View; label: string }[] = [
    { key: "feed", label: tr("games: My releases") },
    { key: "announced", label: tr("games: Announced") },
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
        <TabMenu value={view} options={tabs} onPick={setView} menuLabel={tr("games: Releases")} align="center" floating />
      </div>

      {/* `key` y no un efecto que reinicie el ancla: al cambiar de vista son dos
          listas distintas, y la posición de una no significa nada en la otra.
          Remontar deja el ref del ancla y el "ya anclé" en su estado inicial sin
          que haya que acordarse de reiniciarlos a mano — y sin depender de en
          qué orden corren dos efectos de layout, que es donde esto se rompe. */}
      <ReleaseFeed key={view} view={view} />
    </div>
  );
}

/** El rótulo de un grupo.
 *
 *  Con día exacto delega en dayLabel mientras su respuesta signifique algo —hoy,
 *  mañana y la semana que viene— y a partir de ahí escribe la fecha entera, que
 *  es lo mismo que hace Estrenos: "miércoles" a 254 días no dice nada.
 *
 *  Con cualquier otra precisión, lo escribe formatRelease y no se toca: ese
 *  módulo es justamente el que sabe cuánto se puede afirmar. */
function separatorOf(g: ReleaseGroup<LibraryGame>, now: Date, tz: string, es: boolean): string {
  if (g.kind === "tbd") return tr("No date yet").toUpperCase();
  if (g.kind === "day" && g.date) {
    const iso = `${g.date}T12:00:00Z`;
    const off = dayOffset(iso, now, tz);
    if (off <= 7) return dayLabel(off, iso, dateLocale(), tz);
    return new Date(iso)
      .toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric", timeZone: tz })
      .toUpperCase();
  }
  return formatRelease(g.date, g.precision, { es }).toUpperCase();
}

function ReleaseFeed({ view }: { view: View }) {
  const { data: games = [], isPending } = useGameLibrary();
  const now = useMemo(() => new Date(), []);
  const tz = airTimeZone();
  const es = isEs();
  const today = now.toISOString().slice(0, 10);

  const groups = useMemo(() => {
    const rows = view === "announced" ? games.filter((g) => g.status === "upcoming") : games;
    /* Dentro de un grupo, por nombre. No por fecha: en un grupo de trimestre o
       de año TODAS las filas guardan el mismo día, así que ordenar por fecha
       deja el orden a merced de cómo vinieran de la base — que cambia entre
       cargas y hace que la lista "se mueva" sin que nada haya pasado. */
    return groupReleases([...rows].sort((a, b) => a.name.localeCompare(b.name, dateLocale())));
  }, [games, view]);

  /* Abrir por lo que VIENE, no por el principio: lo de atrás está ahí por si se
     te pasó algo. El ancla es el primer grupo que no ha pasado — puede que hoy
     no salga nada tuyo, y entonces lo siguiente es donde quieres estar. */
  const anchorKey = groups.find((g) => g.kind === "tbd" || (g.date ?? "") >= today)?.key;
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const anchored = useRef(false);
  useLayoutEffect(() => {
    if (anchored.current || isPending || !groups.length) return;
    anchorRef.current?.scrollIntoView({ block: "start" });
    anchored.current = true;
  }, [groups, isPending]);

  if (isPending) return <RowsSkeleton count={5} height={106} />;

  if (!groups.length) {
    return (
      <p className="dim" style={{ fontSize: 14 }}>
        {tr(view === "announced"
          ? "Nothing announced in the games you follow."
          : "No releases in the games you follow.")}
      </p>
    );
  }

  return (
    <div className="cal-feed">
      {groups.map((g) => (
        <div key={g.key} className="cal-day" ref={g.key === anchorKey ? anchorRef : undefined}>
          <div className="cal-daysep">
            <span>{separatorOf(g, now, tz, es)}</span>
          </div>
          {/* El separador ya nombra el periodo en todo lo que no es un día
              exacto, así que la fila no lo repite dos renglones más abajo. */}
          {g.items.map((game) => (
            <GameReleaseRow key={game.title_id} g={game} now={now} periodNamedAbove={g.kind !== "day"} />
          ))}
        </div>
      ))}
    </div>
  );
}
