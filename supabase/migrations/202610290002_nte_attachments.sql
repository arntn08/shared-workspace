-- Private PDF/image attachments for Notices to Explain.
-- Run this migration in Supabase SQL Editor.
alter table public.employee_ntes
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nte-attachments',
  'nte-attachments',
  false,
  10485760,
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp'];

drop policy if exists "HR uploads NTE attachments" on storage.objects;
create policy "HR uploads NTE attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'nte-attachments'
  and (storage.foldername(name))[1] = 'nte'
  and exists (
    select 1 from public.employee_ntes n
    where n.id::text = (storage.foldername(name))[2]
      and n.created_by = (select auth.uid())
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role in ('hr','owner')
      )
  )
);

drop policy if exists "Assigned users read NTE attachments" on storage.objects;
create policy "Assigned users read NTE attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'nte-attachments'
  and (storage.foldername(name))[1] = 'nte'
  and exists (
    select 1 from public.employee_ntes n
    where n.id::text = (storage.foldername(name))[2]
      and (
        n.employee_id = (select auth.uid())
        or exists (
          select 1 from public.profiles p
          where p.id = (select auth.uid()) and p.role in ('hr','owner')
        )
      )
  )
);

drop policy if exists "HR deletes NTE attachments" on storage.objects;
create policy "HR deletes NTE attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'nte-attachments'
  and (storage.foldername(name))[1] = 'nte'
  and exists (
    select 1 from public.employee_ntes n
    where n.id::text = (storage.foldername(name))[2]
      and n.created_by = (select auth.uid())
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.role in ('hr','owner')
      )
  )
);
