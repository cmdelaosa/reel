import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import { chipsFor, myEmoji, REACTIONS, type ReactionRow } from "@/domain/reactions";
import { useSetReaction, type ReactionTarget } from "@/lib/reactions";
import { t as tr } from "@/lib/i18n";

/* The reaction strip under an activity row: the chips already left, plus the
   button that opens the palette. Everything here swallows its click — the row
   behind it opens the show, and reacting is not asking for that. */

export function ReactionBar({ target, rows, me }: {
  target: ReactionTarget;
  rows: ReactionRow[];
  me: string;
}) {
  const set = useSetReaction();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const chips = chipsFor(rows, me);
  const mine = myEmoji(rows, me);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      // Stopped, or the sheet/panel behind this one would close too.
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  // One reaction per person: the emoji you already left withdraws it, any other
  // moves it. Same rule whether you tap a chip or pick from the palette.
  const pick = (emoji: string) => {
    setOpen(false);
    set.mutate({ target, emoji: mine === emoji ? null : emoji });
  };

  return (
    <div className="rx-bar" ref={ref} onClick={(e) => e.stopPropagation()}>
      {chips.map((c) => (
        <button
          key={c.emoji}
          className={`rx-chip${c.mine ? " rx-mine" : ""}`}
          title={c.names.join(", ")}
          aria-pressed={c.mine}
          onClick={() => pick(c.emoji)}
        >
          <span aria-hidden>{c.emoji}</span>
          <span className="rx-count">{c.count}</span>
        </button>
      ))}

      <button
        className={`rx-add${open ? " rx-open" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={tr("React")}
        title={tr("React")}
        onClick={() => setOpen((o) => !o)}
      >
        <SmilePlus size={15} />
      </button>

      {open && (
        <div className="card rx-pop" role="menu" aria-label={tr("React")}>
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              role="menuitem"
              className={`rx-opt${mine === emoji ? " rx-mine" : ""}`}
              onClick={() => pick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
