-- Remove the obsolete AR Encoder role from the Shared Workspace.
-- Existing AR Encoder profiles are retained but downgraded to employee access
-- so no account is deleted or accidentally granted HR privileges.
begin;

-- Migrate any legacy profiles before tightening the role constraint.
update public.profiles
set role = 'employee'
where role = 'ar_encoder';

-- Keep the profile role allow-list aligned with the supported workspace roles.
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'editor', 'employee', 'hr'));

-- Remove AR Encoder from the role-assignment RPC while preserving its
-- owner-only authorization and hardened empty search_path.
create or replace function public.set_workspace_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in.';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'owner'
      and p.active = true
  ) then
    raise exception 'Only an active workspace owner can change roles.';
  end if;

  if p_role is null or p_role not in ('employee', 'hr', 'editor') then
    raise exception 'Unsupported role: %', p_role;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id
  ) then
    raise exception 'The selected account does not exist.';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and p.role = 'owner'
  ) then
    raise exception 'Owner accounts cannot be changed here.';
  end if;

  update public.profiles
  set role = p_role
  where id = p_user_id;
end;
$$;

revoke all on function public.set_workspace_user_role(uuid, text) from public, anon;
grant execute on function public.set_workspace_user_role(uuid, text) to authenticated;

-- AR Generator remains available to owners and editors only.
drop policy if exists "AR records visible to owners and editors" on public.ar_records;
drop policy if exists "AR records visible to authorized AR users" on public.ar_records;
create policy "AR records visible to owners and editors"
on public.ar_records
for select to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in ('owner', 'editor')
  )
);

drop policy if exists "Owners and editors create AR records" on public.ar_records;
drop policy if exists "Authorized AR users create AR records" on public.ar_records;
create policy "Owners and editors create AR records"
on public.ar_records
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in ('owner', 'editor')
  )
);

commit;
