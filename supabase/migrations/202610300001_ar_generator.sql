-- AR Generator records. Restricted to workspace owners and editors.
create table if not exists public.ar_records (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  jo_no text not null,
  jo_date text,
  receipt_no text not null,
  receipt_date date not null default current_date,
  subscriber_name text not null,
  address text not null default '',
  account_no text not null,
  transaction_type text not null default '',
  package_name text not null default '',
  payment_type text not null check (payment_type in ('FULL','PARTIAL')),
  amount numeric(12,2) not null check (amount > 0),
  amount_words text not null default '',
  payment_description text not null default '',
  sa_no text not null default '',
  business_style text not null default '',
  tin text not null default '',
  bank_check_no text not null default '',
  vatable numeric(12,2),
  vat_amount numeric(12,2),
  vat_exempt numeric(12,2),
  total_payable numeric(12,2),
  ocr_text text not null default '',
  created_at timestamptz not null default now(),
  unique (receipt_no)
);
create index if not exists ar_records_created_at_idx on public.ar_records(created_at desc);
create index if not exists ar_records_jo_no_idx on public.ar_records(jo_no);
alter table public.ar_records enable row level security;
revoke all on public.ar_records from anon;
grant select, insert on public.ar_records to authenticated;
drop policy if exists "AR records visible to owners and editors" on public.ar_records;
create policy "AR records visible to owners and editors" on public.ar_records for select to authenticated
using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','editor','ar_encoder') and p.active=true));
drop policy if exists "Owners and editors create AR records" on public.ar_records;
create policy "Owners and editors create AR records" on public.ar_records for insert to authenticated
with check (created_by=auth.uid() and exists(select 1 from public.profiles p where p.id=auth.uid() and p.role in ('owner','editor') and p.active=true));
