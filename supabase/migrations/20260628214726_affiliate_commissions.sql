create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  attribution_id uuid not null references public.affiliate_attributions(id) on delete cascade,
  seller_id uuid not null references public.affiliate_sellers(id) on delete restrict,
  link_id uuid references public.affiliate_links(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  plan_id uuid references public.billing_plans(id) on delete set null,
  competence_month date not null,
  paid_at timestamptz not null,
  provider_payment_id text,
  provider_event_id text,
  eligible_amount_cents integer not null,
  commission_rate_bps integer not null default 1000,
  commission_cents integer not null,
  currency text not null default 'BRL',
  status text not null default 'pending',
  source text not null default 'asaas_webhook',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_commissions_competence_month_check
    check (competence_month = date_trunc('month', competence_month::timestamp)::date),
  constraint affiliate_commissions_eligible_amount_cents_check
    check (eligible_amount_cents >= 0),
  constraint affiliate_commissions_commission_rate_bps_check
    check (commission_rate_bps >= 0 and commission_rate_bps <= 10000),
  constraint affiliate_commissions_commission_cents_check
    check (commission_cents >= 0),
  constraint affiliate_commissions_currency_check
    check (char_length(currency) = 3 and currency = upper(currency)),
  constraint affiliate_commissions_status_check
    check (status in ('pending', 'paid', 'void')),
  constraint affiliate_commissions_source_not_blank
    check (length(btrim(source)) > 0)
);

create unique index if not exists affiliate_commissions_provider_payment_uidx
  on public.affiliate_commissions (provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists affiliate_commissions_attribution_month_uidx
  on public.affiliate_commissions (attribution_id, competence_month);

create index if not exists affiliate_commissions_seller_competence_status_idx
  on public.affiliate_commissions (seller_id, competence_month desc, status);

create index if not exists affiliate_commissions_subscription_competence_idx
  on public.affiliate_commissions (subscription_id, competence_month desc);

create index if not exists affiliate_commissions_project_idx
  on public.affiliate_commissions (project_id);

create index if not exists affiliate_commissions_attribution_idx
  on public.affiliate_commissions (attribution_id);

create index if not exists affiliate_commissions_billing_cycle_idx
  on public.affiliate_commissions (billing_cycle_id)
  where billing_cycle_id is not null;

create index if not exists affiliate_commissions_paid_at_idx
  on public.affiliate_commissions (paid_at desc);

drop trigger if exists trg_affiliate_commissions_updated_at on public.affiliate_commissions;
create trigger trg_affiliate_commissions_updated_at
  before update on public.affiliate_commissions
  for each row
  execute function public.set_updated_at();

alter table public.affiliate_commissions enable row level security;

revoke all on table public.affiliate_commissions from anon;
grant select, insert, update, delete on table public.affiliate_commissions to authenticated;
grant all on table public.affiliate_commissions to service_role;

drop policy if exists affiliate_commissions_superadmin_select on public.affiliate_commissions;
create policy affiliate_commissions_superadmin_select
on public.affiliate_commissions
for select
to authenticated
using ((select public.is_superadmin()));

drop policy if exists affiliate_commissions_superadmin_insert on public.affiliate_commissions;
create policy affiliate_commissions_superadmin_insert
on public.affiliate_commissions
for insert
to authenticated
with check ((select public.is_superadmin()));

drop policy if exists affiliate_commissions_superadmin_update on public.affiliate_commissions;
create policy affiliate_commissions_superadmin_update
on public.affiliate_commissions
for update
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists affiliate_commissions_superadmin_delete on public.affiliate_commissions;
create policy affiliate_commissions_superadmin_delete
on public.affiliate_commissions
for delete
to authenticated
using ((select public.is_superadmin()));
