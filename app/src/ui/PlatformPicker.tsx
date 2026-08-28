import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { t as tr } from "@/lib/i18n";
import { playPlatform, type PlayPlatform } from "@/domain/platformModel";
import { PlatformMarkIcon } from "@/ui/PlatformLogo";

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
 * ── Lo que se ofrece es HARDWARE, no el nombre de IGDB ────────────────────
 * IGDB da «PC (Microsoft Windows)», «Mac», «Linux» y «SteamOS» como cuatro
 * plataformas distintas, y como respuesta a «dónde lo tengo» son la misma: PC.
 * Así que las opciones salen de `playPlatform`, que agrupa el ordenador entero
 * —y solo el ordenador: una PS4 no es una PS5, y el móvil se parte en iOS y
 * Android porque son dos aparatos y dos compras. Agrupar obliga a DEDUPLICAR:
 * un juego que salga en Windows, Mac y Linux tiene que ofrecer «PC» una vez, no
 * tres iguales seguidas.
 *
 * Lo que se guarda es la ETIQUETA («PC», «PlayStation 5»), no el nombre de
 * IGDB. Las entradas que ya tuvieran guardado el nombre viejo siguen valiendo
 * porque las etiquetas se reconocen a sí mismas — hay un test que recorre el
 * catálogo entero comprobándolo, y ese test es lo que ahorra la migración.
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
}: {
  /** Los nombres de IGDB del juego, tal cual. */
  platforms: string[];
  /** La etiqueta guardada — o un nombre de IGDB de antes de 0091. */
  value: string | null;
  onPick: (label: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activo, setActivo] = useState(0);
  // Un id estable por instancia: dos fichas abiertas a la vez —la de un juego
  // sobre la de otro— no pueden compartir los ids de sus opciones.
  const idBase = useId();
  const ref = useRef<HTMLDivElement | null>(null);

  // Las opciones son el hardware del juego —deduplicado, en el orden en que
  // IGDB los da— más «Ninguna» al final, que es lo que deja quitar la elección
  // sin salir del control.
  const opciones = useMemo<(PlayPlatform | null)[]>(() => {
    const vistos = new Set<string>();
    const hw: PlayPlatform[] = [];
    for (const p of platforms) {
      const opt = playPlatform(p);
      if (vistos.has(opt.id)) continue;
      vistos.add(opt.id);
      hw.push(opt);
    }
    return [...hw, null];
  }, [platforms]);

  /* La puesta se resuelve del valor guardado y NO buscándola en las opciones:
     IGDB reescribe `titles.platforms` en cada refresco, y el día que quite una
     plataforma de un juego —pasa, sobre todo con las viejas— la que tú tenías
     puesta deja de estar en la lista. Buscándola ahí, el botón se quedaba con
     el nombre pelado y sin logotipo justo en ese caso. */
  const puesta = value ? playPlatform(value) : null;
  const puestaId = puesta?.id ?? null;

  useEffect(() => {
    if (!open) return;
    const fuera = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [open]);

  const elegir = (v: PlayPlatform | null) => {
    setOpen(false);
    onPick(v?.label ?? null);
  };

  const teclas = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setActivo(Math.max(0, opciones.findIndex((o) => o?.id === puestaId)));
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
    <div className="pick-wrap" ref={ref}>
      <button
        type="button"
        className={`pick${open ? " pick-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        /* Sin esto, las flechas mueven un resaltado que un lector de pantalla
           no anuncia: se oye el nombre del botón y nada más, así que quien no
           ve la lista no sabe sobre qué va a caer el Enter. */
        aria-activedescendant={open ? `${idBase}-${activo}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={teclas}
      >
        {puesta && <PlatformMarkIcon model={puesta} size={16} />}
        <span className="pick-value truncate">{puesta?.label ?? tr("Not set")}</span>
        <ChevronDown size={15} className="mute" aria-hidden />
      </button>
      {open && (
        <div className="pick-menu" role="listbox" aria-label={tr("Platform")}>
          {opciones.map((p, i) => (
            <div
              key={p?.id ?? "__ninguna"}
              id={`${idBase}-${i}`}
              role="option"
              aria-selected={p?.id === puestaId}
              className={`pick-opt${p?.id === puestaId ? " on" : ""}${i === activo ? " activa" : ""}`}
              onPointerEnter={() => setActivo(i)}
              onClick={() => elegir(p)}
            >
              {p ? <PlatformMarkIcon model={p} size={15} /> : <span className="pick-hueco" />}
              <span className="flex-1 min-w-0 truncate">{p?.label ?? tr("Not set")}</span>
              {p?.id === puestaId && <Check size={13} strokeWidth={3} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
