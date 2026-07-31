import { useEffect, useRef, useState } from "react";
import { SmilePlus } from "lucide-react";
import {
  chipsFor, myEmoji, REACTIONS, REACTION_LABELS,
  type ReactionPerson, type ReactionRow,
} from "@/domain/reactions";
import { useSetReaction } from "@/lib/reactions";
import { FriendAvatar, FriendStack } from "@/ui/FriendAvatar";
import { t as tr, tv } from "@/lib/i18n";

/* The reaction strip under an activity row: the chips already left, the palette
   that adds one, and the detail behind a chip — who reacted, with what.

   Chips read, ⊕ writes. A chip used to toggle your own reaction, which is a
   fine gesture but it can't also open a list; the toggle for that emoji now
   lives at the foot of the detail, one tap further in and impossible to hit by
   accident while reading who reacted.

   Everything here swallows its click — the row behind it opens the show, and
   reacting is not asking for that. Emoji carry no accessible name, so every
   control spells out what it means. */

type Open = { kind: "palette" } | { kind: "detail"; emoji: string } | null;

export function ReactionBar({ eventKey, rows, me }: {
  eventKey: string;
  rows: ReactionRow[];
  me: string;
}) {
  const set = useSetReaction();
  const [open, setOpen] = useState<Open>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const chips = chipsFor(rows, me);
  const mine = myEmoji(rows, me);

  const close = (returnFocus: boolean) => {
    setOpen(null);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
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
  // moves it.
  const pick = (emoji: string) => {
    close(false);
    set.mutate({ eventKey, emoji: mine === emoji ? null : emoji });
  };

  const label = (emoji: string) => tr(REACTION_LABELS[emoji] ?? emoji);
  const nameOf = (p: ReactionPerson) => p.name ?? tr("Someone");
  const who = (people: ReactionPerson[]) => people.map(nameOf).join(", ");
  const detailEmoji = open?.kind === "detail" ? open.emoji : null;

  return (
    <div className="rx-bar" ref={ref} onClick={(e) => e.stopPropagation()}>
      {chips.map((c) => (
        <button
          key={c.emoji}
          className={`rx-chip${c.mine ? " rx-mine" : ""}`}
          aria-haspopup="true"
          aria-expanded={detailEmoji === c.emoji}
          aria-label={tv("{reaction}, {count}: {names}", {
            reaction: label(c.emoji), count: c.count, names: who(c.people),
          })}
          onClick={() => setOpen(detailEmoji === c.emoji ? null : { kind: "detail", emoji: c.emoji })}
        >
          <span aria-hidden>{c.emoji}</span>
          {/* Faces rather than a number: with a group this size you read who
              reacted at a glance, and a tooltip is no use on a phone. */}
          <FriendStack
            fans={c.people.map((p) => ({ id: p.id, name: nameOf(p), avatarUrl: p.avatarUrl }))}
            size={16}
            max={3}
          />
        </button>
      ))}

      <button
        ref={triggerRef}
        className={`rx-add${open?.kind === "palette" ? " rx-open" : ""}`}
        aria-haspopup="true"
        aria-expanded={open?.kind === "palette"}
        aria-label={tr("React")}
        title={tr("React")}
        onClick={() => setOpen(open?.kind === "palette" ? null : { kind: "palette" })}
      >
        <SmilePlus size={15} />
      </button>

      {open?.kind === "palette" && (
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

      {detailEmoji && (
        // The whole row's reactions, not just the chip's: what you want to know
        // is who thought what, and that reads worse split across three lists.
        <div className="card friends-pop rx-detail" aria-label={tr("Reactions")}>
          {rows.map((r) => (
            <div key={r.user_id} className="friends-pop-row" style={{ cursor: "default" }}>
              <FriendAvatar
                f={{ id: r.user_id, name: r.display_name ?? tr("Someone"), avatarUrl: r.avatar_url }}
                size={26}
              />
              <span className="flex-1 min-w-0 truncate" style={{ fontSize: 13, fontWeight: 650 }}>
                {r.user_id === me ? tr("You") : (r.display_name ?? tr("Someone"))}
              </span>
              <span aria-label={label(r.emoji)} title={label(r.emoji)} style={{ fontSize: 15 }}>
                {r.emoji}
              </span>
            </div>
          ))}
          <button className="rx-detail-act" onClick={() => pick(detailEmoji)}>
            {mine === detailEmoji
              ? tv("Remove my {emoji}", { emoji: detailEmoji })
              : tv("React with {emoji}", { emoji: detailEmoji })}
          </button>
        </div>
      )}
    </div>
  );
}
