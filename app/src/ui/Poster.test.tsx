import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { Poster } from "@/ui/Poster";
import type { TitleCard } from "@/domain/types";

/* Las dos formas de pedir una carátula, y por qué importa cuál sale.
 *
 * `loading="lazy"` no es gratis en la primera fila: el navegador no pide una
 * imagen diferida hasta tener el layout, así que lo que el usuario está
 * mirando se pone a la cola detrás de todo. La prop `priority` es lo que le
 * dice a una carátula que no es ese caso — y como es la rejilla quien la pasa
 * (a los N primeros del map), un cambio que la ignore no rompe ninguna
 * pantalla a la vista: solo hace la primera pantalla más lenta, en silencio.
 * Estas dos comprobaciones son el único sitio donde eso suena. */

const card: TitleCard = {
  id: "1399",
  name: "Juego de Tronos",
  year: "2011",
  genres: ["Drama"],
  posterPath: "https://image.tmdb.org/t/p/w342/poster.jpg",
  voteAverage: 8.4,
};

function Marco({ priority }: { priority?: boolean }) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={cliente}>
        <Poster t={card} showProviders={false} priority={priority} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

const cliente = new QueryClient();

function paint(priority?: boolean) {
  /* Sin proveedores y sin prefetch: lo que se mide es el <img>, y WatchOn
     pediría una fila de Supabase que no pinta nada de esto. */
  const { container } = render(<Marco priority={priority} />);
  const img = container.querySelector("img.poster-img");
  if (!img) throw new Error("la carátula no pintó ningún <img>");
  return img;
}

afterEach(cleanup);

describe("Poster", () => {
  it("sin priority: se difiere, como el resto de la rejilla", () => {
    const img = paint();
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("fetchpriority")).toBe("auto");
  });

  it("con priority: sin lazy y con prioridad alta", () => {
    const img = paint(true);
    /* Lo que de verdad se comprueba: que NO queda `lazy`. Poner
       fetchPriority sobre una imagen diferida no adelanta nada — la petición
       sigue esperando al layout —, así que esta mitad es la que vale. */
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("priority={false} es exactamente el comportamiento de siempre", () => {
    expect(paint(false).getAttribute("loading")).toBe("lazy");
  });

  /* Repintando el MISMO árbol, no montándolo de cero: la rejilla se pinta
     primero con lo que hay en caché y luego con la lista entera, así que una
     carátula cambia de lado sin desmontarse y es ahí donde un atributo viejo
     se quedaría pegado. */
  it("una carátula que pasa a prioritaria pierde el lazy al repintar", () => {
    const { container, rerender } = render(<Marco priority={false} />);
    const img = () => container.querySelector("img.poster-img")!;
    expect(img().getAttribute("loading")).toBe("lazy");
    rerender(<Marco priority />);
    expect(img().getAttribute("loading")).toBe("eager");
    expect(img().getAttribute("fetchpriority")).toBe("high");
  });
});
