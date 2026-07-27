import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  CalendarClock, Check, Clapperboard, Compass, FileArchive, Info,
  Play, Search, Star, StarHalf, TrendingUp, Users,
} from "lucide-react";
import { Logo } from "@/ui";
import { t } from "@/lib/i18n";

/* Public marketing page at "/" for signed-out visitors (see LandingGate).
   The product shots are recreated UI, not <img> screenshots: they inherit the
   visitor's theme tokens, stay crisp on any display, and never go stale.
   Poster/backdrop art is hotlinked from TMDB exactly like the app does. */

const img = (path: string, size = "w342") => `https://image.tmdb.org/t/p/${size}${path}`;

// Poster wall, all paths verified against image.tmdb.org.
const WALL = [
  "/lFf6LLrQjYldcZItzOkGmMMigP7.jpg", // Severance
  "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg", // Breaking Bad
  "/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg", // The Last of Us
  "/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg", // The Bear
  "/7HW47XbkNQ5fiwQFYGWdw9gs144.jpg", // Succession
  "/49WJfeN0moxb9IPfGn8AIqMGskD.jpg", // Stranger Things
  "/4lbclFySvugI51fwsyxBTOm4DqK.jpg", // The Wire
  "/hlLXt2tOPT6RRnjiUmoxyG1LTFi.jpg", // Chernobyl
  "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg", // Game of Thrones
  "/fC2HDm5t0kHl7mTm7jxMR31b7by.jpg", // Better Call Saul
  "/apbrbWs8M9lyOpJYU5WXrpFbk1Z.jpg", // Dark
  "/rTc7ZXdroqjkKivFPvCPX0Ru7uw.jpg", // The Sopranos
  "/aowr4xpLP5sRCL50TkuADomJ98T.jpg", // True Detective
  "/59SVNwLfoMnZPPB6ukW6dlPxAdI.jpg", // Andor
  "/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg", // Arcane
  "/7DJKHzAi83BmQrWLrYYOqcoKfhR.jpg", // The Office
  "/eU1i6eHXlzMOlEq0ku1Rzq7Y4wA.jpg", // The Mandalorian
  "/1M876KPjulVwppEpldhdc8V4o68.jpg", // The Crown
  "/vUUqzWa2LnHIVqkaKVlVGkVcZIW.jpg", // Peaky Blinders
  "/27vEYsRKa3eAniwmoccOoluEXQ1.jpg", // Fleabag
  "/7QMsOTMUswlwxJP0rTTZfmz2tX2.jpg", // House of the Dragon
  "/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg", // Shōgun
];

const TONIGHT_BACKDROP = "/uDgy6hyPd82kOHh6I95FLtLnj6p.jpg"; // The Last of Us

const UP_NEXT = [
  { poster: WALL[1], tag: "S3 · E7", progress: 62 },
  { poster: WALL[3], tag: "S3 · E2", progress: 18 },
  { poster: WALL[13], tag: "S1 · E9", progress: 71 },
  { poster: WALL[6], tag: "S2 · E5", progress: 44 },
  { poster: WALL[10], tag: "S2 · E3", progress: 30 },
  { poster: WALL[19], tag: "S2 · E1", progress: 8 },
];

function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll(".lp-reveal"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px" },
    );
    els.forEach((el) => io.observe(el));

    // Pause the poster-wall animation while it's off screen — it's the most
    // expensive thing on the page and invisible for most of the scroll.
    const stage = document.querySelector(".lp-stage");
    const stageIo = stage
      ? new IntersectionObserver(([e]) => stage.classList.toggle("offscreen", !e.isIntersecting))
      : null;
    if (stage && stageIo) stageIo.observe(stage);

    return () => {
      io.disconnect();
      stageIo?.disconnect();
    };
  }, []);
}

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`lp-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="lp-wrap lp-nav-inner">
        <Logo tagline={false} />
        <nav className="lp-nav-links" aria-label="Landing sections">
          <a className="lp-nav-link" href="#features">{t("Features")}</a>
          <a className="lp-nav-link" href="#friends">{t("Friends")}</a>
          <a className="lp-nav-link" href="#import">{t("Import")}</a>
        </nav>
        <div className="lp-nav-cta">
          <Link className="btn btn-ghost btn-sm" to="/login">{t("Log in")}</Link>
          <Link className="btn btn-accent btn-sm" to="/login?mode=signup">{t("Sign up")}</Link>
        </div>
      </div>
    </header>
  );
}

function AppFrame() {
  return (
    <div className="lp-frame lp-reveal" data-d="1" aria-hidden>
      <div className="lp-frame-bar">
        <span className="lp-traffic"><i /><i /><i /></span>
        <span className="lp-url">reel.app/tonight</span>
        <span style={{ width: 42 }} />
      </div>
      <div className="lp-app">
        <div className="lp-app-top">
          <Logo compact />
          <div className="lp-app-tabs">
            <span className="lp-app-tab on"><Clapperboard size={13} />{t("Tonight")}</span>
            <span className="lp-app-tab"><Compass size={13} />{t("Explore")}</span>
            <span className="lp-app-tab"><CalendarClock size={13} />{t("Calendar")}</span>
            <span className="lp-app-tab"><Users size={13} />{t("Friends")}</span>
          </div>
          <span className="lp-app-search"><Search size={13} />⌘K</span>
        </div>

        <div className="lp-tonight">
          <img src={img(TONIGHT_BACKDROP, "w780")} alt="" loading="lazy" />
          <div className="lp-tonight-body">
            <span className="lp-tonight-eyebrow">{t("TONIGHT FOR YOU")}</span>
            <span className="lp-tonight-title">The Last of Us</span>
            <span className="lp-tonight-meta">S2 · E1 — “Future Days” · HBO · 54 min</span>
            <span className="lp-tonight-actions">
              <span className="btn btn-accent btn-sm"><Play size={14} fill="currentColor" strokeWidth={0} />{t("Mark watched")}</span>
              <span className="btn btn-ghost btn-sm"><Info size={14} />{t("Details")}</span>
            </span>
          </div>
        </div>

        <div className="lp-upnext">
          <div className="lp-upnext-head">
            <span className="lp-upnext-title">{t("Up next")}</span>
            <span className="lp-upnext-more">{t("See all")}</span>
          </div>
          <div className="lp-upnext-rail">
            {UP_NEXT.map((u) => (
              <span className="lp-up" key={u.poster}>
                <img src={img(u.poster)} alt="" loading="lazy" />
                <span className="lp-up-tag">{u.tag}</span>
                <span className="lp-up-bar"><i style={{ width: `${u.progress}%` }} /></span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PosterWall() {
  const half = Math.ceil(WALL.length / 2);
  const rows = [WALL.slice(0, half), WALL.slice(half)];
  return (
    <div className="lp-band" aria-hidden>
      <div className="lp-marquee">
        {rows.map((row, i) => (
          <div className={`lp-track ${i === 1 ? "rev" : ""}`} key={i}>
            {[...row, ...row].map((p, j) => (
              <span className="lp-mini" key={`${p}-${j}`}>
                <img src={img(p)} alt="" loading={j < half ? "eager" : "lazy"} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RowItem({ poster, name, sub, progress }: { poster: string; name: string; sub: string; progress: number }) {
  return (
    <div className="lp-row-item">
      <img className="lp-row-thumb" src={img(poster, "w92")} alt="" loading="lazy" />
      <div className="lp-row-main">
        <div className="lp-row-name">{name}</div>
        <div className="lp-row-sub">{sub}</div>
        <div className="lp-row-bar"><i style={{ width: `${progress}%` }} /></div>
      </div>
      <span className="lp-row-check"><Check size={15} /></span>
    </div>
  );
}

function CalRow({ dow, num, name, sub, premiere }: { dow: string; num: number; name: string; sub: string; premiere?: boolean }) {
  return (
    <div className="lp-row-item">
      <span className="lp-cal-date">
        <div className="lp-cal-dow">{dow}</div>
        <div className="lp-cal-num">{num}</div>
      </span>
      <div className="lp-row-main">
        <div className="lp-row-name">{name}</div>
        <div className="lp-row-sub">{sub}</div>
      </div>
      {premiere && <span className="lp-badge-premiere">{t("Premiere")}</span>}
    </div>
  );
}

function Heatmap() {
  // Deterministic pseudo-random fill so the mock is stable between renders.
  const cells = Array.from({ length: 7 * 16 }, (_, i) => (i * 37 + 11) % 9);
  const cls = (v: number) => (v > 6 ? "h3" : v > 4 ? "h2" : v > 2 ? "h1" : "");
  return (
    <>
      <div className="lp-heat" aria-hidden>
        {cells.map((v, i) => <i key={i} className={cls(v)} />)}
      </div>
      <div className="lp-heat-caption">
        <span><b>312 h</b> · 2026</span>
        <span><b>38</b> {t("shows")}</span>
        <span><b>17</b> {t("day streak")}</span>
      </div>
    </>
  );
}

function Bento() {
  return (
    <section className="lp-section" id="features">
      <div className="lp-wrap">
        <div className="lp-section-head lp-reveal">
          <span className="lp-eyebrow">{t("The essentials")}</span>
          <h2 className="lp-h2">
            {t("Everything a tracker")}{" "}
            <em className="lp-serif">{t("should")}</em>{" "}
            {t("be.")}
          </h2>
        </div>

        <div className="lp-bento">
          <div className="card lp-cell lp-cell-4 lp-reveal">
            <div className="lp-cell-viz">
              <RowItem poster={WALL[1]} name="Breaking Bad" sub="S3 · E7 — “One Minute”" progress={62} />
              <RowItem poster={WALL[13]} name="Andor" sub="S1 · E9 — “Nobody's Listening!”" progress={71} />
              <RowItem poster={WALL[3]} name="The Bear" sub="S3 · E2 — “Next”" progress={18} />
            </div>
            <div>
              <div className="lp-cell-title"><Play size={17} />{t("Pick up where you left off")}</div>
              <p className="lp-cell-copy">{t("Reel tracks every episode you watch and lines up the next one — per show, per season, automatically.")}</p>
            </div>
          </div>

          <div className="card lp-cell lp-cell-2 lp-reveal" data-d="1">
            <div className="lp-cell-viz">
              <CalRow dow={t("THU")} num={23} name="Severance" sub="S3 · E1 · Apple TV+" premiere />
              <CalRow dow={t("FRI")} num={24} name="The Bear" sub="S4 · E3 · Hulu" />
              <CalRow dow={t("SUN")} num={26} name="House of the Dragon" sub="S3 · E6 · HBO" />
            </div>
            <div>
              <div className="lp-cell-title"><CalendarClock size={17} />{t("Never miss a premiere")}</div>
              <p className="lp-cell-copy">{t("A calendar of returns and new episodes for the shows you follow, in your timezone.")}</p>
            </div>
          </div>

          <div className="card lp-cell lp-cell-2 lp-reveal" id="friends">
            <div className="lp-cell-viz">
              <div className="lp-faces" aria-hidden>
                <span className="lp-face" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}>C</span>
                <span className="lp-face" style={{ background: "linear-gradient(135deg, #8b7cff, #b07cff)", color: "#150e33" }}>A</span>
              </div>
              <div className="lp-match">87% <small>{t("taste match")}</small></div>
              <div className="lp-vs"><b>Chernobyl</b><span className="lp-stars">★★★★★ · ★★★★½</span></div>
              <div className="lp-vs"><b>The Wire</b><span className="lp-stars">★★★★½ · ★★★★★</span></div>
            </div>
            <div>
              <div className="lp-cell-title"><Users size={17} />{t("Watch with your people")}</div>
              <p className="lp-cell-copy">{t("Compare ratings with friends, see what the group is into, and steal your next show.")}</p>
            </div>
          </div>

          <div className="card lp-cell lp-cell-2 lp-reveal" data-d="1">
            <div className="lp-cell-viz">
              <Heatmap />
            </div>
            <div>
              <div className="lp-cell-title"><TrendingUp size={17} />{t("Your year in television")}</div>
              <p className="lp-cell-copy">{t("Heatmap, streaks, hours and top networks — stats that make your watching a story.")}</p>
            </div>
          </div>

          <div className="card lp-cell lp-cell-2 lp-reveal" data-d="2">
            <div className="lp-cell-viz" style={{ gap: 14 }}>
              <div className="lp-bigstars" aria-hidden>
                <Star size={30} fill="currentColor" strokeWidth={0} />
                <Star size={30} fill="currentColor" strokeWidth={0} />
                <Star size={30} fill="currentColor" strokeWidth={0} />
                <Star size={30} fill="currentColor" strokeWidth={0} />
                <StarHalf size={30} fill="currentColor" strokeWidth={0} />
              </div>
              <div className="lp-rate-caption">{t("“The Wire” · S4 — rated 4.5")}</div>
            </div>
            <div>
              <div className="lp-cell-title"><Star size={17} />{t("Build your canon")}</div>
              <p className="lp-cell-copy">{t("Half-star ratings on episodes and seasons. Your history becomes the best recommendation engine.")}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ImportBand() {
  return (
    <section className="lp-section" id="import">
      <div className="lp-wrap">
        <div className="card lp-import lp-reveal">
          <div>
            <span className="lp-eyebrow">{t("TV Time refugee?")}</span>
            <h2 className="lp-h2">
              {t("Bring your whole")}{" "}
              <em className="lp-serif">{t("history")}</em>{" "}
              {t("with you.")}
            </h2>
            <p className="lp-section-sub">
              {t("Upload your TV Time export and Reel rebuilds your library — shows, seen episodes and every rating. Years of watching, nothing lost.")}
            </p>
          </div>
          <div aria-hidden>
            <div className="lp-zip">
              <span className="lp-zip-icon"><FileArchive size={24} /></span>
              tv-time-export.zip
              <small>8.4 MB</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="lp-section">
      <div className="lp-wrap">
        <div className="card lp-final lp-reveal">
          <h2 className="lp-h2">
            {t("Your watchlist is")}{" "}
            <em className="lp-serif">{t("waiting")}.</em>
          </h2>
          <p className="lp-section-sub">
            {t("Reel is in invite-only beta. Got a code from a friend? You're two minutes away from tonight's episode.")}
          </p>
          <div className="lp-ctas">
            <Link className="btn btn-accent lp-btn-lg" to="/login?mode=signup">{t("Create your account")}</Link>
            <Link className="btn btn-outline lp-btn-lg" to="/login">{t("Log in")}</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  useReveal();

  return (
    <div className="lp">
      <Nav />

      <main>
        <section className="lp-hero">
          <div className="lp-wrap">
            <h1 className="lp-h1 lp-reveal in">
              {t("Always know what to watch")}{" "}
              <em className="lp-serif">{t("tonight")}.</em>
            </h1>
            <p className="lp-sub lp-reveal in" data-d="1">
              {t("Reel keeps every show you follow in one place — what's next, when it returns, and what your friends thought of it. Fast, beautiful, and yours.")}
            </p>
            <div className="lp-ctas lp-reveal in" data-d="2">
              <Link className="btn btn-accent lp-btn-lg" to="/login?mode=signup">{t("Create your account")}</Link>
              <Link className="btn btn-outline lp-btn-lg" to="/login">{t("I already have an account")}</Link>
            </div>
          </div>

          <div className="lp-stage">
            <PosterWall />
            <AppFrame />
          </div>
        </section>

        <Bento />
        <ImportBand />
        <FinalCta />
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-inner">
          <Logo tagline={false} />
          <nav className="lp-foot-links">
            <Link to="/privacy">{t("Privacy")}</Link>
            <Link to="/terms">{t("Terms")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
