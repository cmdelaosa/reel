import { useState } from "react";
import { Check, Copy, Link2, Plus, Ticket } from "lucide-react";
import { useCreateInvite, useMyInvites, inviteLink, type MyInvite } from "@/lib/invites";
import { isEs } from "@/lib/i18n";

/* You → Invites: create + share codes, see who redeemed them. */

function statusLabel(inv: MyInvite): string {
  if (isEs()) {
    if (inv.status === "used") return inv.used_by_handle ? `Usada por @${inv.used_by_handle}` : "Usada";
    if (inv.status === "expired") return "Caducada";
    return "Sin usar";
  }
  if (inv.status === "used") return inv.used_by_handle ? `Used by @${inv.used_by_handle}` : "Used";
  if (inv.status === "expired") return "Expired";
  return "Unused";
}

export function InvitesCard() {
  const { data: invites = [] } = useMyInvites();
  const create = useCreateInvite();
  const [copied, setCopied] = useState<string | null>(null);

  const unused = invites.filter((i) => i.status === "unused").length;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(code));
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <div>
          <h2 className="section-title">{isEs() ? "Invitaciones" : "Invites"}</h2>
          <p className="mute" style={{ fontSize: 13 }}>
            {isEs()
              ? `Reel es solo con invitación — trae a un amigo. ${unused}/10 sin usar.`
              : `Reel is invite-only — bring a friend. ${unused}/10 unused.`}
          </p>
        </div>
        <button
          className="btn btn-accent btn-sm"
          disabled={create.isPending || unused >= 10}
          onClick={() => create.mutate()}
        >
          <Plus size={15} />{isEs() ? "Crear invitación" : "Create invite"}
        </button>
      </div>

      {create.error && (
        <p role="alert" style={{ color: "#e5484d", fontSize: 13 }}>{(create.error as Error).message}</p>
      )}

      {invites.length === 0 ? (
        <div className="card" style={{ padding: "24px", display: "flex", alignItems: "center", gap: 12 }}>
          <Ticket size={22} style={{ color: "var(--accent)" }} />
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {isEs() ? "Aún no hay invitaciones — crea una para compartir." : "No invites yet — create one to share."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {invites.map((inv) => (
            <div key={inv.code} className="card mq-row" style={{ cursor: "default" }}>
              <div className="grid place-items-center shrink-0" style={{ width: 40, height: 40, borderRadius: "var(--r-sm)", background: "color-mix(in srgb, var(--accent) 14%, transparent)", color: "var(--accent)" }}>
                <Ticket size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontWeight: 750, fontSize: 15, letterSpacing: "0.04em" }}>{inv.code}</div>
                <div className="mute" style={{ fontSize: 12.5 }}>{statusLabel(inv)}</div>
              </div>
              {inv.status === "unused" && (
                <button className="btn btn-ghost btn-sm" onClick={() => copy(inv.code)}>
                  {copied === inv.code
                    ? <><Check size={14} />{isEs() ? "Copiado" : "Copied"}</>
                    : <><Copy size={14} />{isEs() ? "Copiar enlace" : "Copy link"}</>}
                </button>
              )}
              {inv.status !== "unused" && (
                <span className="badge badge-soft"><Link2 size={12} />{inv.status}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
