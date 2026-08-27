// Tests del OpenID 2.0 de Steam. Los corre el job `edge` de CI.
//
// Casi todos son de seguridad, y conviene decir por qué: la vuelta de Steam es
// una URL que cualquiera puede escribir a mano en la barra del navegador. Todo
// lo que hay entre "llegó un claimed_id" y "esta cuenta es tuya" está aquí.
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { authUrl, checkReturn, isValid, returnBase, steamIdFrom, verifyBody } from "./openid.ts";

const RETURN_TO = "https://ref.supabase.co/functions/v1/steam-sync/return?n=abc123";
const ME = "https://steamcommunity.com/openid/id/76561198000000001";

const goodParams = (over: Record<string, string> = {}) =>
  new URLSearchParams({
    "openid.mode": "id_res",
    "openid.return_to": RETURN_TO,
    "openid.claimed_id": ME,
    "openid.identity": ME,
    "openid.sig": "firma",
    ...over,
  });

Deno.test("la URL de login pide identifier_select y un realm que contiene al return_to", () => {
  const u = new URL(authUrl(RETURN_TO));
  assertEquals(u.origin + u.pathname, "https://steamcommunity.com/openid/login");
  assertEquals(u.searchParams.get("openid.mode"), "checkid_setup");
  assertEquals(u.searchParams.get("openid.return_to"), RETURN_TO);
  // Steam rechaza la petición si el realm no contiene al return_to, así que se
  // deriva de él en vez de recibirse aparte: no pueden discrepar.
  assertEquals(u.searchParams.get("openid.realm"), "https://ref.supabase.co");
  assertStringIncludes(u.searchParams.get("openid.identity")!, "identifier_select");
});

Deno.test("sin STEAM_RETURN_BASE la vuelta sigue cayendo en la función", () => {
  assertEquals(
    returnBase(undefined, "https://ref.supabase.co"),
    "https://ref.supabase.co/functions/v1/steam-sync",
  );
});

Deno.test("con STEAM_RETURN_BASE el realm que ve la persona es el de la app", () => {
  // Lo que se comprueba de verdad: el origen del return_to, que es lo que Steam
  // enseña en su pantalla. Que ponga "reel-app.com" y no el ref de Supabase es
  // el motivo entero de que este secreto exista.
  const base = returnBase("https://reel-app.com/api/steam", "https://ref.supabase.co");
  const u = new URL(authUrl(`${base}/return?n=abc123`));
  assertEquals(u.searchParams.get("openid.realm"), "https://reel-app.com");
  assertEquals(
    u.searchParams.get("openid.return_to"),
    "https://reel-app.com/api/steam/return?n=abc123",
  );
});

Deno.test("una barra final de más no parte la URL de vuelta en dos", () => {
  // El secreto lo escribe una persona en una consola web: la barra sobra un día
  // de cada tres, y `…/api/steam//return` no casa con la ruta del Worker.
  assertEquals(returnBase("https://reel-app.com/api/steam/", null), "https://reel-app.com/api/steam");
  assertEquals(returnBase("  ", "https://ref.supabase.co/"), "https://ref.supabase.co/functions/v1/steam-sync");
});

Deno.test("el cuerpo de verificación devuelve todo lo de Steam y solo cambia el mode", () => {
  const params = goodParams();
  params.set("n", "abc123"); // el pagaré, que es nuestro y no de Steam
  const body = verifyBody(params);

  assertEquals(body.get("openid.mode"), "check_authentication");
  // La firma cubre el conjunto que Steam mandó: quitar o reordenar campos
  // rompe la comprobación en silencio, y el resultado sería un "no válido"
  // achacado a Steam.
  assertEquals(body.get("openid.sig"), "firma");
  assertEquals(body.get("openid.claimed_id"), ME);
  assertEquals(body.get("n"), null);
});

Deno.test("is_valid se lee por línea, no por subcadena", () => {
  assertEquals(isValid("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"), true);
  // `is_valid:false` CONTIENE "is_valid:", así que un includes ingenuo daría
  // por buena una respuesta que dice justo lo contrario.
  assertEquals(isValid("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n"), false);
  assertEquals(isValid(""), false);
});

Deno.test("el claimed_id tiene que ser de steamcommunity.com", () => {
  assertEquals(steamIdFrom(ME), "76561198000000001");
  // Steam firma que estos parámetros son suyos; no firma que el identificador
  // que contienen sea de su espacio de nombres.
  assertEquals(steamIdFrom("https://evil.example/openid/id/76561198000000001"), null);
  assertEquals(steamIdFrom("https://steamcommunity.com/openid/id/123"), null);
  assertEquals(steamIdFrom("https://steamcommunity.com/profiles/76561198000000001"), null);
  assertEquals(steamIdFrom("no es una url"), null);
  assertEquals(steamIdFrom(null), null);
});

Deno.test("una respuesta a la petición de otro sitio no vale aquí", () => {
  // Firmada por Steam y perfectamente válida... para el return_to de quien la
  // pidió. Reenviarla aquí enlazaría SU cuenta de Steam a la sesión de quien
  // abrió este enlace.
  const ajeno = goodParams({ "openid.return_to": "https://otro.example/callback?n=abc123" });
  assertEquals(checkReturn(ajeno, RETURN_TO), { ok: false, reason: "return_to" });

  // Mismo endpoint, otro pagaré: es la respuesta de otro intento.
  const otroPagare = goodParams({
    "openid.return_to": RETURN_TO.replace("abc123", "zzz999"),
  });
  assertEquals(checkReturn(otroPagare, RETURN_TO), { ok: false, reason: "return_to" });
});

Deno.test("el orden de la query no convierte al return_to en otro", () => {
  // El protocolo no garantiza el orden, así que comparar cadenas daría por
  // distinto lo que es lo mismo — y el login fallaría sin motivo visible.
  const reordenado = "https://ref.supabase.co/functions/v1/steam-sync/return?x=1&n=abc123";
  assertEquals(checkReturn(goodParams({ "openid.return_to": reordenado }), RETURN_TO), {
    ok: true,
    steamId: "76561198000000001",
  });
});

Deno.test("cancelar no es una avería", () => {
  // Le dio a "no" en la pantalla de Steam. La interfaz lo dice y ya está.
  assertEquals(checkReturn(goodParams({ "openid.mode": "cancel" }), RETURN_TO), {
    ok: false,
    reason: "cancelled",
  });
});

Deno.test("la vuelta buena da el SteamID64", () => {
  assertEquals(checkReturn(goodParams(), RETURN_TO), {
    ok: true,
    steamId: "76561198000000001",
  });
});
