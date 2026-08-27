import { Star } from "lucide-react";
import { t as tr, tv } from "@/lib/i18n";
import { useFriendsOnTitle } from "@/lib/friendsOnTitle";
import {
  friendGameLabel,
  friendGameStatus,
  friendMovieLabel,
  friendMovieStatus,
  type FriendTitleInput,
} from "@/domain/friendTitleStatus";
import { FriendAvatar } from "@/ui/FriendAvatar";

/* Tus amigos, en la ficha de una película o de un juego: qué han hecho con
   ella y qué nota le pusieron, uno por línea.

   ── Por qué un bloque y no la celda de "Amigos" de las notas ──────────────
   Esa celda ya existe y se queda: es un NÚMERO, la media, y vive en la fila de
   notas junto a la de IMDb porque responde lo mismo que ellas ("¿está bien
   esto?"). Este bloque responde otra cosa —"¿quién de los míos anda con
   esto?"— y a esa pregunta contestan también los que no le han puesto nota: el
   que la tiene pendiente, el que se lo dejó a medias. En una media no caben, y
   son justo con los que se habla de verlo.

   La fila entera abre su perfil, como en el desplegable de la media.

   No hay versión de series: el estado de un amigo con una serie es contar sus
   episodios, y eso no es una consulta más en una ficha (domain/
   friendTitleStatus lo explica). Su nota sí sale allí, en la celda de la
   media, que es lo que había. */

/** La palabra de su estado, o null si no hay estado que contar. Aquí y no en
 *  domain/ porque las dos derivaciones devuelven enums distintos: el que sabe
 *  cuál toca es quien sabe de qué medio es la ficha. */
function stateLabel(kind: "movie" | "game", input: FriendTitleInput): string | null {
  if (kind === "movie") {
    const status = friendMovieStatus(input);
    return status && friendMovieLabel(status);
  }
  const status = friendGameStatus(input);
  return status && friendGameLabel(status);
}

export function FriendsOnTitle({
  kind,
  titleId,
  episodeId,
  tmdbId,
  released,
  onOpen,
}: {
  kind: "movie" | "game";
  titleId: string | null | undefined;
  episodeId: string | null | undefined;
  tmdbId: number;
  /** Ya salió. Es lo que separa "la tiene pendiente" de "aún no ha salido". */
  released: boolean;
  onOpen: (friendId: string) => void;
}) {
  const friends = useFriendsOnTitle({ titleId, episodeId, kind, tmdbId });
  if (!friends.length) return null;

  /* La media de los que SÍ han puntuado, junto al rótulo. Se calcula de estas
     mismas filas y no de la consulta de gustos: así el número resume exactamente
     la lista que hay debajo, en vez de una selección parecida pero distinta.
     Sin nadie que haya puntuado no se pinta —una media de cero no es cero— y la
     lista se queda con los que lo tienen pendiente, que también dicen algo. */
  const puntuadas = friends.map((f) => f.score).filter((s): s is number => s != null);
  const media = puntuadas.length
    ? puntuadas.reduce((suma, s) => suma + s, 0) / puntuadas.length
    : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="eyebrow">{tr("Friends")}</span>
        {media != null && (
          <span className="friends-title-score">
            <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
            {media.toFixed(1)}
          </span>
        )}
      </div>
      <div className="card friends-title-list">
        {friends.map((f) => {
          const state = stateLabel(kind, { entry: f.entry, finished: f.finished, released });
          return (
            <button
              key={f.id}
              type="button"
              className="btn-reset friends-title-row"
              title={tv("Open {name}'s profile", { name: f.name })}
              onClick={() => onOpen(f.id)}
            >
              <FriendAvatar f={f} size={28} />
              <span className="friends-title-name">{f.name}</span>
              {state && <span className="friends-title-state">{tr(state)}</span>}
              {f.score != null && (
                <span className="friends-title-score">
                  <Star size={12} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} />
                  {f.score}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
