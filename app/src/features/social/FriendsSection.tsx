import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, ChevronRight, UserPlus, X } from "lucide-react";
import {
  useAcceptRequest, useFindProfile, useFriendships, useRemoveFriend, useSendRequest,
  type Friendship, type FoundProfile,
} from "@/lib/friends";
import { friendActivityOf, friendActivityVerb } from "@/domain/friendNow";
import { locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { useMedium } from "@/lib/medium";
import { FriendAvatar } from "@/ui/FriendAvatar";

/* You → Friends: add by handle, incoming requests atop, then the friends list. */

export function FriendsSection() {
  const { data: rows = [] } = useFriendships();
  const find = useFindProfile();
  const send = useSendRequest();
  const accept = useAcceptRequest();
  const remove = useRemoveFriend();
  const navigate = useNavigate();

  const [handle, setHandle] = useState("");
  const [found, setFound] = useState<FoundProfile | null | "none">(null);

  const incoming = rows.filter((r) => r.status === "pending" && r.incoming);
  const outgoing = rows.filter((r) => r.status === "pending" && !r.incoming);
  const friends = rows.filter((r) => r.status === "accepted");
  const knownIds = new Set(rows.map((r) => r.other_id));

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = await find.mutateAsync(handle);
    setFound(p ?? "none");
  };

  const openFriend = (id: string) => navigate(`/friend/${id}`);

  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <div>
          <h2 className="section-title">{tr("Friends")}</h2>
        </div>
      </div>

      {/* Add friend */}
      <form onSubmit={search} className="flex items-center gap-2">
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <span className="mute" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14 }}>@</span>
          <input
            value={handle}
            onChange={(e) => { setHandle(e.target.value); setFound(null); }}
            placeholder={tr("handle")}
            spellCheck={false}
            style={{
              width: "100%", padding: "9px 12px 9px 28px", borderRadius: "var(--r)",
              border: "1px solid var(--border-strong)", background: "var(--surface-2)",
              color: "var(--text)", fontSize: 14, outline: "none",
            }}
          />
        </div>
        <button className="btn btn-ghost btn-sm" type="submit" disabled={find.isPending || !handle.trim()}>
          <UserPlus size={15} />{tr("Find")}
        </button>
      </form>

      {found === "none" && (
        <p className="mute" style={{ fontSize: 13 }}>
          {tr("No one with that exact handle.")}
        </p>
      )}
      {found && found !== "none" && (
        <div className="card mq-row" style={{ cursor: "default" }}>
          <FriendAvatar f={{ id: found.id, name: found.display_name, avatarUrl: found.avatar_url }} size={40} />
          <div className="flex-1 min-w-0">
            <div style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">{found.display_name}</div>
            <div className="mute" style={{ fontSize: 12.5 }}>@{found.handle}</div>
          </div>
          {knownIds.has(found.id) ? (
            <span className="badge badge-soft">{tr("Already connected")}</span>
          ) : (
            <button className="btn btn-accent btn-sm" disabled={send.isPending} onClick={() => { send.mutate(found.id); setFound(null); setHandle(""); }}>
              <UserPlus size={14} />{tr("Add")}
            </button>
          )}
        </div>
      )}

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="eyebrow">{tr("Requests")}</div>
          {incoming.map((r) => (
            <div key={r.other_id} className="card mq-row" style={{ cursor: "default" }}>
              <FriendAvatar f={{ id: r.other_id, name: r.display_name, avatarUrl: r.avatar_url }} size={40} />
              <div className="flex-1 min-w-0">
                <div style={{ fontWeight: 700, fontSize: 14.5 }} className="truncate">{r.display_name}</div>
                <div className="mute" style={{ fontSize: 12.5 }}>@{r.handle} {tr("wants to connect")}</div>
              </div>
              <button className="btn btn-accent btn-sm" onClick={() => accept.mutate(r.other_id)}><Check size={14} />{tr("Accept")}</button>
              <button className="btn btn-ghost btn-icon" title={tr("Decline")} onClick={() => remove.mutate(r.other_id)}><X size={16} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Friends list */}
      {friends.length === 0 && incoming.length === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>
            {tr("No friends yet — add someone by their @handle, or share an invite.")}
          </p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
          {friends.map((r) => (
            <FriendCard key={r.other_id} r={r} onOpen={() => openFriend(r.other_id)} />
          ))}
        </div>
      )}

      {outgoing.length > 0 && (
        <p className="mute" style={{ fontSize: 12.5 }}>
          {tv(outgoing.length === 1 ? "{count} pending sent request." : "{count} pending sent requests.", { count: outgoing.length })}
        </p>
      )}
    </section>
  );
}

/* La línea de debajo del nombre habla del medio en el que estás: en
   Videojuegos, a qué juega; en Series, qué está viendo o qué acaba de terminar;
   en Cine, la última que ha visto. Antes decía «Viendo» de lo último que
   marcara fuera lo que fuera, y por eso anunciaba «Viendo Dave the Diver» —un
   juego, y terminado— en el modo Series (0084 lo cuenta entero).

   Sin nada suyo de este medio se queda con su @usuario, que es lo que había
   antes de que hubiera nada que contar: es mejor no decir nada que rellenar el
   hueco con lo de otro modo, que es justo el fallo que esto arregla. */
function FriendCard({ r, onOpen }: { r: Friendship; onOpen: () => void }) {
  const medium = useMedium();
  /* El título en español si lo tiene, como el muro de justo debajo: la RPC
     devuelve el nombre original, así que sin esto la misma serie salía
     "Severance" aquí y "Separación" dos dedos más abajo. El medio es el del
     modo porque es de ese medio de lo que habla la fila. */
  const name = locName(useEsNames(), r.watching_tmdb, r.watching_title ?? "", medium);
  return (
    <div className="card mq-row" onClick={onOpen}>
      <FriendAvatar f={{ id: r.other_id, name: r.display_name, avatarUrl: r.avatar_url }} size={44} />
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{r.display_name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {r.watching_title
            ? <>{tr(friendActivityVerb(friendActivityOf(r.activity, medium)))} <b style={{ fontWeight: 650 }}>{name}</b></>
            : `@${r.handle}`}
        </div>
      </div>
      <ChevronRight size={16} className="mute" />
    </div>
  );
}
