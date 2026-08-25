/* El cliente de Coral, que es como se llama por dentro la API de la app
 * Nintendo Switch Online. Aquí vive TODO lo que habla con Nintendo, y está
 * separado de index.ts porque es la única parte de esta rama que no se puede
 * probar sin credenciales: la cuenta de Nintendo de Reel.
 *
 * ── La cadena, y por qué tiene cuatro pasos y no uno ─────────────────────
 *
 *   1. `session_token` → token de la Cuenta Nintendo. El session_token es el
 *      secreto del proyecto (NINTENDO_SESSION_TOKEN), dura unos dos años y se
 *      saca UNA vez a mano; lo que caduca cada quince minutos es el `id_token`
 *      que se cambia por él.
 *   2. El `id_token` no basta para entrar en Coral: Nintendo exige además un
 *      parámetro `f`, un HMAC que solo sabe calcular la app de verdad
 *      corriendo en un Android. No se calcula aquí ni se puede: se le pide al
 *      servicio de f (ver más abajo).
 *   3. Con el `f`, `Account/Login` devuelve el token de Coral, que dura dos
 *      horas. Es el que autoriza las dos únicas llamadas que esta rama hace.
 *   4. Y esas dos: resolver el código de amigo, y pedir el registro de juego.
 *
 * ── El servicio de f es un tercero, y hay que decirlo ────────────────────
 * `nxapi-znca-api` corre la app de Nintendo en un Android con Frida y calcula
 * el `f` a partir del `id_token` que se le manda. O sea: ese token sale de
 * nuestra infraestructura. Es el de la cuenta BOT de Reel y no el de nadie del
 * grupo — nadie aquí tiene cuenta de Nintendo enlazada, solo un código de
 * amigo, que es público por definición — pero sigue siendo un tercero con un
 * token nuestro, y está en docs/DEPLOY.md con todas las letras.
 *
 * Su URL y sus credenciales son configurables porque el servicio se puede
 * alojar uno mismo, que es la forma de no depender de nadie el día que haga
 * falta. Ver NINTENDO_F_* en docs/DEPLOY.md.
 *
 * ── La versión de la app no se escribe a mano ────────────────────────────
 * Nintendo rechaza un `f` generado con una versión de la app distinta de la
 * que dice la cabecera `X-ProductVersion`, y la app se actualiza sola cada
 * pocos meses. Fijarla en una constante es programar una avería con fecha: el
 * día que el servicio de f solo tenga la nueva, aquí seguiría pidiendo la
 * vieja y todo devolvería 9403 sin una sola línea de código cambiada.
 *
 * Así que se pregunta: `/config` del servicio de f dice qué versión sirve, y
 * esa misma va en las dos cabeceras. Es una petición más por isolate frío, y
 * está cacheada.
 */

const ZNC = "https://api-lp1.znc.srv.nintendo.net";
const NA_TOKEN = "https://accounts.nintendo.com/connect/1.0.0/api/token";
const NA_USER = "https://api.accounts.nintendo.com/2.0.0/users/me";

/** El client_id de la app Nintendo Switch Online. No es un secreto: es público
 *  y es el mismo para todo el mundo, como el de cualquier app móvil. */
const ZNCA_CLIENT_ID = "71b963c1b7b6d119";

const PLATFORM = "Android";
const PLATFORM_VERSION = "12";

/* Todas las llamadas a terceros con el mismo tope que el resto del directorio:
   uno que acepta la conexión y no contesta dejaría el await colgado hasta que
   la plataforma mate la invocación. */
const TIMEOUT_MS = 15_000;

/** Lo que Nintendo contesta cuando la petición no le vale. `status` es SUYO y
 *  viaja dentro de un 200, así que un `res.ok` no dice nada aquí.
 *
 *  Se conserva el número porque es lo único que distingue "el token ha
 *  caducado" de "esa persona no te enseña su registro", y las dos cosas se
 *  cuentan distinto en la pantalla y en `job_runs`. */
export class CoralError extends Error {
  constructor(readonly status: number, message: string) {
    super(`coral ${status}: ${message}`);
  }
}

export interface CoralConfig {
  /** NINTENDO_SESSION_TOKEN: el de la cuenta bot, sacado una vez a mano. */
  sessionToken: string;
  /** La raíz del servicio de f, sin barra final. */
  fApiUrl: string;
  /** Credenciales de cliente del servicio de f, si las pide. */
  fClientId?: string;
  fClientSecret?: string;
  fTokenUrl?: string;
  /** Lo que este proyecto dice ser ante el servicio de f. Lo exige su README:
   *  un User-Agent con nombre, versión y forma de contactar. */
  userAgent: string;
}

export interface CoralSession {
  token: string;
  /** ms desde epoch. Se renueva antes de tiempo, ver `expiredSoon`. */
  expiresAt: number;
}

/** Un juego del registro. Es literalmente lo que devuelve Nintendo, sin
 *  interpretar: interpretarlo es cosa de merge.ts, que sí tiene pruebas. */
export interface PlayLogGame {
  name: string;
  imageUri: string;
  shopUri: string;
  /** MINUTOS acumulados de por vida. La unidad la confirma nxapi, que pasa
   *  este campo por una función que divide entre 60 para sacar las horas. */
  totalPlayTime: number;
  /** Segundos unix, 0 si nunca. */
  firstPlayedAt: number;
}

const timeout = () => AbortSignal.timeout(TIMEOUT_MS);

/* ─────────────────────────── El servicio de f ───────────────────────────── */

/** La versión de la app que sirve el servicio de f, cacheada en el isolate.
 *
 *  Un isolate frío la pide una vez y sirve con ella todo lo que le llegue
 *  después; uno caliente no la vuelve a pedir. No se guarda en la base a
 *  propósito, por lo mismo que el token de Twitch en igdb-proxy: es un dato
 *  que se puede volver a pedir en una llamada y una fila más es una fila que
 *  puede quedarse rancia sin que nadie mire. */
let zncaVersion: string | null = null;

async function appVersion(cfg: CoralConfig): Promise<string> {
  if (zncaVersion) return zncaVersion;
  const res = await fetch(`${cfg.fApiUrl}/config`, {
    headers: { "User-Agent": cfg.userAgent, "Accept": "application/json" },
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`f-api config ${res.status}`);
  const body = await res.json();
  const version = body?.nso_version;
  if (typeof version !== "string" || !version) throw new Error("f-api config sin nso_version");
  zncaVersion = version;
  return version;
}

/** El bearer del servicio de f, si pide credenciales de cliente.
 *
 *  Cacheado igual que la versión y por la misma razón. Si no hay credenciales
 *  configuradas se devuelve null y se llama sin cabecera: un servicio propio
 *  alojado en casa no tiene por qué pedir nada. */
let fToken: { token: string; expiresAt: number } | null = null;

async function fBearer(cfg: CoralConfig): Promise<string | null> {
  if (!cfg.fClientId || !cfg.fClientSecret) return null;
  if (fToken && fToken.expiresAt > Date.now() + 60_000) return fToken.token;

  const url = cfg.fTokenUrl ?? "https://nxapi-auth.fancy.org.uk/api/oauth/token";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
      "User-Agent": cfg.userAgent,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.fClientId,
      client_secret: cfg.fClientSecret,
      scope: "ca:gf ca:er ca:dr",
    }),
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`f-api auth ${res.status}`);
  const body = await res.json();
  const token = body?.access_token;
  if (typeof token !== "string") throw new Error("f-api auth sin access_token");
  const seconds = Number(body?.expires_in);
  fToken = {
    token,
    expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 3600) * 1000,
  };
  return token;
}

interface FData {
  f: string;
  requestId: string;
  timestamp: number;
}

/** El `f` para entrar en Coral.
 *
 *  `timestamp` y `request_id` NO se mandan: desde que Nintendo empezó a
 *  validarlos (agosto de 2022) tienen que salir de la misma generación que el
 *  `f`, y el servicio los devuelve precisamente porque no se le mandan.
 *  Fabricarlos aquí y esperar que casen es la avería que rompió a todos los
 *  clientes de entonces. */
async function genf(cfg: CoralConfig, idToken: string, naId: string): Promise<FData> {
  const version = await appVersion(cfg);
  const bearer = await fBearer(cfg);

  const res = await fetch(`${cfg.fApiUrl}/f`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": cfg.userAgent,
      "X-znca-Platform": PLATFORM,
      "X-znca-Version": version,
      ...(bearer ? { "Authorization": `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ hash_method: "1", token: idToken, na_id: naId }),
    // Más generoso que el resto: dentro hay un móvil Android de verdad
    // arrancando la app de Nintendo, y la primera petición tras un rato
    // parado paga ese arranque entero.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`f-api ${res.status}`);
  const body = await res.json();
  if (typeof body?.f !== "string" || !body.f) throw new Error("f-api sin f");
  return {
    f: body.f,
    requestId: String(body.request_id ?? ""),
    timestamp: Number(body.timestamp ?? 0),
  };
}

/* ─────────────────────────── La cadena de login ─────────────────────────── */

/** Paso 1: el session_token de la cuenta bot por un token de la Cuenta
 *  Nintendo. Lo que sirve de aquí es el `id_token`, que dura quince minutos y
 *  es lo que se le manda al servicio de f. */
async function nintendoAccountToken(sessionToken: string) {
  const res = await fetch(NA_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Dalvik/2.1.0 (Linux; U; Android 8.0.0)",
    },
    body: JSON.stringify({
      client_id: ZNCA_CLIENT_ID,
      session_token: sessionToken,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token",
    }),
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`na token ${res.status}`);
  const body = await res.json();
  if (typeof body?.id_token !== "string") throw new Error("na token sin id_token");
  return { idToken: body.id_token as string, accessToken: body.access_token as string };
}

/** Paso 1b: quién es la cuenta bot. Hacen falta tres cosas suyas —id, fecha de
 *  nacimiento y país— porque `Account/Login` las exige, y una `birthday` que no
 *  case con la del token es un 9403 sin explicación. */
async function nintendoAccountUser(accessToken: string) {
  const res = await fetch(NA_USER, {
    headers: {
      "Accept-Language": "en-GB",
      "User-Agent": "NASDKAPI; Android",
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`na user ${res.status}`);
  const body = await res.json();
  if (typeof body?.id !== "string") throw new Error("na user sin id");
  return {
    id: body.id as string,
    birthday: String(body.birthday ?? ""),
    country: String(body.country ?? ""),
    language: String(body.language ?? "en-GB"),
  };
}

/** Paso 2 y 3: el token de Coral, el que autoriza todo lo demás. */
export async function login(cfg: CoralConfig): Promise<CoralSession> {
  const version = await appVersion(cfg);
  const { idToken, accessToken } = await nintendoAccountToken(cfg.sessionToken);
  const user = await nintendoAccountUser(accessToken);
  const f = await genf(cfg, idToken, user.id);

  const res = await fetch(`${ZNC}/v4/Account/Login`, {
    method: "POST",
    headers: {
      "X-Platform": PLATFORM,
      "X-ProductVersion": version,
      "Content-Type": "application/json; charset=utf-8",
      "Accept": "application/json",
      "User-Agent": `com.nintendo.znca/${version}(${PLATFORM}/${PLATFORM_VERSION})`,
    },
    body: JSON.stringify({
      parameter: {
        naIdToken: idToken,
        naBirthday: user.birthday,
        naCountry: user.country,
        language: user.language,
        timestamp: f.timestamp,
        requestId: f.requestId,
        f: f.f,
      },
    }),
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`coral login http ${res.status}`);
  const body = await res.json();
  // El 200 con `status` distinto de 0: el error de verdad de esta API.
  if (body?.status !== 0) {
    throw new CoralError(Number(body?.status ?? -1), String(body?.errorMessage ?? "login"));
  }
  const credential = body?.result?.webApiServerCredential;
  const token = credential?.accessToken;
  if (typeof token !== "string") throw new Error("coral login sin accessToken");
  const seconds = Number(credential?.expiresIn);
  return {
    token,
    expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 7200) * 1000,
  };
}

/* ─────────────────────────── Las dos llamadas ───────────────────────────── */

async function call<T>(session: CoralSession, path: string, parameter: unknown): Promise<T> {
  const version = zncaVersion ?? "0.0.0";
  const res = await fetch(`${ZNC}${path}`, {
    method: "POST",
    headers: {
      "X-Platform": PLATFORM,
      "X-ProductVersion": version,
      "Content-Type": "application/json; charset=utf-8",
      "Accept": "application/json",
      "User-Agent": `com.nintendo.znca/${version}(${PLATFORM}/${PLATFORM_VERSION})`,
      "Authorization": `Bearer ${session.token}`,
    },
    body: JSON.stringify({ parameter }),
    signal: timeout(),
  });
  if (!res.ok) throw new Error(`coral ${path} http ${res.status}`);
  const body = await res.json();
  if (body?.status !== 0) {
    throw new CoralError(Number(body?.status ?? -1), String(body?.errorMessage ?? path));
  }
  return body.result as T;
}

/** El código de amigo a NSA ID, que es con lo que se pregunta todo lo demás.
 *
 *  Esta llamada la limita Nintendo, y por eso su resultado se guarda en
 *  `profiles.nintendo_nsa_id` (0080): sincronizar no vuelve a gastarla. */
export async function userByFriendCode(
  session: CoralSession,
  friendCode: string,
): Promise<{ nsaId: string; name: string }> {
  const result = await call<{ nsaId?: string; name?: string }>(
    session,
    "/v3/Friend/GetUserByFriendCode",
    { friendCode },
  );
  if (!result?.nsaId) throw new CoralError(0, "friend code sin nsaId");
  return { nsaId: result.nsaId, name: String(result.name ?? "") };
}

/** El registro de juego de una persona.
 *
 *  Solo contesta si esa persona tiene la privacidad del registro en "Todos".
 *  Cuando no, Nintendo devuelve un `status` propio —no un 403— y por eso el
 *  error se propaga con su número: es lo que deja a index.ts decir "arregla la
 *  privacidad" en vez de "ha fallado algo". */
export function playLog(session: CoralSession, nsaId: string): Promise<PlayLogGame[]> {
  return call<PlayLogGame[]>(session, "/v4/User/PlayLog/Show", { nsaId });
}
