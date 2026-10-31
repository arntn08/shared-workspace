-- Workbook-backed booth and area directories
create table if not exists public.sales_booth_directory (
  id uuid primary key default gen_random_uuid(),
  team_leader text not null default '',
  booth_location text not null default '',
  barangay text not null default '',
  deployment_date text not null default '',
  remarks text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.sales_area_directory (
  id uuid primary key default gen_random_uuid(),
  area_district text not null,
  district text not null default '',
  team_leader_reference text not null default '',
  street_name text not null,
  created_at timestamptz not null default now()
);
alter table public.sales_booth_directory enable row level security;
alter table public.sales_area_directory enable row level security;

drop policy if exists "Coordinator reads workbook booths" on public.sales_booth_directory;
create policy "Coordinator reads workbook booths" on public.sales_booth_directory
for select to authenticated using (public.is_project_coordinator());

drop policy if exists "Coordinator reads workbook areas" on public.sales_area_directory;
create policy "Coordinator reads workbook areas" on public.sales_area_directory
for select to authenticated using (public.is_project_coordinator());

drop policy if exists "Owner manages workbook booths" on public.sales_booth_directory;
create policy "Owner manages workbook booths" on public.sales_booth_directory
for all to authenticated using (public.is_project_coordinator_owner())
with check (public.is_project_coordinator_owner());

drop policy if exists "Owner manages workbook areas" on public.sales_area_directory;
create policy "Owner manages workbook areas" on public.sales_area_directory
for all to authenticated using (public.is_project_coordinator_owner())
with check (public.is_project_coordinator_owner());
