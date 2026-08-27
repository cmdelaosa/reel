/* La vuelta de Steam, servida por nuestro dominio en vez de por Supabase.
 *
 * ── Por qué existe esta ruta ─────────────────────────────────────────────
 * Steam no tiene OAuth: tiene OpenID 2.0, y la pantalla de "Sign in to …" que
 * le enseña a la persona muestra el `openid.realm`, que Steam exige que
 * contenga al `openid.return_to`. Mientras la vuelta aterrizaba directamente en
 * la edge function, ese realm era el host del proyecto de Supabase, y la
 * pantalla decía "vas a identificarte ante kjdn….supabase.co" — un dominio que
 * quien usa Reel no ha visto nunca, en la única pantalla donde lo que se juzga
 * es precisamente si el sitio es de fiar.
 *
 * Con este proxy la vuelta aterriza en `/api/steam/return` de nuestro propio
 * dominio, así que el realm es el de Reel. Lo que hay detrás no cambia: esto
 * reenvía la petición a `steam-sync/return` tal cual y devuelve su respuesta.
 *
 * ── Lo que NO puede hacer ────────────────────────────────────────────────
 * Tocar la query. La firma de Steam cubre el conjunto de parámetros `openid.*`
 * que mandó, así que reordenarlos, filtrarlos o re-codificarlos rompe la
 * comprobación en la función — y el síntoma no sería un error de firma sino un
 * enlace que "no funciona". Por eso se reenvía `url.search` como cadena y no un
 * URLSearchParams reconstruido.
 *
 * Y seguir la redirección: la respuesta de `/return` es un 302 a la app, y es
 * el navegador quien tiene que verlo. De ahí `redirect: "manual"`.
 *
 * ── Por qué solo /return y solo GET ──────────────────────────────────────
 * Es la única ruta de steam-sync que necesita vivir en nuestro dominio, y la
 * única que no lleva sesión: el resto las llama el propio front con su JWT
 * contra el host de Supabase (ver lib/steam.ts). Un proxy genérico
 * `/api/steam/*` reenviaría también cabeceras `Authorization` a otro origen sin
 * que nadie lo pidiera; esto no reenvía ninguna cabecera de quien llama, porque
 * la vuelta de Steam es una navegación y no lleva nada que valga.
 *
 * ── Y por qué esto no está en index.ts ───────────────────────────────────
 * Porque el punto de entrada de un Worker solo puede exportar manejadores: un
 * `export const` cualquiera ahí lo rechaza el runtime al arrancar, con
 * «Incorrect type for map entry … not of type 'function or ExportedHandler'».
 * Un `vitest` verde no lo ve; `wrangler dev` no levanta.
 */

/** Lo que Cloudflare inyecta. `SUPABASE_URL` se declara en `wrangler.jsonc` y
 *  NO en los secretos de la consola: puesto allí, el primer despliegue de
 *  Workers Builds lo dejó fuera y esta ruta empezó a contestar 500 sin que nada
 *  avisara (27-ago-2026). Tampoco vale la `VITE_SUPABASE_URL` del build: Vite
 *  la incrusta en el bundle del navegador, no en el Worker. */
export interface Env {
  SUPABASE_URL?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** La ruta nuestra donde aterriza Steam. Es la mitad de un pacto: la otra es
 *  `STEAM_RETURN_BASE` en los secretos de la edge function, que tiene que valer
 *  `https://<dominio>/api/steam`. Si discrepan, la función rechaza la vuelta
 *  por `return_to` y el enlace acaba en `steam=invalid`. */
export const RETURN_PATH = "/api/steam/return";

const FUNCTION_PATH = "/functions/v1/steam-sync/return";

export async function steamReturn(request: Request, env: Env): Promise<Response> {
  /* Solo GET, y el HEAD queda fuera a propósito. La vuelta de Steam es una
     navegación, así que nada legítimo llega aquí de otra forma — y el pagaré es
     de un solo uso: la función pregunta a Steam y lo quema, así que un HEAD de
     un rastreador de enlaces dejaría a la persona aterrizando en
     `steam=expired` sin nada que lo explicara. Reenviarlo como HEAD no arregla
     eso: la ruta de la función no mira el método. */
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  const base = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!base) {
    // Sin esto no hay a dónde reenviar, y adivinarlo no es una opción. Se dice
    // en claro porque el síntoma en el navegador —volver de Steam a una página
    // de error— no se parece en nada a "falta una variable".
    return new Response("SUPABASE_URL not configured", { status: 500 });
  }

  const search = new URL(request.url).search;
  const upstream = await fetch(`${base}${FUNCTION_PATH}${search}`, {
    method: "GET",
    redirect: "manual",
  });

  /* Se reconstruye la respuesta en vez de devolver la de arriba tal cual para
     poder añadir el `no-store`: lo que viaja aquí es un pagaré de un solo uso en
     la query, y no tiene por qué quedarse en ninguna caché intermedia. */
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers });
}
