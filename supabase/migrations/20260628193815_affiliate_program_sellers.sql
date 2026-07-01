create table if not exists public.affiliate_sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null,
  pix_key text not null,
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_sellers_name_not_blank check (length(btrim(name)) > 0),
  constraint affiliate_sellers_contact_not_blank check (length(btrim(contact)) > 0),
  constraint affiliate_sellers_pix_key_not_blank check (length(btrim(pix_key)) > 0),
  constraint affiliate_sellers_status_check check (status in ('active', 'inactive'))
);

create index if not exists affiliate_sellers_status_created_at_idx
  on public.affiliate_sellers (status, created_at desc);

create index if not exists affiliate_sellers_lower_name_idx
  on public.affiliate_sellers (lower(name));

drop trigger if exists trg_affiliate_sellers_updated_at on public.affiliate_sellers;
create trigger trg_affiliate_sellers_updated_at
  before update on public.affiliate_sellers
  for each row
  execute function public.set_updated_at();

alter table public.affiliate_sellers enable row level security;

revoke all on table public.affiliate_sellers from anon;
grant select, insert, update, delete on table public.affiliate_sellers to authenticated;
grant all on table public.affiliate_sellers to service_role;

drop policy if exists affiliate_sellers_superadmin_select on public.affiliate_sellers;
create policy affiliate_sellers_superadmin_select
on public.affiliate_sellers
for select
to authenticated
using ((select public.is_superadmin()));

drop policy if exists affiliate_sellers_superadmin_insert on public.affiliate_sellers;
create policy affiliate_sellers_superadmin_insert
on public.affiliate_sellers
for insert
to authenticated
with check ((select public.is_superadmin()));

drop policy if exists affiliate_sellers_superadmin_update on public.affiliate_sellers;
create policy affiliate_sellers_superadmin_update
on public.affiliate_sellers
for update
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists affiliate_sellers_superadmin_delete on public.affiliate_sellers;
create policy affiliate_sellers_superadmin_delete
on public.affiliate_sellers
for delete
to authenticated
using ((select public.is_superadmin()));
