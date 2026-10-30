-- Extend AR record access to the dedicated AR Encoder portal role.
drop policy if exists "AR records visible to owners and editors" on public.ar_records;
create policy "AR records visible to authorized AR users" on public.ar_records
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in ('owner','editor','ar_encoder')
  )
);
drop policy if exists "Owners and editors create AR records" on public.ar_records;
create policy "Authorized AR users create AR records" on public.ar_records
for insert to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.role in ('owner','editor','ar_encoder')
  )
);
