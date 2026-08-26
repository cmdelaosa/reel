import type { TasteBlock } from "@/domain/tasteProfile";
import { mediumPlural } from "@/domain/mediumCopy";
import { t as tr, tGenre, tv } from "@/lib/i18n";

/* El perfil de gustos, UN bloque POR MEDIO — el tuyo y el de un amigo, el mismo
   componente.

   Antes era uno solo y era el de series: leía `useLibrary()`, que filtra a
   series desde 0067, así que en tu perfil "tus gustos" eran los de un tercio de
   lo que usas, y en la ficha de un amigo eran los del modo en el que estuvieras
   —entrabas desde Videojuegos y te contaba sus cadenas de televisión.

   Cada bloque va teñido de su medio (`data-tint`, tokens.css) y no del acento
   del modo. Es lo que hace que en esta página el color signifique UNA cosa —de
   qué medio es esto— igual que en la rejilla de actividad de al lado. */

/* Seis barras y no ocho: son tres bloques uno al lado del otro, y ocho géneros
   por cabeza convierten la sección en una pared. Los seis primeros ya dicen de
   qué va la biblioteca. */
const BARS = 6;

/** El texto de un chip. Los tres tipos son datos crudos menos la década, que es
 *  un número al que cada idioma le pone su envoltorio ("1990s" / "los 90"). */
function chipLabel(block: TasteBlock, name: string): string {
  if (block.chipKind !== "decade") return name;
  // "los 90" pero "los 2000": el corte de dos cifras solo vale para el siglo XX,
  // y la traducción no puede decidirlo sola porque recibe el número entero.
  const short = Number(name) < 2000 ? name.slice(2) : name;
  return tv("decade: {full}", { full: name, short });
}

export function TasteBlocks({ blocks }: { blocks: TasteBlock[] }) {
  if (blocks.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="eyebrow">{tr("Taste profile")}</div>
      <div className="taste-blocks">
        {blocks.map((b) => (
          <div key={b.medium} className="flex flex-col gap-2" data-tint={b.medium}>
            <div className="card p-4 flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span style={{ fontWeight: 750, fontSize: 13.5 }}>{tr(mediumPlural(b.medium))}</span>
                <span className="mute" style={{ fontSize: 11.5, fontVariantNumeric: "tabular-nums" }}>{b.titles}</span>
              </div>
              {b.genres.slice(0, BARS).map((g) => (
                <div key={g.name} className="flex items-center gap-2.5">
                  <span className="truncate" style={{ flex: 1, fontSize: 12.5 }}>{tGenre(g.name)}</span>
                  <div className="fr-matchbar" style={{ flex: "0 0 72px" }}>
                    <i style={{ width: `${(g.count / b.genres[0].count) * 100}%` }} />
                  </div>
                  <span className="mute" style={{ fontSize: 11.5, width: 24, textAlign: "right", flex: "0 0 auto" }}>{g.count}</span>
                </div>
              ))}
            </div>
            {b.chips.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {b.chips.map((c) => (
                  <span key={c.name} className="badge badge-soft" style={{ fontSize: 11 }}>
                    {chipLabel(b, c.name)} · {c.count}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
