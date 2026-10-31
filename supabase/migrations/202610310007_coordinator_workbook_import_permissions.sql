-- Allow the dedicated Project Coordinator to import and maintain workbook-backed records.
drop policy if exists "Coordinator manages saturation calendar" on public.sales_calendar_assignments;
create policy "Coordinator manages saturation calendar" on public.sales_calendar_assignments
for all to authenticated using (public.is_project_coordinator())
with check (public.is_project_coordinator());

drop policy if exists "Coordinator manages workbook booths" on public.sales_booth_directory;
create policy "Coordinator manages workbook booths" on public.sales_booth_directory
for all to authenticated using (public.is_project_coordinator())
with check (public.is_project_coordinator());

drop policy if exists "Coordinator manages workbook areas" on public.sales_area_directory;
create policy "Coordinator manages workbook areas" on public.sales_area_directory
for all to authenticated using (public.is_project_coordinator())
with check (public.is_project_coordinator());
