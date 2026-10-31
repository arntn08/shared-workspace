-- Editors must be able to resolve active employee, HR, and AR Encoder
-- profiles so the Files & Resources recipient picker can share by profile ID.
-- This repairs the same profile-visibility issue previously seen with HR accounts.

drop policy if exists "editor reads employees" on public.profiles;

create policy "editor reads workspace people"
on public.profiles
for select
to authenticated
using (
  active = true
  and role in ('employee', 'hr', 'ar_encoder')
  and public.is_editor()
);
