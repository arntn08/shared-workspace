-- Employee leave requests with mandatory signed physical-form attachment.
-- Run this migration in Supabase SQL Editor before using the Leave page.

create table if not exists public.employee_leave_requests (
  id uuid primary key,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  employee_name text not null,
  team_name text,
  leave_type text not null check (leave_type in ('Vacation Leave','Sick Leave','Emergency Leave','Other')),
  start_date date not null,
  end_date date not null,
  reason text not null,
  attachment_path text not null,
  attachment_name text not null,
  attachment_type text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  hr_comment text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint leave_dates_valid check (end_date >= start_date)
);

alter table public.employee_leave_requests enable row level security;

drop policy if exists "Employees submit own leave requests" on public.employee_leave_requests;
create policy "Employees submit own leave requests"
on public.employee_leave_requests for insert to authenticated
with check (
  employee_id = (select auth.uid())
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'employee' and p.active = true)
);

drop policy if exists "Employees view own leave requests" on public.employee_leave_requests;
create policy "Employees view own leave requests"
on public.employee_leave_requests for select to authenticated
using (employee_id = (select auth.uid()));

drop policy if exists "HR view all leave requests" on public.employee_leave_requests;
create policy "HR view all leave requests"
on public.employee_leave_requests for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'hr' and p.active = true));

drop policy if exists "HR review leave requests" on public.employee_leave_requests;
create policy "HR review leave requests"
on public.employee_leave_requests for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'hr' and p.active = true))
with check (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'hr' and p.active = true)
  and status in ('approved','rejected')
  and reviewed_by = (select auth.uid())
  and reviewed_at is not null
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('leave-attachments','leave-attachments',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp'];

drop policy if exists "Employees upload own leave form" on storage.objects;
create policy "Employees upload own leave form"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'leave-attachments'
  and (storage.foldername(name))[1] = 'leave'
  and exists (
    select 1 from public.employee_leave_requests r
    where r.id::text = (storage.foldername(name))[2]
      and r.employee_id = (select auth.uid())
  )
);

drop policy if exists "Employee and HR read leave forms" on storage.objects;
create policy "Employee and HR read leave forms"
on storage.objects for select to authenticated
using (
  bucket_id = 'leave-attachments'
  and (storage.foldername(name))[1] = 'leave'
  and exists (
    select 1 from public.employee_leave_requests r
    where r.id::text = (storage.foldername(name))[2]
      and (
        r.employee_id = (select auth.uid())
        or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'hr' and p.active = true)
      )
  )
);

drop policy if exists "Employees delete own pending leave form" on storage.objects;
create policy "Employees delete own pending leave form"
on storage.objects for delete to authenticated
using (
  bucket_id = 'leave-attachments'
  and (storage.foldername(name))[1] = 'leave'
  and exists (
    select 1 from public.employee_leave_requests r
    where r.id::text = (storage.foldername(name))[2]
      and r.employee_id = (select auth.uid())
      and r.status = 'pending'
  )
);
