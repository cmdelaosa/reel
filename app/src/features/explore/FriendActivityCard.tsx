import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAddedBatch, useFriendActivity, type ActivityItem } from "@/lib/explore";
import { useFriendships } from "@/lib/friends";
import { useEventReactions } from "@/lib/reactions";
import { byEvent, type ReactionRow } from "@/domain/reactions";
import { relativeTime } from "@/domain/time";
import { addedListOf, showsEpisodeCount, watchedPhrase } from "@/domain/mediumCopy";
import { thumbArt } from "@/lib/artwork";
import { dateLocale, locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { useAuth } from "@/features/auth/AuthProvider";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { useShowMore } from "@/ui/ShowMore";
import { MediumGlyph } from "@/ui/MediumGlyph";
import { posterBg } from "@/ui/posterBg";
import { ReactionBar } from "@/features/explore/ReactionBar";

/* One shared empty list, so a row with no reactions doesn't hand ReactionBar a
   fresh array identity on every render. */
const EMPTY: ReactionRow[] = [];

/** Los títulos que hay detrás de una fila plegada (0077).
 *
 *  Se monta al desplegar, así que la consulta sale entonces y no antes: el muro
 *  trae treinta filas y lo normal es que nadie abra ninguna.
 *
 *  Rejilla de carátulas y no una lista de texto: son cuarenta juegos y lo que
 *  se hace con ellos es reconocerlos de un vistazo, no leerlos. Cada uno abre
 *  su ficha, que es lo que la fila plegada dejó de poder hacer. */
function AddedBatch({
  eventKey,
  total,
  onPick,
}: {
  eventKey: string;
  /** Lo que dice la frase de arriba. Si la lista trae menos, es el tope del
   *  servidor y hay que decirlo: "añadió 300 juegos" con 200 carátulas debajo
   *  y sin explicación se lee como que faltan cien por una avería. */
  total: number;
  onPick: (t: { kind: string; tmdb_id: number }) => void;
}) {
  const { data, isPending } = useAddedBatch(eventKey);

  if (isPending) {
    return (
      <div className="surface-2" style={{ borderRadius: "var(--r)", padding: 12, margin: "0 0 8px 52px" }}>
        <div className="skeleton" style={{ height: 64, borderRadius: "var(--r-md)" }} />
      </div>
    );
  }
  if (!data?.length) return null;

  return (
    <div
      className="surface-2"
      style={{
        borderRadius: "var(--r)", padding: 12, margin: "0 0 8px 52px",
        display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
      }}
    >
      {data.map((t) => {
        const art = thumbArt(t.kind, t.poster_path);
        return (
          <button
            key={`${t.kind}:${t.tmdb_id}`}
            type="button"
            title={t.name}
            onClick={(e) => { e.stopPropagation(); onPick(t); }}
            style={{ all: "unset", cursor: "pointer", minWidth: 0 }}
          >
            <div
              className="mq-row-art"
              style={{
                width: "100%", aspectRatio: "2 / 3", borderRadius: "var(--r-sm)",
                ...(art ? {} : { background: posterBg(t.name) }),
              }}
            >
              {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
            </div>
            <div
              className="mute"
              style={{ fontSize: 11, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {t.name}
            </div>
          </button>
        );
      })}
      {data.length < total && (
        <div className="mute" style={{ gridColumn: "1 / -1", fontSize: 11.5 }}>
          {tv("+{n} more — the rest are in their library", { n: total - data.length })}
        </div>
      )}
    </div>
  );
}

/* The group's wall (P4-C4, reactions in 0058) — every episode watched, plus
   adds and ratings, yours among them.

   Same-day episodes of one show arrive already collapsed into a single row
   ("S1 · E3–E7"): 0058 moved that grouping into rpc_friend_activity, because a
   reaction needs a row identity that every reader agrees on, and grouping by
   each viewer's local day did not give one. A row from an older RPC has no
   event_key — it renders un-collapsed and without reactions rather than
   breaking. The started/finished_season branches only render against a
   pre-0040 RPC.

   Reactions travel by event_key alone: whose event it is and which show it is
   about are derived from that key in Postgres, never sent from here. */

function epRange(a: ActivityItem): React.ReactNode {
  const toS = a.to_season ?? a.season_number;
  const toE = a.to_episode ?? a.episode_number;
  if (toS === a.season_number && toE === a.episode_number)
    return <>S{a.season_number} · E{a.episode_number}</>;
  if (toS === a.season_number)
    return `S${a.season_number} · E${a.episode_number}–E${toE}`;
  return `S${a.season_number} · E${a.episode_number} – S${toS} · E${toE}`;
}

/* Slot React nodes into a translated sentence's {placeholders}. The whole
   sentence is one dictionary key, so a language can put the show name and the
   episode range where its grammar wants them ("vio S1 · E3 de Severance") —
   a chain of translated fragments would freeze English order. */
function fill(s: string, nodes: Record<string, React.ReactNode>): React.ReactNode {
  return s.split(/(\{[a-z]+\})/).map((part, i) => {
    const slot = /^\{[a-z]+\}$/.test(part) ? nodes[part.slice(1, -1)] : undefined;
    return <Fragment key={i}>{slot ?? part}</Fragment>;
  });
}

/* Your own rows need their own keys, not the third-person ones: English gets
   away with one verb ("watched"), Spanish does not ("vio" / "viste"). */
function phrase(a: ActivityItem, titleName: string, isMe: boolean): React.ReactNode {
  const name = <b style={{ fontWeight: 700 }}>{titleName}</b>;
  const shape = watchedPhrase(a.kind);
  // Solo cuando la frase lleva episodios: ni en cine ni en juegos hay rango que
  // componer, y construirlo para tirarlo deja el código afirmando justo encima
  // lo que la rama de abajo niega.
  const eps = shape === "with-episodes"
    && a.season_number != null && a.episode_number != null && (
      <b style={{ fontWeight: 700 }}>{epRange(a)}</b>
    );
  switch (a.verb) {
    case "rated":
      return fill(tr(isMe ? "self: rated {name}" : "rated {name}"), { name });
    case "added": {
      /* La lista tiene otro nombre en cada medio —watchlist para series y cine,
         PENDIENTES para juegos— y desde 0076 hay una tercera que no la decide
         el medio sino la fila: lo marcado como "Lo tengo" va a la BIBLIOTECA.
         Cuál toca lo dice el servidor; domain/mediumCopy pone el respaldo. */
      const list = addedListOf(a.kind, a.added_list);
      const n = a.added_count ?? 1;

      /* Plegado (0077). Una importación de Steam mete cuarenta juegos de golpe:
         sin esto son cuarenta filas idénticas que además se comen el cupo del
         muro de esa persona y borran su actividad de series. Con uno solo la
         frase es exactamente la de antes, y por eso son dos ramas y no una
         frase con "1" dentro: "añadió 1 juego a su biblioteca" es lo que se
         escribe cuando a nadie le importa cómo suena. */
      if (n > 1) {
        const count = <b style={{ fontWeight: 700 }}>{n}</b>;
        const things = tr(a.kind === "game" ? "games" : a.kind === "movie" ? "movies" : "shows");
        const key = list === "library"
          ? (isMe ? "self: added {count} {things} to their library" : "added {count} {things} to their library")
          : list === "backlog"
          ? (isMe ? "self: added {count} {things} to their backlog" : "added {count} {things} to their backlog")
          : (isMe ? "self: added {count} {things} to their watchlist" : "added {count} {things} to their watchlist");
        return fill(tr(key), { count, things });
      }

      const key = list === "library"
        ? (isMe ? "self: added {name} to their library" : "added {name} to their library")
        : list === "backlog"
        ? (isMe ? "self: added {name} to their backlog" : "added {name} to their backlog")
        : (isMe ? "self: added {name} to their watchlist" : "added {name} to their watchlist");
      return fill(tr(key), { name });
    }
    case "watched":
      /* Una película se ve entera y de una vez, y un juego ni siquiera se ve:
         se termina. En los dos casos no hay un "S1·E1 de" que anteponerle, y el
         episodio sintético que los sostiene por debajo (0067, 0071) no es algo
         que nadie quiera leer. Cuál de las tres frases toca lo decide
         domain/mediumCopy, que es donde está probado. */
      if (shape === "whole-title-finished") {
        return fill(tr(isMe ? "self: finished {name}" : "finished {name}"), { name });
      }
      if (shape === "whole-title") {
        return fill(tr(isMe ? "self: watched {name}" : "watched {name}"), { name });
      }
      return fill(tr(isMe ? "self: watched {eps} of {name}" : "watched {eps} of {name}"), { eps, name });
    case "started":
      return fill(tr("started watching {name}"), { name });
    case "finished_season":
      // {season} is a plain number — filled first, so only {name} stays a node.
      return fill(tv("finished season {season} of {name}", { season: a.season_number ?? "" }), { name });
  }
}

/* How many rows the feed reveals before the first "Show more". The skeleton
   below draws exactly this many, so the placeholder and the feed are the same
   height — hardcoding 6 here against a page of 10 left the Invites card to be
   shoved down four rows once the feed landed. */
const FEED_PAGE = 10;

/* Header + rows at the exact geometry of a real .fr-activity row, so the feed
   swaps in place instead of unfolding the page under the reader. */
function ActivitySkeleton({ count = FEED_PAGE }: { count?: number }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <div>
          <h2 className="section-title">{tr("Activity")}</h2>
        </div>
      </div>
      <div className="card" style={{ padding: 6 }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="fr-activity">
            <div className="skeleton" style={{ width: 38, height: 38, borderRadius: 999, flex: "0 0 auto" }} />
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <div className="skeleton" style={{ height: 13, width: "72%" }} />
              <div className="skeleton" style={{ height: 11, width: "34%" }} />
            </div>
            <div className="skeleton" style={{ width: 34, height: 50, flex: "0 0 auto" }} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function FriendActivityCard() {
  /* Whether this section belongs on the page at all, and its contents, are two
     independent questions — so they are two independent requests. Taking
     `hasFriends` as a prop meant the feed could not even be requested until
     rpc_my_friendships had answered, putting the page's slowest RPC second in a
     chain. Reading friendships here instead hits the same cached query key (no
     extra traffic) while the feed loads alongside it. */
  const { data: friendships = [], isLoading: friendshipsLoading } = useFriendships();
  const hasFriends = friendships.some((f) => f.status === "accepted");
  // Per-episode events (0040) fill a feed much faster than the old digest
  // verbs did, so pull a deeper page.
  const { data: items = [], isLoading: activityLoading } = useFriendActivity(60);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const esNames = useEsNames();
  const { session } = useAuth();
  const me = session?.user.id ?? "";
  // The shared opener, which also warms the detail cache — the inline copy this
  // replaced opened every activity row cold.
  const openTitle = useOpenTitle();
  /* Una fila desplegada cada vez, y no un Set. Cada despliegue es una consulta,
     y dejar diez abiertas es pedir diez listas que nadie está mirando — la
     pregunta que responde esta interfaz ("¿cuáles eran esos 39?") se hace de
     una en una. */
  const [openKey, setOpenKey] = useState<string | null>(null);

  // A reaction notification links straight at its row, which may sit anywhere
  // in the page — so search all of it, not just the first screenful, and reveal
  // down to the row. Slicing to 30 here used to make a link to row 31+ a
  // silent no-op even though the row had been fetched.
  const flashKey = searchParams.get("event");
  const flashAt = flashKey ? items.findIndex((r) => r.event_key === flashKey) : -1;
  const { shown, more } = useShowMore(items, FEED_PAGE, flashAt < 0 ? 0 : flashAt + 1);

  const flashRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flashKey) return;
    if (flashAt >= 0) flashRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    // Dropped even when the row was not found — otherwise a stale ?event= rides
    // along in the URL for the rest of the session and flashes a row the reader
    // already dealt with if it ever floats back up.
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("event");
        return next;
      }, { replace: true });
    }, 2600);
    return () => clearTimeout(timer);
    // setSearchParams is a fresh identity on every URL change, so it stays out
    // of the deps: with it, opening a show mid-flash restarted the timer and
    // yanked the feed back into view behind the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey, flashAt]);

  const keys = useMemo(
    () => shown.map((r) => r.event_key).filter((k): k is string => Boolean(k)),
    [shown],
  );
  const { data: reactionRows = [] } = useEventReactions(keys);
  const reactions = useMemo(() => byEvent(reactionRows), [reactionRows]);

  // Nothing is drawn until friendships answers: it is the fast query, and a
  // skeleton shown to someone with no friends would only collapse again.
  if (friendshipsLoading || !hasFriends) return null;
  if (activityLoading) return <ActivitySkeleton />;
  if (items.length === 0) return null;

  const openFriend = (id: string) => navigate(`/friend/${id}`);
  /* Cada medio abre su ficha: ?title= la de series, ?movie= la de cine y ?game=
     la de juegos. Un id solo es único dentro de su medio —y el de un juego ni
     siquiera es de TMDB, es de IGDB (0071)—, así que mandarlos todos por el
     mismo parámetro abriría otra cosa con el mismo número. */
  const openEvent = (a: { kind: string; tmdb_id: number }) => {
    if (a.kind === "tv") return openTitle(a.tmdb_id);
    const param = a.kind === "movie" ? "movie" : "game";
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(param, String(a.tmdb_id));
      return next;
    });
  };


  return (
    <section className="flex flex-col gap-4">
      <div className="mq-sechead">
        <div>
          <h2 className="section-title">{tr("Activity")}</h2>
        </div>
      </div>
      <div className="card" style={{ padding: 6 }}>
        {shown.map((a) => {
          /* La carátula sale de una fuente distinta según el medio: un juego
             guarda un hash de IGDB donde series y cine guardan una ruta de
             TMDB (0071). thumbArt lo resuelve; tmdbImg a secas devolvía una URL
             que responde 404 en silencio. */
          const art = thumbArt(a.kind, a.poster_path);
          const titleName = locName(esNames, a.tmdb_id, a.title_name, a.kind);
          const isMe = a.friend_id === me;
          const flashed = Boolean(a.event_key) && a.event_key === flashKey;
          const count = a.ep_count ?? 1;
          /* Una fila plegada no lleva a ningún sitio: su título es solo el
             representante del grupo, y abrirlo al tocar la fila sería abrir uno
             cualquiera de los 39. Lo que hace es abrirse. */
          const grouped = a.verb === "added" && (a.added_count ?? 1) > 1 && Boolean(a.event_key);
          const isOpen = grouped && openKey === a.event_key;
          const rowKey = a.event_key ?? `${a.friend_id}|${a.tmdb_id}|${a.at}`;
          return (
            /* `fr-row` no es decorativo: la separación entre filas la daba
               `.fr-activity + .fr-activity`, y al envolver cada fila para poder
               desplegar el grupo debajo, esas dos filas dejaron de ser hermanas
               — el muro se quedó con las filas pegadas y nadie lo vio, porque 2px
               menos por fila no se nota mirando. Lo vio el e2e: 9 huecos por 2px
               son los 18 de diferencia entre el esqueleto y el contenido. */
            <div key={rowKey} className="fr-row flex flex-col">
            <div
              ref={flashed ? flashRef : undefined}
              className={`fr-activity${flashed ? " fr-flash" : ""}`}
              onClick={() =>
                grouped ? setOpenKey(isOpen ? null : a.event_key!) : openEvent(a)}
            >
              <span onClick={(e) => { e.stopPropagation(); openFriend(a.friend_id); }} style={{ flex: "0 0 auto" }}>
                <FriendAvatar f={{ id: a.friend_id, name: a.friend_name, avatarUrl: a.friend_avatar }} size={38} />
              </span>
              <div className="flex-1 min-w-0">
                {/* Two lines, not one: the name and verb eat the whole line on a
                    phone, and truncating left the show itself as "Ana Ruiz rated B…" */}
                <div style={{ fontSize: 13.5 }} className="line-clamp-2">
                  <b style={{ fontWeight: 700 }}>{isMe ? tr("You") : a.friend_name}</b> {phrase(a, titleName, isMe)}
                </div>
                {/* Reactions share the timestamp's line rather than opening one
                    of their own: an unreacted row is the overwhelming case, and
                    a lone ⊕ on its own line taxes all 30 of them. */}
                <div className="fr-meta">
                  <span className="mute" style={{ fontSize: 11.5 }}>
                    {relativeTime(a.at, new Date(), dateLocale())}
                    {showsEpisodeCount(a.kind, count) && <> · {count} {tr("episodes")}</>}
                  </span>
                  {a.event_key && (
                    <ReactionBar
                      eventKey={a.event_key}
                      rows={reactions.get(a.event_key) ?? EMPTY}
                      me={me}
                    />
                  )}
                </div>
              </div>
              {a.verb === "rated" && a.score != null && (
                <span className="badge badge-soft" style={{ fontWeight: 800 }}>{a.score}/10</span>
              )}
              {/* El glifo del medio, pegado a la carátula: es la columna que
                  identifica el título, y ahí se lee como una etiqueta suya en
                  vez de como un adorno suelto en la frase. En las dos, no solo
                  en el cine — ver el par es lo que enseña la convención. */}
              <MediumGlyph kind={a.kind} />
              {/* En una fila plegada la carátula es la del representante, así
                  que en su sitio va el gesto: el chevrón dice que hay algo
                  debajo, que es lo que la fila promete. */}
              {grouped ? (
                <button
                  type="button"
                  className="btn btn-icon btn-ghost"
                  aria-label={tr("See which ones")}
                  aria-expanded={isOpen}
                  style={{ flex: "0 0 auto" }}
                  onClick={(e) => { e.stopPropagation(); setOpenKey(isOpen ? null : a.event_key!); }}
                >
                  {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              ) : (
                <div className="mq-row-art" style={{ width: 34, height: 50, ...(art ? {} : { background: posterBg(titleName) }) }}>
                  {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                </div>
              )}
            </div>
            {isOpen && (
              <AddedBatch eventKey={a.event_key!} total={a.added_count ?? 0} onPick={openEvent} />
            )}
            </div>
          );
        })}
      </div>
      {more}
    </section>
  );
}
