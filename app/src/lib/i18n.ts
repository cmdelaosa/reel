import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getSettings } from "@/lib/settings";
import { useAuth } from "@/features/auth/AuthProvider";

/* Lightweight es/en localization (settings.language).
   - t("English text") looks the string up in the DICT below; unknown strings
     fall back to English, so untranslated corners degrade gracefully.
   - The language is constant for the lifetime of the page: the settings sheet
     reloads the app after switching, so t() can read getSettings() once per
     call without any subscription plumbing.
   - Show titles: canonical DB columns stay English; 0046 adds name_es filled
     by tmdb-proxy/episode-refresh. useEsNames() loads one tmdb_id→name_es map
     and locName() resolves a display name; components that hold a full
     TitleRow use its name_es directly instead. */

export const lang = () => getSettings().language;
export const isEs = () => lang() === "es";

/** Locale for toLocale*String calls — undefined keeps the browser default in English. */
export const dateLocale = (): string | undefined => (isEs() ? "es-ES" : undefined);

const DICT: Record<string, string> = {
  // ---- Shell / nav ----
  "Tonight": "Esta noche",
  "Explore": "Explorar",
  "Calendar": "Calendario",
  "Friends": "Amigos",
  "My Shows": "Mis series",
  "History": "Historial",
  "Search": "Buscar",
  "Notifications": "Notificaciones",
  "Settings": "Ajustes",
  "Your profile": "Tu perfil",

  // ---- Common ----
  "Loading…": "Cargando…",
  "Done": "Hecho",
  "Reset": "Restablecer",
  "Undo": "Deshacer",
  "See all": "Ver todo",
  "Add": "Añadir",
  "Remove": "Quitar",
  "Details": "Detalles",
  "Mark watched": "Marcar visto",
  "episodes": "episodios",
  "episode": "episodio",
  "shows": "series",
  "show": "serie",
  "friends": "amigos",
  "friend": "amigo",
  "Page": "Página",
  "of": "de",
  "Prev": "Anterior",
  "Next": "Siguiente",

  // ---- Settings sheet ----
  "Theme": "Tema",
  "System": "Sistema",
  "Dark": "Oscuro",
  "OLED black": "Negro OLED",
  "Light": "Claro",
  "Language": "Idioma",
  "English": "English",
  "Español": "Español",
  "New episodes": "Nuevos episodios",
  "When a show you follow airs": "Cuando emite una serie que sigues",
  "Premieres": "Estrenos",
  "When a followed upcoming show gets a date": "Cuando una serie que esperas tiene fecha",
  "Friend requests": "Solicitudes de amistad",
  "When someone adds you": "Cuando alguien te añade",
  "App": "App",
  "Email": "Email",
  "Your data": "Tus datos",
  "Import from TV Time": "Importar de TV Time",
  "Export my data": "Exportar mis datos",

  // ---- Tonight ----
  "Working out what's next…": "Calculando qué toca ver…",
  "Up next for you": "Siguiente para ti",
  "New today": "Nuevo hoy",
  "Aired yesterday": "Emitido ayer",
  "Continue watching": "Seguir viendo",
  "Pick up where you left off": "Retoma donde lo dejaste",
  "Fresh episodes": "Episodios recientes",
  "Just aired from shows you follow": "Recién emitidos de series que sigues",
  "Nothing new in the last 5 days.": "Nada nuevo en los últimos 5 días.",
  "Premieres soon": "Próximos estrenos",
  "Dated within the next 60 days": "Con fecha en los próximos 60 días",
  "No dated premieres yet.": "Aún no hay estrenos con fecha.",
  "% done": "% visto",
  "min": "min", // same abbreviation in es — routed through t() so the hero meta has no raw string

  // ---- Shows ----
  "Watching": "Viendo",
  "Caught up": "Al día",
  "Not started": "Sin empezar",
  "Upcoming": "Próximas",
  "Finished": "Terminadas",
  "Stopped": "Abandonadas",
  "All": "Todas",
  "Sort": "Ordenar", // aria-label on the phone dropdown that replaces the sort strip
  "Last watched": "Último visto",
  "Last released": "Último emitido",
  "A–Z": "A–Z",
  "Top rated": "Mejor nota",
  "Loading your shows…": "Cargando tus series…",
  "shows in your library.": "series en tu biblioteca.",
  "Watched everything that's aired — just waiting on the next season.":
    "Has visto todo lo emitido — solo queda esperar la próxima temporada.",
  "Next episode": "Próximo episodio",
  "Stopped watching": "Abandonada",

  // ---- Detail sheet ----
  "Seasons": "Temporadas",
  "Your rating": "Tu nota",
  "Friend ratings": "Notas de amigos",
  "Cast": "Reparto",
  "Original title": "Título original",
  "Premieres ": "Estreno ",
  "Announced": "Anunciada",
  "Stop watching": "Dejar de ver",
  "Stop": "Parar",
  "All watched": "Todo visto",
  "Resume": "Reanudar",
  "Notify me": "Avisarme",
  "Tracking": "Siguiendo",
  "Ignore": "Ignorar",
  "Un-ignore": "Restaurar",
  "Ignore — hide from suggestions": "Ignorar — ocultar de las sugerencias",
  "Un-ignore — show in suggestions again": "Restaurar — volver a sugerirla",
  "Restore to suggestions": "Restaurar a las sugerencias",
  "Marking…": "Marcando…",
  "No episodes available yet.": "Aún no hay episodios disponibles.",
  "Mark earlier episodes as seen?": "¿Marcar los episodios anteriores como vistos?",
  "Only this one": "Solo este",
  "Mark all": "Marcar los",
  "TBA": "Por anunciar",

  // ---- Calendar ----
  "Series premiere": "Estreno de la serie",
  "Season premiere": "Estreno de temporada",
  "Season finale": "Final de temporada",
  "days": "días",
  "Watched": "Visto",
  "Loading more…": "Cargando más…",
  "That's the start of your history.": "Aquí empieza tu historial.",
  "My shows": "Mis series",
  "Returning": "Regresan",
  "New & announced": "Nuevas y anunciadas",
  "Today": "Hoy",
  "Yesterday": "Ayer",
  "Tomorrow": "Mañana",

  // ---- History ----
  "Everything you've watched, newest first.": "Todo lo que has visto, lo más reciente primero.",
  "Nothing watched yet.": "Aún no has visto nada.",

  // ---- You ----
  "in your library": "en tu biblioteca",
  "Everything you've watched": "Todo lo que has visto",
  "Episodes watched": "Episodios vistos",
  "Time spent": "Tiempo total",
  "Shows followed": "Series seguidas",
  "Coming soon": "Próximamente",
  "Avg. rating": "Nota media",
  "Taste profile": "Perfil de gustos",
  "Watch activity": "Actividad de visionado",
  "Their watch activity": "Su actividad de visionado",
  "Less": "Menos",
  "More": "Más",
  "Your ratings": "Tus notas",
  "shows scored": "series puntuadas",
  "Newest": "Recientes",
  "Oldest": "Antiguas",
  "Best rated": "Mejor nota",
  "Worst rated": "Peor nota",
  "No ratings yet — open a show and tap the stars.": "Aún no hay notas — abre una serie y toca las estrellas.",
  "Share profile": "Compartir perfil",
  "rated": "puntuada",
  "today": "hoy",
  "yesterday": "ayer",
  "days ago": "días",

  // ---- Friends / social ----
  "Who you watch with — their activity, their favorites.": "Con quién ves series — su actividad y sus favoritas.",
  "Friend activity": "Actividad de amigos",
  "Taste match": "Afinidad de gustos",
  "Friends stats": "Estadísticas de amigos",
  "What to watch next, score comparisons, shared stinkers": "Qué ver, comparativa de notas y los truños compartidos",
  "See how your ratings line up with your friends'": "Mira cómo encajan tus notas con las de tus amigos",
  "Closest match:": "Mayor afinidad:",
  "Recommended by friends": "Recomendadas por amigos",
  "Nothing to recommend — you've seen everything your friends rated.":
    "Nada que recomendar — has visto todo lo que tus amigos han puntuado.",
  "Your scores vs theirs": "Tus notas contra las suyas",
  "No overlap yet — rate a few shows your friends also scored.":
    "Sin coincidencias aún — puntúa series que tus amigos también hayan puntuado.",
  "Worst watched together": "Lo peor visto en grupo",
  "No shared stinkers yet — lucky you.": "Aún no hay truños compartidos — suerte la tuya.",
  "The friend-group scoreboard — what to watch next, how your scores compare, and the shows everyone regrets.":
    "El marcador del grupo — qué ver, cómo comparan tus notas y las series de las que todos os arrepentís.",
  "No friends yet — add someone on the Friends tab to unlock the friends stats.":
    "Aún no tienes amigos — añade a alguien en la pestaña Amigos para desbloquear las estadísticas.",
  "friend rated it": "amigo la puntuó",
  "friends rated it": "amigos la puntuaron",
  "You": "Tú",
  "avg": "media",

  // ---- Explore ----
  "Find your next show — starting with what your friends love.":
    "Encuentra tu próxima serie — empezando por lo que encanta a tus amigos.",
  "Search shows, genres, networks…": "Busca series, géneros, cadenas…",
  "Trending this week": "Tendencias de la semana",
  "What everyone's watching, via TMDB": "Lo que ve todo el mundo, vía TMDB",
  "Discover": "Descubrir",
  "Popular now": "Popular ahora",
  "Popular with friends": "Popular entre amigos",
  "Most popular for the selected years": "Lo más popular de los años elegidos",
  "New shows and fresh seasons, ranked by buzz": "Series nuevas y temporadas recientes, por repercusión",
  "The best of the catalog, ranked by TMDB score": "Lo mejor del catálogo, por nota de TMDB",
  "Shows your friends are watching, most friends first": "Series que ven tus amigos, con más amigos primero",
  "No popular shows match these filters.": "Ninguna serie popular encaja con estos filtros.",
  "No top-rated shows match these filters.": "Ninguna serie top encaja con estos filtros.",
  "No shows from your friends match these filters.": "Ninguna serie de tus amigos encaja con estos filtros.",
  "Add a friend to see what they're watching.": "Añade un amigo para ver qué está viendo.",
  "All genres": "Todos los géneros",
  "genres ": "géneros",
  "Filters": "Filtros",
  "Genres": "Géneros",
  "Years": "Años",
  "From:": "Desde:",
  "To:": "Hasta:",
  "From": "Desde",
  "To": "Hasta",
  "Any": "Cualquiera",
  "Clear filters": "Quitar filtros",
  "Show more": "Mostrar más",
  "List view": "Vista de lista",
  "Added": "Añadida",
  "hidden show": "serie oculta",
  "hidden shows": "series ocultas",
  "Collections": "Colecciones",

  // ---- Taste page ----
  "How your ratings line up with your friends' — who scores like you, and which shows split you.":
    "Cómo encajan tus notas con las de tus amigos — quién puntúa como tú y qué series os dividen.",
  "Affinity ranking": "Ranking de afinidad",
  "Where you clash": "Donde chocáis",
  "Where you agree": "Donde coincidís",
  "No friends yet — add someone on the Friends tab to compare taste.":
    "Aún no tienes amigos — añade a alguien en la pestaña Amigos para comparar gustos.",
  "Rate a few shows first — your taste match is built from the shows you and your friends both scored.":
    "Puntúa algunas series primero — la afinidad se calcula con las series que habéis puntuado tú y tus amigos.",
  "None of your friends rated a show you rated — yet. Nudge them to score something.":
    "Ningún amigo ha puntuado una serie que tú hayas puntuado — aún. Anímalos a puntuar algo.",
  "Based on the shows you both rated — the more you share, the more the score trusts it.":
    "Basado en las series que ambos puntuasteis — cuantas más compartáis, más fiable es el porcentaje.",
  "rated in common": "puntuadas en común",
  "you basically agree": "básicamente coincidís",
  "clash on": "chocáis en",
  "rated it": "la puntuó",
  "Tap a friend for the full 1-on-1 comparison": "Toca un amigo para la comparativa completa 1 a 1",
  "Them": "Ellos",

  // ---- Search palette ----
  "Search TV shows…": "Busca series…",
  "No results.": "Sin resultados.",
  "Searching…": "Buscando…",
  "Type to search TMDB.": "Escribe para buscar en TMDB.",
  "navigate": "navegar",
  "open": "abrir",
  "TMDB via Reel proxy": "TMDB vía el proxy de Reel",

  // ---- Person page ----
  "Known for": "Conocido por",
  // Deliberately short: it shares a column with the status labels and sits
  // beside the show title in a 328px row — see PersonPage.
  "Not following": "Sin seguir",
  "Your score": "Tu nota",
  "Read more": "Ver más",
  "Show less": "Ver menos",
  // TMDB known_for_department values (English in the API payload).
  "Acting": "Interpretación",
  "Directing": "Dirección",
  "Writing": "Guion",
  "Production": "Producción",

  // ---- Poster lightbox ----
  "View poster": "Ver el póster",
  "Close": "Cerrar",

  // ---- Landing (public marketing page) ----
  "Features": "Funciones",
  "Import": "Importar",
  "Log in": "Inicia sesión",
  "Sign up": "Regístrate",
  "Always know what to watch": "Siempre sabrás qué ver",
  "tonight": "esta noche",
  "Reel keeps every show you follow in one place — what's next, when it returns, and what your friends thought of it. Fast, beautiful, and yours.":
    "Reel guarda todas las series que sigues en un solo sitio: qué toca ver, cuándo vuelven y qué les parecieron a tus amigos. Rápido, bonito y tuyo.",
  "Create your account": "Crea tu cuenta",
  "I already have an account": "Ya tengo cuenta",
  "TONIGHT FOR YOU": "ESTA NOCHE PARA TI",
  "Up next": "Siguientes",
  "The essentials": "Lo esencial",
  "Everything a tracker": "Todo lo que un tracker",
  "should": "debería",
  "be.": "ser.",
  // "Pick up where you left off" already exists in the Tonight section above.
  "Reel tracks every episode you watch and lines up the next one — per show, per season, automatically.":
    "Reel registra cada episodio que ves y te prepara el siguiente: por serie y por temporada, automáticamente.",
  "Never miss a premiere": "No te pierdas ningún estreno",
  "A calendar of returns and new episodes for the shows you follow, in your timezone.":
    "Un calendario con regresos y episodios nuevos de tus series, en tu zona horaria.",
  "THU": "JUE",
  "FRI": "VIE",
  "SUN": "DOM",
  "Premiere": "Estreno",
  "Watch with your people": "Ve series con los tuyos",
  "taste match": "afinidad",
  "Compare ratings with friends, see what the group is into, and steal your next show.":
    "Compara notas con tus amigos, mira qué engancha al grupo y róbales tu próxima serie.",
  "Your year in television": "Tu año en series",
  "Heatmap, streaks, hours and top networks — stats that make your watching a story.":
    "Mapa de calor, rachas, horas y cadenas top: estadísticas que convierten lo que ves en una historia.",
  "day streak": "días seguidos",
  "Build your canon": "Construye tu canon",
  "Half-star ratings on episodes and seasons. Your history becomes the best recommendation engine.":
    "Notas con medias estrellas en episodios y temporadas. Tu historial se convierte en el mejor recomendador.",
  "“The Wire” · S4 — rated 4.5": "«The Wire» · T4 — nota 4,5",
  "TV Time refugee?": "¿Refugiado de TV Time?",
  "Bring your whole": "Tráete todo tu",
  "history": "historial",
  "with you.": "contigo.",
  "Upload your TV Time export and Reel rebuilds your library — shows, seen episodes and every rating. Years of watching, nothing lost.":
    "Sube tu exportación de TV Time y Reel reconstruye tu biblioteca: series, episodios vistos y todas tus notas. Años de historial, sin perder nada.",
  "Your watchlist is": "Tu lista de pendientes te está",
  "waiting": "esperando",
  "Reel is in invite-only beta. Got a code from a friend? You're two minutes away from tonight's episode.":
    "Reel está en beta solo con invitación. ¿Tienes un código de un amigo? Estás a dos minutos del episodio de esta noche.",
};

/** Translate a UI string (identity in English / unknown strings). */
export function t(s: string): string {
  return isEs() ? DICT[s] ?? s : s;
}

/* TMDB TV genres (stored in English in the metadata cache). */
const GENRES_ES: Record<string, string> = {
  "Action & Adventure": "Acción y aventura",
  "Animation": "Animación",
  "Comedy": "Comedia",
  "Crime": "Crimen",
  "Documentary": "Documental",
  "Drama": "Drama",
  "Family": "Familiar",
  "Kids": "Infantil",
  "Mystery": "Misterio",
  "News": "Noticias",
  "Reality": "Reality",
  "Sci-Fi & Fantasy": "Ciencia ficción y fantasía",
  "Soap": "Telenovela",
  "Talk": "Programas de entrevistas",
  "War & Politics": "Guerra y política",
  "Western": "Western",
};

export function tGenre(g: string): string {
  return isEs() ? GENRES_ES[g] ?? g : g;
}

/* ---- Localized show names ---------------------------------------------- */

/** tmdb_id → Spanish title, for every cached title that has one. Loaded once
 *  per session (and only in Spanish); RLS: titles are authenticated-readable.
 *  Errors degrade to an empty map — canonical names render instead. */
export function useEsNames(): Map<number, string> {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["esNames"],
    enabled: isEs() && Boolean(session?.user.id),
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<[number, string][]> => {
      // Silent-fail: against a DB that predates migration 0046 the column is
      // missing — canonical names are a fine fallback, never toast about it.
      const { data, error } = await supabase
        .from("titles")
        .select("tmdb_id, name_es")
        .not("name_es", "is", null);
      if (error) return [];
      return (data ?? [])
        .filter((r): r is { tmdb_id: number; name_es: string } => Boolean(r.name_es))
        .map((r) => [r.tmdb_id, r.name_es]);
    },
  });
  return useMemo(() => new Map(data ?? []), [data]);
}

/** Display name for a title given the loaded map (canonical fallback). */
export function locName(esNames: Map<number, string>, tmdbId: number | string | null | undefined, fallback: string): string {
  if (!isEs() || tmdbId == null) return fallback;
  return esNames.get(Number(tmdbId)) ?? fallback;
}
