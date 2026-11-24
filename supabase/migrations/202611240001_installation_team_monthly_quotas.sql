-- AHBA Installation Tally: configurable monthly team targets.
-- Default target remains 50 when no team/month override exists.
-- Apply in Supabase Dashboard -> SQL Editor.

create table if not exists public.installation_team_monthly_quotas (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.installation_teams(id) on delete cascade,
  quota_month text not null check (quota_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  target_quota integer not null default 50 check (target_quota >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint installation_team_monthly_quotas_team_month_key unique (team_id, quota_month)
);

alter table public.installation_team_monthly_quotas enable row level security;

drop policy if exists "Active workspace users read monthly team quotas" on public.installation_team_monthly_quotas;
create policy "Active workspace users read monthly team quotas"
on public.installation_team_monthly_quotas for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active = true
  )
);

drop policy if exists "Active editors manage monthly team quotas" on public.installation_team_monthly_quotas;
create policy "Active editors manage monthly team quotas"
on public.installation_team_monthly_quotas for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and p.role in ('owner', 'editor', 'hr')
  )
);

drop policy if exists "Active editors update monthly team quotas" on public.installation_team_monthly_quotas;
create policy "Active editors update monthly team quotas"
on public.installation_team_monthly_quotas for update to authenticated
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

revoke all privileges on table public.installation_team_monthly_quotas from anon;
grant select, insert, update on table public.installation_team_monthly_quotas to authenticated;
