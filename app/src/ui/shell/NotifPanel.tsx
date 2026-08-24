import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Bell, Check, Download, Film, Smile, Trash2, Tv, Users } from "lucide-react";
import {
  useNotifications, useMarkNotificationsRead, useClearNotifications, type Notification,
} from "@/lib/notifications";
import { nameList } from "@/domain/reactions";
import { t as tr, tv } from "@/lib/i18n";

/* Bell popover — the in-app inbox. Styling ported from prototype overlays.tsx
   NotifPanel; rows are live (Realtime) and route by type. */

const ICONS: Record<string, typeof Bell> = {
  new_episode: Tv,
  movie_release: Film,
  friend_request: Users,
  import_done: Download,
  reaction: Smile,
};

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return tr("now");
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function title(n: Notification): string {
  switch (n.type) {
    case "new_episode": return tr("New episode");
    /* Dos títulos, no uno: el aviso de cines te manda a comprar una entrada y
       el de streaming a sentarte en el sofá. Llamar a los dos "Ya disponible"
       era exactamente lo que hizo que estos avisos se aplazaran hasta hoy. */
    case "movie_release":
      return (n.payload as Record<string, unknown>).release_kind === "theatrical"
        ? tr("In theatres today")
        : tr("Streaming today");
    case "friend_request": return tr("Friend request");
    case "import_done": return tr("Import finished");
    case "reaction": return tr("Reaction");
    // The type itself, for a row this build doesn't know how to name yet.
    default: return n.type;
  }
}

function body(n: Notification): string {
  const p = n.payload as Record<string, unknown>;
  const show = (p.show_name as string | undefined) ?? tr("A show");
  switch (n.type) {
    case "new_episode":
      // The episode title travels as a placeholder (quoted, or empty) rather
      // than being appended, so a language can put it anywhere in the sentence.
      return tv("{show} S{season} · E{episode}{name} just aired", {
        show,
        season: String(p.season_number),
        episode: String(p.episode_number),
        name: p.episode_name ? ` "${p.episode_name}"` : "",
      });
    case "movie_release": {
      const movie = (p.movie_name as string | undefined) ?? tr("A movie");
      return p.release_kind === "theatrical"
        ? tv("{movie} is in theatres", { movie })
        : tv("{movie} is out to stream", { movie });
    }
    case "import_done":
      return tv("{count} shows imported from TV Time", { count: String(p.matched ?? 0) });
    case "reaction": {
      // One row per event, rewritten as people pile on — so it names them all,
      // and only quotes an emoji while there is a single one to quote.
      const reactors = Array.isArray(p.reactors) ? (p.reactors as { name?: string; emoji?: string }[]) : [];
      const who = nameList(
        // A private reactor comes back nameless from the trigger, on purpose.
        reactors.map((r) => r.name ?? tr("Someone")),
        (a, b) => tv("{a} and {b}", { a, b }),
        (a, n) => tv("{a} and {n} more", { a, n }),
      );
      return reactors.length === 1
        ? tv("{name} reacted {emoji} to {show}", { name: who, emoji: reactors[0].emoji ?? "", show })
        : tv("{names} reacted to {show}", { names: who, show });
    }
    default:
      return typeof p.message === "string" ? p.message : "";
  }
}

/* How the rows leave when the inbox is emptied. Each one starts SWEEP_STEP after
   the one above it — capped, so fifty notifications don't take two seconds to
   go — and the whole thing has to outlast the last row's start. */
const SWEEP_MS = 240;
const SWEEP_STEP = 35;
const SWEEP_CAP = 175;
const sweepDelay = (i: number) => Math.min(i * SWEEP_STEP, SWEEP_CAP);

export function NotifPanel({ onClose }: { onClose: () => void }) {
  const { data: items = [] } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const clear = useClearNotifications();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  /* Clearing deletes optimistically, so the rows are gone from the cache the
     instant you click and there is nothing left to animate. The panel keeps
     rendering this snapshot of them for the length of the sweep, then drops it
     and falls back to live data — which by then is the empty state. Holding a
     copy rather than delaying the mutation also means closing the panel
     mid-animation still clears the inbox. */
  const [sweeping, setSweeping] = useState<Notification[] | null>(null);
  const rows = sweeping ?? items;

  useEffect(() => {
    if (!sweeping) return;
    const timer = setTimeout(() => setSweeping(null), SWEEP_MS + sweepDelay(sweeping.length - 1));
    return () => clearTimeout(timer);
  }, [sweeping]);

  const clearAll = () => {
    if (items.length && !matchMedia("(prefers-reduced-motion: reduce)").matches) setSweeping(items);
    clear.mutate();
  };

  const route = (n: Notification) => {
    if (!n.read_at) markRead.mutate([n.id]);
    const p = n.payload as Record<string, unknown>;
    if ((n.type === "new_episode" || n.type === "movie_release") && p.tmdb_id) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        // Cada medio abre su ficha por su parámetro: un id de TMDB solo es
        // único dentro del suyo (0067).
        next.set(n.type === "movie_release" ? "movie" : "title", String(p.tmdb_id));
        return next;
      });
      onClose();
    } else if (n.type === "import_done") {
      navigate("/settings/import");
      onClose();
    } else if (n.type === "reaction" && typeof p.event_key === "string") {
      // Land on the row itself, not on the show: the reaction is about what
      // you did, and the feed is where it is legible.
      navigate(`/friends?event=${encodeURIComponent(p.event_key)}`);
      onClose();
    }
  };

  return (
    <>
      <div className="mq-notif sheet">
        <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 750, fontSize: 15 }}>{tr("Notifications")}</div>
          <div className="flex items-center gap-1.5">
            {items.some((n) => !n.read_at) && (
              <button className="chip" onClick={() => markRead.mutate(undefined)}>
                <Check size={13} />{tr("Mark all read")}
              </button>
            )}
            {items.length > 0 && (
              // One tap, no dialog and no second press: an inbox is cheap to
              // empty and the rows sweeping out is the confirmation.
              <button className="chip" onClick={clearAll}>
                <Trash2 size={13} />{tr("Clear")}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col" style={{ maxHeight: "min(60vh, 480px)", overflowY: "auto" }}>
          {rows.length === 0 && (
            <div className="dim" style={{ padding: "28px 16px", textAlign: "center", fontSize: 13.5 }}>
              {tr("You're all caught up.")}
            </div>
          )}
          {rows.map((n, i) => {
            const Icon = ICONS[n.type] ?? Bell;
            const unread = !n.read_at;
            return (
              <div
                key={n.id}
                className={`flex items-start gap-3 px-4 py-3.5 cursor-pointer${sweeping ? " notif-sweep" : ""}`}
                style={{
                  borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
                  background: unread ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined,
                  animationDelay: sweeping ? `${sweepDelay(i)}ms` : undefined,
                }}
                onClick={() => !sweeping && route(n)}
              >
                <div
                  className="grid place-items-center shrink-0"
                  style={{
                    width: 36, height: 36, borderRadius: "var(--r-sm)",
                    background: unread ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface-3)",
                    color: unread ? "var(--accent)" : "var(--text-dim)",
                  }}
                >
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{title(n)}</span>
                    <span className="mute" style={{ fontSize: 11 }}>{relTime(n.created_at)}</span>
                    {unread && <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent)", marginLeft: "auto" }} />}
                  </div>
                  <div className="dim" style={{ fontSize: 13 }}>{body(n)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
