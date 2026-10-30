-- Store each user's own AR signature on their workspace profile.
-- The existing profiles RLS policies continue to govern who may update this column.
alter table public.profiles
  add column if not exists ar_signature text;

create or replace function public.save_my_ar_signature(p_signature text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if p_signature is not null and (
    length(p_signature) > 500000
    or p_signature !~ '^data:image/png;base64,'
  ) then
    raise exception 'Invalid signature image.';
  end if;

  update public.profiles
  set ar_signature = p_signature
  where id = auth.uid();

  if not found then
    raise exception 'Workspace profile not found.';
  end if;
end;
$$;

revoke all on function public.save_my_ar_signature(text) from public;
grant execute on function public.save_my_ar_signature(text) to authenticated;
