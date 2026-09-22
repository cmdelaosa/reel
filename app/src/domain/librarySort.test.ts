import { describe, expect, it } from "vitest";
import { byValue, flipDir } from "@/domain/librarySort";

const juego = (name: string, nota: number | null, fecha: string | null = "2020-01-01", minutos = 0) => ({
  name,
  vote_average: nota,
  first_air_date: fecha,
  minutes_played: minutos,
});

const names = <T extends { name: string }>(xs: T[]) => xs.map((x) => x.name);
const porNota = (dir: "desc" | "asc") => byValue<ReturnType<typeof juego>>((g) => g.vote_average, dir);

describe("byValue", () => {
  const lib = [juego("Medio", 72), juego("Alto", 96), juego("Bajo", 31)];

  it("desc: de mayor a menor", () => {
    expect(names([...lib].sort(porNota("desc")))).toEqual(["Alto", "Medio", "Bajo"]);
  });

  it("asc: de menor a mayor", () => {
    expect(names([...lib].sort(porNota("asc")))).toEqual(["Bajo", "Medio", "Alto"]);
  });

  /* La razón de ser de la regla, y el fallo que las restas sueltas de la página
     escondían: voltear el sentido NO debe subir lo que no tiene el dato. Con
     `?? 0` estos dos encabezarían «de menor a mayor» y sepultarían al único
     juego que de verdad está mal valorado. */
  it("lo que no tiene el dato se queda al final en los dos sentidos", () => {
    const con = [juego("Sin nota", null), juego("Tampoco", null), juego("Bajo", 31)];
    expect(names([...con].sort(porNota("asc")))[0]).toBe("Bajo");
    expect(names([...con].sort(porNota("desc")))[0]).toBe("Bajo");
  });

  it("entre las que no tienen el dato manda el nombre, no el orden de llegada", () => {
    const con = [juego("Zelda", null), juego("Abzû", null), juego("Myst", null)];
    expect(names([...con].sort(porNota("desc")))).toEqual(["Abzû", "Myst", "Zelda"]);
    expect(names([...con].sort(porNota("asc")))).toEqual(["Abzû", "Myst", "Zelda"]);
  });

  it("empatados en el valor manda el nombre, en los dos sentidos", () => {
    const con = [juego("Zelda", 80), juego("Abzû", 80)];
    expect(names([...con].sort(porNota("desc")))).toEqual(["Abzû", "Zelda"]);
    expect(names([...con].sort(porNota("asc")))).toEqual(["Abzû", "Zelda"]);
  });

  /* Las fechas son cadenas ISO y se comparan como cadenas: mientras sean
     AAAA-MM-DD el orden alfabético ES el cronológico, que es justo por lo que
     la columna se guarda así. */
  it("fechas: cadenas ISO, y la que falta al final", () => {
    const con = [juego("Vieja", 50, "1998-11-19"), juego("TBA", 50, null), juego("Nueva", 50, "2024-03-08")];
    const porFecha = (dir: "desc" | "asc") =>
      byValue<ReturnType<typeof juego>>((g) => g.first_air_date, dir);
    expect(names([...con].sort(porFecha("desc")))).toEqual(["Nueva", "Vieja", "TBA"]);
    expect(names([...con].sort(porFecha("asc")))).toEqual(["Vieja", "Nueva", "TBA"]);
  });

  /* Un 0 NO es un hueco cuando el 0 es el dato: «nunca lo he jugado» son cero
     minutos de verdad, y en «de menos a más horas» esos juegos van primero,
     que es lo que la etiqueta promete. Quien llama decide cuál de los dos es
     cada campo mandando `null` o no. */
  it("un 0 que es dato se ordena como 0, no como hueco", () => {
    const con = [juego("Sin tocar", 50, "2020-01-01", 0), juego("Mucho", 50, "2020-01-01", 6000)];
    const porHoras = (dir: "desc" | "asc") =>
      byValue<ReturnType<typeof juego>>((g) => g.minutes_played, dir);
    expect(names([...con].sort(porHoras("asc")))).toEqual(["Sin tocar", "Mucho"]);
    expect(names([...con].sort(porHoras("desc")))).toEqual(["Mucho", "Sin tocar"]);
  });

  it("A–Z: cadenas, y el acento no manda al final del alfabeto", () => {
    const con = [juego("Ōkami", 50), juego("Abzû", 50), juego("Ori", 50)];
    const porNombre = (dir: "desc" | "asc") => byValue<ReturnType<typeof juego>>((g) => g.name, dir);
    expect(names([...con].sort(porNombre("asc")))).toEqual(["Abzû", "Ōkami", "Ori"]);
    expect(names([...con].sort(porNombre("desc")))).toEqual(["Ori", "Ōkami", "Abzû"]);
  });
});

describe("flipDir", () => {
  it("voltea y vuelve", () => {
    expect(flipDir("desc")).toBe("asc");
    expect(flipDir("asc")).toBe("desc");
    expect(flipDir(flipDir("desc"))).toBe("desc");
  });
});
