import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { t as tr, tv } from "@/lib/i18n";

/* El visor a tamaño completo: una carátula, un fotograma, una captura.
 *
 * Nació dentro de la ficha de una serie, para su cartel. Está aquí fuera porque
 * ahora lo usan las cuatro —cartel de serie, de película y carátula de juego— y
 * además las capturas de un juego, que son VARIAS: por eso recibe una lista y un
 * índice en vez de una sola imagen, y por eso trae flechas.
 *
 * Con una sola imagen las flechas no se pintan y la tecla no hace nada, así que
 * el caso simple no paga el precio del complicado. */
export function Lightbox({
  imagenes,
  indice,
  onIndice,
  onClose,
  etiqueta,
}: {
  imagenes: string[];
  indice: number;
  /** Ausente = no se puede pasar de una a otra (una carátula sola). */
  onIndice?: (i: number) => void;
  onClose: () => void;
  etiqueta: string;
}) {
  const varias = imagenes.length > 1 && onIndice != null;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      /* Escape lo cierra ANTES de que llegue a la ficha de debajo, que también
         escucha: sin este stopPropagation, una tecla cerraba las dos y volvías
         a la rejilla en vez de a la ficha. */
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (!varias) return;
      if (e.key === "ArrowRight") onIndice!((indice + 1) % imagenes.length);
      if (e.key === "ArrowLeft") onIndice!((indice - 1 + imagenes.length) % imagenes.length);
    };
    // En captura, por lo mismo: la ficha registró el suyo antes.
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose, onIndice, indice, imagenes.length, varias]);

  return (
    <>
      <div className="backdrop" style={{ zIndex: 90 }} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={etiqueta}
        className="fixed lightbox"
        style={{ zIndex: 91, left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
      >
        <img className="lightbox-img" src={imagenes[indice]} alt="" onClick={onClose} />
        <button
          className="btn btn-icon badge-glass lightbox-close"
          aria-label={tr("Close")}
          onClick={onClose}
        >
          <X size={18} />
        </button>
        {varias && (
          <>
            <button
              className="btn btn-icon badge-glass lightbox-nav"
              style={{ left: 10 }}
              aria-label={tr("Previous")}
              onClick={() => onIndice!((indice - 1 + imagenes.length) % imagenes.length)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              className="btn btn-icon badge-glass lightbox-nav"
              style={{ right: 10 }}
              aria-label={tr("Next")}
              onClick={() => onIndice!((indice + 1) % imagenes.length)}
            >
              <ChevronRight size={20} />
            </button>
            <span className="lightbox-count">
              {tv("{n} of {total}", { n: indice + 1, total: imagenes.length })}
            </span>
          </>
        )}
      </div>
    </>
  );
}
