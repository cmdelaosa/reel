import { memo } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Rail, RAIL_BATCH } from "@/ui/Rail";

/* La fila monta por tandas (ui/GrowingList, eje x). Lo que importa aquí es lo
   que la fila pone de su parte: que recorte los hijos, que una tanda nueva no
   vuelva a pintar las tarjetas ya montadas, y que las flechas sigan vivas. */

type Cb = (e: { isIntersecting: boolean }[]) => void;
let live: Cb[] = [];
class FakeIO {
  constructor(private cb: Cb) {}
  observe() { live.push(this.cb); }
  disconnect() { live = live.filter((c) => c !== this.cb); }
}
class FakeRO { observe() {} disconnect() {} }
const fire = () => act(() => live.slice().forEach((cb) => cb([{ isIntersecting: true }])));

const g = globalThis as unknown as Record<string, unknown>;
beforeEach(() => {
  live = [];
  g.IntersectionObserver = FakeIO;
  g.ResizeObserver = FakeRO;
});
afterEach(() => {
  delete g.IntersectionObserver;
  delete g.ResizeObserver;
});

let renders = 0;
// Sin memo a propósito: lo que evita el repintado es que la fila reutilice
// los elementos, no que cada pantalla memoice su tarjeta.
function Card({ n }: { n: number }) {
  renders++;
  return <div className="card-x">{n}</div>;
}
const cards = (c: HTMLElement) => c.querySelectorAll(".card-x").length;
const Many = memo(function Many({ n }: { n: number }) {
  return <Rail title="t">{Array.from({ length: n }, (_, i) => <Card key={i} n={i} />)}</Rail>;
});

describe("Rail por tandas", () => {
  it("monta una tanda y crece con el centinela", () => {
    const { container } = render(<Many n={RAIL_BATCH * 2 + 5} />);
    expect(cards(container)).toBe(RAIL_BATCH);
    fire();
    expect(cards(container)).toBe(RAIL_BATCH * 2);
    fire();
    expect(cards(container)).toBe(RAIL_BATCH * 2 + 5);
    expect(container.querySelector(".grid-sentinel")).toBeNull();
  });

  it("una fila con tope (Explorar, 20) se monta entera y sin centinela", () => {
    const { container } = render(<Many n={RAIL_BATCH} />);
    expect(cards(container)).toBe(RAIL_BATCH);
    expect(container.querySelector(".grid-sentinel")).toBeNull();
  });

  it("una tanda nueva no vuelve a pintar las tarjetas montadas", () => {
    render(<Many n={RAIL_BATCH * 3} />);
    renders = 0;
    fire();
    // Solo las de la tanda nueva: ninguna de las veinte de antes.
    expect(renders).toBe(RAIL_BATCH);
  });

  it("las flechas avanzan la fila aunque la tanda siguiente no esté montada", () => {
    const { container } = render(<Many n={RAIL_BATCH * 3} />);
    const rail = container.querySelector<HTMLDivElement>(".rail")!;
    // jsdom no mide: le damos las medidas que tendría una fila desbordada.
    Object.defineProperty(rail, "clientWidth", { value: 1000, configurable: true });
    Object.defineProperty(rail, "scrollWidth", { value: 3600, configurable: true });
    let left = 0;
    rail.scrollBy = ((o: ScrollToOptions) => { left += o.left ?? 0; }) as typeof rail.scrollBy;
    fireEvent.scroll(rail);
    // La segunda flecha (la etiqueta sale traducida según el idioma).
    const right = container.querySelectorAll<HTMLButtonElement>(".rail-arrow")[1];
    expect(right.disabled).toBe(false);
    fireEvent.click(right);
    expect(left).toBe(800);
  });
});
