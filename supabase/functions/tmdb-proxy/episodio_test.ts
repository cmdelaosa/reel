// Pruebas de lo que se guarda de la gente de un episodio. Las corre el job
// `edge` de CI (`deno test`).
//
// Las tres cosas que estas funciones pueden romper y que un cambio descuidado
// rompería en silencio, porque ninguna revienta — todas devuelven algo:
//   1. dejar un episodio sin guionista por filtrar solo por "Writer";
//   2. pintar la misma cara dos veces cuando alguien dirige y firma;
//   3. borrar una traducción ya guardada al escribir null encima.
import { assertEquals } from "jsr:@std/assert@1";
import { crewRecortado, invitadosRecortados, textoEs } from "./episodio.ts";

const p = (id: number, name: string, job: string, profile_path: string | null = null) =>
  ({ id, name, job, profile_path, adult: false, gender: 2, popularity: 1, credit_id: "x" });

Deno.test("crew: se queda con dirección y guion, y en ese orden", () => {
  const out = crewRecortado([
    p(3, "Montador", "Editor"),
    p(2, "Guionista", "Writer"),
    p(1, "Directora", "Director"),
    p(4, "Sonido", "Sound Re-Recording Mixer"),
  ]);
  assertEquals(out?.map((x) => x.name), ["Directora", "Guionista"]);
  assertEquals(out?.map((x) => x.role), ["Director", "Writer"]);
});

Deno.test("crew: Teleplay, Screenplay y Story también son guion", () => {
  for (const job of ["Teleplay", "Screenplay", "Story"]) {
    const out = crewRecortado([p(1, "Alguien", job)]);
    assertEquals(out?.length, 1, `${job} debería contar como guion`);
    assertEquals(out?.[0].role, "Writer");
  }
});

Deno.test("crew: quien dirige Y firma sale una sola vez, como dirección", () => {
  const out = crewRecortado([p(7, "Ben Stiller", "Director"), p(7, "Ben Stiller", "Writer")]);
  assertEquals(out?.length, 1);
  assertEquals(out?.[0].role, "Director");
});

Deno.test("crew: sin dirección ni guion devuelve null, no lista vacía", () => {
  assertEquals(crewRecortado([p(1, "Montador", "Editor")]), null);
  assertEquals(crewRecortado([]), null);
  assertEquals(crewRecortado(null), null);
});

Deno.test("crew: se descarta a quien no tiene id o nombre", () => {
  const out = crewRecortado([
    { name: "Sin id", job: "Director" },
    { id: 2, job: "Director" },
    p(3, "Válida", "Director"),
  ]);
  assertEquals(out?.map((x) => x.id), [3]);
});

Deno.test("crew: solo se guardan los cuatro campos que la ficha pinta", () => {
  const out = crewRecortado([p(1, "Directora", "Director", "/a.jpg")]);
  assertEquals(Object.keys(out![0]).sort(), ["id", "name", "profile_path", "role"]);
});

const g = (id: number, name: string, character?: string) => ({ id, name, character, order: id });

Deno.test("invitados: se respeta el orden de créditos que trae TMDB", () => {
  const out = invitadosRecortados([g(1, "Primera", "Protagonista"), g(2, "Segundo", "Vecino")]);
  assertEquals(out?.map((x) => x.name), ["Primera", "Segundo"]);
  assertEquals(out?.[0].role, "Protagonista");
});

Deno.test("invitados: sin personaje se conserva la persona, con papel vacío", () => {
  const out = invitadosRecortados([g(1, "Acreditada")]);
  assertEquals(out?.length, 1);
  assertEquals(out?.[0].role, "");
});

Deno.test("invitados: se cortan en doce", () => {
  const muchos = Array.from({ length: 40 }, (_, i) => g(i + 1, `Nº ${i + 1}`, "papel"));
  assertEquals(invitadosRecortados(muchos)?.length, 12);
});

Deno.test("invitados: sin nadie devuelve null", () => {
  assertEquals(invitadosRecortados([]), null);
  assertEquals(invitadosRecortados(undefined), null);
});

Deno.test("español: el texto vacío de TMDB no pisa al canónico", () => {
  // Es LO QUE DEVUELVE la API cuando falta la traducción: cadena vacía, no la
  // inglesa. Si estas claves llegaran a la fila, el upsert escribiría null.
  assertEquals(textoEs({ name: "Título", overview: "" }), { name_es: "Título" });
  assertEquals(textoEs({ name: "   ", overview: "   " }), {});
  assertEquals(textoEs(null), {});
});

Deno.test("español: cuando hay traducción, van las dos claves", () => {
  assertEquals(
    textoEs({ name: "Buenas noticias sobre el Infierno", overview: "Mark es ascendido…" }),
    { name_es: "Buenas noticias sobre el Infierno", overview_es: "Mark es ascendido…" },
  );
});
