import { Activity } from "lucide-react";
import type { WallItem } from "@/domain/activityWall";
import { showsEpisodeCount } from "@/domain/mediumCopy";
import { relativeTime } from "@/domain/time";
import { thumbArt } from "@/lib/artwork";
import { dateLocale, locName, t as tr, useEsNames } from "@/lib/i18n";
import { useOpenSheet } from "@/lib/useOpenTitle";
import { activityPhrase } from "@/ui/activityPhrase";
import { MediumGlyph } from "@/ui/MediumGlyph";
import { posterBg } from "@/ui/posterBg";
import { useShowMore } from "@/ui/ShowMore";

/* El muro de UN perfil: el tuyo y el de un amigo, el mismo componente.
   Lo que pinta se lo da domain/activityWall ya plegado y ordenado.

   Existía antes solo dentro de la ficha de un amigo, escrito a mano y con dos
   límites que este arregla: solo enseñaba SERIES —porque leía el historial
   filtrado por el modo activo— y no plegaba nada, así que una importación
   entera se le comía. Compartirlo con tu perfil no es ahorro de líneas: es lo
   que hace que "perfil" signifique lo mismo mirándote a ti o a otro. */

/* Doce filas antes del primer "Ver más": llenan la columna sin empujar fuera de
   la pantalla lo que va debajo (tus notas). */
const PAGE = 12;

function epRange(a: WallItem): React.ReactNode {
  if (!a.from || !a.to) return null;
  if (a.from.season === a.to.season && a.from.episode === a.to.episode)
    return <>S{a.from.season} · E{a.from.episode}</>;
  if (a.from.season === a.to.season)
    return `S${a.from.season} · E${a.from.episode}–E${a.to.episode}`;
  return `S${a.from.season} · E${a.from.episode} – S${a.to.season} · E${a.to.episode}`;
}

export function ActivityWall({ items, isMe }: { items: WallItem[]; isMe: boolean }) {
  const esNames = useEsNames();
  const openSheet = useOpenSheet();
  const { shown, more } = useShowMore(items, PAGE);

  return (
    <section className="flex flex-col gap-1.5">
      <div className="eyebrow flex items-center gap-1.5"><Activity size={13} />{tr("Recent activity")}</div>
      {items.length === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>{tr("No activity yet.")}</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 6 }}>
            {shown.map((a) => {
              /* La carátula sale de una fuente distinta según el medio: un juego
                 guarda un hash de IGDB donde series y cine guardan una ruta de
                 TMDB (0071). thumbArt lo resuelve; tmdbImg a secas devolvía una
                 URL que responde 404 en silencio. */
              const art = thumbArt(a.kind, a.poster_path);
              const name = locName(esNames, a.tmdb_id, a.name, a.kind);
              /* Una fila plegada no lleva a ningún sitio: su título es solo el
                 representante del grupo, y abrirlo al tocar la fila sería abrir
                 uno cualquiera de los 386. */
              const grouped = a.verb === "added" && a.count > 1;
              return (
                <div
                  key={a.key}
                  className="fr-activity"
                  style={grouped ? undefined : { cursor: "pointer" }}
                  onClick={grouped ? undefined : () => openSheet(a.tmdb_id, a.kind)}
                >
                  <div
                    className="mq-row-art"
                    style={{ width: 34, height: 50, flex: "0 0 auto", ...(art ? {} : { background: posterBg(name) }) }}
                  >
                    {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                    <div className="poster-sheen" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 13.5 }} className="line-clamp-2">
                      {activityPhrase({
                        verb: a.verb,
                        kind: a.kind,
                        name: <b style={{ fontWeight: 700 }}>{name}</b>,
                        count: a.count,
                        episodes: epRange(a),
                        list: a.list,
                        isMe,
                      })}
                    </div>
                    <span className="mute" style={{ fontSize: 11.5 }}>
                      {relativeTime(a.at, new Date(), dateLocale())}
                      {showsEpisodeCount(a.kind, a.count) && <> · {a.count} {tr("episodes")}</>}
                    </span>
                  </div>
                  {a.verb === "rated" && a.score != null && (
                    <span className="badge badge-soft" style={{ fontWeight: 800, flex: "0 0 auto" }}>{a.score}/10</span>
                  )}
                  {/* El glifo del medio, pegado a la carátula: en las tres, no
                      solo en las de cine — ver el par es lo que enseña la
                      convención, y un glifo que solo sale a veces se lee como
                      una marca rara sobre algunas filas. */}
                  <MediumGlyph kind={a.kind} />
                </div>
              );
            })}
          </div>
          {more}
        </>
      )}
    </section>
  );
}
