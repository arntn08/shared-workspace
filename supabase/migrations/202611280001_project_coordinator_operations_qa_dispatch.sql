-- Project Coordinator / QA Dispatcher operational permissions.
-- Extends the dedicated coordinator account without changing profiles.role
-- or granting owner/editor administration privileges.

drop policy if exists "Project coordinator reads schedule workbooks" on public.files;
create policy "Project coordinator reads schedule workbooks" on public.files for select to authenticated
using (public.is_project_coordinator() and kind = 'gsheet');

drop policy if exists "Project coordinator reads roster" on public.roster;
create policy "Project coordinator reads roster" on public.roster for select to authenticated
using (public.is_project_coordinator());

drop policy if exists "Project coordinator inserts imported work orders" on public.installation_imported_work_orders;
create policy "Project coordinator inserts imported work orders" on public.installation_imported_work_orders for insert to authenticated
with check (public.is_project_coordinator());

drop policy if exists "Project coordinator updates imported work orders" on public.installation_imported_work_orders;
create policy "Project coordinator updates imported work orders" on public.installation_imported_work_orders for update to authenticated
using (public.is_project_coordinator()) with check (public.is_project_coordinator());

drop policy if exists "Project coordinator deletes imported work orders" on public.installation_imported_work_orders;
create policy "Project coordinator deletes imported work orders" on public.installation_imported_work_orders for delete to authenticated
using (public.is_project_coordinator());

drop policy if exists "Project coordinator manages tally overrides" on public.installation_tally_overrides;
create policy "Project coordinator manages tally overrides" on public.installation_tally_overrides for all to authenticated
using (public.is_project_coordinator()) with check (public.is_project_coordinator());

drop policy if exists "Project coordinator manages team quotas" on public.installation_team_monthly_quotas;
create policy "Project coordinator manages team quotas" on public.installation_team_monthly_quotas for all to authenticated
using (public.is_project_coordinator()) with check (public.is_project_coordinator());

drop policy if exists "Project coordinator manages department quotas" on public.installation_department_monthly_quotas;
create policy "Project coordinator manages department quotas" on public.installation_department_monthly_quotas for all to authenticated
using (public.is_project_coordinator()) with check (public.is_project_coordinator());

drop policy if exists "Project coordinator manages schedule assignments" on public.schedule_daily_assignments;
create policy "Project coordinator manages schedule assignments" on public.schedule_daily_assignments for all to authenticated
using (public.is_project_coordinator()) with check (public.is_project_coordinator());

drop policy if exists "Project coordinator manages schedule absences" on public.schedule_absences;
create policy "Project coordinator manages schedule absences" on public.schedule_absences for all to authenticated
using (public.is_project_coordinator()) with check (public.is_project_coordinator());

drop policy if exists "Project coordinator manages schedule history" on public.schedule_change_history;
create policy "Project coordinator manages schedule history" on public.schedule_change_history for all to authenticated
using (public.is_project_coordinator()) with check (public.is_project_coordinator());

grant select on public.files, public.roster to authenticated;
grant select, insert, update, delete on public.installation_imported_work_orders to authenticated;
grant select, insert, update, delete on public.installation_tally_overrides to authenticated;
grant select, insert, update, delete on public.installation_team_monthly_quotas to authenticated;
grant select, insert, update, delete on public.installation_department_monthly_quotas to authenticated;
grant select, insert, update, delete on public.schedule_daily_assignments to authenticated;
grant select, insert, update, delete on public.schedule_absences to authenticated;
grant select, insert, update, delete on public.schedule_change_history to authenticated;