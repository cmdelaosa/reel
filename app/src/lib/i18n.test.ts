import { describe, expect, it } from "vitest";
import i18nSource from "@/lib/i18n.ts?raw";

/* El convenio del PREFIJO, que es lo único del diccionario que se puede tener
 * mal sin que nada se rompa.
 *
 * `t()` cae a la clave cuando no encuentra traducción, y eso es justo lo que
 * hace que el resto del diccionario no necesite pruebas: una clave sin traducir
 * sale en inglés, que es feo pero es una frase. Con una clave PREFIJADA no: el
 * prefijo está ahí para desambiguar dos usos de la misma palabra —"Watched" de
 * la actividad y "Watched" de las estadísticas— y no es texto, así que al caer
 * a la clave se cuela entero a la pantalla. Ya pasó: la ficha de un juego llegó
 * a decir "steam: Overwhelmingly Positive" (ver tSteam).
 *
 * De ahí que el inglés, que no necesita diccionario, tenga uno con solo las
 * claves prefijadas. Esto vigila que no se olvide ninguna — es una entrada a
 * mano en otro sitio del fichero, seiscientas líneas más abajo, y olvidarla no
 * rompe ni los tipos ni el lint ni ninguna otra prueba.
 *
 * Se lee el FUENTE y no se importan los diccionarios porque son privados del
 * módulo, y exportarlos solo para esto sería abrir el diccionario entero a
 * cualquiera. El idiom del `?raw` es el de airPairing.mirror.test.ts. */

/** Lo que cuenta como prefijo: una o más palabras en minúscula y dos puntos al
 *  principio de la clave. Es la forma que tienen las diez familias que hay. */
const PREFIJO = /^([a-z][a-z ]*): /;

/* Las dos únicas claves prefijadas que NO llevan entrada en EN, y por qué:
   las de Steam las desprefija tSteam() de una vez, para las nueve; y "you:"
   no es un prefijo, es texto que se pinta —"tú: 5 · Steam: 7"— y en inglés
   cae a la clave a propósito. */
const SIN_ENTRADA_EN = (clave: string) =>
  clave.startsWith("steam: ") || clave.startsWith("you: ");

function claves(nombre: "ES" | "EN"): string[] {
  const abre = `const ${nombre}: Record<string, string> = {`;
  const i = i18nSource.indexOf(abre);
  if (i < 0) throw new Error(`No encuentro el diccionario ${nombre} en i18n.ts`);
  const j = i18nSource.indexOf("\n};", i);
  const bloque = i18nSource.slice(i + abre.length, j);
  /* Solo el arranque de línea: así una cadena de varias líneas —las hay, con
     la traducción debajo— no se cuenta como si fuera otra clave. Y `\\.` para
     las claves que llevan comillas escapadas dentro. */
  return [...bloque.matchAll(/^ {2}"((?:[^"\\]|\\.)*)":/gm)].map((m) => m[1].replace(/\\"/g, '"'));
}

const ES = claves("ES");
const EN = claves("EN");

describe("el convenio del prefijo", () => {
  it("el fichero se deja leer, y los dos diccionarios tienen lo que se espera", () => {
    /* Si esto falla, lo que ha cambiado es la FORMA del fichero y no su
       contenido: el resto de la matriz estaría midiendo el vacío. */
    expect(ES.length).toBeGreaterThan(500);
    expect(EN.length).toBeGreaterThan(20);
    expect(ES).toContain("Playing");
    expect(EN.every((k) => PREFIJO.test(k))).toBe(true);
  });

  it("toda clave prefijada de ES tiene su entrada en EN", () => {
    const faltan = ES.filter((k) => PREFIJO.test(k) && !SIN_ENTRADA_EN(k) && !EN.includes(k));
    expect(faltan).toEqual([]);
  });

  it("y ninguna entrada de EN se deja el prefijo puesto", () => {
    /* El otro lado del mismo fallo: acordarse de añadir la entrada y copiar la
       clave tal cual como valor deja el prefijo en pantalla igual. */
    const bloque = i18nSource.slice(i18nSource.indexOf("const EN: Record<string, string> = {"));
    const pares = [...bloque.matchAll(/^ {2}"((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",$/gm)];
    const conPrefijo = pares.filter(([, , valor]) => PREFIJO.test(valor)).map(([, clave]) => clave);
    expect(conPrefijo).toEqual([]);
  });
});

describe("los cubos de Juegos", () => {
  /* Lo que este convenio compra en la biblioteca de Juegos: tres montones que
     en español no pueden decir lo que dicen los de Series, porque una serie es
     «Terminada» y un juego «Terminado». Las claves tienen que existir las seis
     —las tres de Juegos y las tres compartidas— y ser distintas. */
  const CUBOS = ["Finished", "Upcoming", "All"];

  it("las tres llevan clave propia, y la compartida sigue viva para Series y Cine", () => {
    for (const cubo of CUBOS) {
      expect(ES, `falta la clave de Juegos para ${cubo}`).toContain(`games bucket: ${cubo}`);
      expect(ES, `falta la clave compartida ${cubo}`).toContain(cubo);
    }
  });

  it("y la de Juegos no dice lo mismo que la compartida", () => {
    const valor = (clave: string) => {
      const m = i18nSource.match(
        new RegExp(`^ {2}"${clave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}": "([^"]*)",$`, "m"),
      );
      return m?.[1];
    };
    for (const cubo of CUBOS) {
      const juegos = valor(`games bucket: ${cubo}`);
      expect(juegos, `sin traducción para games bucket: ${cubo}`).toBeTruthy();
      expect(juegos).not.toBe(valor(cubo));
    }
  });
});
