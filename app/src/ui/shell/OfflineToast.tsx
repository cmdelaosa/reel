import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { isOffline, subscribeConnection } from "@/lib/connection";
import { t as tr } from "@/lib/i18n";

/* Fixed toast shown while the app cannot reach the network.
   Driven by observed traffic and our own probes, never by navigator.onLine —
   see domain/connection.ts for why that flag is not allowed a vote. */
export function OfflineToast() {
  const offline = useSyncExternalStore(subscribeConnection, isOffline, () => false);
  if (!offline) return null;
  return (
    <div
      className="card sheet fixed flex items-center gap-2.5"
      style={{ zIndex: 90, left: "50%", bottom: 26, transform: "translateX(-50%)", padding: "11px 16px", borderRadius: 999 }}
      role="status"
    >
      <WifiOff size={16} style={{ color: "var(--accent)" }} />
      <span style={{ fontSize: 13.5, fontWeight: 650 }}>
        {tr("You're offline — changes are paused")}
      </span>
    </div>
  );
}
