import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { type LanguageName } from "@/lib/settings";
import { dateLocale, isEs, lang } from "@/lib/locale";
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

/* The locale primitives live in lib/locale.ts — this module pulls in the
   Supabase client for useEsNames, and formatting a date shouldn't drag that in.
   Re-exported here so the many existing `from "@/lib/i18n"` imports still find
   them, and imported because the dictionary lookups below use them too. */
export { dateLocale, isEs, lang };

/* One dictionary per non-English language, keyed by the English source string.
   English is the key set, so it needs no dictionary. A missing language or a
   missing key falls back to the English key — untranslated corners degrade to
   English rather than break.

   To add a language: add it to LanguageName (settings.ts), drop a `const FR = {…}`
   below with the same keys, register it in DICTS, and add its GENRES map. Nothing
   else in the app changes — every user-facing string already routes through t(). */
const ES: Record<string, string> = {
  // ---- Shell / nav ----
  "Tonight": "Esta noche",
  "Explore": "Explorar",
  "Calendar": "Calendario",
  // The nav tab into My Shows' "Sin empezar" bucket — named after the bucket it
  // opens rather than after the English word, so the tab and the chip it lands
  // on say the same thing.
  "Watchlist": "Sin empezar",
  "Friends": "Amigos",
  /* El botón «···» del carril de pestañas, que guarda las que no caben. */
  "More tabs": "Más pestañas",
  "My Shows": "Mis series",
  "History": "Historial",
  "Search": "Buscar",
  "Notifications": "Notificaciones",
  "Settings": "Ajustes",
  /* Ajustes: con qué pantalla abre la app. "Se abre en" y no "Pantalla de
     inicio", que en un móvil es el escritorio del sistema. */
  "Opens on": "Se abre en",
  "Reel opens on this mode's front page.": "Reel se abre por la portada de ese modo.",
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
  "now": "ahora",
  // Counting fragment ("· 3 vistos" under a collapsed calendar batch), so plural
  // — the singular "visto" sense stays inline in FriendPage's watching card.
  "watched": "vistos",
  "Find": "Buscar",
  "Accept": "Aceptar",
  "Decline": "Rechazar",
  "Copied": "Copiado",
  "Copy link": "Copiar enlace",
  // Rail arrows and the search dialog: invisible unless you're on a screen
  // reader, which is exactly why they were the last English left.
  "Scroll left": "Desplazar a la izquierda",
  "Scroll right": "Desplazar a la derecha",
  "Search shows": "Buscar series",

  // ---- Cine ----
  // El conmutador de la barra y lo que solo existe en el modo Movies. "TV" y
  // "Movies" son etiquetas de dos palabras que se leen igual en español, pero
  // pasan por t() como todo lo demás: si mañana alguien quiere "Cine", el
  // cambio es una línea aquí y no una cacería por los componentes.
  "Medium": "Medio",
  "TV": "Series",
  "Movies": "Cine",
  /* "Mis películas" y no "Mi cine", aunque el MODO se llame Cine. El modo es
     un sitio —una sección de la app— y ahí "Cine" funciona; esto es una lista
     de cosas tuyas, y lo que hay en ella son películas, igual que en "Mis
     series" y "Mis juegos" hay series y juegos. "Mi cine" nombraba el sitio
     otra vez en vez de nombrar lo que guardas. */
  "My Movies": "Mis películas",
  /* Videojuegos. "Sin final" y no "En curso" para 'ongoing': lo que dice no es
     que lo estés jugando ahora —eso es "Jugando"— sino que el juego no se
     acaba. Un CS que llevas un año sin tocar sigue sin tener final. */
  "My Games": "Mis juegos",
  "IGDB via Reel proxy": "IGDB vía el proxy de Reel",
  "Games": "Juegos",
  "Game": "Juego",
  "Game details": "Ficha del juego",
  "Playing": "Jugando",
  "Backlog": "Pendientes",
  "Ongoing": "Sin final",
  "Dropped": "Abandonados",
  "Play state": "En qué punto estás",
  "Time played": "Tiempo jugado",
  "Hours played": "Horas jugadas",
  "Games finished": "Juegos terminados",
  "Games in your list": "Juegos en tu lista",
  "hours": "horas",
  "of {total}": "de {total}",
  "Mark finished": "Marcar terminado",
  "Finished — tap to clear": "Terminado — toca para quitarlo",
  "Platforms": "Plataformas",
  /* El selector de 0083. "En cuál lo juegas" y no "Plataforma": la fila de
     abajo también son plataformas, y lo que separa a las dos no es la palabra
     sino de quién habla cada una — las del juego y la TUYA. */
  "You play it on": "En cuál lo juegas",

  /* ---- La ficha ampliada de un juego (0086) ----
     "My rating" no está aquí: lo trajo antes la ficha de serie y es la misma
     frase, con el mismo rótulo, sobre la misma caja de acento. */
  "Status": "Estado",
  "Platform": "Plataforma",
  "Not set": "Ninguna",
  "Not owned": "No lo tengo",
  "Add it to your library first": "Añádelo a tu biblioteca primero",
  "Play trailer": "Ver el tráiler",
  "View on Steam": "Ver en Steam",
  "Official site": "Web oficial",
  "Developer": "Desarrollador",
  "Publisher": "Distribuidora",
  /* "Genres" ya está más abajo, en los filtros de Explorar. */
  "Modes": "Modos",
  "{votes} reviews": "{votes} reseñas",
  /* Time to beat. Los rótulos NO se traducen del inglés de IGDB ("Hastily",
     "Normally", "Completely"): esas palabras describen al jugador y aquí lo que
     se compara son tres duraciones, así que se nombran por lo que son. */
  "Rushed": "Rápido",
  "Normal": "Normal",
  "Completionist": "Al 100 %",
  "My playtime": "Mis horas",
  "{n} estimates from IGDB": "{n} estimaciones de IGDB",
  "hours played": "horas jugadas",
  /* Los modos de juego, tal y como los nombra IGDB. Sin clave para los que no
     salen traducidos: t() cae al inglés y eso es mejor que una traducción a
     medias que solo cubra los cuatro más comunes. */
  "Single player": "Un jugador",
  "Multiplayer": "Multijugador",
  "Co-operative": "Cooperativo",
  "Split screen": "Pantalla partida",
  "Massively Multiplayer Online (MMO)": "MMO",
  "Battle Royale": "Battle royale",
  /* La escala de reseñas de Steam, con sus tramos. Prefijadas porque
     "Positive" a secas colisionaría con cualquier otro uso de la palabra. */
  "steam: Overwhelmingly Positive": "Extremadamente positivas",
  "steam: Very Positive": "Muy positivas",
  "steam: Positive": "Positivas",
  "steam: Mostly Positive": "Mayormente positivas",
  "steam: Mixed": "Mixtas",
  "steam: Mostly Negative": "Mayormente negativas",
  "steam: Very Negative": "Muy negativas",
  "steam: Overwhelmingly Negative": "Extremadamente negativas",
  "steam: Negative": "Negativas",
  "mark as where you play it": "marcar como donde lo juegas",
  "where you play it — tap to clear": "donde lo juegas — toca para quitarlo",
  "Library": "Biblioteca",
  /* Esta noche, en juegos. El héroe no dice "elige juego": un juego empezado se
     retoma, y elegir es lo que se hace en la pestaña Pendientes. De ahí que
     reutilice "Pick up where you left off", que ya existe en el Esta noche de
     series y dice exactamente eso. */
  "Start something": "Empieza algo",
  "Just out": "Recién salidos",
  /* Lanzamientos, la pantalla. Claves con prefijo y no las de cine ("Releases"
     → "Estrenos") porque en juegos la palabra es otra: un juego no se estrena,
     sale. Como toda clave con prefijo, lleva su entrada inglesa abajo para que
     el prefijo no llegue nunca a la pantalla. */
  "games: Releases": "Lanzamientos",
  "games: My releases": "Mis lanzamientos",
  "games: Announced": "Anunciados",
  /* La portada del modo. "Esta noche" es la pregunta de series y de cine, no la
     de esta pantalla: aquí no se elige nada —el héroe sale de pickResume— y una
     partida no cabe en una noche. "A jugar" conserva lo único que "Esta noche"
     hacía bien, que es invitar en vez de nombrar la pantalla. */
  "games: Tonight": "A jugar",
  "No date yet": "Sin fecha",
  "No releases in the games you follow.": "Ningún lanzamiento en los juegos que sigues.",
  /* Explorar, en juegos. "Más esperados" y no "Tendencias": IGDB no publica
     nada parecido a lo que la gente juega esta semana, y sí `hypes`, que es
     cuánta gente sigue un juego SIN SALIR. Resulta ser además la pregunta que
     más se hace de los videojuegos. */
  "Most anticipated": "Más esperados",
  "New releases": "Novedades",
  "No games on those platforms here.": "Aquí no hay juegos de esas plataformas.",
  "Nothing to show right now.": "Nada que enseñar ahora mismo.",
  "Nothing out recently.": "Nada recién salido.",
  "Nothing announced in the games you follow.": "Nada anunciado en los juegos que sigues.",
  "Nothing on the go — hit {key} and add a game.":
    "No tienes nada entre manos — pulsa {key} y añade un juego.",
  "Most played": "Más jugados",
  /* Steam (0076). "Lo tengo" y no "En propiedad": lo que responde es la
     pregunta que uno se hace en la tienda con el móvil en la mano, y esa
     pregunta se hace con esas tres palabras. */
  "Owned": "Lo tengo",
  "from Steam": "de Steam",
  // El crédito que pide la licencia gratuita de RAWG (0090), en la ficha del juego.
  "Critic score via": "Nota de la crítica vía",
  /* El inventario del mercado (0088). Dos decisiones de vocabulario que se
     repiten abajo y conviene dejar dichas:

     · "Worth" es «Vale» y "Sells for" es «Se vende por». No son sinónimos: el
       primero es la mediana de lo que se ha vendido de verdad y el segundo el
       listing más barato que hay puesto ahora. Toda la pantalla se apoya en que
       esa diferencia se lea de un vistazo, así que no pueden llamarse las dos
       "precio".
     · "Made trading" es «Sacado con el mercado» y no «Ganado»: el saldo de la
       cartera de Steam no se puede sacar, y «ganado» sugiere un ingreso. */
  "Market inventory": "Inventario del mercado",
  "Item": "Objeto",
  "How many": "Cuántos",
  "Worth": "Vale",
  "Sells for": "Se vende por",
  "Cost": "Costó",
  "Total": "Total",
  "Total value": "Valor total",
  "Unit price": "Precio por unidad",
  "Name": "Nombre",
  "Filter by name": "Filtrar por nombre",
  "Nothing matches that.": "No hay nada que case con eso.",
  "locked": "bloqueado",
  "price not confirmed yet": "precio sin confirmar",
  "Value over time": "Valor con el tiempo",
  "Out of your own pocket": "De tu bolsillo",
  "Spent on games": "Gastado en juegos",
  "Made trading": "Sacado con el mercado",
  "Unrealised, on what you still hold": "Sin realizar, en lo que aún tienes",
  "{items} items · {distinct} different · about {quick} if you sold it all today":
    "{items} objetos · {distinct} distintos · unos {quick} si lo vendieras todo hoy",
  "{n} items have no price yet, and are not in that total.":
    "{n} objetos aún no tienen precio, y no están en ese total.",
  "One item has no price yet, and is not in that total.":
    "Un objeto aún no tiene precio, y no está en ese total.",
  "One item had no price on {day}": "Un objeto no tenía precio el {day}",
  "one item": "un objeto",
  "one market row": "una fila de mercado",
  "one price point": "un punto de precio",
  "One row had a date Steam wrote in a way we couldn't read, and was left out rather than dated wrong.":
    "Una fila traía una fecha que Steam escribió de una forma que no supimos leer, y se ha quedado fuera en vez de fecharse mal.",
  "{n} items had no price on {day}": "{n} objetos no tenían precio el {day}",
  "Inventory value from {from} to {to}": "Valor del inventario del {from} al {to}",
  "The value graph starts the day you first upload: nobody recorded what your inventory was worth before that.":
    "La gráfica del valor empieza el día que subes el primer volcado: nadie guardó lo que valía tu inventario antes de eso.",
  "{n} of what you've spent on games didn't come from your pocket — the market paid for it.":
    "{n} de lo que has gastado en juegos no salió de tu bolsillo — lo puso el mercado.",
  "Unrealised covers the {covered} items you actually bought. The other {uncovered} came out of cases or trades and never cost you anything, so there's no gain to compute.":
    "Lo sin realizar es de los {covered} objetos que compraste. Los otros {uncovered} salieron de cajas o de intercambios y no te costaron nada, así que no hay ganancia que calcular.",
  "What your CS2 and Steam items are worth, what you paid, and what the market has given back.":
    "Lo que valen tus objetos de CS2 y de Steam, lo que pagaste, y lo que el mercado te ha devuelto.",
  "Steam blocks servers from reading inventories — that's why the sites that do this work so badly — and your purchase history needs your own session. So the reading happens in your browser, and Reel keeps the result. Nothing of your Steam session ever leaves your machine.":
    "Steam no deja que un servidor lea inventarios —por eso funcionan tan mal las webs que hacen esto— y tu historial de compras necesita tu propia sesión. Así que la lectura ocurre en tu navegador y Reel se queda el resultado. Nada de tu sesión de Steam sale de tu máquina.",
  "Open steamcommunity.com/market in another tab, signed in.":
    "Abre steamcommunity.com/market en otra pestaña, con tu sesión.",
  "Then do the same on store.steampowered.com/account/history — the wallet lives there, on the other side of a wall the first tab can't reach, and that's where \"out of your own pocket\" and \"spent on games\" come from.":
    "Repite lo mismo en store.steampowered.com/account/history — la cartera vive ahí, al otro lado de un muro que la primera pestaña no puede cruzar, y de ahí salen «de tu bolsillo» y «gastado en juegos».",
  "Come back here and upload the files.": "Vuelve aquí y sube los ficheros.",
  "Open the browser console there (⌥⌘J on Chrome for Mac) and paste this.":
    "Abre ahí la consola del navegador (⌥⌘J en Chrome para Mac) y pega esto.",
  "Wait — it asks Steam one price at a time on purpose — then press its buttons to save the files.":
    "Espera —pregunta los precios de uno en uno a propósito— y pulsa sus botones para guardar los ficheros.",
  "Copy the collector": "Copiar el recolector",
  "Show the collector": "Ver el recolector",
  "Hide the collector": "Ocultar el recolector",
  "Upload the file": "Subir el fichero",
  "Upload a new dump": "Subir un volcado nuevo",
  "Fetch the {n} missing prices": "Traer los {n} precios que faltan",
  "Fetched {n}. {left} to go — press again.":
    "Traídos {n}. Quedan {left} — vuelve a pulsar.",
  "Fetched {n}. Everything has a price now.":
    "Traídos {n}. Ya tienen precio todos.",
  "Your items as of {when}. Prices refresh on their own every day.":
    "Tus objetos a {when}. Los precios se refrescan solos a diario.",
  "Prices refresh on their own every day.": "Los precios se refrescan solos a diario.",
  "Uploaded: {what}.": "Subido: {what}.",
  "{n} items": "{n} objetos",
  "{n} market rows": "{n} filas de mercado",
  "{n} price points": "{n} puntos de precio",
  "{n} rows had a date Steam wrote in a way we couldn't read, and were left out rather than dated wrong.":
    "{n} filas traían una fecha que Steam escribió de una forma que no supimos leer, y se han quedado fuera en vez de fecharse mal.",
  "Steam account": "Cuenta de Steam",
  "Connect Steam": "Conectar Steam",
  "Connected": "Conectada",
  "Disconnect": "Desconectar",
  "Sync again": "Volver a sincronizar",
  "Look at my Steam library": "Mirar mi biblioteca de Steam",
  "Connect your Steam account to bring in the hours you've already played. Reel only reads your games list — it never posts anything.":
    "Conecta tu cuenta de Steam para traerte las horas que ya has jugado. Reel solo lee tu lista de juegos — no publica nada.",
  "Your Steam profile's game details have to be public, or Steam sends back an empty list.":
    "Los detalles de juego de tu perfil de Steam tienen que ser públicos, o Steam devuelve una lista vacía.",
  "Steam account connected.": "Cuenta de Steam conectada.",
  "You cancelled the Steam sign-in.": "Cancelaste la identificación en Steam.",
  "That sign-in attempt expired. Try again.": "Ese intento caducó. Vuelve a probar.",
  "That Steam account is already connected to another Reel account.":
    "Esa cuenta de Steam ya está conectada a otra cuenta de Reel.",
  "Steam couldn't confirm that sign-in. Try again.":
    "Steam no ha podido confirmar esa identificación. Vuelve a probar.",
  "Couldn't save the Steam account. Try again.":
    "No se ha podido guardar la cuenta de Steam. Vuelve a probar.",
  "That sign-in link was started from another account, so nothing was linked.":
    "Ese enlace lo empezó otra cuenta, así que no se ha enlazado nada.",
  "Asking Steam for your games…": "Pidiéndole a Steam tus juegos…",
  "Steam sent back an empty list": "Steam ha devuelto una lista vacía",
  "That's what a private profile looks like — Steam answers with no games and no error. In Steam: Profile → Edit profile → Privacy Settings, and set \"Game details\" to Public. Then sync again.":
    "Así es como se ve un perfil privado: Steam contesta sin juegos y sin error. En Steam: Perfil → Editar perfil → Configuración de privacidad, y pon «Detalles del juego» en Público. Luego vuelve a sincronizar.",
  "Couldn't read your Steam library": "No se ha podido leer tu biblioteca de Steam",
  "Steam didn't answer. Try again in a moment.": "Steam no ha contestado. Prueba dentro de un rato.",
  "What's coming in": "Qué va a entrar",
  "{n} of {total} selected": "{n} de {total} marcados",
  "Only what I follow": "Solo lo que sigo",
  "None": "Nada",
  // "In your library" ya está traducida más abajo (la ficha la usa para el
  // botón de añadir): una clave, una traducción.
  "use Steam's": "usar la de Steam",
  "you: {yours} · Steam: {theirs}": "tú: {yours} · Steam: {theirs}",
  "{n} games have hours you typed yourself. They're kept as they are unless you tick \"use Steam's\".":
    "{n} juegos tienen horas escritas por ti. Se quedan como están salvo que marques «usar la de Steam».",
  "Import {n} games": "Importar {n} juegos",
  /* La pantalla de confirmar de 0078: montones, tandas y lo que se dice de cada
     juego. "Finished it" es su propia clave y no "Finished" porque esa dice
     "Terminadas" — la de las series. */
  "Piles": "Montones",
  "Every game": "Todos",
  "Already in Reel": "Ya en Reel",
  "Not in Reel": "Todavía no en Reel",
  "More than 10 hours": "Con más de 10 h",
  "Never opened": "Sin tocar nunca",
  "Hours in conflict": "Horas en conflicto",
  "Decided so far": "Ya decidido",
  "{n} ticked": "{n} marcados",
  "{n} with a state": "{n} con estado",
  "{n} with a rating": "{n} con nota",
  "To the {n} ticked in this pile:": "A los {n} marcados de este montón:",
  "and a rating": "y nota",
  "Apply to the ticked ones": "Aplicar a los marcados",
  "Finished it": "Terminado",
  "Import {name}": "Importar {name}",
  "in Reel": "en Reel",
  "your rating": "tu nota",
  "what Reel already has": "lo que Reel ya tenía apuntado",
  "matches {name}": "casa con {name}",
  "you already follow this one as {year}": "ya sigues este juego con la ficha de {year}",
  "another edition": "otra edición",
  ", and you play it on {platform}": ", y lo juegas en {platform}",
  "Check the edition before importing it again.":
    "Mira la edición antes de importarlo otra vez.",
  /* El estado de UN juego, en la ficha de la pantalla de confirmar. Claves
     propias por lo mismo que "Finished it": los cubos de la pestaña Juegos van
     en plural, y "en Reel · Terminadas" habla de un juego en femenino plural. */
  "not out yet": "aún no ha salido",
  "on your backlog": "pendiente",
  "you're playing it": "jugándolo",
  "no ending": "sin final",
  "you finished it": "terminado",
  "you dropped it": "abandonado",
  "yours, untouched": "tuyo, sin tocar",
  "last played {date}": "última partida {date}",
  "never opened": "sin tocar nunca",
  "use Steam's {hours}": "usar las {hours} de Steam",
  "you typed {hours}": "tú escribiste {hours}",
  "saved as finished on {date}, your last session": "se guardará como terminado el {date}, tu última partida",
  "Steam has no last session for this one, so it'll be saved with today's date":
    "Steam no sabe cuándo lo jugaste por última vez, así que se guardará con la fecha de hoy",
  "What you import is dated with your last session on Steam, not with today.":
    "Lo que importes queda fechado con tu última partida en Steam, no con hoy.",
  "dated {date}, your last session": "queda fechado el {date}, tu última partida",
  "Anything without a state comes in as yours, undecided.":
    "Lo que no lleve estado entra como tuyo y sin decidir.",
  "Marked finished": "Marcados terminados",
  "Given a rating": "Con nota",
  "Anything you didn't give a state to arrives marked as owned and undecided: Steam's hours are lifetime totals and say nothing about what you're playing now.":
    "Lo que no marcaste con un estado entra como «lo tengo» y sin decidir: las horas de Steam son de por vida y no dicen nada sobre lo que estás jugando ahora.",
  "What you marked as finished is dated with your last session on Steam, not with today.":
    "Lo que marcaste como terminado lleva la fecha de tu última partida en Steam, no la de hoy.",
  "Looking up {n} games IGDB didn't have yet…": "Buscando {n} juegos que IGDB aún no tenía…",
  "Added or updated": "Añadidos o actualizados",
  "Conflicts kept as yours": "Conflictos que se quedan como tuyos",
  "Imported games arrive marked as owned, with no play state: Steam's hours are lifetime totals and say nothing about what you're playing now.":
    "Lo importado entra marcado como «lo tengo» y sin estado: las horas de Steam son de por vida y no dicen nada sobre lo que estás jugando ahora.",
  "Your Steam library came back empty, and the profile is public — so there's nothing to import.":
    "Tu biblioteca de Steam ha vuelto vacía, y el perfil es público — así que no hay nada que importar.",
  "No games yet — hit {key} and add one.": "Aún no hay juegos — pulsa {key} y añade uno.",
  "Movie details": "Ficha de la película",
  "Director": "Dirección",
  "Directors": "Dirección",
  "Writers": "Guion",
  "This film": "Esta película",
  "No movies yet — hit {key} and add one.": "Aún no hay películas — pulsa {key} y añade una.",
  // Portada de cine
  "Movie night pick": "La de esta noche",
  "Your watchlist": "Tu lista",
  "New to stream": "Nuevo en streaming",
  "In theatres soon": "Pronto en cines",
  // Explorar de cine: los tres carriles nuevos y el ajuste de plataformas.
  // "New on your services" es la variante del primero cuando has marcado
  // plataformas — dos cadenas y no una interpolada, porque el título cambia de
  // sujeto ("lo que hay" contra "lo que hay para ti"), no de dato.
  "New on your services": "Nuevo en tus plataformas",
  "Coming to cinemas": "Próximamente en cines",
  "Best rated by your friends": "Lo mejor valorado por tus amigos",
  "Your services": "Tus plataformas",
  // Lo que dice el desplegable de Tus plataformas cuando no hay ninguna
  // marcada. "Todas" y no "Ninguna", porque sin marcar nada el carril enseña
  // todo lo que entra en tu país: el ajuste estrecha, no enciende.
  "All platforms": "Todas las plataformas",
  "Narrows \"New to stream\" in Movies to the platforms you pay for. Leave it empty to see everything new in your country.":
    "Ajusta \"Nuevo en streaming\" de Películas a las plataformas que pagas. Déjalo vacío para ver todo lo que llega a tu país.",
  "Nothing new on your services.": "Nada nuevo en tus plataformas.",
  "No dated releases yet.": "Aún no hay estrenos con fecha.",
  "Nothing pending — hit {key} and add a movie.": "Nada pendiente — pulsa {key} y añade una película.",
  // Estrenos
  "Releases": "Estrenos",
  "My releases": "Mis estrenos",
  "In theatres": "En cines",
  /* Ya existe "Announced" con otro sentido: en la ficha califica UNA película
     sin fecha ("Anunciada"), y aquí nombra una lista. Misma palabra inglesa,
     dos significados y dos géneros gramaticales, así que dos claves — la regla
     que los verbos del muro ya siguen unas líneas más abajo. */
  "tab: Announced": "Anunciadas",
  "Streaming": "Streaming",
  "Release": "Estreno",
  "Mark {name} watched": "Marcar {name} como vista",
  "No dated releases in the movies you follow.": "Ninguna de tus películas tiene fecha.",
  "That's the start of your releases.": "Aquí empiezan tus estrenos.",
  "Nothing of yours in theatres right now.": "Ninguna de las tuyas está en cines ahora mismo.",
  "Nothing announced in the movies you follow.": "Ninguna de tus películas está por estrenar.",
  // Explorar cine
  "Popular": "Populares",
  "No movies match these filters.": "Ninguna película encaja con estos filtros.",
  "Filters search the whole catalogue, not just what's in theatres.":
    "Los filtros buscan en todo el catálogo, no solo en cartelera.",
  // Lo compartido: el glifo del medio y las cifras del perfil
  "Filmography": "Filmografía",
  "Movie": "Película",
  "TV series": "Serie",
  "Movies watched": "Películas vistas",
  "Movies in your list": "Películas en tu lista",
  // Avisos de estreno de cine (0072)
  "In theatres today": "Hoy en cines",
  "Streaming today": "Hoy en streaming",
  "A movie": "Una película",
  "{movie} is in theatres": "{movie} ya está en cines",
  "{movie} is out to stream": "{movie} ya se puede ver en casa",
  "Movie releases": "Estrenos de cine",
  "When a movie on your list reaches cinemas or streaming":
    "Cuando una película de tu lista llega al cine o a streaming",
  "watched {name}": "vio {name}",
  "self: watched {name}": "viste {name}",

  // ---- Settings sheet ----
  "Theme": "Tema",
  "System": "Sistema",
  "Dark": "Oscuro",
  "OLED black": "Negro OLED",
  "Light": "Claro",
  "Language": "Idioma",
  "English": "English",
  "Español": "Español",
  "Country": "País",
  "Sets where you can stream each show, and the timezone airing times are shown in.":
    "Determina dónde puedes ver cada serie y la zona horaria de las horas de emisión.",
  "Available on {providers}": "Disponible en {providers}",
  "New episodes": "Nuevos episodios",
  "Only shows you're watching or waiting for": "Solo las series que ves o que esperas",
  "Friend requests": "Solicitudes de amistad",
  "When someone adds you": "Cuando alguien te añade",
  "Imports": "Importaciones",
  "When a TV Time import finishes": "Cuando termina una importación de TV Time",
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
  "Aired {days} days ago": "Emitido hace {days} días",
  "Nothing in progress — add a show with {key} and mark where you are.":
    "Nada en marcha — añade una serie con {key} y marca por dónde vas.",

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
  /* El orden por la fecha de TU nota, en las tres bibliotecas. La flecha (↓ más
     reciente primero, ↑ al revés) la pone la página fuera de la cadena: es
     estado, no idioma. */
  "Last rated": "Última puntuada",
  "Loading your shows…": "Cargando tus series…",
  "shows in your library.": "series en tu biblioteca.",
  "Watched everything that's aired — just waiting on the next season.":
    "Has visto todo lo emitido — solo queda esperar la próxima temporada.",
  "Next episode": "Próximo episodio",
  "Stopped watching": "Abandonada",
  // {key} is the ⌘K chip: it stays a <kbd>, so the sentence travels whole and
  // the component splits on the placeholder to slot the element back in.
  "Nothing here yet — hit {key} and add a show.": "Aún no hay nada — pulsa {key} y añade una serie.",
  "Nothing in {filter} right now.": "Nada en {filter} ahora mismo.",

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
  "Mark the whole show watched?": "¿Marcar toda la serie como vista?",
  "This marks the one aired episode you haven't seen of {name}.": "Marca el único episodio emitido de {name} que no has visto.",
  "This marks all {count} aired episodes you haven't seen of {name}.": "Marca los {count} episodios emitidos de {name} que no has visto.",
  "Mark {count}": "Marcar los {count}",
  "Cancel": "Cancelar",
  "TBA": "Por anunciar",
  "Loading episodes": "Cargando episodios",
  // Episode sub-sheet + season rating graph (IMDb).
  "Episode ratings": "Notas por episodio",
  "Season average (IMDb)": "Media de la temporada (IMDb)",
  "IMDb episode ratings for this season": "Notas de IMDb de los episodios de esta temporada",
  "IMDb episode ratings for this season, averaging {avg}":
    "Notas de IMDb de los episodios de esta temporada, con media {avg}",
  "E{ep} · {rating}": "E{ep} · {rating}",
  "No synopsis yet.": "Aún no hay sinopsis.",
  /* El visor a tamaño completo (ui/Lightbox). "Next" ya está más arriba —lo
     dice el carrusel— y "Previous" no, porque hasta ahora nada iba hacia atrás. */
  "Previous": "Anterior",
  "View cover": "Ver la carátula",
  "Screenshot {n}": "Captura {n}",
  "{n} of {total}": "{n} de {total}",

  /* ---- La ficha de un episodio (0088) ---- */
  "Directing and writing": "Dirección y guion",
  /* El puesto que llega dentro de `episodes.crew`. "Director" ya está más
     abajo (la ficha de cine lo dice), pero esa usa "Writers" en plural y aquí
     el puesto viene de TMDB en singular. */
  "Writer": "Guion",
  "My rating": "Mi nota",
  "Continue with": "Continuar por",
  "Episode details": "Ver la ficha del episodio",
  "Whole show": "Toda la serie",
  "Season {n}": "Temporada {n}",
  "Mark the whole show watched": "Marcar toda la serie vista",
  "{votes} votes": "{votes} votos",
  "Guest stars": "Invitados",
  "Unwatch": "Desmarcar",
  "Not watched": "Sin ver",
  "Aired {date}": "Se emitió el {date}",
  "Watched on {date}": "Visto el {date}",
  "Premieres on {date}": "Se estrena el {date}",
  "No still yet": "Sin fotograma todavía",
  /* De dónde salió la marca de visto. 'app' no se dice: marcarlo tú es lo
     normal y no necesita explicación; lo que sí explica algo es que la marca
     venga de una importación, porque es lo que justifica una fecha vieja. */
  "imported from TV Time": "importado de TV Time",
  "from the initial import": "de la importación inicial",
  "Cast and crew arrive when the episode airs.": "El reparto y la dirección llegan cuando el episodio se emite.",
  "We'll tell you on premiere day": "Te avisaremos el día del estreno",
  "you follow the show and you're up to date": "sigues la serie y estás al día",
  "Runtime to be confirmed": "Duración por confirmar",
  "View on IMDb": "Ver en IMDb",
  /* episode_type de TMDB. 'standard' no se enseña: es el caso de casi todos y
     poner "estándar" en una ficha no dice nada de ese episodio. Las tres
     palabras que sí se usan ya están en el diccionario, más abajo — el
     calendario las dice desde antes. */
  "Episode {n}": "Episodio {n}",
  "Episode S{season} · E{episode}": "Episodio T{season} · E{episode}",
  "{votes} votes on IMDb": "{votes} votos en IMDb",
  "Earlier seasons": "Temporadas anteriores",
  "Later seasons": "Temporadas siguientes",
  "Earlier cast": "Reparto anterior",
  "More cast": "Más reparto",
  "Show details": "Detalles de la serie",
  "{name} details": "Detalles de {name}",
  "Resume — back in Tonight & calendar": "Reanudar — vuelve a Esta noche y al calendario",
  "Stop watching — keeps history, hides from Tonight":
    "Dejar de ver — conserva el historial y la oculta de Esta noche",
  // Singular gets its own sentence: "los 1 episodios" is broken Spanish, and
  // the English it mirrored ("all 1 aired episodes") was never right either.
  "Mark the last aired episode as seen — for shows you've already watched":
    "Marcar el último episodio emitido como visto — para series que ya has visto",
  "Mark all {count} aired episodes as seen — for shows you've already watched":
    "Marcar los {count} episodios emitidos como vistos — para series que ya has visto",
  "Open {name}'s profile": "Abrir el perfil de {name}",
  // Two whole sentences rather than a shared stem plus "episode"/"episodes":
  // a language whose plural reshapes the clause can't be served by a swapped noun.
  "You still have {count} unwatched episode up to S{season} · E{episode}. Mark them all as seen?":
    "Aún tienes {count} episodio sin ver hasta S{season} · E{episode}. ¿Marcarlos todos como vistos?",
  "You still have {count} unwatched episodes up to S{season} · E{episode}. Mark them all as seen?":
    "Aún tienes {count} episodios sin ver hasta S{season} · E{episode}. ¿Marcarlos todos como vistos?",

  // ---- Calendar ----
  "Series premiere": "Estreno de la serie",
  "Season premiere": "Estreno de temporada",
  "Season finale": "Final de temporada",
  /* Dos formas y quien llama coge la suya, como en "heat: {n} episode(s)". Una
     sola cadena imprimía "1 días" y "1 days" en la cuenta atrás de un estreno de
     mañana, en el calendario, en los lanzamientos de juegos y en el tiempo
     total del perfil — cinco sitios diciendo lo mismo mal.

     No hay helper de plural y no lo hay a propósito: con dos idiomas cuyo
     plural funciona igual, un `Intl.PluralRules` sería maquinaria para una
     regla de dos casos. El día que entre un idioma con más formas, el helper
     entra con él. */
  "day": "día",
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
  "Returning series": "Series que regresan",
  "Loading earlier episodes…": "Cargando episodios anteriores…",
  "Later": "Más adelante",
  "Season": "Temporada",
  "No dated episodes from the shows you follow in this window.":
    "No hay episodios con fecha de las series que sigues en esta ventana.",
  "Marked {count} episode as seen": "{count} episodio marcado como visto",
  "Marked {count} episodes as seen": "{count} episodios marcados como vistos",
  "This month": "Este mes",
  "Announced · no date yet": "Anunciadas · sin fecha",
  // Whole sentences, not "Nothing " + a verb: es puts the adjective after the
  // noun it qualifies, so the two halves can't be assembled in English order.
  "Nothing returning from the shows you follow right now.":
    "Nada que regrese de las series que sigues ahora mismo.",
  "Nothing new from the shows you follow right now.":
    "Nada nuevo de las series que sigues ahora mismo.",

  // ---- History ----
  "Everything you've watched, newest first.": "Todo lo que has visto, lo más reciente primero.",
  "Nothing watched yet.": "Aún no has visto nada.",
  "Nothing watched yet. Episodes you mark as watched show up here.":
    "Aún no has visto nada. Los episodios que marques como vistos aparecen aquí.",

  // ---- You ----
  "in your library": "en tu biblioteca",
  /* Con la cifra dentro, para los accesos del perfil: son cuatro tarjetas y el
     número es lo que las distingue de un vistazo. */
  "{n} in your library": "{n} en tu biblioteca",
  "Everything you've watched": "Todo lo que has visto",
  "Episodes watched": "Episodios vistos",
  "Time spent": "Tiempo total",
  "Shows followed": "Series seguidas",
  "Coming soon": "Próximamente",
  "Avg. rating": "Nota media",
  "Taste profile": "Perfil de gustos",
  "Watch activity": "Actividad de visionado",
  "Their watch activity": "Su actividad de visionado",
  // Heatmap cell tooltip — the whole line, so the count and the date can swap.
  "{count} episode · {date}": "{count} episodio · {date}",
  "{count} episodes · {date}": "{count} episodios · {date}",
  "Less": "Menos",
  "More": "Más",
  "Your ratings": "Tus notas",
  "shows scored": "series puntuadas",
  "Newest": "Recientes",
  "Oldest": "Antiguas",
  "Best rated": "Mejor nota",
  "Worst rated": "Peor nota",
  "No ratings yet — open a show and tap the stars.": "Aún no hay notas — abre una serie y toca las estrellas.",
  /* Las notas de un medio: su pantalla (features/you/RatingsPage) y la tarjeta
     del perfil que lleva a ella. Tres frases por cosa y no una con el nombre del
     medio interpolado — en español el género arrastra: son "puntuadas" las
     series y las películas, y "puntuados" los juegos. La tabla que las reparte
     está en domain/ratingsList.

     "Your show ratings" no está en esta lista: ya la tiene la sección de
     Exportar, con esta misma traducción, y el diccionario es plano — repetirla
     aquí no compila, y son dos entradas que un día dirían cosas distintas. */
  "Your movie ratings": "Tus notas de cine",
  "Your game ratings": "Tus notas de juegos",
  /* El nombre del medio no se repite en castellano: al lado ya está, en el
     rótulo de la tarjeta ("Cine") y en el título de la pantalla ("Tus notas de
     cine"). Con él dentro —"44 películas puntuadas · media 6,9"— el renglón se
     parte en tres líneas dentro de una tarjeta de 220 px y la fila queda más
     alta que la de las bibliotecas, que dice "1 en tu biblioteca". Lo que sí
     hace falta son las cuatro formas: el género lo pone el medio (puntuadas las
     series y las películas, puntuados los juegos) y el número, el singular. */
  "{n} show rated · avg {avg}": "{n} puntuada · media {avg}",
  "{n} shows rated · avg {avg}": "{n} puntuadas · media {avg}",
  "{n} movie rated · avg {avg}": "{n} puntuada · media {avg}",
  "{n} movies rated · avg {avg}": "{n} puntuadas · media {avg}",
  "{n} game rated · avg {avg}": "{n} puntuado · media {avg}",
  "{n} games rated · avg {avg}": "{n} puntuados · media {avg}",
  "No show ratings yet — open a show and tap the stars.":
    "Aún no has puntuado ninguna serie — abre una y toca las estrellas.",
  "No movie ratings yet — open a movie and tap the stars.":
    "Aún no has puntuado ninguna película — abre una y toca las estrellas.",
  "No game ratings yet — open a game and tap the stars.":
    "Aún no has puntuado ningún juego — abre uno y toca las estrellas.",
  "Share profile": "Compartir perfil",
  "rated": "puntuada",
  "today": "hoy",
  "yesterday": "ayer",
  "days ago": "días",
  // Whole sentence, not "days ago" + a number: es puts the count in the middle.
  "{days} days ago": "hace {days} días",
  "Sharing lands with friends (Phase 4)": "Compartir llega con los amigos (fase 4)",
  "Invites": "Invitaciones",
  "Create invite": "Crear invitación",
  "No invites yet — create one to share.": "Aún no hay invitaciones — crea una para compartir.",
  // Invite states. The badge shows the bare word; the row below names the
  // redeemer when there is one, so both come from the same three keys.
  "Used": "Usada",
  "Used by @{handle}": "Usada por @{handle}",
  "Expired": "Caducada",
  "Unused": "Sin usar",

  // ---- Friends / social ----
  "Who you watch with — their activity, their favorites.": "Con quién ves series — su actividad y sus favoritas.",
  "Friend activity": "Actividad de amigos",
  /* Activity-feed verbs. Prefixed because English reuses these words in other
     senses that need different Spanish: the "Watched" label is "Visto", the
     "Rated" stat is "Puntuadas", the "Added" badge is "Añadida". A key names a
     meaning, not a word — an unprefixed "Watched" cannot be both. */
  "activity: watched": "visto",
  "activity: Watched": "Vio",
  "activity: Rated": "Puntuó",
  "activity: Added": "Añadió",
  /* Explore's activity feed writes whole sentences instead of a verb + a noun,
     because {name} and {eps} are bold <b> nodes the component slots back in
     after translating — that way es can move them ("vio {eps} de {name}"). */
  "rated {name}": "puntuó {name}",
  "added {name} to their watchlist": "añadió {name} a su lista",
  "watched {eps} of {name}": "vio {eps} de {name}",
  "started watching {name}": "empezó a ver {name}",
  "finished season {season} of {name}": "terminó la temporada {season} de {name}",
  /* Your own rows in that same feed. English reuses the third-person verb and
     Spanish cannot ("vio" vs "viste"), so these are separate keys — prefixed,
     with an English entry below, since "self:" must never reach the screen. */
  "self: rated {name}": "puntuaste {name}",
  "self: added {name} to their watchlist": "añadiste {name} a tu lista",
  "self: watched {eps} of {name}": "viste {eps} de {name}",
  /* Los juegos (0074). El evento por debajo es el MISMO watch_event del
     episodio sintético que en cine, y aun así la frase es otra: lo que ese
     evento significa en un juego es que te salieron los créditos, no que lo
     hayas visto. Y la lista a la que se añade se llama "pendientes", que es el
     nombre del cubo de la biblioteca — decirle "lista" a secas obligaría a
     recordar cuál. */
  "finished {name}": "terminó {name}",
  "self: finished {name}": "terminaste {name}",
  "added {name} to their backlog": "añadió {name} a sus pendientes",
  "self: added {name} to their backlog": "añadiste {name} a tus pendientes",
  /* La biblioteca, que es la tercera lista (0077). No la decide el medio sino
     la fila: un juego marcado "Lo tengo" NO está en pendientes, así que decir
     que se añadió ahí sería mentir sobre dónde cayó. Es lo que pasa con todo
     lo que entra por la importación de Steam. */
  "added {name} to their library": "añadió {name} a su biblioteca",
  "self: added {name} to their library": "añadiste {name} a tu biblioteca",
  /* Y las plegadas: "añadió 39 juegos a su biblioteca". El sustantivo va
     aparte ({things}) porque en español lleva género y el orden de la frase no
     es el inglés — que es justo para lo que estas claves son la frase entera y
     no trozos encadenados. */
  "added {count} {things} to their library": "añadió {count} {things} a su biblioteca",
  "self: added {count} {things} to their library": "añadiste {count} {things} a tu biblioteca",
  "added {count} {things} to their backlog": "añadió {count} {things} a sus pendientes",
  "self: added {count} {things} to their backlog": "añadiste {count} {things} a tus pendientes",
  "added {count} {things} to their watchlist": "añadió {count} {things} a su lista",
  "self: added {count} {things} to their watchlist": "añadiste {count} {things} a tu lista",
  /* El desglose de un día en la rejilla de actividad (0082): "3 episodios · 1
     película · 20 ago". Tres frases y no una con el nombre del medio dentro,
     por lo de siempre: el género arrastra, y de un juego no se dice que se vio
     sino que se terminó. */
  "heat: {n} episode": "{n} episodio",
  "heat: {n} episodes": "{n} episodios",
  "heat: {n} movie": "{n} película",
  "heat: {n} movies": "{n} películas",
  "heat: {n} game finished": "{n} juego terminado",
  "heat: {n} games finished": "{n} juegos terminados",
  /* La década de una película, en el perfil de gustos. Llegan las dos formas
     del número y cada idioma coge la suya: el inglés dice "1990s" y el español
     "los 90" — pero "los 2000", no "los 00", así que el corte de dos cifras lo
     decide quien llama. */
  "decade: {full}": "los {short}",
  "games": "juegos",
  "movies": "películas",
  "See which ones": "Ver cuáles",
  "+{n} more — the rest are in their library": "+{n} más — el resto, en su biblioteca",
  // Reactions on those rows (0058)
  "React": "Reaccionar",
  "Reaction": "Reacción",
  "Reactions": "Reacciones",
  "When someone reacts to your activity": "Cuando alguien reacciona a tu actividad",
  "{name} reacted {emoji} to {show}": "{name} reaccionó {emoji} a {show}",
  "{names} reacted to {show}": "{names} reaccionaron a {show}",
  "{a} and {b}": "{a} y {b}",
  "{a} and {n} more": "{a} y {n} más",
  "Someone": "Alguien",
  "Clear": "Vaciar",
  /* What each emoji means, spoken. Screen readers get no name from an emoji,
     so every chip and palette button carries one of these. */
  "Love it": "Me encanta",
  "Brilliant": "Brutal",
  "Funny": "Qué risa",
  "Shocking": "Qué fuerte",
  "Want to watch": "Me lo apunto",
  "Boring": "Qué aburrimiento",
  "Rubbish": "Vaya truño",
  "{reaction}, {count}: {names}": "{reaction}, {count}: {names}",
  "Remove my reaction": "Quitar mi reacción",
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
  "handle": "usuario",
  "No one with that exact handle.": "Nadie con ese usuario exacto.",
  "Already connected": "Ya conectados",
  "Requests": "Solicitudes",
  "wants to connect": "quiere conectar",
  "In your library": "En tu biblioteca",
  "Add to your library": "Añadir a tu biblioteca",
  // Same two states as above, but as the a11y label that names the show.
  "{name} is in your library": "{name} está en tu biblioteca",
  "Add {name} to your library": "Añadir {name} a tu biblioteca",
  "No friends yet — add someone by their @handle, or share an invite.":
    "Aún no tienes amigos — añade a alguien por su @usuario o comparte una invitación.",
  "{count} pending sent request.": "{count} solicitud enviada pendiente.",
  "{count} pending sent requests.": "{count} solicitudes enviadas pendientes.",
  "Profile not available": "Perfil no disponible",
  "This profile is private or not one of your friends.": "Este perfil es privado o no es de uno de tus amigos.",
  "Newest first": "Las más recientes primero",
  "Oldest first": "Las más antiguas primero",
  "Highest first": "Las mejores primero",
  "Lowest first": "Las peores primero",
  "On": "Por",
  /* Los tres bloques de "ahora mismo" de la ficha de un amigo. Cada uno dice lo
     que se puede decir de SU medio: de una serie, que le quedan episodios; de
     un juego, que lo está jugando; y de cine, lo último — una película no se
     deja a medias, así que "viendo ahora" de una peli no significa nada. */
  "Watching now": "Viendo ahora",
  "Playing now": "Jugando ahora",
  "Recently watched": "Vistas hace poco",
  /* El verbo de la línea de debajo del nombre en la lista de amigos, uno por
     estado (domain/friendNow). Prefijados porque nombran un significado y no
     una palabra: el "Watching" sin prefijo es el cubo de Mis series. */
  "friends: Watching": "Viendo",
  "friends: Just watched": "Acaba de ver",
  "friends: Playing": "Jugando a",
  "friends: Just finished": "Se ha terminado",
  "Shows": "Series",
  "Episodes": "Episodios",
  /* La cifra de "todo lo que ha visto" de la cabecera de un amigo. Prefijada,
     como los verbos del muro y por lo mismo: el "Watched" sin prefijo ya es
     "Visto" (la etiqueta de un episodio marcado) y una clave nombra un
     significado, no una palabra.

     Y NO dice "Episodios" aunque venga de `rpc_friend_snapshot.stats.episodes`:
     esa cuenta TODOS sus watch_events, y una película vista y un juego
     terminado escriben uno igual que un episodio (0067, 0071). Llamarlo
     episodios era la etiqueta prestada de siempre. */
  "stat: Watched": "Vistos",
  "Rated": "Puntuadas",
  "Est. watch time": "Tiempo estimado",
  // es needs a "de" the English doesn't, so the percentage travels in the key.
  "{pct}% taste match": "{pct}% de afinidad",
  "No taste match yet": "Aún sin afinidad",
  "shows in common": "series en común",
  "Rate shows you've both seen and the match score appears.":
    "Puntuad series que hayáis visto los dos y aparecerá la afinidad.",
  "Shared taste:": "Gustos compartidos:",
  "Filter shows": "Filtrar series",
  "Nothing here.": "Nada por aquí.",
  "Recent activity": "Actividad reciente",
  "No activity yet.": "Aún sin actividad.",
  "You both rated": "Puntuadas por los dos",
  // Friend profile: section tabs, the shows filter/sort strips, score badges.
  "Overview": "Resumen",
  "Activity": "Actividad",
  "Compare": "Comparar",
  "You both follow": "Seguís los dos",
  "You don't follow": "No la sigues",
  "Their rating": "Su nota",
  "Critic rating": "Nota de la crítica",
  "Air date": "Fecha de emisión",
  "Their score": "Su nota",
  "Friends' average": "Media de amigos",
  "Group average (yours included)": "Media del grupo (tú incluido)",
  // Head-to-head verdicts. Sentence-cased and standalone here; the lowercase
  // "you basically agree" above is a fragment inside a Taste-page count.
  "Same score": "Misma nota",
  "You basically agree": "Básicamente coincidís",
  "You strongly disagree": "Discrepáis totalmente",
  "Slightly different takes": "Opiniones algo distintas",
  "You haven't both rated the same show yet. Rate one you've both seen and it shows up here.":
    "Aún no habéis puntuado ninguna serie los dos. Puntuad alguna en común y aparecerá aquí.",
  // {plus} is the inline + icon, slotted back after translation.
  "Ring = you follow it too · {plus} adds to your library · bar = their progress.":
    "Anillo = tú también la sigues · {plus} la añade a tu biblioteca · barra = su progreso.",

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
  "hidden movie": "película oculta",
  "hidden movies": "películas ocultas",
  "hidden game": "juego oculto",
  "hidden games": "juegos ocultos",
  "Collections": "Colecciones",
  "Collection": "Colección",
  "You already follow (or hid) everything here.": "Ya sigues (u ocultaste) todo lo de aquí.",
  "Nothing here yet.": "Aún no hay nada aquí.",

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
  /* Las mismas frases en cine y en juegos. Tres y no una con el medio
     interpolado porque el género arrastra: "puntuadas" no vale para juegos y
     "la puntuó" dicho de uno habla de otra cosa (domain/tasteScope). */
  "Rate a few movies first — your taste match is built from the movies you and your friends both scored.":
    "Puntúa algunas películas primero — la afinidad se calcula con las películas que habéis puntuado tú y tus amigos.",
  "None of your friends rated a movie you rated — yet. Nudge them to score something.":
    "Ningún amigo ha puntuado una película que tú hayas puntuado — aún. Anímalos a puntuar algo.",
  "Based on the movies you both rated — the more you share, the more the score trusts it.":
    "Basado en las películas que ambos puntuasteis — cuantas más compartáis, más fiable es el porcentaje.",
  "movies rated in common": "puntuadas en común",
  "movies in common": "películas en común",
  "rated the movie": "la puntuó",
  "friends rated the movie": "amigos la puntuaron",
  "friend rated the movie": "amigo la puntuó",
  "No overlap yet — rate a few movies your friends also scored.":
    "Sin coincidencias aún — puntúa películas que tus amigos también hayan puntuado.",
  "Rate a few games first — your taste match is built from the games you and your friends both scored.":
    "Puntúa algunos juegos primero — la afinidad se calcula con los juegos que habéis puntuado tú y tus amigos.",
  "None of your friends rated a game you rated — yet. Nudge them to score something.":
    "Ningún amigo ha puntuado un juego que tú hayas puntuado — aún. Anímalos a puntuar algo.",
  "Based on the games you both rated — the more you share, the more the score trusts it.":
    "Basado en los juegos que ambos puntuasteis — cuantos más compartáis, más fiable es el porcentaje.",
  "games rated in common": "puntuados en común",
  "games in common": "juegos en común",
  "rated the game": "lo puntuó",
  "friends rated the game": "amigos lo puntuaron",
  "friend rated the game": "amigo lo puntuó",
  "No overlap yet — rate a few games your friends also scored.":
    "Sin coincidencias aún — puntúa juegos que tus amigos también hayan puntuado.",
  "rated in common": "puntuadas en común",
  "you basically agree": "básicamente coincidís",
  "clash on": "chocáis en",
  "rated it": "la puntuó",
  "Tap a friend for the full 1-on-1 comparison": "Toca un amigo para la comparativa completa 1 a 1",
  "Them": "Ellos",
  "No shared ratings yet with {friends}.": "Aún no hay notas compartidas con {friends}.",

  // ---- Search palette ----
  "Search TV shows…": "Busca series…",
  "Search movies…": "Busca películas…",
  "Search games…": "Busca juegos…",
  "Search movies": "Buscar películas",
  "Search games": "Buscar juegos",
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
  "{age} years old": "{age} años",

  // ---- Poster lightbox ----
  "View poster": "Ver el póster",
  "Close": "Cerrar",
  // a11y labels that name a show — the only text a screen reader gets off a
  // poster tile or a mark-watched check, so they carry the whole sentence.
  "{name} — open details": "{name} — abrir detalles",
  "Mark {name} {se} watched": "Marcar {name} {se} como visto",

  // ---- Landing (public marketing page) ----
  "Features": "Funciones",
  "Import": "Importar",
  "Log in": "Inicia sesión",
  "Sign up": "Regístrate",
  // ---- Public legal pages ----
  "Back to Reel": "Volver a Reel",
  "Last updated": "Última actualización",
  "Privacy Policy": "Política de Privacidad",
  "Terms of Service": "Términos del Servicio",
  "Privacy": "Privacidad",
  "Terms": "Términos",
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
  // a11y / tooltip strings that name a show — see tv() for the {placeholder}.
  "Watched — tap to clear": "Visto — toca para desmarcar",
  "Mark all {count} watched": "Marcar los {count} como vistos",
  "Hide {name} from suggestions": "Ocultar {name} de las sugerencias",
  "Restore {name} to suggestions": "Devolver {name} a las sugerencias",
  "Your watchlist is": "Tu lista de pendientes te está",
  "waiting": "esperando",
  "Reel is in invite-only beta. Got a code from a friend? You're two minutes away from tonight's episode.":
    "Reel está en beta solo con invitación. ¿Tienes un código de un amigo? Estás a dos minutos del episodio de esta noche.",

  // ---- Notifications panel ----
  "Mark all read": "Marcar todo leído",
  "You're all caught up.": "Estás al día.",
  // Row titles (singular — the settings toggles above use the plural forms).
  "New episode": "Nuevo episodio",
  "Friend request": "Solicitud de amistad",
  "Import finished": "Importación terminada",
  // Row bodies. {name} carries the already-quoted episode title or "" — the
  // whole clause is one key so a language can move it off the end.
  "A show": "Una serie",
  "{show} S{season} · E{episode}{name} just aired": "{show} S{season} · E{episode}{name} acaba de emitirse",
  "{count} shows imported from TV Time": "{count} series importadas de TV Time",

  // ---- Import ----
  "Importing…": "Importando…",
  "Drop your export zip here": "Suelta aquí tu zip",
  "or click to choose · max 25MB": "o haz clic para elegirlo · máx. 25MB",
  "Import complete": "Importación completada",
  "Import failed": "La importación falló",
  "Queued…": "En cola…",
  "Shows matched": "Series encontradas",
  "Episodes marked": "Episodios marcados",
  "Couldn't match": "Sin coincidencia",
  "Importing… {done} / {total} shows": "Importando… {done} / {total} series",
  "Couldn't match: {shows} — add them by hand with ⌘K.":
    "Sin coincidencia: {shows} — añádelas a mano con ⌘K.",

  // ---- Export ----
  "Shows you follow": "Series que sigues",
  "Every episode you've marked watched": "Cada episodio que marcaste como visto",
  "Your show ratings": "Tus notas de series",
  "Preparing…": "Preparando…",
  "Download my data": "Descargar mis datos",

  /* ---- Lo que hace un amigo con ESTE título (ficha de cine y de juegos) ----
     Con prefijo porque no son las palabras de los cubos: en tu biblioteca el
     cubo se llama "Sin empezar" y hablando de otra persona eso no se entiende
     ("¿sin empezar qué?"). En tercera persona y con el verbo delante, que es
     como se cuenta lo que hace alguien.

     El género arrastra, y por eso son dos juegos de claves y no uno con el
     nombre del medio interpolado: "la tiene pendiente" (la película) y "lo
     tiene pendiente" (el juego) no se arreglan con una sola frase. */
  "friend: Not out yet": "Aún no ha salido",
  "friend: On their watchlist": "La tiene pendiente",
  "friend: Watched it": "La ha visto",
  "friend: In their backlog": "Lo tiene pendiente",
  "friend: Owns it": "Lo tiene",
  "friend: Playing it": "Lo está jugando",
  "friend: Keeps playing it": "Sigue jugándolo",
  "friend: Finished it": "Se lo ha terminado",
  "friend: Dropped it": "Lo dejó",

  // ---- Toasts ----
  "Couldn't load — check your connection and retry": "No se pudo cargar — revisa tu conexión y reintenta",
  "You're offline — changes are paused": "Sin conexión — los cambios quedan en pausa",
};

/* English normally needs no dictionary — the keys ARE the English. The
   exception is a context-prefixed key like "activity: Watched", whose prefix
   disambiguates a meaning and must never reach the screen. Those get an English
   entry too, so the fallback prints the word rather than the key. */
const EN: Record<string, string> = {
  "tab: Announced": "Announced",
  "self: watched {name}": "watched {name}",
  "activity: watched": "watched",
  "activity: Watched": "Watched",
  "activity: Rated": "Rated",
  "activity: Added": "Added",
  "self: rated {name}": "rated {name}",
  "self: added {name} to their watchlist": "added {name} to your watchlist",
  "games: Releases": "Releases",
  "games: My releases": "My releases",
  "games: Announced": "Announced",
  "games: Tonight": "Play",
  "self: watched {eps} of {name}": "watched {eps} of {name}",
  "self: finished {name}": "finished {name}",
  "self: added {name} to their backlog": "added {name} to your backlog",
  "self: added {name} to their library": "added {name} to your library",
  "self: added {count} {things} to their library": "added {count} {things} to your library",
  "self: added {count} {things} to their backlog": "added {count} {things} to your backlog",
  "self: added {count} {things} to their watchlist": "added {count} {things} to your watchlist",
  "stat: Watched": "Watched",
  "heat: {n} episode": "{n} episode",
  "heat: {n} episodes": "{n} episodes",
  "heat: {n} movie": "{n} movie",
  "heat: {n} movies": "{n} movies",
  "heat: {n} game finished": "{n} game finished",
  "heat: {n} games finished": "{n} games finished",
  "decade: {full}": "{full}s",
  /* Los estados de un amigo. En inglés el prefijo es lo único que sobra —el
     género no arrastra— pero la entrada tiene que estar igual, o la ficha
     enseñaría la clave con los dos puntos delante. */
  /* Los verbos de la lista de amigos. En inglés el prefijo es lo único que
     sobra, pero la entrada tiene que estar o la tarjeta enseñaría la clave con
     los dos puntos delante. */
  "friends: Watching": "Watching",
  "friends: Just watched": "Just watched",
  "friends: Playing": "Playing",
  "friends: Just finished": "Just finished",
  "friend: Not out yet": "Not out yet",
  "friend: On their watchlist": "On their watchlist",
  "friend: Watched it": "Watched it",
  "friend: In their backlog": "In their backlog",
  "friend: Owns it": "Owns it",
  "friend: Playing it": "Playing it",
  "friend: Keeps playing it": "Keeps playing it",
  "friend: Finished it": "Finished it",
  "friend: Dropped it": "Dropped it",
};

/** Dictionaries by language. */
const DICTS: Partial<Record<LanguageName, Record<string, string>>> = { en: EN, es: ES };

/** Translate a UI string. Falls back to the English key when the active language
 *  has no dictionary or no entry, so unknown/untranslated strings stay readable. */
export function t(s: string): string {
  return DICTS[lang()]?.[s] ?? s;
}

/** Translate a string carrying {placeholders}, then fill them.
 *  The dictionary holds the whole sentence rather than fragments so a
 *  translation can move the placeholder — concatenating around a variable locks
 *  English word order into every language. Used for the labels that name a show:
 *  the show's title can't be a dictionary key, but the sentence around it can. */
export function tv(s: string, vars: Record<string, string | number>): string {
  // split/join, not replaceAll: the app's tsc target predates ES2021, and this
  // needs no regex escaping for a placeholder that is already brace-delimited.
  return Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), t(s));
}

/* TMDB TV genres — stored in English in the metadata cache, translated per
   language the same way the UI dictionary is. Add a language's map to GENRES. */
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
  // Géneros de CINE: otra taxonomía de TMDB, con nombres propios. Comparten
  // clave con los de series los que se llaman igual en inglés (Animation,
  // Comedy, Crime, Documentary, Drama, Family, Mystery, Western) y por eso no
  // se repiten aquí.
  "Action": "Acción",
  "Adventure": "Aventura",
  "Fantasy": "Fantasía",
  "History": "Historia",
  "Horror": "Terror",
  "Music": "Música",
  "Romance": "Romance",
  "Science Fiction": "Ciencia ficción",
  "Thriller": "Thriller",
  "TV Movie": "Película de TV",
  "War": "Bélica",
};

const GENRES: Partial<Record<LanguageName, Record<string, string>>> = { es: GENRES_ES };

export function tGenre(g: string): string {
  return GENRES[lang()]?.[g] ?? g;
}

/* ---- Localized show names ---------------------------------------------- */

/** Los desplazamientos que faltan por pedir, sabiendo el total y cuántas filas
 *  trajo de verdad la primera página.
 *
 *  Existe suelta y exportada para poder probarla: es aritmética pura y es donde
 *  vive el fallo caro de un paginado —pedir de menos deja huecos que nadie ve—,
 *  mientras que lo que la rodea es una llamada de red que este proyecto no
 *  simula en ninguna prueba.
 *
 *  `step` es lo que VINO, no lo que se pidió: el tope de filas por respuesta lo
 *  decide el servidor, y calcular los tramos con el tamaño pedido cuando sirve
 *  menos salta filas en silencio. Un `step` de 0 —una primera página vacía— no
 *  devuelve nada que pedir, que además evita dividir entre cero. */
/** Las filas tal como vienen → las parejas del mapa. Los dos caminos de
 *  {@link useEsNames} —con total y sin él— acaban aquí, y tenerlo escrito una
 *  vez es lo que evita que uno de los dos se quede con la clave de antes. */
const entries = (rows: { tmdb_id: number; kind: string; name_es: string | null }[]) =>
  rows
    .filter((r) => Boolean(r.name_es))
    .map((r): [string, string] => [`${r.kind}:${r.tmdb_id}`, r.name_es as string]);

export function restOffsets(total: number, step: number): number[] {
  if (step <= 0 || total <= step) return [];
  return Array.from({ length: Math.ceil((total - step) / step) }, (_, i) => step + i * step);
}

/** "medio:tmdb_id" → Spanish title, for every cached title that has one.
 *  Loaded once per session (and only in Spanish); RLS: titles are
 *  authenticated-readable. Errors degrade to an empty map — canonical names
 *  render instead.
 *
 *  La clave lleva el medio porque un id de TMDB solo es único dentro del suyo
 *  (0067): con el número a secas, el título español de una película pisaba el
 *  de la serie del mismo id — y al revés, según cuál llegara última. */
export function useEsNames(): Map<string, string> {
  const { session } = useAuth();
  const { data } = useQuery({
    queryKey: ["esNames"],
    enabled: isEs() && Boolean(session?.user.id),
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<[string, string][]> => {
      /* Paginado, y no por elegancia: PostgREST corta en 1.000 filas y NO lo
         dice. Con las series de la biblioteca ya rondando ese número, el corte
         se llevaba entero el cine — el mapa se llenaba de series y ninguna
         película llegaba, así que el modo Movies salía en español con todos los
         títulos en inglés. `order` es imprescindible: sin él dos páginas pueden
         solapar y dejar huecos, porque PostgREST no promete ningún orden.

         Silent-fail: contra una base anterior a 0046 la columna no existe y los
         nombres canónicos son un respaldo perfectamente digno. */
      // Medido en producción el 25-ago-2026: 1.436 filas con traducción, 96 kB,
      // dos páginas de verdad. Crece con el catálogo cacheado, no con tu
      // biblioteca, así que la forma de esto importa más de lo que su tamaño de
      // hoy sugiere.
      const PAGE = 1000;
      /* El total se pide SOLO en la primera. `count: "exact"` no es gratis —es
         un COUNT sobre el conjunto filtrado—, y pedirlo también en las páginas
         que van en paralelo es pagarlo tantas veces como páginas haya para
         tirar todas las respuestas menos una. */
      const page = (from: number, withCount = false) =>
        supabase
          .from("titles")
          .select("tmdb_id, kind, name_es", withCount ? { count: "exact" } : undefined)
          .not("name_es", "is", null)
          .order("kind")
          .order("tmdb_id")
          .range(from, from + PAGE - 1);

      /* La primera página trae ADEMÁS el total, y con el total se sabe cuántas
         quedan sin preguntarlo. Eso ahorra las dos cosas que costaba encadenar
         páginas hasta ver una vacía:

           · la petición de más — la que solo servía para descubrir que no
             quedaba nada (medida: 88 ms de puro peaje);
           · y sobre todo la ESPERA EN FILA. Las páginas iban una detrás de otra
             porque hasta que no volvía una no se sabía si había otra, así que el
             mapa tardaba la suma de todas (~0,86 s hoy). Nada se bloquea
             esperándolo —los títulos se pintan en su idioma canónico y cambian
             al llegar—, pero ese cambio a la vista es justo lo que se nota, y
             dura lo que tarde el mapa.

         Con el total, la primera manda y el resto van a la vez: el reloj es el
         de la más lenta, no el de la suma, y sigue siendo correcto por muchas
         páginas que haya. */
      const first = await page(0, true);
      if (first.error) return [];

      const rows = [...(first.data ?? [])];
      /* Sin total no se adivina: se vuelve a encadenar hasta la página vacía,
         que es lento pero completo. `count ?? rows.length` parecía razonable y
         era una trampa — daría "no queda nada" ante un total desconocido y
         truncaría en silencio justo lo que este paginado arregla. */
      if (first.count == null) {
        let from = rows.length;
        for (;;) {
          const more = await page(from);
          const got = more.error ? [] : (more.data ?? []);
          if (got.length === 0) break;
          rows.push(...got);
          from += got.length;
        }
        return entries(rows);
      }
      const total = first.count;
      /* Por lo que HA VENIDO, no por lo que se pidió: el tope de filas de
         PostgREST es ajuste suyo, y si sirviera menos de mil, calcular los
         tramos con PAGE dejaría huecos silenciosos — el mismo truncamiento
         invisible que este paginado existe para arreglar. */
      const offsets = restOffsets(total, rows.length);
      if (offsets.length > 0) {
        // La flecha explícita no es adorno: `.map(page)` le pasaría el ÍNDICE
        // como segundo argumento, que aquí es `withCount` — y volvería a pedir
        // el COUNT en todas las páginas menos la primera. Es la misma trampa
        // que el compilador cazó ayer en movieSearchRow.
        const rest = await Promise.all(offsets.map((from) => page(from)));
        for (const r of rest) {
          // Una página caída se salta: medio mapa deja medio catálogo en
          // español, y eso es estrictamente mejor que ninguno.
          if (!r.error) rows.push(...(r.data ?? []));
        }
      }
      return entries(rows);
    },
  });
  return useMemo(() => new Map(data ?? []), [data]);
}

/** Display name for a title given the loaded map (canonical fallback).
 *  `kind` por defecto "tv": lo son las dos docenas de llamadas que ya había. */
export function locName(
  esNames: Map<string, string>,
  tmdbId: number | string | null | undefined,
  fallback: string,
  kind: "tv" | "movie" | "game" = "tv",
): string {
  if (!isEs() || tmdbId == null) return fallback;
  // 'game' se acepta y nunca acierta: name_es lo llena tmdb-proxy (0046) y IGDB
  // no tiene traducciones, así que un juego cae siempre al nombre original. Se
  // admite igualmente para que las listas mezcladas —el muro, el historial—
  // llamen a locName con el kind de la fila sin ramificar antes.
  return esNames.get(`${kind}:${Number(tmdbId)}`) ?? fallback;
}
