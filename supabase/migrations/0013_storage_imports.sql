-- 0013_storage_imports.sql
-- Private bucket for uploaded TV Time export zips, owner-scoped by the
-- <uid>/... path convention. 25MB cap. The importer edge function reads them
-- with the service-role key.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 26214400, array['application/zip', 'application/x-zip-compressed', 'application/octet-stream'])
on conflict (id) do nothing;

create policy "imports: owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "imports: owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "imports: owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'imports' and (storage.foldername(name))[1] = (select auth.uid())::text);
