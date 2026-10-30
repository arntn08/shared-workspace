-- Store each user's own AR signature on their workspace profile.
-- The existing profiles RLS policies continue to govern who may update this column.
alter table public.profiles
  add column if not exists ar_signature text;
