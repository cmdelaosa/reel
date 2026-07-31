import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import {
  chipsFor, myEmoji, REACTIONS, REACTION_LABELS,
  type ReactionPerson, type ReactionRow,
} from "@/domain/reactions";
import { useSetReaction } from "@/lib/reactions";
import { FriendStack } from "@/ui/FriendAvatar";
import { t as tr, tv } from "@/lib/i18n";

/* The reaction strip under an activity row: the chips already left, plus the
   button that opens the palette. Everything here swallows its click — the row
   behind it opens the show, and reacting is not asking for that.

   Emoji carry no accessible name, so every control spells out what it means
   and who is behind it; the palette is a plain group rather than a role="menu",
   which would promise arrow-key navigation this does not implement. */

export function ReactionBar({ eventKey, rows, me }: {
  eventKey: string;
  rows: ReactionRow[];
  me: string;
}) {
  const set = useSetReaction();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const chips = chipsFor(rows, me);
  const mine = myEmoji(rows, me);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      // Stopped, or the sheet/panel behind this one would close too.
      if (e.key === "Escape") { e.stopPropagation(); close(true); }
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
    close(false);
    set.mutate({ eventKey, emoji: mine === emoji ? null : emoji });
  };

  const label = (emoji: string) => tr(REACTION_LABELS[emoji] ?? emoji);
  const who = (people: ReactionPerson[]) => people.map((p) => p.name ?? tr("Someone")).join(", ");

  return (
    <div className="rx-bar" ref={ref} onClick={(e) => e.stopPropagation()}>
      {chips.map((c) => (
        <button
          key={c.emoji}
          className={`rx-chip${c.mine ? " rx-mine" : ""}`}
          title={who(c.people)}
          aria-pressed={c.mine}
          aria-label={tv("{reaction}, {count}: {names}", {
            reaction: label(c.emoji), count: c.count, names: who(c.people),
          })}
          onClick={() => pick(c.emoji)}
        >
          <span aria-hidden>{c.emoji}</span>
          {/* Faces rather than a number: with a group this size you read who
              reacted at a glance, and a tooltip is no use on a phone. */}
          <FriendStack
            fans={c.people.map((p) => ({ id: p.id, name: p.name ?? tr("Someone"), avatarUrl: p.avatarUrl }))}
            size={16}
            max={3}
          />
        </button>
      ))}

      <button
        ref={triggerRef}
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
        <div className="card rx-pop" role="group" aria-label={tr("React")}>
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              className={`rx-opt${mine === emoji ? " rx-mine" : ""}`}
              aria-label={label(emoji)}
              aria-pressed={mine === emoji}
              title={label(emoji)}
              onClick={() => pick(emoji)}
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
