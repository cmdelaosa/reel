import { useState } from "react";
import { Play } from "lucide-react";
import { t as tr } from "@/lib/i18n";

/* El tráiler de un juego (0086).
 *
 * ── Por qué no es un <iframe> desde el principio ──────────────────────────
 * Un iframe de YouTube cuesta ~1 MB y una docena de peticiones a Google en
 * cuanto se pinta, ABRAS EL VÍDEO O NO. Esta ficha se abre para mirar las
 * horas, el estado o quién de tus amigos lo tiene, y en la mayoría de esas
 * veces el tráiler no se toca. Así que hasta que alguien pulsa hay una imagen
 * y un botón, y el iframe se monta en ese clic.
 *
 * La imagen no es la miniatura de YouTube: es una captura de IGDB, que ya está
 * guardada (0086) y viene del mismo sitio que el resto de la ficha. Pedirle la
 * miniatura a i.ytimg.com sería avisar a Google de que estás mirando este juego
 * antes de que hayas decidido ver nada.
 *
 * ── youtube-nocookie ──────────────────────────────────────────────────────
 * El dominio sin cookies de seguimiento. No es privacidad completa —YouTube ve
 * la petición— pero es lo que se puede hacer sin renunciar al vídeo, y es
 * gratis. `rel=0` para que al acabar no ofrezca vídeos de otros juegos.
 */
export function Trailer({
  videoId,
  name,
  portada,
}: {
  videoId: string;
  name: string;
  /** URL de la imagen que hace de portada, ya resuelta por quien llama: en un
   *  juego sale de igdbImg y en una película de tmdbImg, y el componente no
   *  tiene por qué saber de cuál de los dos. */
  portada: string | null | undefined;
}) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="trailer">
        <iframe
          className="trailer-frame"
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={name}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button className="trailer btn-reset" onClick={() => setPlaying(true)} aria-label={tr("Play trailer")}>
      {portada
        ? <img className="trailer-img" src={portada} alt="" />
        : <span className="trailer-img trailer-empty" />}
      <span className="trailer-scrim" />
      <span className="trailer-play"><Play size={22} fill="currentColor" strokeWidth={0} /></span>
      <span className="trailer-name">{name}</span>
    </button>
  );
}
