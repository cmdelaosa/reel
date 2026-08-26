import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ChevronDown, ChevronUp, Eye, EyeOff, Star, X } from "lucide-react";
import type { TitleRow } from "@/lib/schemas";
import { externalScore, scoreColor, scoreLabel } from "@/domain/externalScore";
import { tmdbImg } from "@/lib/tmdb";
import { useTitleIntent } from "@/lib/useOpenTitle";
import { isEs, locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";
import { posterBg } from "@/ui/posterBg";
import { useIgnored, useUnignore } from "@/lib/ignore";
import { hiddenLabel } from "@/domain/mediumCopy";
import { ofMedium, sheetParam, type Medium } from "@/domain/tasteScope";
import { useFocusTrap } from "@/ui/useFocusTrap";

/* Las piezas que comparten las pantallas de Explorar —series, cine y juegos—:
   la carátula de una rejilla de descubrimiento, el panel de filtros con su
   selector de años, y el cajón de lo que ocultaste.

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

/** El cajón de lo oculto de una pantalla de Explorar: cuántos hay, y sus
 *  carátulas con un ojo para devolverlos a las sugerencias.
 *
 *  Vive aquí y no en la pantalla de series porque lo oculto ya no es solo de
 *  series: desde los sheets de cine y de juegos también se oculta, y hasta
 *  ahora esas fichas iban a parar a un cajón que solo existía en Explorar de
 *  series, titulado "series ocultas" y que las abría con `?title=` — o sea, un
 *  sitio donde no se podían ni reconocer ni recuperar. Cada modo enseña LO
 *  SUYO. */
export function HiddenTitles({ medium }: { medium: Medium }) {
  const { ignored } = useIgnored();
  const unignore = useUnignore();
  const [, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const mine = ofMedium(ignored, medium);
  if (mine.length === 0) return null;

  const openSheet = (tmdbId: number) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(sheetParam(medium), String(tmdbId));
      return next;
    });

  return (
    <div className="flex flex-col gap-3">
      <button
        className="chip"
        style={{ alignSelf: "flex-start" }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <EyeOff size={13} />
        {mine.length} {tr(hiddenLabel(medium, mine.length))}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="grid gap-[var(--gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--pw), 1fr))" }}>
          {mine.map((t) => {
            const art = tmdbImg(t.posterPath);
            return (
              <div key={t.titleId} className="poster" style={{ background: posterBg(t.name) }} onClick={() => openSheet(t.tmdbId)}>
                {art && <img className="poster-img" src={art} alt="" loading="lazy" />}
                <div className="poster-sheen" />
                <button
                  className="btn btn-icon badge-glass absolute"
                  style={{ top: 8, right: 8, color: "#fff", zIndex: 3 }}
                  title={tr("Restore to suggestions")}
                  aria-label={tv("Restore {name} to suggestions", { name: t.name })}
                  onClick={(e) => { e.stopPropagation(); unignore.mutate(t.titleId); }}
                >
                  <Eye size={15} />
                </button>
                <div className="poster-body">
                  <div className="poster-title">{t.name}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
