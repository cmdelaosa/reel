import { useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";
import { subscribeQueryError, isQueryErrorVisible } from "@/ui/shell/queryErrorStore";
import { t as tr } from "@/lib/i18n";

export function QueryErrorToast() {
  const shown = useSyncExternalStore(subscribeQueryError, isQueryErrorVisible, () => false);
  if (!shown) return null;
  return (
    <div
      className="card sheet fixed flex items-center gap-2.5"
      style={{ zIndex: 90, left: "50%", bottom: 26, transform: "translateX(-50%)", padding: "11px 16px", borderRadius: 999 }}
      role="alert"
    >
      <AlertTriangle size={16} style={{ color: "#e5484d" }} />
      <span style={{ fontSize: 13.5, fontWeight: 650 }}>
        {tr("Couldn't load — check your connection and retry")}
      </span>
    </div>
  );
}
