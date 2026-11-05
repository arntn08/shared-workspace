-- Allow active HR accounts to populate the employee picker for private Notices to Explain.
-- HR can read active employee profile rows; this does not grant access to editor,
-- owner, AR Encoder, or inactive profiles.

drop policy if exists "HR reads active employee profiles" on public.profiles;

create policy "HR reads active employee profiles"
on public.profiles
for select
to authenticated
using (
  active = true
  and role = 'employee'
  and exists (
    select 1
    from public.profiles hr
    where hr.id = (select auth.uid())
      and hr.role = 'hr'
      and hr.active = true
  )
);
