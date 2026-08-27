/* El punto de entrada del Worker que sirve Reel.
 *
 * Casi todo lo que se pide son ficheros del build, y de eso se encarga el
 * binding de assets — que además los sirve sin pasar por aquí salvo en las
 * rutas de `run_worker_first` (ver wrangler.jsonc). La única ruta que es código
 * es la vuelta de Steam, y el porqué está entero en steamReturn.ts.
 *
 * Aquí NO puede haber nada más que el manejador: el runtime de Workers rechaza
 * cualquier otro `export` del punto de entrada al arrancar, con «Incorrect type
 * for map entry … not of type 'function or ExportedHandler'». Por eso la ruta y
 * su lógica viven en el módulo de al lado, que además es el que puede importar
 * un test.
 */
import { RETURN_PATH, steamReturn, type Env } from "@/worker/steamReturn";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return new URL(request.url).pathname === RETURN_PATH
      ? steamReturn(request, env)
      : env.ASSETS.fetch(request);
  },
};
