import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/* Phone shape of a tab strip. Three strips scroll horizontally on a phone —
   Discover's pools, the Calendar's views and My Shows' sort — and every one of
   them left its last option past the viewport edge with nothing on screen
   saying it was there, so the list read one option short. Below 768px CSS
   hides the .segmented row and shows this instead: a trigger naming the option
   you are on, and a menu holding all of them. Escape and outside-click close
   it, the idiom the Filters popover already uses.

   Labels arrive already localized — this is pure UI and never calls t(). */
export function TabMenu<T extends string>({ value, options, onPick, menuLabel, align = "start", floating = false, always = false }: {
  value: T;
  /** `hint` rides along beside the label — My Shows' buckets carry a count, and
   *  losing it in the phone shape would make the menu say less than the row. */
  options: readonly { key: T; label: string; hint?: string }[];
  onPick: (key: T) => void;
  /** aria-label for the menu, already localized. */
  menuLabel: string;
  /** Which trigger edge the menu hangs off. The menu is wider than the trigger,
   *  so this has to match where the trigger sits in its toolbar or the menu
   *  opens off-screen — "end" for a trigger parked at the right, "center" for
   *  one that is centred. */
  align?: "start" | "center" | "end";
  /** The calendar's strip floats over the scrolling feed inside a blurred pill;
   *  its trigger has to be that pill rather than a flat chip dropped into it. */
  floating?: boolean;
  /** Keep the menu shape at every width, with no segmented row behind it. For
   *  controls that were never a strip: the friend page's sort was a bare
   *  <select> whose custom skin stripped the arrow, so on a desktop it read as
   *  a dead pill. The chip's chevron is the affordance the select lost. */
  always?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <div className={`tabmenu tabmenu-${align}${floating ? " tabmenu-float" : ""}${always ? " tabmenu-always" : ""}`} ref={ref}>
      <button className="chip" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="truncate">{current.label}</span>
        {current.hint && <span className="mute" style={{ fontWeight: 700 }}>{current.hint}</span>}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="filter-menu" role="menu" aria-label={menuLabel}>
          {options.map((o) => (
            <button
              key={o.key}
              role="menuitemradio"
              aria-checked={value === o.key}
              className="filter-opt"
              onClick={() => { onPick(o.key); setOpen(false); }}
            >
              {o.label}
              {o.hint && <span className="mute" style={{ fontWeight: 700 }}>{o.hint}</span>}
              {value === o.key && <Check size={14} className="filter-opt-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
