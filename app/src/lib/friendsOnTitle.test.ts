import { describe, expect, it } from "vitest";
import { friendEntryRowSchema } from "@/lib/friendsOnTitle";

/* La misma avería que vigila kindEnums.test.ts, en la otra columna que ya
   creció una vez: `play_state`. Zod no ignora un valor fuera de la lista, tira
   el parseo entero — y aquí eso sería el bloque de amigos caído en TODAS las
   fichas porque UN amigo usa un estado que este cliente aún no conoce (una
   pestaña abierta desde ayer, un móvil sin recargar). */
describe("la fila de biblioteca de un amigo", () => {
  const base = { user_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", followed: true };

  it("lee los cuatro estados de hoy", () => {
    for (const play_state of ["backlog", "playing", "ongoing", "dropped"]) {
      expect(friendEntryRowSchema.parse({ ...base, play_state }).play_state).toBe(play_state);
    }
  });

  it("un estado que no conoce se lee como 'no ha dicho nada', y no revienta", () => {
    expect(friendEntryRowSchema.parse({ ...base, play_state: "shelved" }).play_state).toBeNull();
  });

  it("y la fila sigue llegando entera", () => {
    const row = friendEntryRowSchema.parse({ ...base, play_state: "shelved", owned: true, minutes_played: 120 });
    expect(row).toMatchObject({ followed: true, owned: true, minutes_played: 120 });
  });
});
