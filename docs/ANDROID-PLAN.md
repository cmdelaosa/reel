# Plan: Reel Android nativa (paridad completa)

> Documento de trabajo para un agente ejecutor. Objetivo: app Android nativa en
> Kotlin + Jetpack Compose con paridad funcional completa con la web app
> (`app/`), lista para instalar en ~2 días de trabajo de agente y distribuida
> vía Play Store (testing cerrado).
>
> Decisiones ya tomadas con el usuario (NO re-abrir):
> - **Kotlin + Jetpack Compose**, no Capacitor/RN/TWA.
> - **Paridad completa** con la web (exclusiones justificadas en §4.14).
> - **Material 3 / Material You** (dynamic color), NO replicar el diseño visual de la web.
> - **Monorepo**: el código vive en `android/` en este repo.
> - **Distribución**: Play Store, track de testing cerrado.
>
> Fuente de verdad de lo que hay que portar: el inventario de la web app
> resumido en §4–§5. La web usa React + TanStack Query + react-router; backend
> Supabase (Postgres+RLS, Edge Functions Deno, Storage, Realtime, pg_cron);
> TMDB solo vía la edge function `tmdb-proxy`; i18n en/es.

## 0. Prerequisitos manuales (los hace el usuario, no el agente)

Estos pasos requieren cuentas/identidad y el agente no puede hacerlos. Todo lo
demás del plan puede avanzar en paralelo; los puntos donde bloquean están
marcados como **[BLOQUEO-N]** en las fases.

1. **[BLOQUEO-1] Google Cloud Console** (proyecto del OAuth web de Supabase):
   crear un OAuth Client ID de tipo **Android** con:
   - package name: `app.reel.android`
   - SHA-1 del keystore de debug del agente (el agente lo genera e imprime en Fase 0)
   - Más adelante: SHA-1 del keystore de release y el de Play App Signing.
   El **Web Client ID existente** también hace falta: `signInWithIdToken` de
   Supabase valida contra el client ID web (audience). Apuntarlo en
   `android/local.properties` como `GOOGLE_WEB_CLIENT_ID`.
   *Nota: en la web Google está detrás del flag `VITE_GOOGLE_AUTH`; si en
   producción está apagado, este bloqueo baja a prioridad baja y la app
   arranca solo con OTP.*
2. **[BLOQUEO-2] Supabase Dashboard → Auth → URL Configuration**: añadir
   `app.reel.android://auth-callback` a las Redirect URLs permitidas (para
   magic links / OTP).
3. **[BLOQUEO-3] Play Console**: cuenta de desarrollador (25 USD, verificación
   de identidad — puede tardar días; **iniciarla YA**), crear la app, activar
   Play App Signing, subir el primer `.aab`, crear track de testing cerrado y
   lista de testers. Necesita URL de política de privacidad y formulario de
   data safety (se recogen: email, handle, avatar, actividad de visionado,
   ratings, amistades).
   - **Nota de calendario**: la verificación de Play puede exceder los 2 días.
     El entregable de los 2 días es un **APK firmado con keystore propio**
     instalable por sideload + el `.aab` listo para subir cuando la cuenta
     esté verificada. No bloquea el desarrollo.

## 1. Entorno del agente (Fase 0, ~30 min)

El agente trabaja headless, sin Android Studio. En esta máquina hay JDK 21
(sdkman) pero no hay Android SDK.

```bash
mkdir -p ~/Library/Android/sdk/cmdline-tools
cd ~/Library/Android/sdk/cmdline-tools
curl -LO https://dl.google.com/android/repository/commandlinetools-mac-13114758_latest.zip
unzip commandlinetools-*.zip && mv cmdline-tools latest
export ANDROID_HOME=~/Library/Android/sdk
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

- Verificación de builds: `./gradlew :app:assembleDebug` y `./gradlew :app:testDebugUnitTest`.
- Pruebas en dispositivo/emulador quedan para el usuario; el agente valida con
  compilación, tests unitarios y screenshots de `@Preview` si hace falta.
- Keystore de debug: se genera solo; imprimir su SHA-1 para [BLOQUEO-1]:
  `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android | grep SHA1`
- Keystore de release: generarlo en Fase 8 con `keytool -genkeypair`, guardarlo
  FUERA del repo (`~/keystores/reel-release.jks`) y referenciarlo desde
  `android/keystore.properties` (gitignored).

## 2. Estructura y stack del proyecto

```
android/
  settings.gradle.kts
  build.gradle.kts
  gradle/libs.versions.toml        # version catalog, única fuente de versiones
  local.properties                 # SDK path + secrets locales (gitignored)
  app/
    build.gradle.kts
    src/main/kotlin/app/reel/android/
      ReelApp.kt                   # Application, DI
      MainActivity.kt              # single-activity, deep links, NavHost
      core/                        # supabase client, sesión, red, i18n, utils
      domain/                      # lógica pura portada de app/src/domain (§5.5)
      data/                        # modelos serializables + repositorios (§5)
      ui/
        theme/                     # Material 3, dynamic color
        components/                # Poster, Rail, Stars, Skeletons, etc. en M3
        navigation/                # NavHost + rutas tipadas + bottom bar
      features/
        auth/ tonight/ explore/ detail/ shows/ history/
        calendar/ social/ you/ importexport/ notifications/ search/ settings/
    src/test/kotlin/               # tests unitarios (dominio y serialización)
```

Stack (todas en `libs.versions.toml`, usar últimas estables):

| Área | Elección |
|---|---|
| Lenguaje | Kotlin 2.x, JDK 21 toolchain |
| UI | Jetpack Compose + Material 3, dynamic color (Material You), tema claro/oscuro del sistema |
| Navegación | Navigation Compose con rutas tipadas (`@Serializable` routes) |
| Backend | **supabase-kt** (módulos `auth-kt`, `postgrest-kt`, `storage-kt`, `functions-kt`, `realtime-kt`) sobre Ktor + kotlinx.serialization |
| Imágenes | Coil 3 (compose) — pósters/backdrops hotlinkeados de `image.tmdb.org` |
| Async/estado | Coroutines + Flow; ViewModel por pantalla con `StateFlow<UiState>` |
| DI | Hilt (o Koin si Hilt da fricción con KSP; decidir en Fase 1 y no cambiar) |
| Persistencia sesión | supabase-kt `Auth` (storage propio sobre DataStore) |
| minSdk / target | minSdk 26, targetSdk 36, compileSdk 36 |

Convenciones:
- Single-activity. **Bottom navigation con 4 tabs**: Tonight, Explore,
  Calendar, Friends (mismas top-level que la web). Top app bar con: búsqueda
  (→ pantalla Search, equivalente del ⌘K Palette), campana de notificaciones,
  y avatar (→ You). Settings vive dentro de You.
- El **detalle de un título es un destino navegable** `detail/{tmdbId}`
  presentado como pantalla completa (en la web es un modal por query param
  `?title=<tmdbId>`); accesible desde cualquier pantalla.
- Cada feature: `XxxScreen` (composable) + `XxxViewModel` + `XxxUiState`
  (Loading/Error/Content) + eventos one-shot para toasts/undo.
- Repositorios con errores tipados; ViewModels traducen a estado de UI con retry.
- **Optimistic updates** para follow/mark/rate/notify/stopped/ignore con
  rollback si la mutación falla (la web lo hace extensivamente; replicar el
  patrón con un cache en memoria por repositorio e invalidación de flows).
- **i18n en/es**: portar el diccionario de `app/src/lib/i18n.ts` a
  `res/values/strings.xml` + `res/values-es/strings.xml`. Títulos/overviews
  localizados vienen del backend (`name_es`, `overview_es`); replicar los
  helpers `locName`/`tGenre`.
- Secretos: `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `BuildConfig` leídos de
  `local.properties` (copiar valores de `app/.env.local`; la anon key es
  publicable).

## 3. Auth y gates de acceso (Fase 2)

La web encadena cuatro guards; portar la cadena entera como grafo de arranque:

```
sesión? ──no──► LoginScreen
   │sí
invitado? (rpc is_invited) ──no──► InviteScreen (rpc redeem_invite)
   │sí
handle placeholder? (regex ^user_[0-9a-f]{16}$) ──sí──► WelcomeScreen
   │no
App (bottom nav)
```

Pantallas:
1. **LoginScreen** — email → `auth.signInWith(OTP)` (magic link; crea cuenta
   en primer uso). Estados: sent/busy/error. Botón Google solo si
   `GOOGLE_WEB_CLIENT_ID` está configurado: **Credential Manager**
   (`androidx.credentials` + `GetGoogleIdOption`) → `signInWith(IDToken)`
   [BLOQUEO-1]. El flujo password de la web es solo-dev: no portar.
   - Magic link: vuelve por deep link `app.reel.android://auth-callback`
     (intent-filter en MainActivity + `handleDeeplinks` de supabase-kt)
     [BLOQUEO-2]. Fallback sin tocar el email en el móvil: input del código
     OTP de 6 dígitos (`verifyEmailOtp`).
   - **Invite stash**: la web guarda `?invite=CODE` en localStorage para
     sobrevivir al redirect. En Android: si la app se abre con un link de
     invitación, guardar el código en DataStore y redimirlo tras el login.
2. **InviteScreen** — input código → RPC `redeem_invite({p_code})` (los códigos
   multi-uso crean amistades automáticas server-side). Botón sign out.
3. **WelcomeScreen** (onboarding) — display_name + handle + avatar.
   Validación de handle en vivo: regex `^[a-z0-9_.]{3,24}$` + RPC
   `handle_available({p_handle})` con debounce (estados idle/invalid/checking/
   taken/free). Avatar: photo picker → recorte cuadrado + resize a 256px PNG
   (equivalente Kotlin de `cropAvatar`) → upload a Storage
   `avatars/<uid>/avatar.png` (upsert) → `update` de `profiles`.
4. **Sesión** — restore + refresh automático (supabase-kt); sign out limpia
   sesión y caches en memoria. El perfil propio se crea por trigger de DB en
   el signup; solo hay que leerlo (`profiles` por id).

## 4. Mapeo de paridad pantalla a pantalla

Cada subsección lista: qué se construye, estados de UI y datos que consume
(referencias exactas en §5). El código web de referencia está en
`app/src/features/<módulo>/`.

### 4.1 Tonight (tab 1, pantalla de inicio)
- Hero con el up-next del show más activo (backdrop, próximo episodio,
  botón marcar visto) + rail "Continue watching" con el resto.
- Columnas "Fresh episodes" (feed de los últimos 5 días) y "Premieres soon"
  (60 días).
- Datos: `rpc_up_next`, `rpc_calendar_feed` (1 semana). Mutación: mark watched
  inline con animación de check y undo.
- Lógica de orden/ventanas: portar `domain/tonight.ts` (`orderByActivity`,
  `recentlyAired`, `soonPremieres`; ventanas 5d/60d).

### 4.2 Explore (tab 2)
- Rail "Trending" + sección con tabs **popular | rated | friends**.
- Filtros: multi-género (mapa `TV_GENRES` a IDs TMDB), rango de años;
  paginación "Show more" (18 en 18, tope 54); toggle vista mosaic/list
  (persistir en DataStore); sección de "hidden shows" restaurables (ignored).
- Sección Collections: tiles con gradiente por hue → CollectionScreen (grid
  de `useCollection`, filtrando ya-seguidos/ignorados).
- Card de actividad de amigos (`rpc_friend_activity`).
- Datos: tmdb-proxy `/trending`, `/popular-now`, `/popular`, `/top-rated`,
  `/collection/:slug` + `rpc_popular_with_friends`, `rpc_library_rollup`,
  `ignored_titles`.

### 4.3 Search (equivalente del ⌘K Palette)
- Pantalla de búsqueda a pantalla completa desde la lupa del top bar:
  input con debounce → tmdb-proxy `/search?q=&lang=es`, resultados → detail.

### 4.4 Detail (destino `detail/{tmdbId}`)
La pantalla más densa; réplica de `DetailSheet.tsx`:
- Hero backdrop + poster (lightbox al tocar), nombre, meta (año, network con
  logo, estado TMDB, géneros).
- Acciones: Add/Remove (follow), Not interested (ignore), Notify me,
  Stop/Resume, All watched (`rpc_mark_series` con confirmación).
- Ratings: el tuyo (estrellas interactivas 1–10, upsert en `ratings`), nota
  TMDB, popover de ratings de amigos.
- Overview (expandible), cast rail (→ PersonScreen).
- Tabs de temporada (lazy load por temporada) + lista de episodios: marcar
  uno, desmarcar, "mark up to here" (`rpc_mark_up_to`, con confirmación si
  salta muchos) y undo.
- Season recomendada / progreso: `rpc_title_detail_progress`.
- Datos: tmdb-proxy `/title/:id`, `/title/:id/season/:n`, `/title/:id/credits`
  (cache-first vía PostgREST `titles`/`seasons`, ver §5.4), `watch_events`
  del título, `rpc_library_rollup` (estado propio), ratings propios y de
  amigos.

### 4.5 Shows (Mis series, desde Tonight o You)
- Grid de biblioteca con filtro por bucket (watching / caughtup / watchlist /
  upcoming / finished / stopped / all, con contadores) y sort
  (lastwatched / lastreleased / az / rating).
- El bucket se deriva client-side: portar `domain/status.ts`
  (`deriveStatus`, `watchProgress`) — regla central, con tests.
- Datos: `rpc_library_rollup` decorado (equivalente de `lib/library.ts:decorate`).

### 4.6 Calendar (tab 3)
- Tabs **shows | returning | new**:
  - *shows*: feed cronológico de episodios de shows seguidos, agrupado por
    día con clustering mismo-show-mismo-día, ancla de scroll en "Today",
    carga perezosa hacia atrás (3 → hasta 60 semanas al hacer scroll), grupos
    colapsables con "mark up to here", undo tras marcar en batch.
  - *returning / new*: premieres de la biblioteca en buckets This month /
    Later / Announced, con toggle "Notify me".
- Portar `domain/calendar.ts` (`dayOffset` DST-safe, `groupFeed`, `dayLabel`,
  `episodeBadge`, `clusterFeed`) con tests.
- Datos: `rpc_calendar_feed(p_from,p_to)`, `rpc_library_rollup`,
  mutaciones mark/notify.

### 4.7 History
- Feed infinito de episodios vistos agrupado por día local, hora exacta por
  fila. Paginación keyset (60/página) con `rpc_watch_history(p_limit,
  p_before, p_before_id)`. Portar `domain/history.ts` (`groupHistory`,
  `historyDayLabel`).

### 4.8 Friends (tab 4) y subpantallas
- **FriendsScreen**: teasers de Taste y Stats, sección de amigos (añadir por
  handle → `rpc_find_profile`; solicitudes entrantes/salientes →
  insert/update/delete en `friendships`; lista con "watching now" →
  `rpc_my_friendships`), actividad de amigos, "Best rated by friends"
  (`rpc_best_rated_by_friends`, paginado), card de invitaciones (§4.10).
- **FriendScreen** (`friend/{id}`): perfil de amigo con secciones
  overview / shows / activity / ratings; filtros (all/both/not) y sorts
  (their/critic/air); affinity, co-rated, taste profile; heatmap del amigo.
  Datos: `rpc_friend_snapshot`, `rpc_friend_progress`, `watch_events` y
  `ratings` del amigo (RLS friend-read lo permite), `rpc_watch_heatmap` con
  `p_user`.
- **PersonScreen** (`person/{id}`): créditos TV de un actor (tmdb-proxy
  `/person/:id`) anotados con tu estado/rating; bio en diálogo.
- **StatsScreen**: Recommended by friends / Your scores vs theirs / Worst
  watched together — derivado de ratings de amigos + propios + biblioteca.
- **TasteScreen**: ranking de afinidad con anillo de porcentaje, "Where you
  clash", "Where you agree". Portar **`tasteAffinity`** de `lib/taste.ts`
  (afinidad ajustada por confianza `n/(n+4)`) con tests.

### 4.9 You
- Header de perfil, atajos a Shows e History, grid de stats
  (`rpc_user_stats`), taste profile (géneros/networks derivados de la
  biblioteca), **WatchHeatmap** (grid tipo GitHub, `rpc_watch_heatmap` con
  timezone del dispositivo), ratings propios paginados (15/página, sort
  new/old/best/worst).
- Entrada a Settings (§4.12) y sign out.

### 4.10 Invites
- Card en Friends/You: crear código (`rpc_create_invite`), listar
  (`rpc_my_invites`), compartir link vía share sheet de Android.

### 4.11 Notifications
- Panel desde la campana: lista de `notifications` (select), marcar leídas
  (update). **Realtime**: suscripción al canal de `postgres_changes` INSERT
  en `public.notifications` filtrado por `user_id` (único uso de realtime-kt)
  con badge en la campana. Preferencias por tipo (new_episode, premiere,
  friend_request) sobre `notification_prefs` (inapp on / email off por
  defecto), dentro de Settings.

### 4.12 Settings
- La web tiene theme/accent/density/language. Con Material You, reducir a:
  idioma (en/es/sistema), tema (sistema/claro/oscuro) y preferencias de
  notificaciones. No portar accent/density (los cubre dynamic color) — anotar
  como exclusión de paridad justificada.

### 4.13 Import / Export
- **Import** (TV Time): selector de archivo zip (SAF) → upload a Storage
  `imports/<uid>/<jobId>.zip` → insert en `import_jobs` →
  `functions.invoke("importer", {job_id, path})`. Polling del job cada 2s
  mientras pending/running, con reintento si se atasca (backstop de stall de
  la web). Mostrar reporte final (matched / episodes marked / unmatched).
- **Export**: GET a la edge function `export` con Bearer del usuario →
  guardar `reel-export.zip` en Descargas (MediaStore) y ofrecer share.

### 4.14 Exclusiones de paridad (justificadas)
- `landing/` (marketing web) y `kit/` (style guide): no aplican a la app.
- Login con password: solo-dev en la web.
- Accent/density de settings: sustituidos por Material You.
- Todo lo demás de la web debe quedar implementado o listado aquí con motivo.

## 5. Capa de datos: contratos exactos

### 5.1 RPCs (postgrest-kt `rpc(...)`)
Portar cada schema Zod a data class `@Serializable`; los schemas cliente están
en `app/src/lib/*.ts` (referencia por archivo en el inventario). Firmas SQL en
`supabase/migrations/` (números indicados):

| RPC | Args | Retorno (resumen) |
|---|---|---|
| `is_invited` | `{uid}` | boolean |
| `redeem_invite` | `{p_code}` | void (crea amistades si multi-uso) |
| `handle_available` | `{p_handle}` | boolean |
| `rpc_library_rollup` | — | filas de biblioteca con aired/watched counts, next_air, upcoming season (0028) |
| `rpc_up_next` | — | shows iniciados + próximo episodio, con backdrop_path (0049) |
| `rpc_calendar_feed` | `{p_from,p_to}` ISO | episodios en rango con is_premiere/is_finale/watch_event_id |
| `rpc_watch_history` | `{p_limit,p_before,p_before_id}` | página keyset de vistos |
| `rpc_user_stats` | — | episodes/minutes/shows/coming_soon/avg_rating/friends |
| `rpc_watch_heatmap` | `{days,tz[,p_user]}` | `(day,n)` por día (0047/0048) |
| `rpc_mark_up_to` | `{p_episode_id}` | uuid[] marcados |
| `rpc_mark_series` | `{p_title_id}` | uuid[] marcados |
| `rpc_title_detail_progress` | `{p_title_id}` | jsonb `{recommended_season, unseen_before, unwatched_aired}` |
| `rpc_my_friendships` | — | amigos + requests + watching now |
| `rpc_find_profile` | `{p_handle}` | perfil público |
| `rpc_friend_snapshot` | `{p_friend}` | jsonb `{profile, stats, watching[]}` |
| `rpc_friend_progress` | `{p_friend}` | `(tmdb_id, watched, aired, last_watched_at)` |
| `rpc_popular_with_friends` | — | jsonb |
| `rpc_best_rated_by_friends` | — | jsonb |
| `rpc_friend_activity` | `{p_limit}` | jsonb |
| `rpc_my_invites` / `rpc_create_invite` | — | códigos propios / void |

### 5.2 Tablas (postgrest-kt `from(...)`)
- `profiles`: select propio; update en onboarding.
- `library_entries`: upsert/update (follow, favorite, notify, stopped).
- `watch_events`: insert/delete (mark/unmark); select por título y por amigo.
- `ratings`: upsert/select (score 1–10, por title_id).
- `friendships`: insert (pending) / update (accept) / delete; PK(a,b) con a<b.
- `ignored_titles`: select/upsert/delete.
- `notifications` / `notification_prefs`: ver §4.11.
- `import_jobs`: insert/select (polling).
- `collections` (+ tiles) y `network_logos`: select.
- `titles` (`*, seasons(*)`) y `seasons` (`*, episodes(*)`): solo para el
  cache-first de detalle (§5.4).

RLS a tener en cuenta: los datos de amigos (watch_events/ratings/library) son
legibles por amistad aceptada — **filtrar siempre por `user_id` explícito** en
las queries, como hace la web.

### 5.3 Storage / Edge functions / Realtime
- Storage: `avatars/<uid>/avatar.png` (público, upsert, PNG 256px);
  `imports/<uid>/<jobId>.zip` (privado, zip ≤25MB).
- `functions.invoke("importer", {job_id, path})`.
- **`tmdb-proxy`** y **`export`** se llaman con **fetch/Ktor directo** a
  `<SUPABASE_URL>/functions/v1/<fn>` con headers `Authorization: Bearer
  <access_token>` y `apikey: <anon>` (así lo hace la web). Rutas del proxy:
  `/search`, `/trending`, `/popular-now`, `/popular`, `/top-rated`,
  `/collection/:slug`, `/title/:id`, `/title/:id/season/:n`,
  `/title/:id/credits`, `/person/:id`. La API key de TMDB NUNCA va en el
  cliente.
- Imágenes: `https://image.tmdb.org/t/p/<size><path>` con Coil (tamaños
  w92/w185/w342/w780/w1280/original según superficie).
- Realtime: un solo canal (notifications INSERT por user_id).

### 5.4 Estrategia de cache
- Réplica ligera del patrón TanStack de la web: repositorios con
  `StateFlow`/in-memory cache por clave (espejo de `lib/queryKeys.ts`),
  invalidación tras mutaciones y optimistic updates con rollback.
- Detalle cache-first: intentar `titles`/`seasons` vía PostgREST y caer al
  proxy si falta o está stale (como `lib/tmdb.ts`).
- No usar Room en esta fase (la web no tiene offline); dejarlo anotado como
  mejora futura.

### 5.5 Lógica de dominio a portar con tests
De `app/src/domain/` (todo puro; los `.test.ts` existentes definen los casos —
portarlos a JUnit):
- `status.ts` → `deriveStatus`, `watchProgress`.
- `tonight.ts` → `activityMs`, `orderByActivity`, `recentlyAired`,
  `soonPremieres`, ventanas 5d/60d.
- `calendar.ts` → `dayOffset` (DST-safe), `groupFeed`, `dayLabel`,
  `episodeBadge`, `clusterFeed`.
- `history.ts` → `groupHistory`, `historyDayLabel`.
- `time.ts` → `relativeTime` (es/en).
- `lib/taste.ts` → `tasteAffinity` (confianza `n/(n+4)`).
- `lib/stats.ts` → `timeSpentLabel`.
- (`airedCount.ts` y `rateLimit.ts` son server-side; no se portan.)

## 6. Orden de ejecución (fases)

Cada fase termina con `assembleDebug` + `testDebugUnitTest` en verde y un
commit. Las fases 4–7 son paralelizables entre agentes por feature una vez
cerrada la Fase 3 (los repositorios son el contrato).

- **F0 — Entorno** (§1): SDK headless, imprimir SHA-1 debug para [BLOQUEO-1].
- **F1 — Scaffold**: proyecto Gradle (version catalog), Hilt, tema M3 con
  dynamic color + fallback, Navigation Compose con bottom bar (4 tabs vacíos),
  BuildConfig con secretos de `local.properties`, cliente supabase-kt
  singleton, i18n base (strings en/es).
- **F2 — Auth completa** (§3): guards, Login OTP (+código 6 dígitos), deep
  link de callback, Invite, Welcome (avatar crop + upload), sesión
  persistente. *Google puede quedar detrás de flag hasta [BLOQUEO-1].*
- **F3 — Capa de datos** (§5): data classes de TODOS los contratos con tests
  de serialización sobre fixtures JSON reales (capturarlos llamando a los RPCs
  con un usuario de prueba, o desde los tipos Zod), repositorios con cache +
  optimistic, cliente tmdb-proxy, dominio portado con tests (§5.5).
- **F4 — Tonight + Detail + Search**: §4.1, §4.3, §4.4. Al cierre: se puede
  buscar, seguir, ver detalle y marcar episodios.
- **F5 — Shows + Calendar + History**: §4.5, §4.6, §4.7.
- **F6 — Social + You**: §4.8, §4.9, §4.10, §4.11, §4.12 (Explore §4.2 puede
  ir aquí o en F4 según carga).
- **F7 — Import/Export**: §4.13.
- **F8 — Release**: keystore release, `bundleRelease` (.aab) + APK firmado,
  versionCode/versionName, iconos adaptativos + splash, revisar permisos del
  manifest (INTERNET, POST_NOTIFICATIONS no hace falta aún — las
  notificaciones son in-app), política de privacidad (página estática en el
  dominio de la web), checklist Play Console (§0.3), instrucciones de sideload
  para los testers.

Presupuesto orientativo para ~2 días de agente: F0–F3 el día 1 (la capa de
datos es lo más denso y lo que desbloquea el paralelismo), F4–F8 el día 2 con
features en paralelo. Si algo se cae del presupuesto, cae por este orden:
Export → Import → Taste/Stats (páginas derivadas) → Explore avanzado
(filtros/hidden); nunca Auth/Tonight/Detail/Calendar.

## 7. Verificación y definición de "hecho"

- `./gradlew :app:assembleDebug :app:testDebugUnitTest` en verde tras cada fase.
- Tests unitarios obligatorios: dominio portado (§5.5, espejando los `.test.ts`
  de la web), serialización de cada contrato RPC con fixtures reales, y
  reducers de estado con lógica (filtros de Shows, clustering de Calendar,
  afinidad de Taste).
- Paridad se comprueba contra §4: cada pantalla/estado o está implementado o
  está en §4.14 con motivo.
- Entregable final: APK debug + APK release firmado + `.aab` + instrucciones
  de instalación por sideload + checklist de subida a Play Console + lista de
  bloqueos manuales pendientes (§0) con su estado.
