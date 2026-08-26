import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { NavLink, useLocation } from "react-router";
import { Ellipsis } from "lucide-react";
import { fittingTabs } from "@/domain/tabFit";
import { t } from "@/lib/i18n";

/* El carril de pestañas de la barra, en escritorio. Enseña las que caben y
   recoge el resto en un menú «···».

   Lo que había antes era un carril con desplazamiento lateral y un desvanecido
   en el borde derecho diciendo que había más. Con seis pestañas en modo Juegos
   eso significaba, medido, que "Amigos" no se veía NUNCA y que Steam se veía a
   dos tercios — a 1280px y también a 1920, porque la barra estaba topada al
   mismo ancho que la rejilla de carátulas. Ahora la barra ocupa la ventana
   entera (marquee.css, .mq-top-inner) y lo que aun así no quepa entra en el
   menú. Una pestaña en un menú se ve, se pulsa y la encuentra el teclado; una
   pestaña detrás de un degradado no está en ninguna parte.

   La cuenta de cuántas caben es de domain/tabFit, con sus pruebas. Aquí solo
   está lo que hace falta un navegador para saber: cuánto mide cada rótulo. */

type TabIcon = ComponentType<{ size?: number }>;
export type TopTab = { readonly path: string; readonly label: string; readonly icon: TabIcon };

/** Si esta ruta enciende esta pestaña. Es la misma regla que aplica NavLink sin
 *  `end`: la ruta exacta o cualquier hija suya. Hace falta aparte porque el
 *  botón «···» tiene que encenderse cuando la pestaña activa está dentro del
 *  menú, y para saberlo no basta con preguntárselo a los NavLink que se pintan.
 *  La consulta se descarta: `?filter=` es un cubo dentro de la biblioteca, y
 *  cambiar de cubo no apaga la pestaña. */
const isOn = (pathname: string, path: string): boolean => {
  const base = path.split("?")[0];
  return pathname === base || pathname.startsWith(`${base}/`);
};

export function TopTabs({ tabs }: { tabs: readonly TopTab[] }) {
  const navRef = useRef<HTMLElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(tabs.length);
  const { pathname } = useLocation();
  /* El menú abierto se guarda como "abierto EN esta ruta", no como un booleano.
     Así navegar lo cierra sin un efecto que mire el pathname para llamar a
     setState — que es un render en cascada, y además el momento de cerrarlo es
     exactamente el render en el que la ruta ya es otra. */
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);

  /* La medida se toma de una fila FANTASMA, no del carril: el carril enseña
     solo las que caben, así que preguntarle cuánto mide una pestaña escondida
     no tiene respuesta. La fila fantasma lleva siempre las seis y el botón, a
     su tamaño natural, dentro de una caja de 0×0 con `overflow: hidden` — así
     no pinta, no se pulsa y, sobre todo, no cuenta para el ancho de la página,
     que es lo que mide la prueba e2e de la barra. */
  const measure = useCallback(() => {
    const nav = navRef.current;
    const ghost = ghostRef.current;
    if (!nav || !ghost) return;
    const cs = getComputedStyle(nav);
    const available =
      nav.clientWidth - parseFloat(cs.paddingLeft || "0") - parseFloat(cs.paddingRight || "0");
    const kids = Array.from(ghost.children) as HTMLElement[];
    if (kids.length < 2) return;
    const widths = kids.slice(0, -1).map((el) => el.getBoundingClientRect().width);
    const moreWidth = kids[kids.length - 1].getBoundingClientRect().width;
    setShown(fittingTabs({ widths, gap: parseFloat(cs.columnGap || "0") || 0, available, moreWidth }));
  }, []);

  /* Antes de pintar, no después: con un `useEffect` normal se ve un fotograma
     con las seis pestañas desbordadas antes de que el menú se las lleve.
     Envuelto y no `useLayoutEffect(measure, …)` a secas: pasándolo tal cual,
     lo que `measure` devuelva pasa a ser la función de limpieza del efecto, y
     `measure` está lleno de `return;` sueltos — el día que uno devuelva algo,
     React revienta al desmontar y el error no señala aquí. */
  useLayoutEffect(() => { measure(); }, [measure, tabs]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(nav);
    return () => ro.disconnect();
  }, [measure]);

  /* Los rótulos cambian de ancho cuando entra Inter, y la primera medida se
     toma con la tipografía de respaldo. Sin esto la barra se queda con el
     reparto de otra letra hasta que alguien cambie el tamaño de la ventana. */
  useEffect(() => {
    if (!document.fonts) return;
    let vivo = true;
    document.fonts.ready.then(() => { if (vivo) measure(); });
    return () => { vivo = false; };
  }, [measure]);

  /* Cerrar: fuera, Escape y al navegar. Los tres, el mismo idioma que ya usan
     el popover de filtros y TabMenu. */
  useEffect(() => {
    if (!open) return;
    const fuera = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const visibles = tabs.slice(0, shown);
  const guardadas = tabs.slice(shown);
  /* El «···» se enciende cuando la pestaña en la que estás vive dentro de él.
     La alternativa era sacarla al carril empujando a otra dentro, y eso mueve
     la fila bajo el ratón cada vez que navegas: la barra dejaría de estar en el
     mismo sitio de una pantalla a la siguiente, que es media razón de que haya
     barra. Así el orden no se toca nunca y el color dice "estás ahí dentro". */
  const activaEscondida = guardadas.some((tab) => isOn(pathname, tab.path));
  const masLabel = t("More tabs");

  return (
    <nav className="mq-tabs" ref={navRef}>
      {visibles.map((tab) => (
        <NavLink key={tab.path} to={tab.path} className={({ isActive }) => `mq-tab ${isActive ? "on" : ""}`}>
          <tab.icon size={16} />
          <span>{t(tab.label)}</span>
        </NavLink>
      ))}

      {guardadas.length > 0 && (
        <span className="mq-tabmore" ref={moreRef}>
          <button
            className={`mq-tab mq-tabmore-btn ${activaEscondida ? "on" : ""}`}
            onClick={() => setOpen(!open)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={masLabel}
            title={masLabel}
          >
            <Ellipsis size={16} />
          </button>
          {open && (
            <div className="filter-menu" role="menu" aria-label={masLabel}>
              {guardadas.map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  role="menuitem"
                  className={({ isActive }) => `filter-opt ${isActive ? "mq-tabmore-on" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  <tab.icon size={16} />
                  <span>{t(tab.label)}</span>
                </NavLink>
              ))}
            </div>
          )}
        </span>
      )}

      {/* ⚠️ Esto lleva una COPIA de cada pestaña y del botón, con las mismas
          clases: tiene que llevarlas, o mediría una caja distinta de la que
          luego se pinta. O sea que `.mq-tab` y `.mq-tabmore-btn` casan aquí
          dentro también, y un selector sin acotar —una prueba, un estilo— se
          encuentra con estas, que son invisibles. Acótalos por su padre. */}
      <div className="mq-tabs-probe" aria-hidden="true">
        <div className="mq-tabs-ghost" ref={ghostRef}>
          {tabs.map((tab) => (
            <span className="mq-tab" key={tab.path}>
              <tab.icon size={16} />
              <span>{t(tab.label)}</span>
            </span>
          ))}
          <span className="mq-tab mq-tabmore-btn"><Ellipsis size={16} /></span>
        </div>
      </div>
    </nav>
  );
}
