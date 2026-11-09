-- AHBA Shared Workspace: require active employee accounts for leave-file upload/delete
-- Apply in Supabase Dashboard -> SQL Editor.
-- Keeps the existing path convention: leave/<leave-request-id>/<filename>.

drop policy if exists "Employees upload own leave form" on storage.objects;

create policy "Employees upload own leave form"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'leave-attachments'
  and (storage.foldername(name))[1] = 'leave'
  and exists (
    select 1
    from public.employee_leave_requests r
    where r.id::text = (storage.foldername(name))[2]
      and r.employee_id = (select auth.uid())
      and r.status = 'pending'
      and exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.role = 'employee'
          and p.active = true
      )
  )
);

drop policy if exists "Employees delete own pending leave form" on storage.objects;

create policy "Employees delete own pending leave form"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'leave-attachments'
  and (storage.foldername(name))[1] = 'leave'
  and exists (
    select 1
    from public.employee_leave_requests r
    where r.id::text = (storage.foldername(name))[2]
      and r.employee_id = (select auth.uid())
      and r.status = 'pending'
      and exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.role = 'employee'
          and p.active = true
      )
  )
);
