import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { t as tr } from "@/lib/i18n";
import { PlatformLogo } from "@/ui/PlatformLogo";

/* «En cuál lo juegas», como desplegable CON logotipo.
 *
 * ── Por qué no es un <select> ─────────────────────────────────────────────
 * La app ya tiene `.field-select`, que es un <select> nativo, y sería lo primero
 * que uno coge. No vale: un <option> solo admite texto, así que el logotipo no
 * puede entrar. Y el logotipo es justo lo que hace que esto se lea de un
 * vistazo — un juego con seis plataformas es una lista de nombres parecidos.
 *
 * Así que es una lista propia, con lo que eso obliga a poner a mano: cerrar al
 * pulsar fuera, cerrar con Escape, y las teclas de un listbox de verdad
 * (flechas, Home/End, Enter). Sin eso, quien navega con teclado se queda sin
 * poder cambiar de plataforma.
 *
 * ── Volver a pulsar la puesta la quita ────────────────────────────────────
 * Es la regla de 0083, y se mantiene: «dónde lo juego» tiene UNA respuesta, y
 * cuando te lo llevas a la consola nueva esa respuesta cambia, no se acumula.
 * Aquí se ofrece como una opción más de la lista, «Ninguna», porque en un
 * desplegable no hay dónde volver a pulsar. */
export function PlatformPicker({
  platforms,
  value,
  onPick,
  width,
}: {
  platforms: string[];
  value: string | null;
  onPick: (name: string | null) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [activo, setActivo] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  // Las opciones son las plataformas más «Ninguna» al final, que es lo que
  // deja quitar la elección sin salir del control.
  const opciones: (string | null)[] = [...platforms, null];

  useEffect(() => {
    if (!open) return;
    const fuera = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [open]);

  const elegir = (v: string | null) => {
    setOpen(false);
    onPick(v);
  };

  const teclas = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setActivo(Math.max(0, opciones.indexOf(value)));
        setOpen(true);
      }
      return;
    }
    // Escape se para aquí: la ficha entera también escucha Escape para
    // cerrarse, y sin esto cerrar el desplegable cerraría también la ficha.
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActivo((i) => (i + 1) % opciones.length); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActivo((i) => (i - 1 + opciones.length) % opciones.length); return; }
    if (e.key === "Home") { e.preventDefault(); setActivo(0); return; }
    if (e.key === "End") { e.preventDefault(); setActivo(opciones.length - 1); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(opciones[activo]); }
  };

  return (
    <div className="pick-wrap" ref={ref} style={width ? { width } : undefined}>
      <button
        type="button"
        className={`pick${open ? " pick-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={teclas}
      >
        {value && <PlatformLogo name={value} size={16} bare />}
        <span className="pick-value truncate">{value ?? tr("Not set")}</span>
        <ChevronDown size={15} className="mute" aria-hidden />
      </button>
      {open && (
        <div className="pick-menu" role="listbox" aria-label={tr("Platform")}>
          {opciones.map((p, i) => (
            <div
              key={p ?? "__ninguna"}
              role="option"
              aria-selected={p === value}
              className={`pick-opt${p === value ? " on" : ""}${i === activo ? " activa" : ""}`}
              onPointerEnter={() => setActivo(i)}
              onClick={() => elegir(p)}
            >
              {p ? <PlatformLogo name={p} size={15} bare /> : <span className="pick-hueco" />}
              <span className="flex-1 min-w-0 truncate">{p ?? tr("Not set")}</span>
              {p === value && <Check size={13} strokeWidth={3} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
