#!/usr/bin/env bash
# Todo lo que se puede juzgar de un cambio de reel sin salir de la máquina: lo
# mismo que mira `.github/workflows/check.yml`, pero antes de empujar.
#
# Lo lanza `probar-rama.sh` antes del push. Hasta hoy reel no tenía este fichero,
# así que la cadena empujaba a ciegas y el CI era la ÚNICA red: un `tsc` roto se
# descubría cinco minutos después, en una PR ya abierta, y arreglarlo dejaba en
# main la historia de «arreglo lo que el CI vio». Medido aquí: 15 s en local
# contra los minutos que cuesta la vuelta entera por GitHub.
#
# Por eso aquí va lo RÁPIDO, y cada sección se lanza solo si el cambio la toca
# —`--todo` las fuerza—. Un freno que cuesta minutos acaba con un
# `--sin-verificar` en cada llamada, y entonces no frena nada.
#
# ⚠️ **La autoridad es `check.yml`, no esto.** Sus tres jobs y estas tres
# secciones son la misma comprobación escrita dos veces, y el día que una cambie
# sin la otra este guión dará un verde que la PR no confirma. Se tocan juntas.
set -uo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
fallos=0

todo=0
for bandera in "$@"; do
  case "$bandera" in
    --todo) todo=1 ;;
    -h | --help)
      printf 'Uso: verificar.sh [--todo]\n\n'
      printf '  Sin banderas: las migraciones siempre, y la app y las edge\n'
      printf '  functions solo si el cambio las toca.\n'
      printf '  --todo: las tres secciones pase lo que pase.\n'
      exit 0 ;;
    *) printf 'Opción desconocida: %s\n' "$bandera" >&2; exit 1 ;;
  esac
done

titulo() { printf '\n=== %s ===\n' "$1"; }

# Qué ha cambiado desde `main`, para no gastar doce segundos volviendo a
# demostrar lo mismo que ayer. Lo decide el diff, no quien llama. Sin base con la
# que comparar no se decide a la ligera: se lanza todo — un freno que no sabe
# responder tiene que decir que sí a lo caro, no que no.
#
# `git diff <base> -- rutas` compara la base con el ÁRBOL DE TRABAJO, así que ya
# incluye lo commiteado y lo que está sin guardar.
#
# Lo que NO ve son los ficheros sin seguir, y aquí eso no da igual: un fichero
# nuevo en `app/src` es código que `tsc` compilaría, y sin mirarlo este guión
# imprime «TODO BIEN» sobre un árbol roto — el verde falso de siempre, ahora en
# el freno que existe para no darlos. Medido al escribirlo: un `.ts` con un
# error de tipos, recién creado y sin `git add`, pasaba entero. Así que la
# pregunta se hace dos veces, y la segunda es por los que git todavía no sigue.
base=""
if [ "$todo" != 1 ]; then
  base=$(git -C "$repo" merge-base HEAD origin/main 2>/dev/null) || base=""
fi

toca() {                                # toca <ruta…>
  [ "$todo" = 1 ] && return 0
  [ -n "$base" ] || return 0
  git -C "$repo" diff --quiet "$base" -- "$@" || return 0
  [ -n "$(git -C "$repo" ls-files --others --exclude-standard -- "$@")" ]
}

# Un chequeo callado no se distingue de uno que aprueba, así que saltárselo se
# dice con las mismas letras que hacerlo.
saltada() {                             # saltada <título> <motivo>
  titulo "$1"
  printf '  ----    NO la he lanzado: %s.\n' "$2"
  printf '          La lanza igualmente el CI. A mano:  ./verificar.sh --todo\n'
}

# ── Las migraciones ─────────────────────────────────────────────────────────
# Esta va SIEMPRE: es un `ls` y un `sort`, cuesta un parpadeo, y es el fallo que
# de verdad mordió. El 24-08-2026 dos ramas abiertas a la vez miraron el último
# número y eligieron el mismo 0071 —videojuegos y avisos de cine—; la primera en
# fusionarse ganó y la segunda no lo descubrió hasta que `db push` falló contra
# PRODUCCIÓN con un 23505 sobre `schema_migrations`.
titulo "un número de migración, un fichero"
migraciones=$(ls "$repo"/supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
dupes=$(ls "$repo"/supabase/migrations/*.sql 2>/dev/null |
  xargs -n1 basename |
  cut -d_ -f1 |
  sort | uniq -d)
# Cero ficheros no es «no hay repetidos», es «no he mirado nada», y las dos cosas
# imprimían el mismo `ok`. reel tiene setenta y pico: un cero aquí significa que
# el directorio se ha movido y que esta sección lleva sin comprobar nada desde
# entonces, sin que se note.
if [ "$migraciones" -eq 0 ]; then
  printf '  FALLO   no he encontrado ni una migración en supabase/migrations/\n'
  printf '          Un cero no es «sin repetidos»: es que aquí no he mirado nada.\n'
  fallos=$((fallos + 1))
elif [ -n "$dupes" ]; then
  printf '  FALLO   números repetidos: %s\n' "$(printf '%s' "$dupes" | tr '\n' ' ')"
  ls "$repo"/supabase/migrations/*.sql | xargs -n1 basename |
    grep -E "^($(printf '%s' "$dupes" | paste -sd'|' -))_" | sed 's/^/          /'
  printf '          El que se renumera es el que NO esté aplicado en la base hosted:\n'
  printf '          un número ya registrado en supabase_migrations.schema_migrations\n'
  printf '          no se puede renombrar sin tocar a mano el registro de producción.\n'
  fallos=$((fallos + 1))
else
  printf '  ok      sin repetidos (%s migraciones)\n' "$migraciones"
fi

# ── La app ──────────────────────────────────────────────────────────────────
# `npm run check` es tsc + eslint + vitest, los tres que corre el job `check`.
if toca app; then
  titulo "app: tsc, eslint y vitest"
  # `npm ci` solo cuando hace falta: un worktree recién abierto no trae
  # node_modules —son seis segundos— y un package-lock más nuevo que la carpeta
  # significa que lo instalado ya no es lo que el lock dice.
  #
  # El `2>&1` envuelve al `cd` TAMBIÉN, y por eso van entre llaves: pegado solo
  # al `npm`, el «No such file or directory» del `cd` se escapaba a la terminal
  # por su cuenta mientras `$salida` quedaba vacía, o sea un FALLO sin motivo
  # debajo y el motivo suelto tres líneas más arriba.
  if [ ! -d "$repo/app/node_modules" ] ||
     [ "$repo/app/package-lock.json" -nt "$repo/app/node_modules" ]; then
    printf '  ...     instalando dependencias (node_modules al día no las trae)\n'
    if ! salida=$( { cd "$repo/app" && npm ci --no-audit --fund=false; } 2>&1 ); then
      printf '  FALLO   npm ci\n'
      printf '%s\n' "$salida" | tail -20 | sed 's/^/          /'
      fallos=$((fallos + 1))
      instalado=0
    fi
  fi
  # Con la instalación rota, `npm run check` falla seguro y por lo mismo: dos
  # rojos para una sola causa, y el de arriba —el que hay que leer— enterrado
  # bajo cuarenta líneas de tsc quejándose de que no encuentra nada.
  if [ "${instalado:-1}" = 0 ]; then
    printf '  ----    npm run check: no lo lanzo, la instalación ha fallado\n'
  elif salida=$( { cd "$repo/app" && npm run check; } 2>&1 ); then
    printf '  ok      npm run check\n'
  else
    printf '  FALLO   npm run check\n'
    printf '%s\n' "$salida" | tail -40 | sed 's/^/          /'
    fallos=$((fallos + 1))
  fi
else
  saltada "app: tsc, eslint y vitest" "app/ no ha cambiado desde main"
fi

# ── Las edge functions ──────────────────────────────────────────────────────
# No las cubre ni el tsc ni el vitest de la app: son Deno, y viven fuera de
# `app/`. Sin esto, un error de tipos viaja hasta un cron desatendido.
if toca supabase/functions; then
  titulo "edge functions: deno check y deno test"
  if ! command -v deno >/dev/null 2>&1; then
    # Que falte la herramienta NO es un aprobado. Es exactamente la forma de
    # verde falso que persigue todo lo demás: si no se ha comprobado, no está
    # bien, y decirlo en rojo es lo único honesto. La escotilla es
    # `probar-rama.sh --sin-verificar`, que la autoriza Carlos.
    printf '  FALLO   no hay deno en esta máquina, así que esto NO se ha mirado\n'
    printf '          brew install deno\n'
    fallos=$((fallos + 1))
  else
    # `--no-lock` es la única diferencia a propósito con `check.yml`, y hace
    # falta justo por vivir en tu disco y no en un contenedor de usar y tirar:
    # sin él, `deno check` deja un `deno.lock` al lado de cada `deno.json` —el de
    # `export` y el de `importer`—, reel no sigue ninguno, y ese fichero suelto
    # hace que `probar-rama.sh` se plante con «el worktree tiene cambios sin
    # guardar». Un freno que ensucia el árbol que va a juzgar se acaba apagando.
    malas=""
    miradas=0
    for dir in "$repo"/supabase/functions/*/; do
      f="${dir}index.ts"
      [ -f "$f" ] || continue
      miradas=$((miradas + 1))
      cfg="${dir}deno.json"
      if [ -f "$cfg" ]; then
        salida=$(deno check --no-lock --config "$cfg" "$f" 2>&1) || malas="$malas$salida"$'\n'
      else
        salida=$(deno check --no-lock "$f" 2>&1) || malas="$malas$salida"$'\n'
      fi
    done
    # Sin el contador, un glob que no casa con nada recorre cero funciones, deja
    # `malas` vacía e imprime el mismo `ok` que haber comprobado las siete. Y se
    # llega aquí justo cuando el cambio TOCA `supabase/functions` — mover o
    # renombrar ese directorio entra en esa definición—, así que el día que pase
    # será el día en que esta sección deje de mirar nada y siga diciendo que sí.
    if [ "$miradas" -eq 0 ]; then
      printf '  FALLO   no he encontrado ni un index.ts en supabase/functions/*/\n'
      printf '          Cero funciones comprobadas no es un aprobado.\n'
      fallos=$((fallos + 1))
    elif [ -n "$malas" ]; then
      printf '  FALLO   deno check\n'
      printf '%s' "$malas" | tail -40 | sed 's/^/          /'
      fallos=$((fallos + 1))
    else
      printf '  ok      deno check (%s funciones)\n' "$miradas"
    fi
    # Sin ficheros de prueba se aprueba: la mayoría de funciones todavía no
    # tiene, y eso no es un fallo.
    if salida=$(deno test --no-lock --permit-no-files "$repo/supabase/functions/" 2>&1); then
      printf '  ok      deno test\n'
    else
      printf '  FALLO   deno test\n'
      printf '%s\n' "$salida" | tail -40 | sed 's/^/          /'
      fallos=$((fallos + 1))
    fi
  fi
else
  saltada "edge functions: deno check y deno test" \
          "supabase/functions/ no ha cambiado desde main"
fi

# Lo que este guión tarda es parte de lo que comprueba: el objetivo son segundos,
# y avisa en vez de suspender — un chequeo que se pone rojo por lento se apaga a
# la semana.
echo
if [ "$SECONDS" -gt "${TOPE_SEGUNDOS:-30}" ]; then
  echo "OJO: esto ha tardado ${SECONDS}s, y el objetivo son ${TOPE_SEGUNDOS:-30}s."
  echo "     Lo lento tiene su sitio en el CI, no en el freno de antes del push."
fi
if [ "$fallos" -eq 0 ]; then
  echo "verificar.sh: TODO BIEN (${SECONDS}s)"
  exit 0
fi
echo "verificar.sh: $fallos comprobacion(es) en rojo (${SECONDS}s)"
exit 1
