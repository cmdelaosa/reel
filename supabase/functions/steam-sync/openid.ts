/* OpenID 2.0 de Steam — la parte que se puede probar sin red.
 *
 * Steam no tiene OAuth. Tiene OpenID 2.0, un protocolo de 2007 que Valve
 * mantiene vivo y que sigue siendo la única forma de que alguien te demuestre
 * que una cuenta de Steam es suya. Lo que devuelve es un SteamID64 y nada más:
 * ni nombre, ni correo, ni permisos. Para lo que hace falta aquí —pedirle su
 * biblioteca a la Web API— es exactamente lo que se necesita.
 *
 * ── La regla de oro: el parámetro que llega NO es la respuesta ────────────
 * La vuelta de Steam es una navegación del navegador a una URL nuestra con
 * `openid.claimed_id=…/id/76561198…` en la query. Leer ese número y creérselo
 * es el fallo clásico de OpenID 2.0: cualquiera puede escribir esa URL a mano
 * y quedarse con la cuenta de Steam de otro. La firma que acompaña a los
 * parámetros solo la puede comprobar Steam, y se le pregunta devolviéndole
 * TODOS los parámetros con `openid.mode` cambiado a `check_authentication`
 * (verifyBody). Hasta que su respuesta diga `is_valid:true`, lo que llegó es
 * una afirmación de un desconocido.
 *
 * Y hay dos comprobaciones más que la firma no cubre, porque van sobre lo que
 * pedimos y no sobre lo que contestaron:
 *   · el `openid.return_to` que vuelve tiene que ser el nuestro — si no, es una
 *     respuesta válida de Steam a la petición de OTRO sitio, reenviada aquí;
 *   · el `claimed_id` tiene que colgar de steamcommunity.com, o el "identity
 *     provider" es cualquiera.
 */

export const STEAM_OPENID = "https://steamcommunity.com/openid/login";

const NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";

/** La URL a la que se manda a la persona para que se identifique.
 *
 *  `identifier_select` en identity y claimed_id es "no sé quién eres, dímelo
 *  tú": es lo que convierte esto en un botón de login en vez de en una
 *  comprobación de una identidad concreta.
 *
 *  El `realm` es lo que Steam le enseña a la persona ("vas a identificarte
 *  ante ESTO"), y tiene que contener a `return_to` o Steam rechaza la
 *  petición. Se deriva del propio return_to en vez de recibirlo aparte para
 *  que no puedan discrepar. */
export function authUrl(returnTo: string): string {
  const realm = new URL(returnTo).origin;
  const p = new URLSearchParams({
    "openid.ns": NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo,
    "openid.realm": realm,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_OPENID}?${p}`;
}

/** El cuerpo con el que se le pregunta a Steam si esos parámetros son suyos.
 *
 *  Van TODOS los `openid.*` que llegaron, tal cual, con `mode` cambiado. Filtrar
 *  o reordenar rompe la comprobación: la firma cubre el conjunto que Steam
 *  mandó, no el que a nosotros nos interese. Lo que no empieza por `openid.`
 *  se queda fuera porque es nuestro (el pagaré), no de Steam. */
export function verifyBody(params: URLSearchParams): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of params) {
    if (k.startsWith("openid.")) body.append(k, v);
  }
  body.set("openid.mode", "check_authentication");
  return body;
}

/** ¿Dijo Steam que sí?
 *
 *  La respuesta es key-value line format, no JSON: líneas `clave:valor`. Se
 *  busca la línea exacta y no una subcadena — `is_valid:false` contiene
 *  "is_valid:" y un `includes` ingenuo lo daría por bueno. */
export function isValid(responseText: string): boolean {
  return responseText
    .split("\n")
    .map((l) => l.trim())
    .includes("is_valid:true");
}

/** El SteamID64 de un claimed_id, o null si eso no es un claimed_id de Steam.
 *
 *  Se comprueba el host además del formato: la firma de Steam demuestra que
 *  Steam firmó estos parámetros, no que el identificador que contienen sea de
 *  su espacio de nombres. */
export function steamIdFrom(claimedId: string | null | undefined): string | null {
  if (!claimedId) return null;
  let url: URL;
  try {
    url = new URL(claimedId);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname !== "steamcommunity.com") return null;
  const m = url.pathname.match(/^\/openid\/id\/(\d{17})$/);
  return m ? m[1] : null;
}

/** Todo lo que hay que comprobar del lado de acá, junto: que la respuesta
 *  vuelva de una petición nuestra y traiga una identidad de Steam.
 *
 *  `is_valid` se pasa aparte porque exige un viaje a Steam y esto es puro. */
export function checkReturn(
  params: URLSearchParams,
  expectedReturnTo: string,
): { ok: true; steamId: string } | { ok: false; reason: string } {
  if (params.get("openid.mode") !== "id_res") {
    // 'cancel' es que le dio a "no" en Steam, y no es una avería.
    return { ok: false, reason: params.get("openid.mode") === "cancel" ? "cancelled" : "mode" };
  }
  /* Comparar por URL y no por texto: Steam devuelve el return_to que le dimos,
     pero el orden de la query no está garantizado por el protocolo y una
     comparación de cadenas lo daría por distinto. Lo que importa es que sea la
     misma ruta del mismo origen y con el mismo pagaré. */
  const got = params.get("openid.return_to");
  if (!got || !sameEndpoint(got, expectedReturnTo)) return { ok: false, reason: "return_to" };

  const steamId = steamIdFrom(params.get("openid.claimed_id"));
  if (!steamId) return { ok: false, reason: "claimed_id" };
  return { ok: true, steamId };
}

function sameEndpoint(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin &&
      ua.pathname === ub.pathname &&
      ua.searchParams.get("n") === ub.searchParams.get("n");
  } catch {
    return false;
  }
}
