-- AHBA Shared Workspace security hardening (2026-11-09)
-- Enforces role-specific field changes inside PostgreSQL, not only in the UI.
-- Apply in Supabase Dashboard -> SQL Editor.

-- NTE: only active HR/owners may manage notice content and lifecycle.
-- Assigned active employees may only submit/update their own explanation.
create or replace function public.guard_employee_nte_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_active boolean;
begin
  select p.role, p.active
    into v_role, v_active
  from public.profiles p
  where p.id = (select auth.uid());

  if coalesce(v_active, false) = false then
    raise exception 'Your workspace account is inactive.';
  end if;

  if v_role in ('hr', 'owner') then
    return new;
  end if;

  if v_role <> 'employee' or old.employee_id <> (select auth.uid()) then
    raise exception 'You are not allowed to update this notice.';
  end if;

  if (to_jsonb(new) - array['employee_response','status','acknowledged_at','responded_at','updated_at'])
     is distinct from
     (to_jsonb(old) - array['employee_response','status','acknowledged_at','responded_at','updated_at']) then
    raise exception 'Employees may only update their response to an NTE.';
  end if;

  if new.status <> 'responded'
     or nullif(btrim(coalesce(new.employee_response, '')), '') is null
     or new.acknowledged_at is null
     or new.responded_at is null then
    raise exception 'Submit a response before acknowledging this notice.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_employee_nte_update_trigger on public.employee_ntes;
create trigger guard_employee_nte_update_trigger
before update on public.employee_ntes
for each row execute function public.guard_employee_nte_update();

drop policy if exists "HR and owners read NTEs" on public.employee_ntes;
create policy "HR and owners read NTEs"
on public.employee_ntes for select to authenticated
using (
  employee_id = (select auth.uid())
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('hr','owner') and p.active = true
  )
);

drop policy if exists "HR and owners issue NTEs" on public.employee_ntes;
create policy "HR and owners issue NTEs"
on public.employee_ntes for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('hr','owner') and p.active = true
  )
);

drop policy if exists "HR and owners manage NTEs" on public.employee_ntes;
create policy "HR and owners manage NTEs"
on public.employee_ntes for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('hr','owner') and p.active = true
  )
  or (
    employee_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'employee' and p.active = true
    )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('hr','owner') and p.active = true
  )
  or (
    employee_id = (select auth.uid())
    and status = 'responded'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'employee' and p.active = true
    )
  )
);

revoke all on table public.employee_ntes from anon;
grant select, insert, update on table public.employee_ntes to authenticated;

-- Leave: HR alone can review. The trigger prevents HR-side edits to the
-- employee's submitted details or attachment after submission.
create or replace function public.guard_leave_request_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_active boolean;
begin
  select p.role, p.active
    into v_role, v_active
  from public.profiles p
  where p.id = (select auth.uid());

  if v_role <> 'hr' or coalesce(v_active, false) = false then
    raise exception 'Only active HR accounts may review leave requests.';
  end if;

  if (to_jsonb(new) - array['status','hr_comment','reviewed_by','reviewed_at'])
     is distinct from
     (to_jsonb(old) - array['status','hr_comment','reviewed_by','reviewed_at']) then
    raise exception 'HR may only update the leave decision and review details.';
  end if;

  if new.status not in ('approved','rejected')
     or new.reviewed_by <> (select auth.uid())
     or new.reviewed_at is null then
    raise exception 'A valid HR decision and review timestamp are required.';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_leave_request_update_trigger on public.employee_leave_requests;
create trigger guard_leave_request_update_trigger
before update on public.employee_leave_requests
for each row execute function public.guard_leave_request_update();

-- Rebuild the review policy so only active HR can review.
drop policy if exists "HR review leave requests" on public.employee_leave_requests;
create policy "HR review leave requests"
on public.employee_leave_requests for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'hr' and p.active = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'hr' and p.active = true
  )
  and status in ('approved','rejected')
  and reviewed_by = (select auth.uid())
  and reviewed_at is not null
);

revoke all on table public.employee_leave_requests from anon;
grant select, insert, update, delete on table public.employee_leave_requests to authenticated;

-- Lock down the trigger functions to authenticated callers only.
revoke all on function public.guard_employee_nte_update() from public, anon;
grant execute on function public.guard_employee_nte_update() to authenticated;
revoke all on function public.guard_leave_request_update() from public, anon;
grant execute on function public.guard_leave_request_update() to authenticated;
