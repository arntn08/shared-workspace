-- Shared Workspace: HR Notices to Explain (NTE)
-- Run in Supabase SQL Editor. NTE content is restricted to HR, workspace owners,
-- and the employee assigned to the notice.

create table if not exists public.employee_ntes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  title text not null,
  details text not null,
  due_date date,
  status text not null default 'issued' check (status in ('issued','responded','closed')),
  employee_response text,
  acknowledged_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_ntes_employee_created_idx
  on public.employee_ntes (employee_id, created_at desc);

alter table public.employee_ntes enable row level security;
revoke all on public.employee_ntes from anon;
grant select, insert, update on public.employee_ntes to authenticated;

drop policy if exists "HR and owners read NTEs" on public.employee_ntes;
create policy "HR and owners read NTEs"
on public.employee_ntes for select to authenticated
using (
  employee_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('hr','owner')
  )
);

drop policy if exists "HR and owners issue NTEs" on public.employee_ntes;
create policy "HR and owners issue NTEs"
on public.employee_ntes for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('hr','owner')
  )
);

drop policy if exists "HR and owners manage NTEs" on public.employee_ntes;
create policy "HR and owners manage NTEs"
on public.employee_ntes for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('hr','owner')
  )
  or employee_id = (select auth.uid())
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('hr','owner')
  )
  or (
    employee_id = (select auth.uid())
    and status in ('issued','responded')
  )
);

-- Notifications are intentionally not auto-created here: the existing notifications
-- table schema may differ by project. The HR portal displays NTEs directly.
