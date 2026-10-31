-- Project Coordinator & Sales Activities
-- Run in Supabase SQL Editor after creating the five Auth users.
-- This feature uses a separate mapping table; existing workspace roles are unchanged.

create table if not exists public.sales_team_leaders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team_leader_name text not null,
  district text not null,
  team_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sales_team_leaders enable row level security;

create table if not exists public.sales_activity_proposals (
  id uuid primary key default gen_random_uuid(),
  team_leader_id uuid not null references public.sales_team_leaders(user_id) on delete cascade,
  activity_type text not null check (activity_type in ('Saturation','Booth deployment','Event','Other')),
  proposed_date date,
  end_date date,
  barangay text,
  streets text,
  location text,
  details text not null,
  remarks text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','changes_requested')),
  coordinator_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_dates_valid check (end_date is null or proposed_date is null or end_date >= proposed_date)
);
alter table public.sales_activity_proposals enable row level security;

create table if not exists public.sales_activity_schedule (
  id uuid primary key default gen_random_uuid(),
  source_proposal_id uuid references public.sales_activity_proposals(id) on delete set null,
  team_leader_id uuid not null references public.sales_team_leaders(user_id) on delete cascade,
  activity_type text not null,
  scheduled_date date not null,
  end_date date,
  barangay text,
  streets text,
  location text,
  details text not null,
  remarks text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.sales_activity_schedule enable row level security;

create table if not exists public.sales_booth_deployments (
  id uuid primary key default gen_random_uuid(),
  team_leader_id uuid not null references public.sales_team_leaders(user_id) on delete cascade,
  booth_location text not null,
  barangay text,
  deployment_start date,
  deployment_end date,
  remarks text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','changes_requested')),
  coordinator_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sales_booth_deployments enable row level security;

-- Owner is the only role allowed into coordinator data. Team leaders see and submit only their own records.
create or replace function public.is_project_coordinator_owner()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'owner' and p.active = true
  );
$$;

drop policy if exists "Coordinator manages leader mappings" on public.sales_team_leaders;
create policy "Coordinator manages leader mappings" on public.sales_team_leaders
for all to authenticated using (public.is_project_coordinator_owner())
with check (public.is_project_coordinator_owner());

drop policy if exists "Leader reads own mapping" on public.sales_team_leaders;
create policy "Leader reads own mapping" on public.sales_team_leaders
for select to authenticated using (user_id = auth.uid() and active = true);

drop policy if exists "Owner manages proposals" on public.sales_activity_proposals;
create policy "Owner manages proposals" on public.sales_activity_proposals
for all to authenticated using (public.is_project_coordinator_owner())
with check (public.is_project_coordinator_owner());

drop policy if exists "Leader reads own proposals" on public.sales_activity_proposals;
create policy "Leader reads own proposals" on public.sales_activity_proposals
for select to authenticated using (team_leader_id = auth.uid());

drop policy if exists "Leader submits own proposals" on public.sales_activity_proposals;
create policy "Leader submits own proposals" on public.sales_activity_proposals
for insert to authenticated with check (
  team_leader_id = auth.uid()
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and exists (select 1 from public.sales_team_leaders l where l.user_id = auth.uid() and l.active = true)
);

drop policy if exists "Leader edits own pending proposals" on public.sales_activity_proposals;
create policy "Leader edits own pending proposals" on public.sales_activity_proposals
for update to authenticated
using (team_leader_id = auth.uid() and status in ('pending','changes_requested'))
with check (team_leader_id = auth.uid() and status in ('pending','changes_requested') and reviewed_by is null and reviewed_at is null);

drop policy if exists "Owner manages official schedule" on public.sales_activity_schedule;
create policy "Owner manages official schedule" on public.sales_activity_schedule
for all to authenticated using (public.is_project_coordinator_owner())
with check (public.is_project_coordinator_owner());

drop policy if exists "Leader reads own approved schedule" on public.sales_activity_schedule;
create policy "Leader reads own approved schedule" on public.sales_activity_schedule
for select to authenticated using (team_leader_id = auth.uid());

drop policy if exists "Owner manages booth deployments" on public.sales_booth_deployments;
create policy "Owner manages booth deployments" on public.sales_booth_deployments
for all to authenticated using (public.is_project_coordinator_owner())
with check (public.is_project_coordinator_owner());

drop policy if exists "Leader reads own booth proposals" on public.sales_booth_deployments;
create policy "Leader reads own booth proposals" on public.sales_booth_deployments
for select to authenticated using (team_leader_id = auth.uid());

drop policy if exists "Leader submits booth proposals" on public.sales_booth_deployments;
create policy "Leader submits booth proposals" on public.sales_booth_deployments
for insert to authenticated with check (
  team_leader_id = auth.uid()
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and exists (select 1 from public.sales_team_leaders l where l.user_id = auth.uid() and l.active = true)
);

-- Add leader accounts only AFTER creating their Auth users in Authentication > Users.
-- Replace each email with the actual login email used for that person.
insert into public.sales_team_leaders (user_id, team_leader_name, district, team_code)
select u.id, v.team_leader_name, v.district, v.team_code
from (values
  ('Jinky Balayan','D3','JINKY-D3','jinky@example.com'),
  ('James Garcia','D4','JAMES-D4','james@example.com'),
  ('Creslyn Maglaque','D2','CRESLYN-D2','creslyn@example.com'),
  ('Arman Sacris','D5','ARMAN-D5','arman@example.com'),
  ('Jay Marcelo','D6','JAY-D6','jay@example.com')
) as v(team_leader_name,district,team_code,email)
join auth.users u on lower(u.email) = lower(v.email)
on conflict (user_id) do update set
  team_leader_name = excluded.team_leader_name,
  district = excluded.district,
  team_code = excluded.team_code,
  active = true;

-- Review this result. Any row not found means the matching Auth user has not been created
-- or the email placeholder above has not been replaced.
select team_leader_name, district, team_code, user_id, active
from public.sales_team_leaders
order by district, team_leader_name;
