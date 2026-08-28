-- Marca de volcado en el libro de Steam.
--
-- Por qué hace falta: hasta hoy, corregir cómo se CLASIFICA una fila del
-- historial de la cartera le cambiaba el `external_id` —el id llevaba el `kind`
-- dentro— y la fila corregida entraba AL LADO de la equivocada en vez de encima.
-- El caso real: las recargas de cartera venían etiquetadas como compra en la
-- tienda, porque la columna de tipo de Steam pone "Compra" también cuando
-- recargas; arreglarlo habría duplicado cada recarga y contado ese dinero dos
-- veces, una como gasto y otra como ingreso.
--
-- El id ya no lleva la clasificación dentro (ver steamCollector.js). Esta
-- columna resuelve la otra mitad: las filas que escribió el volcado ANTERIOR y
-- que el nuevo ya no trae —porque hoy se llaman de otra forma— hay que barrerlas.
-- Es la misma mecánica que `steam_holdings.collected_at`: se escribe todo con la
-- marca de esta pasada y se borra después lo que se quedó con una marca vieja.
--
-- El `null` de las filas que ya están en la tabla no es un descuido: son
-- justamente las del volcado equivocado, y entran en el primer barrido.
alter table public.steam_ledger
  add column if not exists collected_at timestamptz;

comment on column public.steam_ledger.collected_at is
  'Marca del volcado que escribio esta fila. Solo la usan las filas de la cartera (external_id wallet_...): el volcado completo barre las que quedaron con una marca anterior. Null = escrita antes de que existiera esta columna.';

-- El barrido pregunta por (user_id, external_id like 'wallet_%', collected_at).
create index if not exists steam_ledger_user_collected_idx
  on public.steam_ledger (user_id, collected_at)
  where external_id like 'wallet\_%';
