-- 0082_nintendo.sql
-- Traer de Nintendo las horas jugadas. La cuarta rodaja del modo Videojuegos:
-- el catálogo lo puso 0071, el progreso a mano 0073, Steam 0076, y el estado y
-- la nota de la pantalla de confirmar 0078.
--
-- ── Nintendo no tiene login, tiene código de amigo ────────────────────────
-- Con Steam la identidad era de la PERSONA (OpenID devuelve su SteamID64) y la
-- clave era del PROYECTO. Con Nintendo no hay ninguna de las dos cosas: no
-- existe API pública de bibliotecas, y la única forma de saber a qué ha jugado
-- alguien es preguntárselo a la API de la app Nintendo Switch Online — donde no
-- se pregunta "¿qué ha jugado el del código SW-…?" como desconocido, sino desde
-- DENTRO de la app, con una cuenta de Nintendo que hace la pregunta.
--
-- De ahí la forma de esta rodaja, que es la misma que usa Exophase:
--
--   · Reel tiene UNA cuenta de Nintendo propia, la que pregunta. No es de
--     nadie del grupo y nadie la ve: vive en el secreto NINTENDO_SESSION_TOKEN
--     (ver docs/DEPLOY.md).
--   · De cada persona se guarda su CÓDIGO DE AMIGO, que es lo único que hay
--     que pedirle. Eso es todo su enlace: ni contraseña, ni pantalla de
--     permisos, ni token que caduque.
--   · Y hace falta que esa persona ponga en su Switch la privacidad del
--     registro de juego en "Todos". Sin eso Nintendo no le enseña la lista a
--     nadie que no sea ella, y la importación se queda en cero — un caso que la
--     interfaz tiene que saber distinguir de "no has jugado a nada".
--
-- ── Lo que Nintendo da, y lo que no ──────────────────────────────────────
-- Da el nombre, la carátula y `totalPlayTime` en MINUTOS acumulados de por
-- vida. No da la última partida, y esa ausencia decide dos cosas:
--
--   1. La pantalla de confirmar de Nintendo no ofrece "terminado". Con Steam sí
--      lo ofrece porque hay `rtime_last_played` con el que fechar el evento
--      (0078); aquí fecharlo sería ponerle a todo el día de hoy, que es
--      exactamente el muro mentiroso que 0078 existe para no publicar. Se marca
--      desde la ficha, que es donde la fecha la pones tú.
--   2. `library_entries.played_at` se APRENDE. Cada sincronización compara los
--      minutos con los de la vez anterior, y cuando suben, esa es la última
--      partida. La primera importación no lo sabe y lo deja como esté; a partir
--      de ahí Reel lo sabe mejor que Nintendo.
--
-- Y un tercer límite que no es nuestro: Nintendo solo lista el registro
-- RECIENTE, no todo lo jugado. Lo que no salga aparecerá en cuanto se juegue, y
-- desde ese momento ya es de Reel aunque Nintendo deje de listarlo.

-- ============================================================
-- 1. El código de amigo, en el perfil
-- ============================================================
-- El formato es el que se lee en la consola: SW- y tres grupos de cuatro
-- dígitos. Se guarda tal cual se enseña, con guiones, porque es lo que la
-- persona va a copiar y lo que va a comparar cuando dude de haberlo escrito
-- bien; normalizarlo a doce dígitos ahorraría tres bytes y le quitaría a la
-- pantalla la única forma de darle la razón.
alter table public.profiles add column if not exists nintendo_friend_code text;
alter table public.profiles drop constraint if exists profiles_nintendo_friend_code_check;
alter table public.profiles add constraint profiles_nintendo_friend_code_check
  check (nintendo_friend_code is null or nintendo_friend_code ~ '^SW-[0-9]{4}-[0-9]{4}-[0-9]{4}$');

-- El NSA ID es lo que Nintendo devuelve al resolver el código, y es lo que va
-- en TODAS las peticiones siguientes. Se guarda para no volver a resolver el
-- código en cada sincronización: esa llamada la limita Nintendo, y gastarla
-- cada vez para obtener siempre lo mismo es pedir que un día nos la corten
-- justo cuando alguien está importando.
alter table public.profiles add column if not exists nintendo_nsa_id text;
alter table public.profiles add column if not exists nintendo_linked_at timestamptz;

-- Único por la misma razón que `steam_id` en 0076: dos perfiles de Reel
-- apuntando a la misma cuenta de Nintendo significa que alguien puso el código
-- de otro, y la sincronización escribiría en dos bibliotecas desde una sola
-- fuente. Va sobre el NSA ID y no sobre el código porque el NSA ID es lo que
-- Nintendo confirma; el código es lo que alguien escribe.
create unique index if not exists profiles_nintendo_nsa_id_key
  on public.profiles (nintendo_nsa_id) where nintendo_nsa_id is not null;

comment on column public.profiles.nintendo_friend_code is
  'SW-1234-5678-9012. Lo unico que se le pide a la persona: no hay login de Nintendo por usuario.';
comment on column public.profiles.nintendo_nsa_id is
  'Lo que Nintendo devuelve al resolver el codigo de amigo. Se guarda para no gastar esa llamada en cada sincronizacion.';

-- ============================================================
-- 2. Las tablas de la importación dejan de ser de Steam
-- ============================================================
-- 0076 las llamó `steam_imports` y `steam_import_items` porque entonces solo
-- había un proveedor. Ahora hay dos, y una tabla llamada `steam_import_items`
-- con dentro los juegos de tu Switch es un nombre que miente — la clase de
-- mentira que se descubre seis meses después, leyendo una consulta y
-- entendiendo justo lo contrario de lo que hace.
--
-- Se renombran en vez de duplicarse porque lo que guardan es lo MISMO: un
-- borrador que se revisa una vez y se confirma una vez. Lo que cambia entre
-- proveedores no es la forma del borrador, es de dónde salen las filas.
do $$
begin
  if to_regclass('public.steam_imports') is not null then
    alter table public.steam_imports rename to game_imports;
    alter index steam_imports_user_idx rename to game_imports_user_idx;
    alter policy "steam_imports: owner reads own" on public.game_imports
      rename to "game_imports: owner reads own";
  end if;

  if to_regclass('public.steam_import_items') is not null then
    alter table public.steam_import_items rename to game_import_items;
    alter index steam_import_items_import_idx rename to game_import_items_import_idx;
    alter policy "steam_import_items: owner reads own" on public.game_import_items
      rename to "game_import_items: owner reads own";
  end if;
end $$;

-- Quién trajo estas filas. Sin defecto a propósito: un defecto 'steam' haría
-- que una función nueva que se olvide de decirlo escriba juegos de Switch
-- etiquetados como de Steam, y eso no falla — solo miente en la pantalla y en
-- el recibo. Las filas que ya existen sí se rellenan, porque de esas sí
-- sabemos de dónde vienen.
alter table public.game_imports add column if not exists provider text;
update public.game_imports set provider = 'steam' where provider is null;
alter table public.game_imports alter column provider set not null;
alter table public.game_imports drop constraint if exists game_imports_provider_check;
alter table public.game_imports add constraint game_imports_provider_check
  check (provider in ('steam', 'nintendo'));

comment on column public.game_imports.provider is
  'steam | nintendo. Sin defecto: escribirlo es obligacion de quien inserta, para que ninguna fila mienta sobre su origen.';

-- El identificador que usa el proveedor, como TEXTO. Con Steam era `appid int`
-- y con eso bastaba; Nintendo no da ningún número que sirva de llave, así que
-- la columna tiene que aceptar las dos cosas. Steam sigue escribiendo su appid
-- —convertido en la frontera, ver steam-sync— y Nintendo escribe el nsuid de la
-- tienda cuando lo hay y `name:<nombre normalizado>` cuando no.
--
-- Un int con un text al lado, cada uno nulo la mitad de las veces, era la otra
-- opción: dos columnas, una comprueba que dice cuál toca según el proveedor, y
-- todas las consultas eligiendo. Una columna de texto y una conversión en un
-- solo sitio es menos superficie.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'game_import_items' and column_name = 'appid'
  ) then
    alter table public.game_import_items rename column appid to external_id;
    alter table public.game_import_items alter column external_id type text using external_id::text;
    alter table public.game_import_items rename constraint steam_import_items_import_id_appid_key
      to game_import_items_import_id_external_id_key;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'game_import_items' and column_name = 'steam_name'
  ) then
    alter table public.game_import_items rename column steam_name to name;
  end if;
end $$;

-- La carátula, solo cuando el proveedor la da. Steam no la necesita: se arma
-- desde el appid con una URL fija de su CDN, y guardar trescientas URLs
-- calculables sería guardar la misma plantilla trescientas veces. Nintendo no
-- tiene esa plantilla —la imagen vive bajo un hash suyo— así que la manda con
-- cada juego y hay que quedársela, o la pantalla de confirmar son veinte
-- nombres sin arte, que es justo lo que 0076 decidió no hacer.
alter table public.game_import_items add column if not exists image_uri text;

comment on column public.game_import_items.external_id is
  'El id del proveedor como texto: el appid con Steam, el nsuid (o name:<normalizado>) con Nintendo.';
comment on column public.game_import_items.image_uri is
  'Solo Nintendo: la caratula que manda el registro de juego. Con Steam es null y se calcula desde el appid.';

-- ============================================================
-- 3. De dónde salieron las horas
-- ============================================================
-- `minutes_source` lo puso 0073 con dos valores posibles ('manual' | 'steam') y
-- una comprueba que ahora se queda corta. Se amplía en vez de quitarse: es lo
-- que hace que la ficha pueda decir "12 h según Nintendo" frente a las que
-- escribiste tú, y sobre todo es lo que impide que una sincronización pise una
-- cifra escrita a mano (ver merge.ts, regla 2).
alter table public.library_entries drop constraint if exists library_entries_minutes_source_check;
alter table public.library_entries add constraint library_entries_minutes_source_check
  check (minutes_source is null or minutes_source in ('manual', 'steam', 'nintendo'));

comment on column public.library_entries.minutes_source is
  'manual | steam | nintendo. Una cifra manual no la pisa ninguna sincronizacion.';
