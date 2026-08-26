import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import {
  detailProgressQueryOptions,
  seasonQueryOptions,
  titleQueryOptions,
  type DetailProgress,
} from "@/features/detail/data";
import type { TitleResponse } from "@/lib/schemas";
import { tmdbImg } from "@/lib/tmdb";
import { sheetParam, type Medium } from "@/domain/tasteScope";

export function usePrefetchTitle() {
  const queryClient = useQueryClient();
  return useCallback(
    async (tmdbId: number) => {
      await queryClient.prefetchQuery(titleQueryOptions(tmdbId));
      const title = queryClient.getQueryData<TitleResponse>(["title", tmdbId]);
      if (!title) return;

      for (const src of [tmdbImg(title.title.poster_path, "w342"), tmdbImg(title.title.backdrop_path, "w780")]) {
        if (src) new Image().src = src;
      }

      await queryClient.prefetchQuery(detailProgressQueryOptions(title.title.id));
      const progress = queryClient.getQueryData<DetailProgress>(["detailProgress", title.title.id]);
      const regular = title.seasons.filter((season) => season.number > 0);
      const season = progress?.recommended_season ?? regular[0]?.number;
      if (season != null) {
        await queryClient.prefetchQuery(seasonQueryOptions(tmdbId, season, title));
      }
    },
    [queryClient],
  );
}

/** Intent handlers for cards: wait briefly on hover so merely crossing a grid
 * does not warm dozens of titles; focus/pointer-down are strong intent. */
export function useTitleIntent(tmdbId: number | undefined) {
  const prefetch = usePrefetchTitle();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
  const run = () => { if (tmdbId != null) void prefetch(tmdbId); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    onPointerEnter: () => {
      cancel();
      timer.current = setTimeout(run, 120);
    },
    onPointerLeave: cancel,
    onPointerDown: run,
    onFocus: run,
    onBlur: cancel,
  };
}

/** Returns a callback that opens the detail sheet for a tmdb id by setting the
 *  global `?title=` param. Shared by the calendar, Tonight and explore rows. */
export function useOpenTitle() {
  const [, setSearchParams] = useSearchParams();
  const prefetch = usePrefetchTitle();
  return (tmdbId: number) => {
    void prefetch(tmdbId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("title", String(tmdbId));
      return next;
    });
  };
}

/** Lo mismo, pero para las pantallas COMPARTIDAS —afinidad, estadísticas del
 *  grupo, tu perfil—, cuyas filas pueden ser de cualquiera de los tres medios.
 *
 *  El parámetro sale del medio de la fila (`sheetParam`) y no del modo: una
 *  nota tuya de cine abierta con `?title=` mandaba a la ficha de la SERIE con
 *  ese número, o a ninguna. El precalentado se queda solo en series: es el que
 *  pide temporadas y progreso, cosas que ni una película ni un juego tienen. */
export function useOpenSheet() {
  const [, setSearchParams] = useSearchParams();
  const prefetch = usePrefetchTitle();
  return (tmdbId: number, kind: Medium) => {
    if (kind === "tv") void prefetch(tmdbId);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(sheetParam(kind), String(tmdbId));
      return next;
    });
  };
}
