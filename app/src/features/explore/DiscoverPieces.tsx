import { useEffect } from "react";
import { EyeOff, Star, X } from "lucide-react";
import type { TitleRow } from "@/lib/schemas";
import { externalScore, scoreColor, scoreLabel } from "@/domain/externalScore";
import { tmdbImg } from "@/lib/tmdb";
import { useTitleIntent } from "@/lib/useOpenTitle";
import { isEs, locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";
import { posterBg } from "@/ui/posterBg";
import { useFocusTrap } from "@/ui/useFocusTrap";

/* Las piezas que comparten las dos pantallas de Explorar, la de series y la de
   cine: la carátula de una rejilla de descubrimiento, el panel de filtros y su
   selector de años.

   Vivían dentro de DiscoverSections hasta que hubo una segunda pantalla que
   quería exactamente lo mismo. Lo único que se parametrizó al sacarlas es lo que
   de verdad cambia entre medios: el `kind` de la carátula y la taxonomía de
   géneros del panel. */

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 1970 + 1 }, (_, i) => THIS_YEAR - i);

/* First-air-year bound picker inside the filters panel: label stacked over the
   select so From/To sit side by side. */
function YearField({ value, onChange, label }: { value: number | null; onChange: (y: number | null) => void; label: string }) {
  return (
    <label className="disc-yearfield">
      <span className="mute" style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
      <select
        className="year-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{tr("Any")}</option>
        {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </label>
  );
}

export function TitlePoster({ t, rank, score, kind = "tv", onOpen, onIgnore }: {
  t: TitleRow;
  rank?: number;
  /** Una nota que MANDA sobre la del catálogo, para el carril que enseña otra
   *  cosa: hoy la media de tus amigos. Sin ella, una carátula de cine saca la
   *  suya (IMDb, o TMDB de reserva) y una de series no saca ninguna, que es lo
   *  que las dos hacían antes de que el cine tuviera nota propia. */
  score?: number | null;
  /** El medio de `t` — decide de dónde sale su título en español (0067), si
   *  tiene sentido precargar (la precarga trae temporadas y episodios, que en
   *  una película no existen) y si la carátula saca nota por su cuenta. */
  kind?: "tv" | "movie";
  onOpen: () => void;
  onIgnore?: () => void;
}) {
  const art = tmdbImg(t.poster_path);
  const intent = useTitleIntent(kind === "tv" ? t.tmdb_id : undefined);
  const esNames = useEsNames();
  const name = (isEs() && t.name_es) || locName(esNames, t.tmdb_id, t.name, kind);
  /* La nota del propio catálogo, solo en cine: IMDb manda y TMDB queda de
     reserva (domain/externalScore). La de fuera gana cuando la hay porque
     significa otra cosa —lo que puntuaron tus amigos— y se pinta con el acento
     de la app, no con el amarillo de IMDb. */
  const own = score == null && kind === "movie" ? externalScore(t) : null;
  return (
    <div className="poster" style={{ background: posterBg(name) }} onClick={onOpen} {...intent}>
      {art && <img className="poster-img" src={art} alt="" loading="lazy" />}
      <div className="poster-sheen" />
      {rank != null && <span className="mq-rank">{rank}</span>}
      {score != null && score > 0 && (
        <span className="badge badge-glass absolute" style={{ top: 8, left: 8, zIndex: 3 }}>
          <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} /> {score.toFixed(1)}
        </span>
      )}
      {own && (
        <span className="badge badge-glass absolute" style={{ top: 8, left: 8, zIndex: 3 }} title={scoreLabel(own.source)}>
          <Star size={11} fill="currentColor" strokeWidth={0} style={{ color: scoreColor(own.source) }} /> {own.value.toFixed(1)}
        </span>
      )}
      {onIgnore && (
        <button
          className="btn btn-icon badge-glass absolute disc-hide"
          style={{ top: 8, right: 8, color: "#fff", zIndex: 3 }}
          title={tr("Ignore — hide from suggestions")}
          aria-label={tv("Hide {name} from suggestions", { name: t.name })}
          onClick={(e) => { e.stopPropagation(); onIgnore(); }}
        >
          <EyeOff size={15} />
        </button>
      )}
      <div className="poster-body">
        <div className="poster-title">{name}</div>
        <div className="poster-sub">{[t.first_air_date?.slice(0, 4), tGenre(t.genres[0] ?? "")].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
  );
}

export function FilterPanel({ genres, selected, onToggleGenre, fromYear, toYear, onFromYear, onToYear, hasFilters, onClear, onClose }: {
  /** La taxonomía de este medio: los ids de género de cine y de series son
   *  espacios distintos de TMDB, y sus nombres tampoco coinciden. */
  genres: string[];
  selected: string[];
  onToggleGenre: (g: string) => void;
  fromYear: number | null;
  toYear: number | null;
  onFromYear: (y: number | null) => void;
  onToYear: (y: number | null) => void;
  hasFilters: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useFocusTrap<HTMLDivElement>();
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <>
      <div className="backdrop disc-sheet-backdrop" onClick={onClose} />
      <div ref={ref} className="disc-panel" role="dialog" aria-modal="true" aria-label={tr("Filters")} tabIndex={-1}>
        <div className="disc-handle" aria-hidden />
        <div className="disc-sec-label">{tr("Genres")}</div>
        <div className="disc-genres">
          {genres.map((g) => (
            <label key={g} className="filter-opt">
              <input type="checkbox" checked={selected.includes(g)} onChange={() => onToggleGenre(g)} />
              <span>{tGenre(g)}</span>
            </label>
          ))}
        </div>
        <div className="disc-sec-label">{tr("Years")}</div>
        <div className="disc-years">
          <YearField value={fromYear} onChange={onFromYear} label={tr("From")} />
          <YearField value={toYear} onChange={onToYear} label={tr("To")} />
        </div>
        <div className="disc-panel-foot">
          <button className="chip" disabled={!hasFilters} onClick={onClear}>
            <X size={13} />
            {tr("Clear filters")}
          </button>
        </div>
      </div>
    </>
  );
}
