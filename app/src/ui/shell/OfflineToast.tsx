import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { isEs } from "@/lib/i18n";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/* Fixed toast shown while the browser reports no network. */
export function OfflineToast() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div
      className="card sheet fixed flex items-center gap-2.5"
      style={{ zIndex: 90, left: "50%", bottom: 26, transform: "translateX(-50%)", padding: "11px 16px", borderRadius: 999 }}
      role="status"
    >
      <WifiOff size={16} style={{ color: "var(--accent)" }} />
      <span style={{ fontSize: 13.5, fontWeight: 650 }}>
        {isEs() ? "Sin conexión — los cambios quedan en pausa" : "You're offline — changes are paused"}
      </span>
    </div>
  );
}
