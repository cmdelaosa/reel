/* Lo que te llevas de verdad al vender, que no es lo que pone el precio.
 *
 * El mercado de Steam enseña SIEMPRE lo que paga el comprador. De ahí salen dos
 * comisiones —el 5 % de la plataforma y el 10 % del juego— y lo que queda es lo
 * único que aterriza en tu cartera. En un inventario de 1.842 € eso son casi
 * 240 € de diferencia, así que un total en bruto y uno en neto no son el mismo
 * número con otro nombre: contestan a dos preguntas distintas —«cuánto vale
 * esto» y «cuánto me darían por ello»— y la pantalla deja elegir cuál.
 *
 * ── Por qué no es dividir entre 1,15 ──────────────────────────────────────
 * Las dos comisiones se calculan sobre lo que RECIBE el vendedor, no sobre lo
 * que paga el comprador, y cada una tiene un mínimo de un céntimo. En los
 * cromos —que son 532 de los 608 objetos— eso lo cambia todo: un cromo de 0,03 €
 * deja 0,01 €, no 0,026. Dividir entre 1,15 diría que la mitad de tu inventario
 * vale casi el triple de lo que vale.
 *
 * Así que se resuelve al revés, que es como lo hace Valve: se busca el mayor
 * neto cuyo precio final no pase del bruto. La búsqueda arranca de la
 * estimación de 1,15 y se mueve de céntimo en céntimo, que a esa distancia son
 * una o dos vueltas.
 *
 * ── Lo que este módulo NO promete ────────────────────────────────────────
 * El céntimo exacto de Valve en objetos de céntimos. Su redondeo interno no
 * está publicado y no se puede comprobar contra nada; lo que sí se puede
 * garantizar es la regla —mínimo un céntimo por comisión, y el total nunca por
 * encima del bruto—, que es de donde viene toda la diferencia que se ve. */

const STEAM_FEE = 0.05;
const GAME_FEE = 0.10;

/** Lo que el comprador acaba pagando para que tú recibas `net`. */
function grossFor(net: number): number {
  return net + Math.max(1, Math.floor(net * STEAM_FEE)) + Math.max(1, Math.floor(net * GAME_FEE));
}

/** Lo que te queda de un precio de mercado, en céntimos.
 *
 *  Nunca por encima del bruto y nunca por debajo de un céntimo: un objeto que
 *  cotiza a algo no puede dejar cero, y un cero en la rejilla se leería como
 *  «sin precio», que es otra cosa que la pantalla ya dice de otra forma. */
export function netCents(grossCents: number): number {
  if (grossCents <= 0) return 0;
  /* Con tres céntimos o menos las dos comisiones mínimas ya se lo comen todo, y
     la búsqueda de abajo se quedaría en el suelo dando vueltas. */
  if (grossCents <= 3) return 1;

  let net = Math.max(1, Math.floor(grossCents / (1 + STEAM_FEE + GAME_FEE)));
  while (grossFor(net + 1) <= grossCents) net += 1;
  while (net > 1 && grossFor(net) > grossCents) net -= 1;
  return net;
}

/** El mismo cálculo respetando el hueco: un objeto sin precio sigue sin
 *  tenerlo, en neto y en bruto. Sin esto cada sitio que pinta un precio tendría
 *  que repetir el `null`, y alguno se olvidaría de hacerlo. */
export function netOrNull(grossCents: number | null): number | null {
  return grossCents === null ? null : netCents(grossCents);
}
