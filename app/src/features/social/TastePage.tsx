import { useNavigate } from "react-router";
import { ChevronRight, Flame, Heart, ThumbsUp } from "lucide-react";
import { tmdbImg } from "@/lib/tmdb";
import { useTaste, type TasteFriend, type TasteTitle } from "@/lib/taste";
import { useOpenTitle } from "@/lib/useOpenTitle";
import { FriendAvatar, FriendStack } from "@/ui/FriendAvatar";
import { posterBg } from "@/ui/posterBg";

/* Taste match (route /friends/taste) — the aggregate rating comparison against
   ALL friends at once: an affinity leaderboard (confidence-adjusted, see
   lib/taste.ts), the shows where you clash with the group, and the shows
   you're in sync on. Rows link to the 1-on-1 friend profile / detail sheet. */

function AffinityRing({ pct, size = 50 }: { pct: number; size?: number }) {
  const ring = `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--surface-2) 0)`;
  const mask = "radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px))";
  return (
    <span
      style={{ position: "relative", width: size, height: size, flex: "0 0 auto", display: "grid", placeItems: "center" }}
      role="img"
      aria-label={`${pct}% taste match`}
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

function FriendRow({ rank, f, onOpen }: { rank: number; f: TasteFriend; onOpen: () => void }) {
  const a = f.affinity!;
  return (
    <div className="card mq-row" onClick={onOpen}>
      <span className="mute" style={{ width: 22, fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", flex: "0 0 auto", textAlign: "right" }}>
        {rank}
      </span>
      <FriendAvatar f={{ id: f.id, name: f.name, avatarUrl: f.avatarUrl }} size={40} />
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{f.name}</div>
        <div className="dim truncate" style={{ fontSize: 12.5 }}>
          {a.common} rated in common
          {f.clashTitle ? <> · clash on <b style={{ fontWeight: 650 }}>{f.clashTitle}</b></> : a.avgDiff <= 1 ? " · you basically agree" : ""}
        </div>
      </div>
      <AffinityRing pct={a.pct} />
    </div>
  );
}

function TitleRow({ t, onOpen }: { t: TasteTitle; onOpen: () => void }) {
  return (
    <div className="card mq-row" onClick={onOpen}>
      <TitleArt poster={t.poster_path} name={t.name} />
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{t.name}</div>
        <div className="flex items-center gap-2" style={{ marginTop: 3 }}>
          <FriendStack fans={t.raters.map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatarUrl }))} size={20} />
          <span className="mute" style={{ fontSize: 12 }}>
            {t.raters.length === 1 ? `${t.raters[0].name} rated it` : `${t.raters.length} friends rated it`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto" }}>
        <span className="badge badge-soft" title="Your score" style={{ fontWeight: 800 }}>You {t.mine}</span>
        <span className="badge badge-soft" title="Friends' average" style={{ fontWeight: 800 }}>
          Them {Number.isInteger(t.friendAvg) ? t.friendAvg : t.friendAvg.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

export default function TastePage() {
  const taste = useTaste();
  const navigate = useNavigate();
  const open = useOpenTitle();

  return (
    <div className="screen mq-page">
      <header className="mq-header">
        <h1 className="mq-h1">Taste match</h1>
        <p className="dim mq-sub">How your ratings line up with your friends' — who scores like you, and which shows split you.</p>
      </header>

      {taste.loading ? (
        <div className="dim">Loading…</div>
      ) : !taste.hasFriends ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>No friends yet — add someone on the Friends tab to compare taste.</p>
        </div>
      ) : taste.myRatedCount === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="dim" style={{ margin: 0, fontSize: 14 }}>Rate a few shows first — your taste match is built from the shows you and your friends both scored.</p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2.5">
            <div className="eyebrow flex items-center gap-1.5"><Heart size={13} />Affinity ranking</div>
            {taste.ranked.length === 0 ? (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>None of your friends rated a show you rated — yet. Nudge them to score something.</p>
              </div>
            ) : (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {taste.ranked.map((f, i) => (
                  <FriendRow key={f.id} rank={i + 1} f={f} onOpen={() => navigate(`/friend/${f.id}`)} />
                ))}
              </div>
            )}
            {taste.unranked.length > 0 && (
              <p className="mute" style={{ fontSize: 12.5, margin: 0 }}>
                No shared ratings yet with {taste.unranked.map((f) => f.name).join(", ")}.
              </p>
            )}
            {taste.ranked.length > 0 && (
              <p className="mute" style={{ fontSize: 11.5, margin: 0 }}>
                Based on the shows you both rated — the more you share, the more the score trusts it.
              </p>
            )}
          </section>

          {taste.clash.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <div className="eyebrow flex items-center gap-1.5"><Flame size={13} />Where you clash</div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {taste.clash.map((t) => <TitleRow key={t.tmdb_id} t={t} onOpen={() => open(t.tmdb_id)} />)}
              </div>
            </section>
          )}

          {taste.agree.length > 0 && (
            <section className="flex flex-col gap-2.5">
              <div className="eyebrow flex items-center gap-1.5"><ThumbsUp size={13} />Where you agree</div>
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {taste.agree.map((t) => <TitleRow key={t.tmdb_id} t={t} onOpen={() => open(t.tmdb_id)} />)}
              </div>
            </section>
          )}

          {taste.ranked.length > 0 && (
            <p className="mute" style={{ fontSize: 12.5, margin: 0 }}>
              Tap a friend for the full 1-on-1 comparison <ChevronRight size={11} style={{ verticalAlign: "-1px" }} />
            </p>
          )}
        </>
      )}
    </div>
  );
}
