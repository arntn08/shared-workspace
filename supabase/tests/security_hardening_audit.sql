-- AHBA Shared Workspace: security hardening regression checks
-- Run AFTER applying 202611090001_security_hardening.sql in Supabase SQL Editor.
-- Read-only: this script does not insert, update, or delete application data.

do $$
declare
  missing text[] := array[]::text[];
  v_public boolean;
begin
  if to_regclass('public.employee_ntes') is null then
    missing := array_append(missing, 'public.employee_ntes table');
  elsif not (select c.relrowsecurity from pg_class c where c.oid = 'public.employee_ntes'::regclass) then
    missing := array_append(missing, 'RLS enabled on employee_ntes');
  end if;

  if to_regclass('public.employee_leave_requests') is null then
    missing := array_append(missing, 'public.employee_leave_requests table');
  elsif not (select c.relrowsecurity from pg_class c where c.oid = 'public.employee_leave_requests'::regclass) then
    missing := array_append(missing, 'RLS enabled on employee_leave_requests');
  end if;

  if to_regprocedure('public.guard_employee_nte_update()') is null then
    missing := array_append(missing, 'guard_employee_nte_update()');
  end if;
  if to_regprocedure('public.guard_leave_request_update()') is null then
    missing := array_append(missing, 'guard_leave_request_update()');
  end if;
  if to_regprocedure('public.is_active_hr()') is null then
    missing := array_append(missing, 'is_active_hr()');
  end if;
  if to_regprocedure('public.set_workspace_user_role(uuid,text)') is null then
    missing := array_append(missing, 'set_workspace_user_role(uuid,text)');
  end if;

  if to_regclass('public.employee_ntes') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.employee_ntes'::regclass
         and tgname = 'guard_employee_nte_update_trigger'
         and not tgisinternal
     ) then
    missing := array_append(missing, 'NTE update guard trigger');
  end if;

  if to_regclass('public.employee_leave_requests') is not null
     and not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.employee_leave_requests'::regclass
         and tgname = 'guard_leave_request_update_trigger'
         and not tgisinternal
     ) then
    missing := array_append(missing, 'leave review guard trigger');
  end if;

  if to_regclass('public.employee_ntes') is not null then
    if has_table_privilege('anon', 'public.employee_ntes', 'SELECT')
       or has_table_privilege('anon', 'public.employee_ntes', 'INSERT')
       or has_table_privilege('anon', 'public.employee_ntes', 'UPDATE')
       or has_table_privilege('anon', 'public.employee_ntes', 'DELETE') then
      missing := array_append(missing, 'anonymous access revoked on employee_ntes');
    end if;
  end if;

  if to_regclass('public.employee_leave_requests') is not null then
    if has_table_privilege('anon', 'public.employee_leave_requests', 'SELECT')
       or has_table_privilege('anon', 'public.employee_leave_requests', 'INSERT')
       or has_table_privilege('anon', 'public.employee_leave_requests', 'UPDATE')
       or has_table_privilege('anon', 'public.employee_leave_requests', 'DELETE') then
      missing := array_append(missing, 'anonymous access revoked on employee_leave_requests');
    end if;
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'nte-attachments' and public = false
  ) then
    missing := array_append(missing, 'private nte-attachments bucket');
  end if;

  if not exists (
    select 1 from storage.buckets
    where id = 'leave-attachments' and public = false
  ) then
    missing := array_append(missing, 'private leave-attachments bucket');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'employee_ntes'
      and policyname = 'HR and owners manage NTEs'
  ) then
    missing := array_append(missing, 'NTE HR/owner/employee update policy');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'employee_leave_requests'
      and policyname = 'HR review leave requests'
  ) then
    missing := array_append(missing, 'HR-only leave review policy');
  end if;

  if cardinality(missing) > 0 then
    raise exception E'SECURITY AUDIT FAILED. Missing or incorrect items:\n%',
      array_to_string(missing, E'\n');
  end if;

  raise notice 'SECURITY AUDIT PASSED: required tables, RLS, guard triggers, policies, grants, and private buckets are present.';
end;
$$;

-- Display effective policies for a human review after the assertions pass.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename in ('employee_ntes','employee_leave_requests','profiles'))
   or (schemaname = 'storage' and tablename = 'objects'
       and policyname in ('HR uploads NTE attachments','Assigned users read NTE attachments',
                          'HR deletes NTE attachments','Employee and HR read leave forms'))
order by schemaname, tablename, policyname;
