create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.affiliate_sellers(id) on delete restrict,
  competence_month date not null,
  amount_cents integer not null default 0,
  commission_count integer not null default 0,
  currency text not null default 'BRL',
  status text not null default 'paid',
  payment_method text not null default 'pix_manual',
  paid_at timestamptz not null default now(),
  paid_by uuid references auth.users(id) on delete set null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_payouts_competence_month_check
    check (competence_month = date_trunc('month', competence_month::timestamp)::date),
  constraint affiliate_payouts_amount_cents_check
    check (amount_cents >= 0),
  constraint affiliate_payouts_commission_count_check
    check (commission_count >= 0),
  constraint affiliate_payouts_currency_check
    check (char_length(currency) = 3 and currency = upper(currency)),
  constraint affiliate_payouts_status_check
    check (status in ('paid', 'void')),
  constraint affiliate_payouts_payment_method_not_blank
    check (length(btrim(payment_method)) > 0)
);

alter table public.affiliate_commissions
  add column if not exists payout_id uuid,
  add column if not exists marked_paid_at timestamptz,
  add column if not exists marked_paid_by uuid references auth.users(id) on delete set null,
  add column if not exists payment_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_commissions_payout_id_fkey'
      and conrelid = 'public.affiliate_commissions'::regclass
  ) then
    alter table public.affiliate_commissions
      add constraint affiliate_commissions_payout_id_fkey
      foreign key (payout_id)
      references public.affiliate_payouts(id)
      on delete set null;
  end if;
end $$;

create index if not exists affiliate_payouts_seller_competence_idx
  on public.affiliate_payouts (seller_id, competence_month desc, paid_at desc);

create index if not exists affiliate_payouts_status_idx
  on public.affiliate_payouts (status, paid_at desc);

create index if not exists affiliate_commissions_payout_id_idx
  on public.affiliate_commissions (payout_id)
  where payout_id is not null;

create index if not exists affiliate_commissions_marked_paid_idx
  on public.affiliate_commissions (marked_paid_at desc)
  where marked_paid_at is not null;

drop trigger if exists trg_affiliate_payouts_updated_at on public.affiliate_payouts;
create trigger trg_affiliate_payouts_updated_at
  before update on public.affiliate_payouts
  for each row
  execute function public.set_updated_at();

alter table public.affiliate_payouts enable row level security;

revoke all on table public.affiliate_payouts from anon;
grant select, insert, update, delete on table public.affiliate_payouts to authenticated;
grant all on table public.affiliate_payouts to service_role;

drop policy if exists affiliate_payouts_superadmin_select on public.affiliate_payouts;
create policy affiliate_payouts_superadmin_select
on public.affiliate_payouts
for select
to authenticated
using ((select public.is_superadmin()));

drop policy if exists affiliate_payouts_superadmin_insert on public.affiliate_payouts;
create policy affiliate_payouts_superadmin_insert
on public.affiliate_payouts
for insert
to authenticated
with check ((select public.is_superadmin()));

drop policy if exists affiliate_payouts_superadmin_update on public.affiliate_payouts;
create policy affiliate_payouts_superadmin_update
on public.affiliate_payouts
for update
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists affiliate_payouts_superadmin_delete on public.affiliate_payouts;
create policy affiliate_payouts_superadmin_delete
on public.affiliate_payouts
for delete
to authenticated
using ((select public.is_superadmin()));
