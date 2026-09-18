#!/usr/bin/env bash
# Corre TODAS las matrices de este directorio contra la base local, y falla si
# falla una. Lo llaman el job `migrations` de `.github/workflows/check.yml` y
# `./verificar.sh`: un solo guión para los dos, porque la misma comprobación
# escrita dos veces es cómo una de las dos se queda vieja.
#
# Hasta hoy estas matrices solo corrían a mano, o sea cuando alguien se acordaba.
# La PR #132 (migración 0098) reescribió `rpc_library_rollup` partiendo de una
# versión vieja y le quitó dos columnas; el CI salió verde porque no había nada
# en el CI que llamase a la función. Una matriz que no corre sola no es una red.
#
# Cada fichero es una transacción que acaba en `rollback`, así que esto no deja
# nada en la base y se puede lanzar las veces que haga falta.
#
#   supabase/sql-checks/correr.sh            # contra supabase_db_<project_id>
#   CONTENEDOR_DB=otro supabase/sql-checks/correr.sh
set -uo pipefail

aqui=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
supa=$(dirname "$aqui")
# Se puede apuntar a otro directorio: es como se demuestra que esto sabe fallar,
# rompiendo una matriz en una COPIA y no en la de verdad.
matrices=${MATRICES_DIR:-$aqui}

# El nombre sale de config.toml y no de un `grep supabase_db` sobre `docker ps`:
# en una máquina con dos proyectos de Supabase arriba, el grep elige el primero
# que salga y las matrices corren, en verde o en rojo, contra la base de otro.
proyecto=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "$supa/config.toml" | head -1)
contenedor=${CONTENEDOR_DB:-supabase_db_$proyecto}

if ! docker exec "$contenedor" true >/dev/null 2>&1; then
  printf '  FALLO   no hay base local: el contenedor %s no responde\n' "$contenedor"
  printf '          supabase start\n'
  exit 1
fi

sql() { docker exec -i "$contenedor" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

# Una matriz que pasa contra un esquema que no es el de esta rama no ha probado
# nada. Lo que se puede saber barato es si los números coinciden; una migración
# editada EN SU SITIO después de aplicada no se ve desde aquí, y para eso está
# el CI, que parte siempre de una base vacía.
en_disco=$(ls "$supa"/migrations/*.sql 2>/dev/null | xargs -n1 basename | cut -d_ -f1 | sort)
aplicadas=$(sql -Atc 'select version from supabase_migrations.schema_migrations' 2>/dev/null | sort)
faltan=$(comm -23 <(printf '%s\n' "$en_disco") <(printf '%s\n' "$aplicadas") | paste -sd' ' -)
sobran=$(comm -13 <(printf '%s\n' "$en_disco") <(printf '%s\n' "$aplicadas") | paste -sd' ' -)
if [ -n "$faltan" ]; then
  printf '  FALLO   la base local no tiene aplicadas: %s\n' "$faltan"
  printf '          Las matrices correrían contra el esquema de ANTES del cambio.\n'
  printf '          supabase db reset   (o `supabase migration up` si no quieres perder datos)\n'
  exit 1
fi
# Al revés no se suspende: la pila local es UNA para todos los worktrees, y la
# base adelantada es el estado normal en cuanto otra sesión tiene una migración
# abierta. Suspender aquí obligaría a un `db reset` que le rompe la base a la
# otra. Se dice, y el veredicto limpio lo da el CI.
if [ -n "$sobran" ]; then
  printf '  OJO     la base local tiene migraciones que esta rama no trae: %s\n' "$sobran"
  printf '          Lo que salga aquí es contra ESE esquema; el del CI es el limpio.\n'
fi

corridas=0
rojas=0
for f in "$matrices"/*.sql; do
  [ -f "$f" ] || continue
  corridas=$((corridas + 1))
  # Por la entrada estándar y no con `docker cp`: no deja un /tmp/t.sql que la
  # siguiente matriz pueda encontrarse si su copia falla.
  if salida=$(sql -q -f - < "$f" 2>&1); then
    printf '  ok      %s\n' "$(basename "$f")"
  else
    printf '  FALLO   %s\n' "$(basename "$f")"
    # El motivo son las líneas de ERROR y su CONTEXT; lo demás son las tablas
    # que las matrices imprimen por el camino, y enterraban el motivo bajo
    # quince líneas de `set_config`. Si no hay ninguna —psql muerto, conexión
    # caída— se enseña el final en crudo, porque callarse ahí es peor.
    motivo=$(printf '%s\n' "$salida" | grep -E '^(psql:|ERROR|CONTEXT|DETAIL|HINT|FATAL)')
    if [ -n "$motivo" ]; then
      printf '%s\n' "$motivo" | head -10 | sed 's/^/          /'
    else
      printf '%s\n' "$salida" | grep -v '^$' | tail -10 | sed 's/^/          /'
    fi
    rojas=$((rojas + 1))
  fi
done

# Cero ficheros no es «todas pasan», es «no he mirado nada» — el mismo cero que
# vigila verificar.sh con las migraciones.
if [ "$corridas" -eq 0 ]; then
  printf '  FALLO   no he encontrado ni una matriz en %s\n' "$matrices"
  exit 1
fi
[ "$rojas" -eq 0 ]
