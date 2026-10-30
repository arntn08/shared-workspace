-- Add AR Encoder to the roles accepted by the profiles table.
-- Keep every role currently supported by the Shared Workspace app.
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'editor', 'employee', 'hr', 'ar_encoder'));
