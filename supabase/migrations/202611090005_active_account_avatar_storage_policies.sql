-- Ensure deactivated accounts cannot access or modify avatar objects.
-- Owner and Editor access remains available only while those accounts are active.

drop policy if exists "avatar read" on storage.objects;
create policy "avatar read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and public.is_active()
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_owner()
    or public.is_editor()
  )
);

drop policy if exists "avatar update" on storage.objects;
create policy "avatar update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active()
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active()
);

drop policy if exists "avatar delete" on storage.objects;
create policy "avatar delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active()
);
