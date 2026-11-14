-- AHBA Installation Tally: persistent manual daily-count overrides
-- Apply in Supabase Dashboard -> SQL Editor.
-- Overrides are stored separately from imported work orders, so a later Excel
-- import will not erase a manual correction.

create table if not exists public.installation_tally_overrides (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.installation_teams(id) on delete cascade,
  work_date date not null,
  manual_count integer not null check (manual_count >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint installation_tally_overrides_team_date_key unique (team_id, work_date)
);

alter table public.installation_tally_overrides enable row level security;

drop policy if exists "Active workspace users read tally overrides" on public.installation_tally_overrides;
create policy "Active workspace users read tally overrides"
on public.installation_tally_overrides for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active = true
  )
);

drop policy if exists "Active tally editors insert overrides" on public.installation_tally_overrides;
create policy "Active tally editors insert overrides"
on public.installation_tally_overrides for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and p.role in ('owner', 'editor', 'hr')
  )
);

drop policy if exists "Active tally editors update overrides" on public.installation_tally_overrides;
create policy "Active tally editors update overrides"
on public.installation_tally_overrides for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and p.role in ('owner', 'editor', 'hr')
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and p.role in ('owner', 'editor', 'hr')
  )
);

revoke all on table public.installation_tally_overrides from anon;
grant select, insert, update on table public.installation_tally_overrides to authenticated;
