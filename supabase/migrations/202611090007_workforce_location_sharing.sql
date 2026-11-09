-- Employee-consented workforce location sharing.
-- Each employee can write only their own row. Owner, Editor and HR can read
-- rows for management; no location is collected until the employee opts in.
begin;

create table if not exists public.workforce_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  sharing_enabled boolean not null default false,
  consented_at timestamptz,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  captured_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint workforce_locations_latitude_range check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint workforce_locations_longitude_range check (longitude is null or (longitude >= -180 and longitude <= 180)),
  constraint workforce_locations_accuracy_nonnegative check (accuracy_m is null or accuracy_m >= 0)
);

create index if not exists workforce_locations_last_seen_idx
  on public.workforce_locations (last_seen_at desc);

alter table public.workforce_locations enable row level security;

drop policy if exists "Employees manage own workforce location" on public.workforce_locations;
create policy "Employees manage own workforce location"
on public.workforce_locations
for all to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active = true
  )
);

drop policy if exists "Management reads workforce locations" on public.workforce_locations;
create policy "Management reads workforce locations"
on public.workforce_locations
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
      and p.role in ('owner', 'editor', 'hr')
  )
);

grant select, insert, update, delete on public.workforce_locations to authenticated;
revoke all on public.workforce_locations from anon;

comment on table public.workforce_locations is
  'Employee-consented location sharing. GPS is captured only while the employee has enabled sharing and the workspace app is open.';

commit;
