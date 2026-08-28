import { Check, Clock, ExternalLink, Star, X } from "lucide-react";
import type { EpisodeRow } from "@/lib/schemas";
import { tmdbImg } from "@/lib/tmdb";
import { fmtAirDateLong, fmtPlainDate } from "@/lib/region";
import { isEs, t as tr, tv } from "@/lib/i18n";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";
import { CastRail } from "@/ui/CastRail";
import type { RailPerson } from "@/ui/railPerson";
import { useWatchedAt } from "@/features/detail/data";

/* Ficha de un episodio — el sub-diálogo que se abre sobre la de la serie, al
   tocar una fila o un punto de la gráfica.

   ── Qué enseña, y por qué esto y no más ────────────────────────────────────
   El fotograma, quién lo dirigió y lo firmó, los invitados, las dos notas y la
   sinopsis. Los cuatro primeros son nuevos (0087) y no cuestan una petición:
   ya venían en el payload de temporada y el ingest los tiraba.

   NO hay nota por episodio. `ratings.episode_id` existe en el esquema desde
   0003, pero puntuar episodio a episodio no es algo que esta app quiera pedir:
   la nota es de la serie y ahí se queda.

   ── La tira de estado ──────────────────────────────────────────────────────
   Va SOBRE el fotograma, y tiene la misma anatomía en los tres casos —disco,
   qué pasa, qué puedes hacer— para que se lea como un control con tres estados
   y no como tres cosas distintas:

     visto        ● disco lleno   Visto el 3 mar     [Desmarcar]
     sin ver      ○ disco vacío   Sin ver            [Marcar visto]
     sin emitir   ◷ reloj         Se estrena el 21   (sin botón)

   En "sin ver" el botón es de acento porque ahí sí hay algo que hacer; en
   "visto" es de cristal, porque deshacer no es la acción principal. En "sin
   emitir" no hay botón: la lista ya deshabilita el check de un episodio no
   emitido, y un botón muerto sería peor que ninguno.

   El disco hace lo mismo que el botón cuando el episodio se ha emitido —es el
   control de la lista, y ahí sí se pulsa—; sin emitir es el reloj, y entonces
   ni se pulsa ni pinta el cursor de mano.

   ── El estado pobre es el que hay que mirar ────────────────────────────────
   De un episodio sin emitir, TMDB no tiene fotograma, ni notas, ni sinopsis,
   ni reparto. La ficha se sostiene con el título y la fecha, y los huecos se
   dicen con palabras en vez de dejar cajas vacías. */

/** El tipo de episodio, cuando dice algo. 'standard' es casi todo y no informa. */
const TIPOS: Record<string, string> = {
  premiere: "Series premiere",
  finale: "Season finale",
  mid_season: "Mid-season finale",
};

/** De dónde vino la marca de visto. 'app' no se explica: marcarlo tú es lo
 *  normal. Lo que pide explicación es una fecha que tú no pusiste. */
const ORIGENES: Record<string, string> = {
  tvtime_import: "imported from TV Time",
  seed: "from the initial import",
};

function Score({ label, value, color, href, votes }: {
  label: string;
  value: number | null | undefined;
  color: string;
  href?: string | null;
  votes?: number | null;
}) {
  const inner = (
    <>
      <div className="ratings-value">
        <Star size={16} fill="currentColor" strokeWidth={0} style={{ color }} />
        <span>{value != null ? value.toFixed(1) : "—"}</span>
        {href && <ExternalLink size={13} style={{ opacity: 0.7 }} aria-hidden />}
      </div>
      {votes != null && <div className="mute" style={{ fontSize: 11 }}>{tv("{votes} votes", { votes: votes.toLocaleString() })}</div>}
    </>
  );
  return (
    <div className="ratings-cell" style={{ flex: 1 }}>
      <div className="eyebrow">{label}</div>
      {href ? (
        <a className="btn-reset" href={href} target="_blank" rel="noreferrer noopener" title={tr("View on IMDb")}
           style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: "inherit" }}>
          {inner}
        </a>
      ) : inner}
    </div>
  );
}

export function EpisodeSheet({
  episode,
  aired,
  watched,
  busy,
  onToggleWatched,
  onClose,
  onPickPerson,
}: {
  episode: EpisodeRow;
  aired: boolean;
  watched: boolean;
  busy: boolean;
  onToggleWatched: () => void;
  onClose: () => void;
  onPickPerson: (personId: number) => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>();
  const { data: when } = useWatchedAt(episode.id, watched);

  const name = (isEs() && episode.name_es) || episode.name || tv("Episode {n}", { n: episode.episode_number });
  const overview = (isEs() && episode.overview_es) || episode.overview;
  const still = tmdbImg(episode.still_path, "w780");
  const tipo = episode.episode_type ? TIPOS[episode.episode_type] : undefined;
  const meta = [
    episode.air_datetime ? fmtAirDateLong(episode.air_datetime) : tr("TBA"),
    episode.runtime ? `${episode.runtime} ${tr("min")}` : aired ? null : tr("Runtime to be confirmed"),
    tipo ? tr(tipo) : null,
  ].filter(Boolean).join(" · ");

  const equipo: RailPerson[] = (episode.crew ?? []).map((p) => ({ ...p, sub: tr(p.role), subAccent: true }));
  const invitados: RailPerson[] = (episode.guest_stars ?? []).map((p) => ({ ...p, sub: p.role }));

  /* Las tres caras de la tira. Se calculan aquí y no en el JSX para que las
     tres estén una al lado de la otra y se vea que son el mismo control. */
  const tira = !aired
    ? {
        icon: <Clock size={19} />,
        on: false,
        titulo: episode.air_datetime
          ? tv("Premieres on {date}", { date: fmtPlainDate(episode.air_datetime.slice(0, 10)) })
          : tr("TBA"),
        sub: null as string | null,
        boton: null,
      }
    : watched
      ? {
          icon: <Check size={19} strokeWidth={3} />,
          on: true,
          titulo: when
            ? tv("Watched on {date}", { date: fmtPlainDate(when.watched_at.slice(0, 10)) })
            : tr("Watched"),
          sub: when && ORIGENES[when.source] ? tr(ORIGENES[when.source]) : null,
          boton: (
            <button className="btn btn-sm badge-glass" style={{ color: "#fff", borderRadius: "var(--r-sm)" }}
                    disabled={busy} onClick={onToggleWatched}>
              {tr("Unwatch")}
            </button>
          ),
        }
      : {
          icon: <Check size={19} strokeWidth={3} />,
          on: false,
          titulo: tr("Not watched"),
          sub: episode.air_datetime
            ? tv("Aired {date}", { date: fmtPlainDate(episode.air_datetime.slice(0, 10)) })
            : null,
          boton: (
            <button className="btn btn-accent btn-sm" style={{ borderRadius: "var(--r-sm)" }}
                    disabled={busy} onClick={onToggleWatched}>
              <Check size={15} />{tr("Mark watched")}
            </button>
          ),
        };

  return (
    <>
      <div className="backdrop" style={{ zIndex: 80 }} onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={tv("Episode S{season} · E{episode}", {
          season: episode.season_number,
          episode: episode.episode_number,
        })}
        tabIndex={-1}
        className="sheet-center fixed z-[81] card ep-sheet"
        style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
      >
        {/* Fotograma + la tira de estado encima */}
        <div className="ep-still">
          {still
            ? <img src={still} alt="" />
            : (
              <div className="ep-still-empty" style={{ background: posterBg(episode.name ?? String(episode.id)) }}>
                <span className="mute">{tr("No still yet")}</span>
              </div>
            )}
          <span className="ep-still-scrim" />
          <button className="btn btn-icon badge-glass ep-still-close" aria-label={tr("Close")} onClick={onClose}>
            <X size={18} />
          </button>
          <div className="ep-state">
            {/* El disco. Emitido, es el mismo control que el de la lista y
                marca o desmarca; sin emitir es un reloj que solo informa, y
                entonces vuelve a ser un adorno. Antes era siempre un `span`:
                pintaba el cursor de mano y la mano no hacía nada.
                Las 44 de caja son las de `button.check`, con el margen que le
                devuelve a la tira las 40 que medía cuando no se podía pulsar. */}
            {aired ? (
              <button
                type="button"
                className={`check ${tira.on ? "on" : ""}`}
                style={{ width: 44, height: 44, flex: "0 0 auto", marginBlock: -2 }}
                disabled={busy}
                aria-pressed={tira.on}
                aria-label={tira.on ? tr("Watched — tap to clear") : tr("Mark watched")}
                onClick={onToggleWatched}
              >
                {tira.icon}
              </button>
            ) : (
              <span className={`check ${tira.on ? "on" : ""}`} style={{ width: 40, height: 40, flex: "0 0 auto", cursor: "default" }} aria-hidden>
                {tira.icon}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="ep-state-title">{tira.titulo}</span>
              {tira.sub && <span className="ep-state-sub">{tira.sub}</span>}
            </span>
            {tira.boton}
          </div>
        </div>

        <div className="ep-sheet-body">
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              S{episode.season_number} · E{episode.episode_number}
            </div>
            <h3 style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.2 }}>{name}</h3>
            {meta && <div className="mute" style={{ fontSize: 13, marginTop: 4 }}>{meta}</div>}
          </div>

          {/* Las dos notas. La de IMDb enlaza a la ficha del episodio: su tconst
              propio está guardado desde 0057, así que el enlace no cuesta nada. */}
          <div className="ep-sheet-scores">
            <Score label="TMDB" value={episode.tmdb_vote_average} color="var(--accent)" votes={episode.tmdb_vote_count} />
            <div className="ratings-divider" />
            <Score
              label="IMDb"
              value={episode.imdb_rating}
              color="var(--imdb)"
              votes={episode.imdb_votes}
              href={episode.imdb_id ? `https://www.imdb.com/title/${episode.imdb_id}/` : null}
            />
          </div>

          {overview
            ? <p className="ep-sheet-overview">{overview}</p>
            : <p className="ep-sheet-overview" style={{ fontStyle: "italic" }}>{tr("No synopsis yet.")}</p>}

          {equipo.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>{tr("Directing and writing")}</div>
              <CastRail people={equipo} onPick={onPickPerson} />
            </div>
          )}
          {invitados.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 10 }}>{tr("Guest stars")}</div>
              <CastRail people={invitados} onPick={onPickPerson} />
            </div>
          )}
          {/* El hueco, dicho con palabras. Solo antes de emitirse: después, que
              TMDB no tenga reparto es un dato suyo y no una espera. */}
          {!aired && equipo.length === 0 && invitados.length === 0 && (
            <p className="mute" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              {tr("Cast and crew arrive when the episode airs.")}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
