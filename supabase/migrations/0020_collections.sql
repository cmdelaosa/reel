-- 0020_collections.sql
-- Curated collections. Schema is deterministic; the 4 collection rows are
-- seeded here, and their titles are populated from whatever's already in the
-- metadata cache by criteria (so on a fresh/empty DB the collections exist but
-- fill in as titles get cached). Read-all (authenticated); service-role write.

create table public.collections (
  id       uuid primary key default gen_random_uuid(),
  slug     text unique not null,
  name     text not null,
  sub      text not null,
  hue      int not null,
  position int not null default 0
);

create table public.collection_titles (
  collection_id uuid not null references public.collections on delete cascade,
  title_id      uuid not null references public.titles on delete cascade,
  position      int not null default 0,
  primary key (collection_id, title_id)
);

alter table public.collections enable row level security;
alter table public.collection_titles enable row level security;
revoke all on public.collections, public.collection_titles from anon, authenticated;
grant select on public.collections, public.collection_titles to authenticated;
grant all on public.collections, public.collection_titles to service_role;

create policy "collections: authenticated read"
  on public.collections for select to authenticated using (true);
create policy "collection_titles: authenticated read"
  on public.collection_titles for select to authenticated using (true);

-- ── seed the 4 collections ───────────────────────────────────────────────────
insert into public.collections (slug, name, sub, hue, position) values
  ('critically-acclaimed', 'Critically acclaimed', 'The best-reviewed of the decade', 265, 0),
  ('bingeable-weekend',    'Bingeable in a weekend', 'Short and unmissable', 12, 1),
  ('mind-benders',         'Mind-benders', 'Sci-fi that rewires you', 190, 2),
  ('award-winners',        'Award winners', 'Emmy & Globe darlings', 45, 3)
on conflict (slug) do nothing;

-- Populate from the cache by criteria (idempotent).
insert into public.collection_titles (collection_id, title_id, position)
select c.id, t.id, row_number() over (order by t.vote_average desc nulls last)
from public.collections c
join public.titles t on t.vote_average >= 8.3
where c.slug = 'critically-acclaimed'
order by t.vote_average desc nulls last
limit 12
on conflict do nothing;

insert into public.collection_titles (collection_id, title_id, position)
select c.id, t.id, row_number() over (order by t.popularity desc nulls last)
from public.collections c
join public.titles t on t.genres && array['Comedy']
where c.slug = 'bingeable-weekend'
order by t.popularity desc nulls last
limit 12
on conflict do nothing;

insert into public.collection_titles (collection_id, title_id, position)
select c.id, t.id, row_number() over (order by t.vote_average desc nulls last)
from public.collections c
join public.titles t on t.genres && array['Sci-Fi & Fantasy', 'Mystery']
where c.slug = 'mind-benders'
order by t.vote_average desc nulls last
limit 12
on conflict do nothing;

insert into public.collection_titles (collection_id, title_id, position)
select c.id, t.id, row_number() over (order by t.vote_average desc nulls last)
from public.collections c
join public.titles t on t.genres && array['Drama'] and t.vote_average >= 8.0
where c.slug = 'award-winners'
order by t.vote_average desc nulls last
limit 12
on conflict do nothing;
