import { describe, expect, it } from "vitest";
import { byRatedAt } from "@/domain/ratedSort";

const item = (title_id: string, name: string) => ({ title_id, name });
const ratedAt = new Map([
  ["a", Date.parse("2015-03-01T00:00:00Z")],
  ["b", Date.parse("2026-08-01T00:00:00Z")],
  ["c", Date.parse("2020-06-01T00:00:00Z")],
]);
const names = <T extends { name: string }>(xs: T[]) => xs.map((x) => x.name);

describe("byRatedAt", () => {
  const lib = [item("a", "Vieja"), item("z", "Sin nota"), item("b", "Reciente"), item("c", "Media")];

  it("desc: lo último puntuado primero", () => {
    expect(names([...lib].sort(byRatedAt(ratedAt, "desc")))).toEqual(["Reciente", "Media", "Vieja", "Sin nota"]);
  });

  it("asc: lo primero puntuado primero", () => {
    expect(names([...lib].sort(byRatedAt(ratedAt, "asc")))).toEqual(["Vieja", "Media", "Reciente", "Sin nota"]);
  });

  /* La razón de ser de la primera regla: voltear el sentido NO sube lo que no
     tiene nota, que si no sepultaría lo puntuado bajo la biblioteca entera. */
  it("lo sin puntuar se queda al final en los dos sentidos", () => {
    const many = [item("z", "Sin nota"), item("y", "Tampoco"), item("b", "Reciente")];
    expect(names([...many].sort(byRatedAt(ratedAt, "asc")))[0]).toBe("Reciente");
    expect(names([...many].sort(byRatedAt(ratedAt, "desc")))[0]).toBe("Reciente");
  });

  // Una importación sella cientos de notas con el mismo instante.
  it("mismo instante → alfabético, y no el orden de llegada", () => {
    const same = new Map([["1", 1000], ["2", 1000], ["3", 1000]]);
    const rows = [item("2", "Ceniza"), item("3", "Alba"), item("1", "Bruma")];
    expect(names([...rows].sort(byRatedAt(same, "desc")))).toEqual(["Alba", "Bruma", "Ceniza"]);
    expect(names([...rows].sort(byRatedAt(same, "asc")))).toEqual(["Alba", "Bruma", "Ceniza"]);
  });

  it("sin ninguna nota, la rejilla no se descoloca: alfabético", () => {
    const rows = [item("x", "Zeta"), item("y", "Alfa")];
    expect(names([...rows].sort(byRatedAt(new Map(), "desc")))).toEqual(["Alfa", "Zeta"]);
  });
});
