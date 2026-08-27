import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "@/worker/index";
import { RETURN_PATH, type Env } from "@/worker/steamReturn";

/* La matriz del proxy de la vuelta de Steam.
 *
 * Lo que se juzga aquí no es "reenvía": es que reenvía SIN TOCAR NADA. La firma
 * de Steam cubre el conjunto de parámetros `openid.*` que mandó, así que un
 * proxy que los reordene o los re-codifique rompe el enlace con un fallo que en
 * pantalla se lee como "no funciona" y en los registros como una firma
 * inválida. Y que no siga el 302: si lo siguiera, la persona se quedaría
 * mirando la respuesta de la app en vez de aterrizar en ella. */

const SUPABASE = "https://ref.supabase.co";

/* La query de una vuelta real: parámetros con dos puntos y barras dentro, en un
   orden que es el que Steam firmó y no el alfabético, y con un escape en
   minúsculas (`%3a`) y un espacio como `%20`.
   Esos dos últimos son el detector: sobreviven a copiar la cadena y NO
   sobreviven a reconstruirla con URLSearchParams, que las devuelve como `%3A` y
   `+`. Sin ellos, "reenvía la query" y "reenvía la query intacta" se pintan
   iguales en verde. */
const QUERY =
  "?n=abc123&openid.mode=id_res&openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198000000001" +
  "&openid.sig=firma%20con%20espacio%3D&openid.ns=http%3a%2f%2fspecs.openid.net%2fauth%2f2.0";

const env = (over: Partial<Env> = {}): Env => ({
  SUPABASE_URL: SUPABASE,
  ASSETS: { fetch: () => Promise.resolve(new Response("la app", { status: 200 })) },
  ...over,
});

/** Un upstream que apunta lo que le llega y contesta como `/return`: un 302. */
function upstream(response = Response.redirect("https://reel-app.com/games/steam?steam=confirm", 302)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response);
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("la vuelta de Steam", () => {
  it("llega a la función con la query intacta, carácter a carácter", async () => {
    const calls = upstream();
    await worker.fetch(new Request(`https://reel-app.com${RETURN_PATH}${QUERY}`), env());

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(`${SUPABASE}/functions/v1/steam-sync/return${QUERY}`);
    // Y sin seguir el 302 de la función: el que tiene que verlo es el navegador.
    expect(calls[0].init?.redirect).toBe("manual");
  });

  it("no sigue la redirección: el 302 es para el navegador", async () => {
    upstream();
    const res = await worker.fetch(new Request(`https://reel-app.com${RETURN_PATH}${QUERY}`), env());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://reel-app.com/games/steam?steam=confirm");
    // El pagaré viaja en la query; que no se quede en ninguna caché.
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("una barra final de más en SUPABASE_URL no parte la URL en dos", async () => {
    const calls = upstream();
    await worker.fetch(
      new Request(`https://reel-app.com${RETURN_PATH}${QUERY}`),
      env({ SUPABASE_URL: `${SUPABASE}/` }),
    );

    expect(calls[0].url).toBe(`${SUPABASE}/functions/v1/steam-sync/return${QUERY}`);
  });

  it("sin SUPABASE_URL responde 500 y no inventa a dónde reenviar", async () => {
    const calls = upstream();
    const res = await worker.fetch(
      new Request(`https://reel-app.com${RETURN_PATH}${QUERY}`),
      env({ SUPABASE_URL: undefined }),
    );

    expect(res.status).toBe(500);
    expect(calls.length).toBe(0);
  });

  it("un POST a la ruta no se reenvía", async () => {
    const calls = upstream();
    const res = await worker.fetch(
      new Request(`https://reel-app.com${RETURN_PATH}`, { method: "POST" }),
      env(),
    );

    expect(res.status).toBe(405);
    expect(calls.length).toBe(0);
  });
});

describe("todo lo demás", () => {
  /* El Worker está delante de los ficheros estáticos: cualquier ruta que no sea
     la vuelta de Steam tiene que acabar en el binding de assets, o la app deja
     de servirse. */
  it("va a los ficheros de la app, no a Supabase", async () => {
    const calls = upstream();
    for (const path of ["/", "/games/steam", "/assets/index-abc.js", "/api/steam/otra"]) {
      const res = await worker.fetch(new Request(`https://reel-app.com${path}`), env());
      expect(await res.text()).toBe("la app");
    }
    expect(calls.length).toBe(0);
  });
});
