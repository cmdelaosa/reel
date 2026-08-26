import { useNavigate } from "react-router";
import { ChevronRight, Flame, Heart, ThumbsUp } from "lucide-react";
import { tmdbImg } from "@/lib/tmdb";
import { useTaste, type TasteFriend, type TasteTitle } from "@/lib/taste";
import { useOpenSheet } from "@/lib/useOpenTitle";
import { tasteCopy, type Medium } from "@/domain/tasteScope";
import { locName, t as tr, tv, useEsNames } from "@/lib/i18n";
import { FriendAvatar, FriendStack } from "@/ui/FriendAvatar";
import { useShowMore } from "@/ui/ShowMore";
import { posterBg } from "@/ui/posterBg";

/* Taste match (route /friends/taste) — the aggregate rating comparison against
   ALL friends at once: an affinity leaderboard (confidence-adjusted, see
   lib/taste.ts), the shows where you clash with the group, and the shows
   you're in sync on. Rows link to the 1-on-1 friend profile / detail sheet.

   Es la MISMA página en los tres modos, como Amigos: lo que cambia es de qué
   medio son las notas que compara —el del conmutador— y, con él, las palabras.
   Un juego no se "ve" ni se puntúa "en femenino" (domain/tasteScope). */

function AffinityRing({ pct, size = 50 }: { pct: number; size?: number }) {
  const ring = `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--surface-2) 0)`;
  const mask = "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))";
  return (
    <span
      style={{ position: "relative", width: size, height: size, flex: "0 0 auto", display: "grid", placeItems: "center" }}
      role="img"
      aria-label={tv("{pct}% taste match", { pct })}
    >
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: ring, WebkitMask: mask, mask }} />
      <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
    </span>
  );
}

function TitleArt({ poster, name }: { poster: string | null; name: string }) {
  const art = tmdbImg(poster, "w92");
  return (
    <div className="mq-row-art" style={art ? undefined : { background: posterBg(name) }}>
      {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      <div className="poster-sheen" />
    </div>
  );
}

function FriendRow({ rank, f, medium, onOpen }: { rank: number; f: TasteFriend; medium: Medium; onOpen: () => void }) {
  const a = f.affinity!;
  const copy = tasteCopy(medium);
  return (
    <div className="card mq-row" onClick={onOpen}>
      <span className="mute" style={{ width: 22, fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", flex: "0 0 auto", textAlign: "right" }}>
        {rank}
      </span>
      <FriendAvatar f={{ id: f.id, name: f.name, avatarUrl: f.avatarUrl }} size={40} />
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{f.name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {a.common} {tr(copy.ratedInCommon)}
          {f.clashTitle ? <> · {tr("clash on")} <b style={{ fontWeight: 650 }}>{f.clashTitle}</b></> : a.avgDiff <= 1 ? ` · ${tr("you basically agree")}` : ""}
        </div>
      </div>
      <AffinityRing pct={a.pct} />
    </div>
  );
}

function TitleRow({ t, onOpen }: { t: TasteTitle; onOpen: () => void }) {
  const copy = tasteCopy(t.kind);
  const esNames = useEsNames();
  const name = locName(esNames, t.tmdb_id, t.name);
  return (
    <div className="card mq-row" onClick={onOpen}>
      <TitleArt poster={t.poster_path} name={name} />
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{name}</div>
        <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
          <FriendStack fans={t.raters.map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatarUrl }))} size={20} />
          <span className="mute" style={{ fontSize: 12 }}>
            {t.raters.length === 1
              ? `${t.raters[0].name} ${tr(copy.ratedIt)}`
              : `${t.raters.length} ${tr(copy.friendsRatedIt)}`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto" }}>
        <span className="badge badge-soft" title={tr("Your score")} style={{ fontWeight: 800 }}>{tr("You")} {t.mine}</span>
        <span className="badge badge-soft" title={tr("Friends' average")} style={{ fontWeight: 800 }}>
          {tr("Them")} {Number.isInteger(t.friendAvg) ? t.friendAvg : t.friendAvg.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

export default function TastePage() {
  const taste = useTaste();
  const navigate = useNavigate();
  const open = useOpenSheet();
  const copy = tasteCopy(taste.medium);

  const ranked = useShowMore(taste.ranked, 12);
  const clash = useShowMore(taste.clash, 12);
  const agree = useShowMore(taste.agree, 12);

  return (
    <div className="screen mq-page">
      <h1 className="sr-only">{tr("Taste match")}</h1>

      {taste.loading ? (
        <div className="dim">{tr("Loading…")}</div>
      ) : !taste.hasFriends ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>{tr("No friends yet — add someone on the Friends tab to compare taste.")}</p>
        </div>
      ) : taste.myRatedCount === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>{tr(copy.rateFirst)}</p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2.5">
            <div className="eyebrow flex items-center gap-1.5"><Heart size={13} />{tr("Affinity ranking")}</div>
            {taste.ranked.length === 0 ? (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>{tr(copy.noShared)}</p>
              </div>
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {ranked.shown.map((f, i) => (
                  <FriendRow key={f.id} rank={i + 1} f={f} medium={taste.medium} onOpen={() => navigate(`/friend/${f.id}`)} />
                ))}
              </div>
            )}
            {ranked.more}
            {taste.unranked.length > 0 && (
              <p className="mute" style={{ fontSize: 12.5, margin: 0 }}>
                {tv("No shared ratings yet with {friends}.", { friends: taste.unranked.map((f) => f.name).join(", ") })}
              </p>
            )}
            {taste.ranked.length > 0 && (
              <p className="mute" style={{ fontSize: 11.5, margin: 0 }}>
                {tr(copy.basedOn)}
              </p>
            )}
          </section>

          {taste.clash.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <div className="eyebrow flex items-center gap-1.5"><Flame size={13} />{tr("Where you clash")}</div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {clash.shown.map((t) => <TitleRow key={t.tmdb_id} t={t} onOpen={() => open(t.tmdb_id, t.kind)} />)}
              </div>
              {clash.more}
            </section>
          )}

          {taste.agree.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <div className="eyebrow flex items-center gap-1.5"><ThumbsUp size={13} />{tr("Where you agree")}</div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {agree.shown.map((t) => <TitleRow key={t.tmdb_id} t={t} onOpen={() => open(t.tmdb_id, t.kind)} />)}
              </div>
              {agree.more}
            </section>
          )}

          {taste.ranked.length > 0 && (
            <p className="mute" style={{ fontSize: 12.5, margin: 0 }}>
              {tr("Tap a friend for the full 1-on-1 comparison")} <ChevronRight size={11} style={{ verticalAlign: "-1px" }} />
            </p>
          )}
        </>
      )}
    </div>
  );
}
