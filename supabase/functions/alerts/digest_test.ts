import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Alertable, digestHtml, digestText, emailSubject } from "./digest.ts";

const ep = (title: string, detail = "S1 · E1"): Alertable => ({
  user_id: "u", episode_id: "e", event: "episode", type: "new_episode", title, detail, payload: {},
});
const movie = (title: string, detail = "in theatres today", event = "theatrical"): Alertable => ({
  user_id: "u", episode_id: "e", event, type: "movie_release", title, detail, payload: {},
});

Deno.test("asunto: solo episodios, con su plural", () => {
  assertEquals(emailSubject([ep("A")]), "1 new episode from your shows");
  assertEquals(emailSubject([ep("A"), ep("B")]), "2 new episodes from your shows");
});

Deno.test("asunto: solo cine, sin llamarlo episodio", () => {
  assertEquals(emailSubject([movie("A")]), "1 movie you follow out today");
  assertEquals(emailSubject([movie("A"), movie("B")]), "2 movies you follow out today");
});

Deno.test("asunto: mezclado, sin nombrar uno de los dos", () => {
  // Nombrar cualquiera de los dos sería mentir sobre el otro.
  assertEquals(emailSubject([ep("A"), movie("B")]), "2 new things from your list");
});

Deno.test("el cuerpo separa las dos listas bajo su encabezado", () => {
  const text = digestText([ep("Severance", "S2 · E1"), movie("Dune")]);
  assertStringIncludes(text, "New episodes from shows you follow:");
  assertStringIncludes(text, "Releases from movies you follow:");
  assertStringIncludes(text, "• Severance — S2 · E1");
  assertStringIncludes(text, "• Dune — in theatres today");
});

Deno.test("un solo tipo no imprime el encabezado del otro", () => {
  const text = digestText([movie("Dune")]);
  assertEquals(text.includes("New episodes from shows you follow:"), false);
});

Deno.test("las dos fechas de una misma película caben en el mismo correo", () => {
  // Es lo que 0072 existe para permitir: dos avisos, un episodio sintético.
  const text = digestText([
    movie("Dune", "in theatres today", "theatrical"),
    movie("Dune", "streaming today", "digital"),
  ]);
  assertStringIncludes(text, "in theatres today");
  assertStringIncludes(text, "streaming today");
});

Deno.test("el título va destacado y el detalle detrás", () => {
  const html = digestHtml([ep("Severance", "S2 · E1")]);
  assertStringIncludes(html, "<strong>Severance</strong> — S2 · E1");
});

Deno.test("un título con HTML no se convierte en etiqueta", () => {
  const html = digestHtml([movie("<img src=x onerror=alert(1)>")]);
  assertEquals(html.includes("<img"), false);
  assertStringIncludes(html, "&lt;img");
  // Y el texto plano lo deja como está: ahí no hay nada que interpretar.
  assertStringIncludes(digestText([movie("<img>")]), "<img>");
});
