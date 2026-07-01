create table if not exists public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.affiliate_sellers(id) on delete cascade,
  code text not null,
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_links_code_not_blank check (length(btrim(code)) > 0),
  constraint affiliate_links_code_format check (code ~ '^[a-z0-9][a-z0-9-]{5,39}$'),
  constraint affiliate_links_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists affiliate_links_seller_id_uidx
  on public.affiliate_links (seller_id);

create unique index if not exists affiliate_links_lower_code_uidx
  on public.affiliate_links (lower(code));

create index if not exists affiliate_links_status_created_at_idx
  on public.affiliate_links (status, created_at desc);

drop trigger if exists trg_affiliate_links_updated_at on public.affiliate_links;
create trigger trg_affiliate_links_updated_at
  before update on public.affiliate_links
  for each row
  execute function public.set_updated_at();

alter table public.affiliate_links enable row level security;

revoke all on table public.affiliate_links from anon;
grant select, insert, update, delete on table public.affiliate_links to authenticated;
grant all on table public.affiliate_links to service_role;

drop policy if exists affiliate_links_superadmin_select on public.affiliate_links;
create policy affiliate_links_superadmin_select
on public.affiliate_links
for select
to authenticated
using ((select public.is_superadmin()));

drop policy if exists affiliate_links_superadmin_insert on public.affiliate_links;
create policy affiliate_links_superadmin_insert
on public.affiliate_links
for insert
to authenticated
with check ((select public.is_superadmin()));

drop policy if exists affiliate_links_superadmin_update on public.affiliate_links;
create policy affiliate_links_superadmin_update
on public.affiliate_links
for update
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists affiliate_links_superadmin_delete on public.affiliate_links;
create policy affiliate_links_superadmin_delete
on public.affiliate_links
for delete
to authenticated
using ((select public.is_superadmin()));
