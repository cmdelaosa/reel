import { describe, expect, it } from "vitest";
import { restOffsets } from "@/lib/i18n";

/* El paginado del mapa de títulos en español. Lo que se prueba aquí es la
   aritmética, que es donde un paginado falla de la forma cara: pedir de menos
   no revienta, deja huecos — y un hueco aquí significa un puñado de títulos en
   inglés dentro de una app en español, sin nada que lo delate. */
describe("restOffsets", () => {
  it("no pide nada cuando todo cupo en la primera página", () => {
    expect(restOffsets(600, 1000)).toEqual([]);
    expect(restOffsets(1000, 1000)).toEqual([]);
  });

  it("pide la segunda cuando sobra una fila", () => {
    expect(restOffsets(1001, 1000)).toEqual([1000]);
  });

  it("cubre el total exacto sin pedir una página de más", () => {
    expect(restOffsets(3000, 1000)).toEqual([1000, 2000]);
  });

  it("cuenta con lo que VINO, no con lo que se pidió", () => {
    /* El caso que justifica la función: el servidor tope a 500 aunque se
       pidieran 1.000. Con el tamaño pedido saldría [1000, 2000] y se perderían
       las filas 500-999 y 1500-1999 sin un solo error. */
    expect(restOffsets(2000, 500)).toEqual([500, 1000, 1500]);
  });

  it("no divide entre cero cuando la primera página vino vacía", () => {
    expect(restOffsets(0, 0)).toEqual([]);
    expect(restOffsets(1436, 0)).toEqual([]);
  });
});
