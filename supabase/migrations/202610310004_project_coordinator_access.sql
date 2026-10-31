-- Dedicated Project Coordinator access for AHBA Shared Workspace.
-- This grants portal access without changing the user's profiles.role.

create table if not exists public.project_coordinator_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.project_coordinator_access enable row level security;

create or replace function public.is_project_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_coordinator_access a
    where a.user_id = auth.uid()
      and a.active = true
  );
$$;

drop policy if exists "Coordinator reads own access" on public.project_coordinator_access;
create policy "Coordinator reads own access"
on public.project_coordinator_access
for select
to authenticated
using (user_id = auth.uid() and active = true);

drop policy if exists "Owner manages coordinator access" on public.project_coordinator_access;
create policy "Owner manages coordinator access"
on public.project_coordinator_access
for all
to authenticated
using (public.is_project_coordinator_owner())
with check (public.is_project_coordinator_owner());

drop policy if exists "Project coordinator reads leader mappings" on public.sales_team_leaders;
create policy "Project coordinator reads leader mappings"
on public.sales_team_leaders
for select
to authenticated
using (public.is_project_coordinator());

drop policy if exists "Project coordinator manages activity proposals" on public.sales_activity_proposals;
create policy "Project coordinator manages activity proposals"
on public.sales_activity_proposals
for all
to authenticated
using (public.is_project_coordinator())
with check (public.is_project_coordinator());

drop policy if exists "Project coordinator manages activity schedule" on public.sales_activity_schedule;
create policy "Project coordinator manages activity schedule"
on public.sales_activity_schedule
for all
to authenticated
using (public.is_project_coordinator())
with check (public.is_project_coordinator());

drop policy if exists "Project coordinator manages booth deployments" on public.sales_booth_deployments;
create policy "Project coordinator manages booth deployments"
on public.sales_booth_deployments
for all
to authenticated
using (public.is_project_coordinator())
with check (public.is_project_coordinator());

-- Enable Josh's dedicated coordinator access if his Auth user already exists.
insert into public.project_coordinator_access (user_id, email, active)
select id, email, true
from auth.users
where lower(email) = lower('ahba.josh@gmail.com')
on conflict (user_id) do update
set email = excluded.email,
    active = true;

-- Verify the account mapping after running this migration.
select u.email, a.active, a.user_id
from public.project_coordinator_access a
join auth.users u on u.id = a.user_id
where lower(u.email) = lower('ahba.josh@gmail.com');
