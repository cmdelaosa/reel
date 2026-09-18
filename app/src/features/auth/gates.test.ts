/* La matriz de los porteros de la entrada.
 *
 * Aquí se prueba la tabla de verdad entera, y no por completismo: la nota del
 * aparato existe para ADELANTAR la entrada mientras no se sabe, y la forma de
 * estropearla es dejar que adelante también cuando ya se sabe que no. Esa
 * celda —respuesta negativa con nota puesta— es la que hay que mirar primero si
 * algún día alguien reordena estas funciones. */

import { describe, expect, test, beforeEach } from "vitest";
import {
  forgetCleared,
  hasCleared,
  inviteVerdict,
  markCleared,
  onboardVerdict,
} from "@/features/auth/gates";

const YO = "0b52edfb-79b7-4dca-913d-39f5fd8d92f4";
const OTRO = "11111111-2222-3333-4444-555555555555";

describe("el portero de la invitación", () => {
  test("con la respuesta a favor se entra, haya nota o no", () => {
    expect(inviteVerdict(true, false)).toBe("enter");
    expect(inviteVerdict(true, true)).toBe("enter");
  });

  test("LA CELDA: la nota NO contradice un 'no' que ya llegó", () => {
    expect(inviteVerdict(false, true)).toBe("bounce");
    expect(inviteVerdict(false, false)).toBe("bounce");
  });

  test("mientras viaja, la nota es la que adelanta la entrada", () => {
    expect(inviteVerdict(undefined, true)).toBe("enter");
  });

  test("mientras viaja y sin nota se espera: es la primera vez en este aparato", () => {
    expect(inviteVerdict(undefined, false)).toBe("wait");
  });
});

describe("el portero del alta", () => {
  test("con alias propio se entra", () => {
    expect(onboardVerdict("carlos", false)).toBe("enter");
  });

  test("LA CELDA: con el alias del disparador se rebota aunque haya nota", () => {
    // El marcador que pone el alta: "user_" y 16 dígitos hex (schemas.ts:197).
    expect(onboardVerdict("user_0b52edfb79b74dca", true)).toBe("bounce");
    // Y uno que solo se le parece SÍ entra: es un alias propio, no el marcador.
    expect(onboardVerdict("user_carlos", true)).toBe("enter");
  });

  test("mientras viaja, la nota adelanta la entrada", () => {
    expect(onboardVerdict(undefined, true)).toBe("enter");
  });

  test("mientras viaja y sin nota se espera", () => {
    expect(onboardVerdict(undefined, false)).toBe("wait");
  });
});

describe("la nota del aparato", () => {
  beforeEach(() => {
    forgetCleared();
  });

  test("se escribe y se lee", () => {
    expect(hasCleared(YO)).toBe(false);
    markCleared(YO);
    expect(hasCleared(YO)).toBe(true);
  });

  test("es de UNA cuenta: en un aparato compartido no abre la puerta a la siguiente", () => {
    markCleared(YO);
    expect(hasCleared(OTRO)).toBe(false);
  });

  test("sin sesión no hay nota que valga", () => {
    markCleared(YO);
    expect(hasCleared(undefined)).toBe(false);
  });

  test("cerrar sesión la borra", () => {
    markCleared(YO);
    forgetCleared();
    expect(hasCleared(YO)).toBe(false);
  });
});
