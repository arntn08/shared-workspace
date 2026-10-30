-- Allow workspace owners to assign supported roles without relying on
-- the separately deployed manage-user Edge Function.
create or replace function public.set_workspace_user_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'owner'
      and active = true
  ) then
    raise exception 'Only an active workspace owner can change roles.';
  end if;

  if p_role not in ('employee', 'ar_encoder', 'hr', 'editor') then
    raise exception 'Unsupported role: %', p_role;
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'The selected account does not exist.';
  end if;

  if exists (
    select 1 from public.profiles
    where id = p_user_id and role = 'owner'
  ) then
    raise exception 'Owner accounts cannot be changed here.';
  end if;

  update public.profiles
  set role = p_role
  where id = p_user_id;
end;
$$;

revoke all on function public.set_workspace_user_role(uuid, text) from public;
grant execute on function public.set_workspace_user_role(uuid, text) to authenticated;
