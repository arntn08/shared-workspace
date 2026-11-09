-- AHBA Shared Workspace: NTE employee response integrity
-- Apply in Supabase Dashboard -> SQL Editor after migrations 001-003.
-- Employees may revise a response while the NTE is open, but cannot reopen a closed NTE.
-- Response timestamps are assigned by PostgreSQL, not trusted from the browser.

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

  -- HR and owners manage the notice lifecycle and its content.
  if v_role in ('hr', 'owner') then
    return new;
  end if;

  if v_role <> 'employee' or old.employee_id <> (select auth.uid()) then
    raise exception 'You are not allowed to update this notice.';
  end if;

  -- A closed notice is final. An employee cannot reopen it through the API.
  if old.status = 'closed' then
    raise exception 'This notice is closed and can no longer be changed.';
  end if;

  -- Employee-side updates are limited to the response fields.
  if (to_jsonb(new) - array['employee_response','status','acknowledged_at','responded_at','updated_at'])
     is distinct from
     (to_jsonb(old) - array['employee_response','status','acknowledged_at','responded_at','updated_at']) then
    raise exception 'Employees may only update their response to an NTE.';
  end if;

  if new.status <> 'responded'
     or nullif(btrim(coalesce(new.employee_response, '')), '') is null then
    raise exception 'Submit a response before acknowledging this notice.';
  end if;

  -- The first acknowledgement time is immutable; each revision gets a
  -- database-generated response timestamp.
  new.acknowledged_at := coalesce(old.acknowledged_at, now());
  new.responded_at := now();
  new.updated_at := now();

  return new;
end;
$$;

revoke all on function public.guard_employee_nte_update() from public, anon;
grant execute on function public.guard_employee_nte_update() to authenticated;
