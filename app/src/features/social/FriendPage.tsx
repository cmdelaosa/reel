import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import {
  Activity, ArrowDownWideNarrow, ArrowUpNarrowWide, Check, Clock, Eye, Heart,
  LayoutGrid, Plus, Scale, Star, User,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { hueOf, posterBg } from "@/ui/posterBg";
import { gridArt, thumbArt } from "@/lib/artwork";
import { NetworkLogo, TabMenu } from "@/ui";
import { useShowMore } from "@/ui/ShowMore";
import { FriendAvatar } from "@/ui/FriendAvatar";
import { MediumGlyph } from "@/ui/MediumGlyph";
import { relativeTime } from "@/domain/time";
import {
  useFriendLastWatched, useFriendProfile, useFriendProgress, useFriendWatchHistory,
  type FriendFollow, type FriendProgress, type FriendRating,
} from "@/lib/friendProfile";
import { useLibraryRows, useFollow } from "@/lib/library";
import { buildWall } from "@/domain/activityWall";
import { lastWatched, mediaFirst, playingNow } from "@/domain/friendNow";
import { formatPlaytime, hoursProgress } from "@/domain/gameStatus";
import { mediumPlural } from "@/domain/mediumCopy";
import { tasteBlocks } from "@/domain/tasteProfile";
import { MEDIA, ofMedium, tasteCopy, type Medium } from "@/domain/tasteScope";
import { useMyRatings } from "@/lib/ratings";
import { tasteAffinity, type Affinity } from "@/lib/taste";
import { timeSpentLabel } from "@/lib/stats";
import { useMedium } from "@/lib/medium";
import { useOpenSheet } from "@/lib/useOpenTitle";
import { ActivityWall } from "@/features/social/ActivityWall";
import { TasteBlocks } from "@/features/social/TasteBlocks";
import { WatchHeatmap } from "@/features/you/WatchHeatmap";
import { dateLocale, locName, t as tr, tGenre, tv, useEsNames } from "@/lib/i18n";
import type { TitleRow } from "@/lib/schemas";

/* Friend profile page (route /friend/:id). rpc_friend_snapshot supplies the
   profile, episode counts and "watching now" (recent-first, ≤2 months since
   their last watch); useFriendProfile adds their full follow list + ratings,
   useFriendProgress their per-show watched/aired counts and
   useFriendWatchHistory their latest episode watches. A slim sticky header
   fuses identity + section tabs (Overview / Library / Activity / Compare) and
   stays pinned under the top bar. Opening a title stacks the detail sheet on
   top via the shell's global ?title= / ?movie= / ?game= param.

   Esta página NO FILTRA por el conmutador de medio, y ese cambio es el que
   arregla "el perfil solo enseña series": lo hacía, así que entrar en la ficha
   de un amigo desde Videojuegos te contaba sus juegos y ni una de sus series, y
   desde Series al revés. Ahora enseña a la persona entera, y lo que se reparte
   por medio son las cosas que NO se pueden mezclar: hay tres afinidades, tres
   bloques de gustos y tres secciones de biblioteca, porque un `tmdb_id` solo es
   único dentro de su medio (domain/tasteScope).

   El modo sí decide una cosa: el ORDEN de los tres bloques de "ahora mismo",
   con el suyo delante (domain/friendNow). Y son tres desde esta rama, porque
   "Viendo ahora" era de series y solo de series: `rpc_friend_snapshot` lo saca
   de tener un episodio emitido sin ver, y eso ni una película ni un juego lo
   tienen. Entrar aquí desde Videojuegos y encontrarse solo sus series era
   enseñar media persona; a qué juega sale de lo que él dijo a mano (0073) y de
   cine, de lo último que vio. */

/** La identidad de un título en una lista de los tres medios. El número solo no
 *  vale: la serie 1399 y la película 1399 son cosas distintas (0067). */
const keyOf = (kind: Medium, tmdbId: number) => `${kind}:${tmdbId}`;

const snapshotSchema = z.object({
  profile: z.object({
    id: z.string().uuid(),
    handle: z.string(),
    display_name: z.string(),
    avatar_url: z.string().nullable(),
    bio: z.string().nullable(),
    country: z.string().nullable(),
  }),
  stats: z.object({ shows: z.number(), episodes: z.number(), rated: z.number() }),
  watching: z.array(z.object({
    tmdb_id: z.number(),
    name: z.string(),
    poster_path: z.string().nullable(),
    network: z.string().nullable(),
    season_number: z.number(),
    episode_number: z.number(),
    // Post-0038 fields; optional so the page keeps parsing against the old RPC.
    watched: z.number().optional(),
    aired: z.number().optional(),
    last_watched_at: z.string().nullable().optional(),
  })),
});
type Snapshot = z.infer<typeof snapshotSchema>;

type SectionKey = "overview" | "library" | "activity" | "compare";
type ShowFilter = "all" | "both" | "not";
type ShowSort = "their" | "critic" | "air";
type SortDir = "desc" | "asc";

/** Lo que sale de cruzar SU medio con el tuyo. Uno por medio con algo dentro. */
interface MediumSlice {
  medium: Medium;
  follows: FriendFollow[];
  ratings: FriendRating[];
  /** null si no habéis puntuado nada en común de ese medio. */
  affinity: Affinity | null;
  /** Lo que los dos habéis puntuado, lo que más difiere primero. */
  coRated: (FriendRating & { mine: number })[];
  /** Lo que los dos seguís. */
  shared: FriendFollow[];
  /** Géneros suyos que también son tuyos. */
  sharedGenres: string[];
}

function MiniArt({ kind, poster, name, className = "mq-row-art", style }: { kind: Medium; poster: string | null; name: string; className?: string; style?: React.CSSProperties }) {
  /* thumbArt y no tmdbImg: un juego guarda un hash de IGDB donde series y cine
     guardan una ruta de TMDB (0071), y pasárselo a tmdbImg da una URL que
     responde 404 sin quejarse en consola. */
  const art = thumbArt(kind, poster);
  return (
    <div className={className} style={{ ...(art ? {} : { background: posterBg(name) }), ...style }}>
      {art && <img src={art} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      <div className="poster-sheen" />
    </div>
  );
}

function toTitleRow(f: FriendFollow): TitleRow {
  return {
    id: f.id, tmdb_id: f.tmdb_id, kind: f.kind, name: f.name, overview: null,
    poster_path: f.poster_path, backdrop_path: null, first_air_date: f.first_air_date,
    status: f.status, genres: f.genres, network: f.network, episode_run_time: f.episode_run_time,
    vote_average: f.vote_average, popularity: null,
  };
}

function agreementLabel(theirs: number, mine: number): string {
  const d = Math.abs(theirs - mine);
  if (d === 0) return tr("Same score");
  if (d <= 1) return tr("You basically agree");
  if (d >= 4) return tr("You strongly disagree");
  return tr("Slightly different takes");
}

/** TV-Time-style progress: thin bar + "watched / aired" underneath a poster. */
function ProgressStrip({ watched, aired }: { watched: number; aired: number }) {
  const pct = aired > 0 ? Math.min(100, Math.round((watched / aired) * 100)) : 0;
  return (
    <div className="fr-progress">
      <div className="fr-matchbar" style={{ height: 5 }}><i style={{ width: `${pct}%` }} /></div>
      <span className="mute" style={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>{watched}/{aired}</span>
    </div>
  );
}

/* Poster tile in the browsable library grid: their score (if rated), a
   common-ring when you follow it too, a one-tap Add, and their episode
   progress underneath. */
function FollowTile({ f, name, theirScore, progress, added, onOpen, onAdd }: {
  f: FriendFollow; name: string; theirScore?: number; progress?: FriendProgress; added: boolean; onOpen: () => void; onAdd: () => void;
}) {
  const art = gridArt(f.kind, f.poster_path);
  return (
    <div className="fr-show">
      <div className={`fr-mini ${added ? "fr-common" : ""}`} style={{ background: posterBg(name) }} title={name} onClick={onOpen}>
        {art && <img src={art} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
        {theirScore != null && (
          <span className="badge badge-glass absolute" style={{ top: 6, left: 6, zIndex: 2, fontSize: 11, padding: "2px 6px" }}>
            <Star size={10} fill="currentColor" strokeWidth={0} style={{ color: "var(--accent)" }} /> {theirScore}
          </span>
        )}
        <button
          className="btn btn-icon badge-glass absolute"
          style={{ top: 6, right: 6, zIndex: 2, color: "#fff", width: 26, height: 26 }}
          title={added ? tr("In your library") : tr("Add to your library")}
          aria-label={tv(added ? "{name} is in your library" : "Add {name} to your library", { name })}
          onClick={(e) => { e.stopPropagation(); if (!added) onAdd(); }}
        >
          {added ? <Check size={14} /> : <Plus size={14} />}
        </button>
        <span className="fr-mini-name">{name}</span>
      </div>
      {progress && progress.aired > 0 && <ProgressStrip watched={progress.watched} aired={progress.aired} />}
    </div>
  );
}

/** Una sección de la biblioteca de un amigo: sus series, o su cine, o sus
 *  juegos. Es un componente y no un bucle porque cada una revela las suyas por
 *  su cuenta (`useShowMore` es un hook, y un hook no se llama en un bucle). */
function FollowSection({ slice, rows, children }: { slice: MediumSlice; rows: FriendFollow[]; children: (f: FriendFollow) => React.ReactNode }) {
  // 12 caben en dos filas completas de la rejilla más ancha.
  const { shown, more } = useShowMore(rows, 12);
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2.5" data-tint={slice.medium}>
      <div className="eyebrow flex items-center gap-1.5">
        <MediumGlyph kind={slice.medium} tone="accent" />{tr(mediumPlural(slice.medium))} · {rows.length}
      </div>
      <div className="fr-grid">{shown.map(children)}</div>
      {more}
    </section>
  );
}

export default function FriendPage() {
  const { id = "" } = useParams();
  const friendId = id;

  const { data: snap, isPending } = useQuery({
    queryKey: ["friendSnapshot", friendId],
    enabled: Boolean(friendId),
    queryFn: async (): Promise<Snapshot | null> => {
      const { data, error } = await supabase.rpc("rpc_friend_snapshot", { p_friend: friendId });
      if (error) throw error;
      return data ? snapshotSchema.parse(data) : null;
    },
  });

  const { data: fp } = useFriendProfile(friendId);
  const { data: progressMap } = useFriendProgress(friendId);
  const { data: watchHistory = [] } = useFriendWatchHistory(friendId);
  /* Las últimas películas se piden aparte y no se sacan del muro: ver
     `useFriendLastWatched`. Doce para que al quitar los revisionados sigan
     quedando seis. */
  const { data: movieHistory = [] } = useFriendLastWatched(friendId, "movie", 12);
  const { data: library = [] } = useLibraryRows();
  const { data: myRatings = [] } = useMyRatings();
  const follow = useFollow();

  /* Lo ÚNICO que esta página mira del conmutador: en qué orden se enseñan los
     bloques de "ahora mismo". Ver la cabecera del fichero. */
  const medium = useMedium();

  const [section, setSection] = useState<SectionKey>("overview");
  const esNames = useEsNames();
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");
  const [showSort, setShowSort] = useState<ShowSort>("their");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  /* Cada fila se abre con el parámetro de SU medio: `?title=` sobre una
     película llevaba a la ficha de la serie con ese número, o a ninguna
     (domain/tasteScope, `sheetParam`). */
  const openSheet = useOpenSheet();

  /* Todos los cruces van por (medio, número) y no por el número solo. Sin el
     medio, su película 1399 salía marcada como "ya la sigues" porque sigues la
     serie 1399, y su nota de esa película se comparaba con la de tu serie. */
  const myFollowKeys = useMemo(() => new Set(library.map((r) => keyOf(r.kind, r.tmdb_id))), [library]);
  const theirScoreByKey = useMemo(
    () => new Map((fp?.ratings ?? []).map((r) => [keyOf(r.kind, r.tmdb_id), r.score])),
    [fp],
  );

  /* El progreso de un título suyo, o nada si no se puede saber de quién es.
     `rpc_friend_progress` es de 0038 —de cuando solo había series— y llavea sus
     filas por el `tmdb_id` a secas, así que dos títulos suyos de medios
     distintos con el mismo número comparten entrada y gana la última fila. Con
     la ficha abierta a los tres medios eso deja de ser teórico: una biblioteca
     importada trae cientos de ids de IGDB, que viven en otro espacio de
     numeración entero (0071). El síntoma sería una barra "1/1" —el episodio
     sintético de un juego— bajo una serie de setenta capítulos.

     Los números ambiguos se descartan: sin barra se lee como "no se sabe", y
     con la barra de otro se lee como un dato. */
  const progressOf = useMemo(() => {
    const mediaById = new Map<number, Set<Medium>>();
    for (const f of fp?.follows ?? []) {
      const set = mediaById.get(f.tmdb_id) ?? new Set<Medium>();
      set.add(f.kind);
      mediaById.set(f.tmdb_id, set);
    }
    return (tmdbId: number): FriendProgress | undefined =>
      (mediaById.get(tmdbId)?.size ?? 0) > 1 ? undefined : progressMap?.get(tmdbId);
  }, [fp, progressMap]);

  const slices = useMemo((): MediumSlice[] => {
    if (!fp) return [];
    return MEDIA.flatMap((medium): MediumSlice[] => {
      const follows = ofMedium(fp.follows, medium);
      const ratings = ofMedium(fp.ratings, medium);
      if (follows.length === 0 && ratings.length === 0) return [];

      /* Los tres mapas se construyen DENTRO del medio, así que la clave vuelve
         a ser el `tmdb_id` a secas sin que eso sea una trampa: es lo que
         domain/tasteScope pide, filtrar en el borde y comparar después. */
      const mine = new Map(
        ofMedium(myRatings.map((r) => ({ kind: r.titles.kind, tmdb_id: r.titles.tmdb_id, score: r.score })), medium)
          .map((r) => [r.tmdb_id, r.score]),
      );
      const theirs = new Map(ratings.map((r) => [r.tmdb_id, r.score]));
      const myGenres = new Set(ofMedium(library, medium).flatMap((r) => r.genres));
      const theirGenres = new Set(follows.flatMap((f) => f.genres));

      return [{
        medium,
        follows,
        ratings,
        // La misma afinidad ajustada por confianza que la tabla de /friends/taste,
        // para que una persona enseñe el mismo número en toda la app.
        affinity: tasteAffinity(mine, theirs),
        coRated: ratings
          .filter((r) => mine.has(r.tmdb_id))
          .map((r) => ({ ...r, mine: mine.get(r.tmdb_id)! }))
          .sort((a, b) => Math.abs(b.score - b.mine) - Math.abs(a.score - a.mine)),
        shared: follows.filter((f) => myFollowKeys.has(keyOf(medium, f.tmdb_id))),
        sharedGenres: [...theirGenres].filter((g) => myGenres.has(g)).slice(0, 6),
      }];
    });
  }, [fp, library, myRatings, myFollowKeys]);

  /* Su perfil de gustos, un bloque por medio: géneros y, debajo, sus cadenas /
     sus décadas / sus plataformas (domain/tasteProfile). */
  const taste = useMemo(() => tasteBlocks(fp?.follows ?? []), [fp]);

  /* Su muro, con los tres medios y plegado: sin plegar, el día que importó su
     backlog son cuatrocientas filas idénticas que entierran todo lo demás. */
  const wall = useMemo(
    () => buildWall({
      watched: watchHistory.map((w) => ({
        at: w.watched_at, kind: w.kind, tmdb_id: w.tmdb_id, name: w.name,
        poster_path: w.poster_path, season_number: w.season_number, episode_number: w.episode_number,
      })),
      rated: (fp?.ratings ?? []).map((r) => ({
        at: r.created_at, kind: r.kind, tmdb_id: r.tmdb_id, name: r.name,
        poster_path: r.poster_path, score: r.score,
      })),
      added: (fp?.follows ?? []).map((f) => ({
        at: f.added_at, kind: f.kind, tmdb_id: f.tmdb_id, name: f.name,
        poster_path: f.poster_path, owned: f.owned,
      })),
    }),
    [fp, watchHistory],
  );

  /* Su media de nota, de todo lo que puntúa. Es de la persona, no de un medio:
     no se compara con nada de otro sitio, solo dice si es de puntuar alto. */
  const avgRating = useMemo(() => {
    const all = fp?.ratings ?? [];
    return all.length ? all.reduce((a, b) => a + b.score, 0) / all.length : null;
  }, [fp]);

  /* El runtime medio sale SOLO de sus series: es lo que multiplica a los
     episodios para estimar el tiempo, y una película o un juego en esa media la
     convierten en otra cosa. */
  const avgRuntime = useMemo(() => {
    const runtimes = ofMedium(fp?.follows ?? [], "tv").map((f) => f.episode_run_time).filter((n): n is number => n != null && n > 0);
    return runtimes.length ? runtimes.reduce((a, b) => a + b, 0) / runtimes.length : 42;
  }, [fp]);

  const browse = useMemo(() => {
    // One numeric key per field so the direction is a single sign flip; dates
    // become timestamps rather than a second, string-shaped comparison.
    const rank: Record<ShowSort, (f: FriendFollow) => number | null> = {
      their: (f) => theirScoreByKey.get(keyOf(f.kind, f.tmdb_id)) ?? null,
      critic: (f) => f.vote_average ?? null,
      air: (f) => {
        const t = f.first_air_date ? Date.parse(f.first_air_date) : NaN;
        return Number.isNaN(t) ? null : t;
      },
    };
    const key = rank[showSort];
    const dir = sortDir === "asc" ? -1 : 1;
    /* Un solo juego de controles manda sobre las tres secciones: se lee como
       una decisión ("enséñame solo lo que tenemos en común") y no como tres
       formularios. La sección que se quede vacía con el filtro puesto
       desaparece, en vez de dejar un título con nada debajo. */
    return slices.map((slice) => ({
      slice,
      rows: slice.follows
        .filter((f) => {
          if (showFilter === "both") return myFollowKeys.has(keyOf(f.kind, f.tmdb_id));
          if (showFilter === "not") return !myFollowKeys.has(keyOf(f.kind, f.tmdb_id));
          return true;
        })
        .sort((a, b) => {
          const ka = key(a), kb = key(b);
          // Shows with no value sink whichever way the sort runs. Flipping to
          // "lowest first" is a request for their worst scores, not for the pile
          // they never scored at all — those would otherwise take the whole screen.
          if (ka == null || kb == null) {
            if (ka != null) return -1;
            if (kb != null) return 1;
          } else if (ka !== kb) {
            return dir * (kb - ka);
          }
          return a.name.localeCompare(b.name);
        }),
    }));
  }, [slices, showFilter, showSort, sortDir, myFollowKeys, theirScoreByKey]);

  /* "Viendo ahora" es de SERIES y no por descuido: `rpc_friend_snapshot` lo saca
     de lo que tiene un episodio emitido sin ver, y ni una película ni un juego
     tienen tal cosa — su episodio sintético (0067, 0071) se ve entero de una
     vez. Se cruza con sus series para saber que el número es de una: la función
     no dice el medio (0016 y 0038 son de cuando solo había series) y sin el
     cruce escribía "S1 · E1" sobre una película. Arriba de los `return`
     tempranos porque es un hook. */
  const theirTvIds = useMemo(
    () => new Set(ofMedium(fp?.follows ?? [], "tv").map((f) => f.tmdb_id)),
    [fp],
  );

  /* Los juegos que ya se terminó, que es lo que saca a uno de "está jugando"
     aunque la etiqueta siga puesta (domain/gameStatus: los créditos mandan).
     Dos fuentes porque ninguna sola los tiene todos: `rpc_friend_progress` solo
     cuenta lo que SIGUE —un juego terminado y quitado de la biblioteca no está—
     y su muro solo llega hasta donde llega el `limit` de la consulta. */
  const finishedGameIds = useMemo(() => {
    const ids = new Set(ofMedium(watchHistory, "game").map((w) => w.tmdb_id));
    for (const f of ofMedium(fp?.follows ?? [], "game")) {
      if ((progressOf(f.tmdb_id)?.watched ?? 0) > 0) ids.add(f.tmdb_id);
    }
    return ids;
  }, [fp, watchHistory, progressOf]);

  /* A qué está jugando y qué ha visto hace poco: las otras dos mitades de
     "ahora mismo", que hasta hoy no se enseñaban en ningún sitio de su ficha.
     La de juegos no sale de contar nada —el progreso de una partida no está en
     ninguna tabla— sino de lo que él mismo dijo (0073). */
  const playingGames = useMemo(() => playingNow(fp?.follows ?? [], finishedGameIds), [fp, finishedGameIds]);
  const recentMovies = useMemo(() => lastWatched(movieHistory, "movie"), [movieHistory]);

  const hue = hueOf(friendId);
  const estMinutes = snap ? Math.round(snap.stats.episodes * avgRuntime) : 0;

  if (isPending) {
    return <div className="screen mq-page"><div className="dim">{tr("Loading…")}</div></div>;
  }
  if (!snap) {
    return (
      <div className="screen mq-page">
        <div className="card" style={{ padding: "28px 24px", textAlign: "center" }}>
          <div style={{ fontWeight: 750, fontSize: 16 }}>{tr("Profile not available")}</div>
          <p className="dim" style={{ fontSize: 13.5, marginTop: 6 }}>
            {tr("This profile is private or not one of your friends.")}
          </p>
        </div>
      </div>
    );
  }

  // The last tab holds nothing but the head-to-head, so it is named and drawn
  // for that: a balance, not the star it shared with every other rating in the
  // app. "Notas" said whose notes it was showing, and the answer was "both".
  const sections: { v: SectionKey; label: string; icon: typeof User }[] = [
    { v: "overview", label: tr("Overview"), icon: User },
    { v: "library", label: tr("Library"), icon: LayoutGrid },
    { v: "activity", label: tr("Activity"), icon: Activity },
    { v: "compare", label: tr("Compare"), icon: Scale },
  ];

  const filters: { v: ShowFilter; label: string }[] = [
    { v: "all", label: tr("All") },
    { v: "both", label: tr("You both follow") },
    { v: "not", label: tr("You don't follow") },
  ];

  const sorts: { v: ShowSort; label: string }[] = [
    { v: "their", label: tr("Their rating") },
    { v: "critic", label: tr("Critic rating") },
    { v: "air", label: tr("Air date") },
  ];
  // What the arrow means depends on the field it points at — "lowest first" on
  // an air date is nonsense, and the toggle is the only thing naming the order.
  const dirLabel = showSort === "air"
    ? sortDir === "desc"
      ? tr("Newest first")
      : tr("Oldest first")
    : sortDir === "desc"
      ? tr("Highest first")
      : tr("Lowest first");

  const watchingCards = snap.watching.filter((w) => theirTvIds.has(w.tmdb_id)).map((w) => {
    const wName = locName(esNames, w.tmdb_id, w.name, "tv");
    const p = w.watched != null && w.aired != null
      ? { watched: w.watched, aired: w.aired }
      : progressOf(w.tmdb_id);
    const pct = p && p.aired > 0 ? Math.min(100, Math.round((p.watched / p.aired) * 100)) : null;
    return (
      <div key={w.tmdb_id} className="card mq-row" onClick={() => openSheet(w.tmdb_id, "tv")}>
        <MiniArt kind="tv" poster={w.poster_path} name={wName} style={{ width: 52, height: 76 }} />
        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{wName}</div>
          <div className="dim" style={{ fontSize: 12.5 }}>
            {tr("On")} S{w.season_number} · E{w.episode_number}
            {w.last_watched_at ? <span className="mute"> · {tr("activity: watched")} {relativeTime(w.last_watched_at, new Date(), dateLocale())}</span> : null}
          </div>
          {pct != null && (
            <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
              <div className="fr-matchbar" style={{ flex: 1, height: 5 }}><i style={{ width: `${pct}%` }} /></div>
              <span className="mute" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>{p!.watched}/{p!.aired}</span>
            </div>
          )}
        </div>
        {w.network && <NetworkLogo network={w.network} size={11} />}
      </div>
    );
  });

  const gameCards = playingGames.map((g) => {
    const gName = locName(esNames, g.tmdb_id, g.name, "game");
    const minutes = g.minutes_played ?? 0;
    /* El estado que se le pinta es el que él dijo, y solo importa para la barra:
       'ongoing' no tiene denominador honesto porque el juego no se acaba, y
       hoursProgress devuelve null para que las horas salgan a secas. */
    const state = g.play_state === "ongoing" ? "ongoing" : "playing";
    const pct = hoursProgress(minutes, g.beat_seconds, state);
    const line = [
      minutes > 0 ? formatPlaytime(minutes) : null,
      g.played_at ? relativeTime(g.played_at, new Date(), dateLocale()) : null,
    ].filter(Boolean).join(" · ");
    return (
      <div key={g.tmdb_id} className="card mq-row" onClick={() => openSheet(g.tmdb_id, "game")}>
        <MiniArt kind="game" poster={g.poster_path} name={gName} style={{ width: 52, height: 76 }} />
        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{gName}</div>
          <div className="dim truncate" style={{ fontSize: 12.5 }}>
            {/* Sin horas ni fecha —lo marcó y no ha apuntado nada más— la fila
                dice al menos qué hace con él, en vez de quedarse en blanco. */}
            {line || tr(state === "ongoing" ? "friend: Keeps playing it" : "friend: Playing it")}
          </div>
          {pct != null && minutes > 0 && (
            <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
              <div className="fr-matchbar" style={{ flex: 1, height: 5 }}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
              <span className="mute" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", flex: "0 0 auto" }}>{pct}%</span>
            </div>
          )}
        </div>
      </div>
    );
  });

  const movieCards = recentMovies.map((m) => {
    const mName = locName(esNames, m.tmdb_id, m.name, "movie");
    return (
      <div key={m.tmdb_id} className="card mq-row" onClick={() => openSheet(m.tmdb_id, "movie")}>
        <MiniArt kind="movie" poster={m.poster_path} name={mName} style={{ width: 52, height: 76 }} />
        <div className="min-w-0 flex-1">
          <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{mName}</div>
          <div className="dim truncate" style={{ fontSize: 12.5 }}>
            {tr("activity: watched")} {relativeTime(m.watched_at, new Date(), dateLocale())}
          </div>
        </div>
      </div>
    );
  });

  /* Los tres bloques de "ahora mismo", con el del modo delante (domain/friendNow).
     Cada medio dice lo suyo y no lo mismo tres veces: una serie se está VIENDO
     —le quedan episodios—, un juego se está jugando porque él lo dijo, y una
     película ni se está viendo ni se deja a medias, así que de cine lo que hay
     que contar es lo último. Los vacíos no pintan cabecera. */
  const nowBlocks: { medium: Medium; label: string; cards: React.ReactNode[] }[] =
    mediaFirst(medium)
      .map((m) => ({
        medium: m,
        label: m === "tv" ? tr("Watching now") : m === "game" ? tr("Playing now") : tr("Recently watched"),
        cards: m === "tv" ? watchingCards : m === "game" ? gameCards : movieCards,
      }))
      .filter((b) => b.cards.length > 0);

  /* Las cifras de su cabecera, desglosadas por medio en el cliente.
     `rpc_friend_snapshot.stats.shows` cuenta TODO lo que sigue —cine y juegos
     incluidos— bajo la etiqueta "series", porque 0016 y 0038 son de cuando solo
     había series. Aquí ya tenemos su lista entera y paginada, así que contar
     bien no cuesta ni una consulta. `episodes` sí se queda como viene, y por eso
     cambia de nombre: son todos sus watch_events, y una película vista y un
     juego terminado escriben uno igual que un episodio (0067, 0071). */
  const stats: { key: string; label: string; value: string; icon?: typeof User; medium?: Medium }[] = [
    /* Una tarjeta por medio del que SIGA algo. `slices` incluye también los
       medios de los que solo tiene notas, y con ellos la cabecera enseñaba un
       "Cine · 0" a quien puntuó tres películas sin guardarlas — el cero
       permanente que el resto de la página evita. */
    ...slices.filter((s) => s.follows.length > 0)
      .map((s) => ({ key: s.medium, label: tr(mediumPlural(s.medium)), value: String(s.follows.length), medium: s.medium })),
    { key: "watched", icon: Eye, label: tr("stat: Watched"), value: snap.stats.episodes.toLocaleString() },
    { key: "rated", icon: Star, label: tr("Rated"), value: String(snap.stats.rated) },
    { key: "time", icon: Clock, label: tr("Est. watch time"), value: `~${timeSpentLabel(estMinutes)}` },
    { key: "avg", icon: Heart, label: tr("Avg. rating"), value: avgRating != null ? avgRating.toFixed(1) : "—" },
  ];

  return (
    <div className="screen mq-page">
      {/* Slim sticky header: identity + section tabs over a fading hue wash */}
      <div className="fr-hero" style={{ "--fr-hue": hue } as React.CSSProperties}>
        <div className="fr-hero-id">
          <FriendAvatar f={{ id: snap.profile.id, name: snap.profile.display_name, avatarUrl: snap.profile.avatar_url }} size={44} ring />
          <div className="min-w-0">
            <div className="truncate" style={{ fontSize: 16, fontWeight: 800 }}>{snap.profile.display_name}</div>
            <div className="dim truncate" style={{ fontSize: 12 }}>@{snap.profile.handle}{snap.profile.country ? ` · ${snap.profile.country}` : ""}</div>
          </div>
        </div>
        {/* Buttons, not divs: on a phone CSS drops the label of every tab but
            the active one to keep all four on one line, and only an aria-label
            on a focusable control survives that. */}
        <div className="segmented scroll no-scrollbar fr-hero-tabs">
          {sections.map((s) => (
            <button
              key={s.v}
              type="button"
              className={`seg ${section === s.v ? "seg-active" : ""}`}
              onClick={() => setSection(s.v)}
              aria-label={s.label}
              title={s.label}
            >
              <s.icon size={14} /><span className="seg-label">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {section === "overview" && (
          <>
            {/* Ahora mismo — lo primero que ves, y en los tres medios: entrar
                aquí desde Videojuegos y encontrar solo sus series era enseñar
                media persona. El del modo va delante. */}
            {nowBlocks.map((b) => (
              <section key={b.medium} className="flex flex-col gap-2.5" data-tint={b.medium}>
                <div className="eyebrow flex items-center gap-1.5">
                  <MediumGlyph kind={b.medium} tone="accent" />{b.label}
                </div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(300px, 100%), 1fr))" }}>
                  {b.cards}
                </div>
              </section>
            ))}

            {/* Stats */}
            <div className="fr-stats">
              {stats.map((st) => (
                <div key={st.key} className="card p-3 flex flex-col gap-0.5" data-tint={st.medium}>
                  {st.medium ? <MediumGlyph kind={st.medium} size={16} tone="accent" /> : st.icon && <st.icon size={16} style={{ color: "var(--accent)" }} />}
                  <div style={{ fontSize: 18, fontWeight: 800 }} className="mt-1">{st.value}</div>
                  <div className="mute" style={{ fontSize: 11.5 }}>{st.label}</div>
                </div>
              ))}
            </div>

            {/* Taste match — una por medio. No hay una sola cifra que las resuma
                y no se inventa: promediarlas sería mezclar lo que 0067 y 0071
                separaron, y además esconde lo interesante, que es coincidir en
                cine y no en series. */}
            {slices.length > 0 && (
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))" }}>
                {slices.map((s) => {
                  const copy = tasteCopy(s.medium);
                  return (
                    <div key={s.medium} className="card p-4 flex flex-col gap-2" data-tint={s.medium}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700 }}>
                          <MediumGlyph kind={s.medium} size={15} tone="accent" />
                          {s.affinity
                            ? tv("{pct}% taste match", { pct: s.affinity.pct })
                            : tr("No taste match yet")}
                        </div>
                      </div>
                      <div className="fr-matchbar"><i style={{ width: `${s.affinity?.pct ?? 0}%` }} /></div>
                      <span className="mute" style={{ fontSize: 12 }}>
                        {s.affinity ? `${s.affinity.common} ${tr(copy.ratedInCommon)} · ` : ""}
                        {s.shared.length} {tr(copy.inCommon)}
                      </span>
                      {!s.affinity && (
                        <p className="mute" style={{ fontSize: 12, margin: 0 }}>{tr(copy.noOverlap)}</p>
                      )}
                      {s.sharedGenres.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 2 }}>
                          <span className="mute" style={{ fontSize: 11.5 }}>{tr("Shared taste:")}</span>
                          {s.sharedGenres.map((g) => <span key={g} className="badge badge-soft" style={{ fontSize: 11 }}>{tGenre(g)}</span>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <section className="taste-grid">
              <WatchHeatmap userId={friendId} />
            </section>

            <TasteBlocks blocks={taste} />
          </>
        )}

        {section === "library" && (
          <section className="flex flex-col gap-5">
            <div className="fr-toolbar">
              <div className="segmented scroll no-scrollbar">
                {filters.map((f) => (
                  <button
                    key={f.v}
                    type="button"
                    className={`seg ${showFilter === f.v ? "seg-active" : ""}`}
                    onClick={() => setShowFilter(f.v)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {/* Phone shape of the same three — "You don't follow" alone is
                  half a 375px row, so the strip wrapped onto a second line. */}
              <TabMenu
                value={showFilter}
                options={filters.map((f) => ({ key: f.v, label: f.label }))}
                onPick={setShowFilter}
                menuLabel={tr("Filter shows")}
              />
              <div className="fr-sort">
                <TabMenu
                  value={showSort}
                  options={sorts.map((s) => ({ key: s.v, label: s.label }))}
                  onPick={setShowSort}
                  menuLabel={tr("Sort")}
                  align="end"
                  always
                />
                <button
                  type="button"
                  className="chip chip-icon"
                  onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                  aria-label={dirLabel}
                  title={dirLabel}
                >
                  {sortDir === "desc" ? <ArrowDownWideNarrow size={15} /> : <ArrowUpNarrowWide size={15} />}
                </button>
              </div>
            </div>
            {browse.every((b) => b.rows.length === 0) ? (
              <p className="dim" style={{ fontSize: 13, margin: 0 }}>{tr("Nothing here.")}</p>
            ) : (
              <>
                {browse.map(({ slice, rows }) => (
                  <FollowSection key={slice.medium} slice={slice} rows={rows}>
                    {(f) => (
                      <FollowTile
                        key={keyOf(f.kind, f.tmdb_id)}
                        f={f}
                        name={locName(esNames, f.tmdb_id, f.name, f.kind)}
                        theirScore={theirScoreByKey.get(keyOf(f.kind, f.tmdb_id))}
                        /* Las barras son de series: `rpc_friend_progress` cuenta
                           episodios y su clave es el número a secas, así que en
                           otro medio pintaría el progreso de la serie que
                           llevara ese número. */
                        progress={f.kind === "tv" ? progressOf(f.tmdb_id) : undefined}
                        added={myFollowKeys.has(keyOf(f.kind, f.tmdb_id))}
                        onOpen={() => openSheet(f.tmdb_id, f.kind)}
                        onAdd={() => follow.mutate(toTitleRow(f))}
                      />
                    )}
                  </FollowSection>
                ))}
                <span className="mute" style={{ fontSize: 11.5 }}>
                  {/* One key for the whole legend: the + icon is slotted back
                      where the translation puts {plus}, not where English did. */}
                  {tr("Ring = you follow it too · {plus} adds to your library · bar = their progress.")
                    .split("{plus}")
                    .flatMap((part, i) => (i === 0 ? [part] : [<Plus key={i} size={11} style={{ verticalAlign: "-1px" }} />, part]))}
                </span>
              </>
            )}
          </section>
        )}

        {section === "activity" && <ActivityWall items={wall} isMe={false} />}

        {/* Head-to-head only. "Their top ratings" sat above it saying nothing
            about the two of you, and it was already the first thing the Activity
            feed and the Overview's average covered. Una sección por medio, cada
            una encabezada por su afinidad: es donde el porcentaje se entiende,
            justo encima de las notas que lo justifican. */}
        {section === "compare" && (
          <div className="flex flex-col gap-6">
            {slices.every((s) => s.coRated.length === 0) && (
              <div className="card" style={{ padding: "24px" }}>
                <p className="dim" style={{ margin: 0, fontSize: 14 }}>
                  {tr("You haven't both rated the same show yet. Rate one you've both seen and it shows up here.")}
                </p>
              </div>
            )}
            {slices.filter((s) => s.coRated.length > 0).map((s) => (
              <CompareSection key={s.medium} slice={s} esNames={esNames} onOpen={openSheet} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Lo que los dos habéis puntuado de UN medio, lo que más difiere primero.
 *
 *  Componente aparte por lo mismo que FollowSection: cada sección revela las
 *  suyas de nueve en nueve, y `useShowMore` es un hook. */
function CompareSection({ slice, esNames, onOpen }: {
  slice: MediumSlice;
  esNames: ReturnType<typeof useEsNames>;
  onOpen: (tmdbId: number, kind: Medium) => void;
}) {
  // 9 at a time, so the comparison grid reveals whole rows at its widest (three
  // 320px columns).
  const { shown, more } = useShowMore(slice.coRated, 9);
  const copy = tasteCopy(slice.medium);
  return (
    <div className="flex flex-col gap-2.5" data-tint={slice.medium}>
      <div className="eyebrow flex items-center gap-1.5">
        <Scale size={13} />{tr(mediumPlural(slice.medium))} · {slice.coRated.length} {tr(copy.ratedInCommon)}
        {slice.affinity && <span className="mute"> · {tv("{pct}% taste match", { pct: slice.affinity.pct })}</span>}
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))" }}>
        {shown.map((c) => {
          const name = locName(esNames, c.tmdb_id, c.name, c.kind);
          return (
            <div key={c.tmdb_id} className="card mq-row" onClick={() => onOpen(c.tmdb_id, c.kind)}>
              <MiniArt kind={c.kind} poster={c.poster_path} name={name} />
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 14.5, fontWeight: 700 }}>{name}</div>
                <div className="dim" style={{ fontSize: 12.5 }}>{agreementLabel(c.score, c.mine)}</div>
              </div>
              <div className="flex items-center gap-1.5" style={{ flex: "0 0 auto" }}>
                <span className="badge badge-soft" title={tr("Their score")} style={{ fontWeight: 800 }}>{tr("Them")} {c.score}</span>
                <span className="badge badge-soft" title={tr("Your score")} style={{ fontWeight: 800 }}>{tr("You")} {c.mine}</span>
              </div>
            </div>
          );
        })}
      </div>
      {more}
    </div>
  );
}
