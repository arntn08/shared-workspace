-- Spreadsheet-backed Sales Calendar for Project Coordinator and Team Leaders.
create table if not exists public.sales_calendar_assignments (
  id uuid primary key default gen_random_uuid(),
  team_leader_id uuid not null references public.sales_team_leaders(user_id) on delete cascade,
  scheduled_date date not null,
  assignment_details text not null,
  source_sheet text not null,
  created_at timestamptz not null default now(),
  unique(team_leader_id, scheduled_date)
);
alter table public.sales_calendar_assignments enable row level security;

drop policy if exists "Coordinator reads sales calendar" on public.sales_calendar_assignments;
create policy "Coordinator reads sales calendar" on public.sales_calendar_assignments
for select to authenticated using (public.is_project_coordinator());

drop policy if exists "Team leader reads own sales calendar" on public.sales_calendar_assignments;
create policy "Team leader reads own sales calendar" on public.sales_calendar_assignments
for select to authenticated using (team_leader_id = auth.uid());

drop policy if exists "Owner manages sales calendar" on public.sales_calendar_assignments;
create policy "Owner manages sales calendar" on public.sales_calendar_assignments
for all to authenticated using (public.is_project_coordinator_owner())
with check (public.is_project_coordinator_owner());

-- Temporary staging table for the workbook CSV. It contains no account IDs.
create table if not exists public.sales_calendar_import (
  scheduled_date date not null,
  leader_name text not null,
  assignment_details text not null,
  source_sheet text not null
);
alter table public.sales_calendar_import enable row level security;
drop policy if exists "Coordinator manages calendar import staging" on public.sales_calendar_import;
create policy "Coordinator manages calendar import staging" on public.sales_calendar_import
for all to authenticated using (public.is_project_coordinator())
with check (public.is_project_coordinator());

-- After importing the supplied CSV into sales_calendar_import, run this merge:
-- insert into public.sales_calendar_assignments(team_leader_id,scheduled_date,assignment_details,source_sheet)
-- select l.user_id,i.scheduled_date,i.assignment_details,i.source_sheet
-- from public.sales_calendar_import i
-- join public.sales_team_leaders l on lower(l.team_leader_name)=lower(i.leader_name) and l.active=true
-- on conflict(team_leader_id,scheduled_date) do update
-- set assignment_details=excluded.assignment_details,source_sheet=excluded.source_sheet;
