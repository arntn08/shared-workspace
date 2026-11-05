-- Allow active HR accounts to populate the employee picker for private Notices to Explain.
-- Use a SECURITY DEFINER helper to avoid recursive profiles RLS evaluation.

create or replace function public.is_active_hr()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'hr'
      and active = true
  );
$$;

revoke all on function public.is_active_hr() from public;
grant execute on function public.is_active_hr() to authenticated;

drop policy if exists "HR reads active employee profiles" on public.profiles;

create policy "HR reads active employee profiles"
on public.profiles
for select
to authenticated
using (
  active = true
  and role = 'employee'
  and public.is_active_hr()
);
