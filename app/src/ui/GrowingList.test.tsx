import { useRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextCount, useGrowingList } from "@/ui/GrowingList";

/* jsdom no tiene IntersectionObserver. Este lo sustituye y deja al test decidir
   cuándo el centinela "entra" en la ventana: `observe()` recuerda a quién mira
   y `fire()` avisa a los observadores vivos, como haría el navegador. */
type Cb = (e: { isIntersecting: boolean }[]) => void;
type Opts = { root?: Element | null; rootMargin?: string };
let live: { cb: Cb; el: Element | null; opts: Opts }[] = [];
class FakeIO {
  private rec: { cb: Cb; el: Element | null; opts: Opts };
  constructor(cb: Cb, opts: Opts = {}) {
    this.rec = { cb, el: null, opts };
  }
  observe(el: Element) {
    this.rec.el = el;
    live.push(this.rec);
  }
  disconnect() {
    live = live.filter((r) => r !== this.rec);
  }
}
const fire = () => act(() => live.slice().forEach((r) => r.cb([{ isIntersecting: true }])));

beforeEach(() => {
  live = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
});
afterEach(() => {
  delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
});

const list = (n: number) => Array.from({ length: n }, (_, i) => i);

function Grid({ items, resetKey, step = 10 }: { items: number[]; resetKey: string; step?: number }) {
  const { shown, sentinel } = useGrowingList(items, resetKey, step);
  return (
    <div>
      <ul>{shown.map((i) => <li key={i}>{i}</li>)}</ul>
      {sentinel}
    </div>
  );
}
const mounted = (c: HTMLElement) => c.querySelectorAll("li").length;
const hasSentinel = (c: HTMLElement) => !!c.querySelector(".grid-sentinel");

describe("nextCount", () => {
  it("suma una tanda sin pasarse de la lista", () => {
    expect(nextCount(10, 100, 10)).toBe(20);
    expect(nextCount(95, 100, 10)).toBe(100);
    expect(nextCount(100, 100, 10)).toBe(100);
  });
});

describe("useGrowingList", () => {
  it("monta solo la primera tanda y crece cuando el centinela se acerca", () => {
    const { container } = render(<Grid items={list(35)} resetKey="a" />);
    expect(mounted(container)).toBe(10);
    fire();
    expect(mounted(container)).toBe(20);
    fire();
    fire();
    expect(mounted(container)).toBe(35);
    // Todo montado: sin centinela, y sin observadores vivos que hagan nada.
    expect(hasSentinel(container)).toBe(false);
    expect(live).toHaveLength(0);
  });

  it("vuelve a preguntar tras cada tanda aunque el centinela no haya salido", () => {
    // Un observador nuevo por tanda: el navegador solo avisa al CRUZAR el
    // margen, y en una pantalla alta el centinela no llega a salir de él.
    render(<Grid items={list(35)} resetKey="a" />);
    const first = live[0];
    fire();
    expect(live).toHaveLength(1);
    expect(live[0]).not.toBe(first);
  });

  it("una lista corta se monta entera y no pone centinela", () => {
    const { container } = render(<Grid items={list(7)} resetKey="a" />);
    expect(mounted(container)).toBe(7);
    expect(hasSentinel(container)).toBe(false);
  });

  it("datos nuevos con la misma clave no devuelven a la primera tanda", () => {
    // La revalidación del rollup, o marcar algo en la ficha abierta encima:
    // quien iba por la tanda tres no puede perder su sitio.
    const { container, rerender } = render(<Grid items={list(50)} resetKey="a" />);
    fire();
    fire();
    expect(mounted(container)).toBe(30);
    rerender(<Grid items={list(51)} resetKey="a" />);
    expect(mounted(container)).toBe(30);
  });

  it("cambiar de cubo u orden vuelve a la primera tanda", () => {
    const { container, rerender } = render(<Grid items={list(50)} resetKey="a" />);
    fire();
    expect(mounted(container)).toBe(20);
    rerender(<Grid items={list(50)} resetKey="b" />);
    expect(mounted(container)).toBe(10);
  });
});

function Row({ items }: { items: number[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { shown, sentinel } = useGrowingList(items, "", 10, { axis: "x", root: ref });
  return (
    <div ref={ref} data-testid="row">
      <ul>{shown.map((i) => <li key={i}>{i}</li>)}</ul>
      {sentinel}
    </div>
  );
}

describe("useGrowingList en horizontal", () => {
  it("mira el contenedor y no la ventana, con el margen hacia la derecha", () => {
    // Con la ventana de raíz, el overflow de la fila recortaría el centinela
    // y el margen no contaría: la tanda llegaría con el final ya a la vista.
    const { getByTestId } = render(<Row items={list(35)} />);
    expect(live).toHaveLength(1);
    expect(live[0].opts.root).toBe(getByTestId("row"));
    expect(live[0].opts.rootMargin).toBe("0px 1500px 0px 0px");
  });

  it("el centinela ocupa un píxel de ancho y no engancha el scroll", () => {
    const { container } = render(<Row items={list(35)} />);
    const s = container.querySelector<HTMLElement>(".grid-sentinel")!;
    expect(s.style.width).toBe("1px");
    expect(s.style.height).toBe("");
    expect(s.style.scrollSnapAlign).toBe("none");
  });

  it("crece por tandas igual que en vertical", () => {
    const { container } = render(<Row items={list(25)} />);
    expect(mounted(container)).toBe(10);
    fire();
    fire();
    expect(mounted(container)).toBe(25);
    expect(hasSentinel(container)).toBe(false);
  });
});
