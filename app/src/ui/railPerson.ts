/* La forma mínima que pinta CastRail, y los traductores hacia ella.
   En un módulo aparte y no dentro del componente porque `personaDelReparto` es
   un valor, y un fichero de componentes que exporta valores rompe el fast
   refresh de Vite (react-refresh/only-export-components). */

export interface RailPerson {
  /** Id de TMDB — es lo que deja abrir /person/:id. */
  id: number;
  name: string;
  profile_path: string | null;
  /** La línea de debajo: el personaje, o el puesto en el equipo. */
  sub?: string | null;
  /** El puesto va en acento; el personaje, en gris. */
  subAccent?: boolean;
}

/** Un intérprete del reparto. El personaje va en gris: es a quién hace, no lo
 *  que hizo. */
export const personaDelReparto = (
  c: { id: number; name: string; profile_path: string | null; character: string | null },
): RailPerson => ({ id: c.id, name: c.name, profile_path: c.profile_path, sub: c.character });
