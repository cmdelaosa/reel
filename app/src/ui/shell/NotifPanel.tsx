import { useNavigate, useSearchParams } from "react-router";
import { Bell, CalendarClock, Check, Download, Tv, Users } from "lucide-react";
import { useNotifications, useMarkNotificationsRead, type Notification } from "@/lib/notifications";

/* Bell popover — the in-app inbox. Styling ported from prototype overlays.tsx
   NotifPanel; rows are live (Realtime) and route by type. */

const ICONS: Record<string, typeof Bell> = {
  new_episode: Tv,
  premiere: CalendarClock,
  friend_request: Users,
  import_done: Download,
};

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function title(n: Notification): string {
  switch (n.type) {
    case "new_episode": return "New episode";
    case "premiere": return "Premiere dated";
    case "friend_request": return "Friend request";
    case "import_done": return "Import finished";
    default: return n.type;
  }
}

function body(n: Notification): string {
  const p = n.payload as Record<string, unknown>;
  switch (n.type) {
    case "new_episode":
      return `${p.show_name ?? "A show"} S${p.season_number} · E${p.episode_number}${p.episode_name ? ` "${p.episode_name}"` : ""} just aired`;
    case "premiere":
      return `${p.show_name ?? "A show"} has a premiere date`;
    case "import_done":
      return `${p.matched ?? 0} shows imported from TV Time`;
    default:
      return typeof p.message === "string" ? p.message : "";
  }
}

export function NotifPanel({ onClose }: { onClose: () => void }) {
  const { data: items = [] } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();

  const route = (n: Notification) => {
    if (!n.read_at) markRead.mutate([n.id]);
    const p = n.payload as Record<string, unknown>;
    if (n.type === "new_episode" && p.tmdb_id) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("title", String(p.tmdb_id));
        return next;
      });
      onClose();
    } else if (n.type === "import_done") {
      navigate("/settings/import");
      onClose();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div
        className="fixed z-[56] card overflow-hidden sheet"
        style={{ top: 64, right: 16, width: "min(380px, 92vw)", borderRadius: "var(--r-lg)" }}
      >
        <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 750, fontSize: 15 }}>Notifications</div>
          {items.some((n) => !n.read_at) && (
            <button className="chip" onClick={() => markRead.mutate(undefined)}>
              <Check size={13} />Mark all read
            </button>
          )}
        </div>

        <div className="flex flex-col" style={{ maxHeight: "min(60vh, 480px)", overflowY: "auto" }}>
          {items.length === 0 && (
            <div className="dim" style={{ padding: "28px 16px", textAlign: "center", fontSize: 13.5 }}>
              You're all caught up.
            </div>
          )}
          {items.map((n, i) => {
            const Icon = ICONS[n.type] ?? Bell;
            const unread = !n.read_at;
            return (
              <div
                key={n.id}
                className="flex items-start gap-3 px-4 py-3.5 cursor-pointer"
                style={{
                  borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none",
                  background: unread ? "color-mix(in srgb, var(--accent) 6%, transparent)" : undefined,
                }}
                onClick={() => route(n)}
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
