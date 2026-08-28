import { PLATFORM_MARKS } from "@/ui/icons/platformMarks";

/* El logotipo de Steam, que lucide no trae y no puede traer: su set es de
   iconos de interfaz, no de marcas. Antes esta pestaña llevaba un eslabón de
   cadena (Link2) diciendo "cuenta enlazada", y lo que hay al otro lado no es
   una cuenta cualquiera — es Steam, y su marca la reconoce de un vistazo
   cualquiera que juegue en PC, que es exactamente para quien está la pestaña.

   El trazado sale de ui/icons/platformMarks, que es donde viven los logotipos
   de todas las plataformas desde 0091; antes estaba copiado aquí. Es cuadrado
   (r = 1), así que a diferencia de los de PlatformLogo aquí puede pedirse por
   lado sin que nada se aplaste.

   La firma imita la de un icono de lucide —`size` y el resto de props de un
   <svg>— para que la pestaña no tenga que tratarlo distinto: GAME_TABS guarda
   componentes de icono y los pinta todos igual, con `<tab.icon size={19} />`.

   `fill="currentColor"` y no `stroke`: es un logotipo macizo, no un pictograma
   de trazo, así que hereda el color del texto por relleno. */
export function SteamIcon({ size = 24, ...rest }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={PLATFORM_MARKS.steam.vb}
      fill="currentColor"
      aria-hidden="true"
      {...rest}
      dangerouslySetInnerHTML={{ __html: PLATFORM_MARKS.steam.body }}
    />
  );
}
