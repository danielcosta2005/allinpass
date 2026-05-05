-- Module 3 schema:
-- Subscriptions, billing, usage metering, retroactive charging, and credits.

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly', 'yearly')),
  base_price_cents integer not null check (base_price_cents >= 0),
  included_passes integer not null default 0 check (included_passes >= 0),
  overage_price_cents integer not null default 0 check (overage_price_cents >= 0),
  trial_days integer not null default 7 check (trial_days >= 0 and trial_days <= 90),
  auto_upgrade_to_plan_id uuid references public.billing_plans(id) on delete set null,
  is_active boolean not null default true,
  features jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  legal_name text not null,
  billing_email text not null,
  document_type text not null check (document_type in ('cpf', 'cnpj', 'other')),
  document_number text not null,
  address jsonb not null default '{}'::jsonb,
  gateway_provider text not null check (gateway_provider in ('pagseguro', 'infinitepay', 'rede', 'other')),
  gateway_customer_id text,
  provider_status text not null default 'active'
    check (provider_status in ('active', 'inactive', 'blocked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id),
  unique (id, project_id)
);

create table if not exists public.billing_payment_methods (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  billing_account_id uuid not null,
  gateway_provider text not null check (gateway_provider in ('pagseguro', 'infinitepay', 'rede', 'other')),
  gateway_payment_method_id text not null,
  brand text,
  last4 char(4),
  exp_month integer check (exp_month is null or (exp_month >= 1 and exp_month <= 12)),
  exp_year integer check (exp_year is null or exp_year >= 2000),
  holder_name text,
  is_default boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'expired', 'failed', 'revoked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gateway_provider, gateway_payment_method_id),
  constraint billing_payment_methods_account_project_fk
    foreign key (billing_account_id, project_id)
    references public.billing_accounts(id, project_id)
    on delete cascade
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  billing_account_id uuid not null,
  plan_id uuid not null references public.billing_plans(id),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  gateway_provider text check (gateway_provider in ('pagseguro', 'infinitepay', 'rede', 'other')),
  gateway_subscription_id text,
  base_price_cents integer not null check (base_price_cents >= 0),
  included_passes integer not null check (included_passes >= 0),
  overage_price_cents integer not null check (overage_price_cents >= 0),
  currency text not null default 'BRL' check (char_length(currency) = 3 and currency = upper(currency)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  constraint billing_subscriptions_account_project_fk
    foreign key (billing_account_id, project_id)
    references public.billing_accounts(id, project_id)
    on delete cascade,
  check (current_period_end is null or current_period_start is null or current_period_end > current_period_start),
  check (trial_ends_at is null or trial_started_at is null or trial_ends_at >= trial_started_at)
);

create table if not exists public.billing_subscription_changes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid not null,
  previous_plan_id uuid references public.billing_plans(id) on delete set null,
  new_plan_id uuid not null references public.billing_plans(id),
  change_type text not null
    check (change_type in ('upgrade', 'downgrade', 'renewal', 'cancellation', 'reactivation', 'trial_conversion')),
  change_reason text not null default 'manual'
    check (change_reason in ('manual', 'auto_limit', 'billing_retry', 'sales_assisted', 'system')),
  proration_delta_cents integer not null default 0,
  effective_at timestamptz not null default now(),
  requested_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint billing_subscription_changes_subscription_project_fk
    foreign key (subscription_id, project_id)
    references public.billing_subscriptions(id, project_id)
    on delete cascade
);

create table if not exists public.billing_cycles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid references public.billing_subscriptions(id) on delete restrict,
  cycle_type text not null check (cycle_type in ('subscription', 'usage', 'retroactive')),
  frequency text not null default 'monthly' check (frequency in ('weekly', 'monthly', 'retroactive')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed', 'invoiced', 'paid', 'void')),
  closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, cycle_type, period_start, period_end),
  check (period_end > period_start)
);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid references public.billing_subscriptions(id) on delete restrict,
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  billing_account_id uuid references public.billing_accounts(id) on delete set null,
  invoice_number text,
  gateway_provider text check (gateway_provider in ('pagseguro', 'infinitepay', 'rede', 'other')),
  gateway_invoice_id text,
  gateway_charge_id text,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'paid', 'past_due', 'failed', 'canceled', 'refunded')),
  currency text not null default 'BRL' check (char_length(currency) = 3 and currency = upper(currency)),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer generated always as (subtotal_cents + tax_cents - discount_cents) stored,
  amount_paid_cents integer not null default 0 check (amount_paid_cents >= 0),
  amount_due_cents integer not null default 0 check (amount_due_cents >= 0),
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  check (total_cents >= 0)
);

create table if not exists public.billing_invoice_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_id uuid not null,
  item_type text not null
    check (item_type in ('subscription_base', 'overage_pass', 'credit_purchase', 'proration', 'retroactive_usage', 'adjustment')),
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_amount_cents integer not null,
  line_total_cents integer generated always as (quantity * unit_amount_cents) stored,
  period_start timestamptz,
  period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint billing_invoice_items_invoice_project_fk
    foreign key (invoice_id, project_id)
    references public.billing_invoices(id, project_id)
    on delete cascade
);

create table if not exists public.billing_reprocessing_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'canceled')),
  lookback_months integer not null check (lookback_months >= 1 and lookback_months <= 24),
  period_start timestamptz not null,
  period_end timestamptz not null,
  triggered_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  check (period_end > period_start)
);

create table if not exists public.billing_usage_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  invoice_item_id uuid references public.billing_invoice_items(id) on delete set null,
  reprocessing_batch_id uuid references public.billing_reprocessing_batches(id) on delete set null,
  pass_id uuid references public.passes(id) on delete set null,
  event_type text not null check (event_type in ('issue', 'reversal', 'adjustment')),
  source text not null default 'pass_issue'
    check (source in ('pass_issue', 'manual', 'import', 'retroactive_reprocess')),
  quantity integer not null default 1 check (quantity <> 0),
  unit_amount_cents integer not null default 0,
  is_billable boolean not null default true,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_credit_wallets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  balance_credits bigint not null default 0,
  low_balance_threshold bigint not null default 0 check (low_balance_threshold >= 0),
  auto_recharge_enabled boolean not null default false,
  auto_recharge_pack_size bigint check (auto_recharge_pack_size is null or auto_recharge_pack_size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id),
  unique (id, project_id)
);

create table if not exists public.billing_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  wallet_id uuid not null,
  transaction_type text not null
    check (transaction_type in ('grant', 'purchase', 'consume', 'expire', 'refund', 'adjustment', 'reversal')),
  credits_delta bigint not null check (credits_delta <> 0),
  unit_price_cents integer,
  currency text check (currency is null or (char_length(currency) = 3 and currency = upper(currency))),
  invoice_item_id uuid references public.billing_invoice_items(id) on delete set null,
  usage_event_id uuid references public.billing_usage_events(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint billing_credit_transactions_wallet_project_fk
    foreign key (wallet_id, project_id)
    references public.billing_credit_wallets(id, project_id)
    on delete cascade
);

create table if not exists public.billing_notification_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_type text not null
    check (event_type in ('charge_succeeded', 'charge_failed', 'invoice_due', 'trial_ending', 'subscription_renewal', 'credit_low', 'credit_recharge')),
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'webhook', 'in_app')),
  recurrence_unit text not null check (recurrence_unit in ('day', 'week', 'month')),
  recurrence_interval integer not null default 1 check (recurrence_interval >= 1 and recurrence_interval <= 31),
  is_active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  payload_template jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  rule_id uuid not null references public.billing_notification_rules(id) on delete cascade,
  invoice_id uuid references public.billing_invoices(id) on delete set null,
  subscription_id uuid references public.billing_subscriptions(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.project_billing_audit_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  target_table text not null,
  target_id uuid,
  action text not null check (action in ('insert', 'update', 'delete', 'sync_gateway')),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_plans_active_idx
  on public.billing_plans (id)
  where is_active;

create unique index if not exists billing_accounts_gateway_customer_uidx
  on public.billing_accounts (gateway_provider, gateway_customer_id)
  where gateway_customer_id is not null;

create index if not exists billing_payment_methods_project_idx
  on public.billing_payment_methods (project_id);
create index if not exists billing_payment_methods_account_idx
  on public.billing_payment_methods (billing_account_id);
create index if not exists billing_payment_methods_default_active_idx
  on public.billing_payment_methods (project_id, created_at desc)
  where is_default and status = 'active';

create index if not exists billing_subscriptions_project_status_idx
  on public.billing_subscriptions (project_id, status);
create unique index if not exists billing_subscriptions_active_project_uidx
  on public.billing_subscriptions (project_id)
  where status in ('trialing', 'active', 'past_due', 'paused');
create unique index if not exists billing_subscriptions_gateway_uidx
  on public.billing_subscriptions (gateway_provider, gateway_subscription_id)
  where gateway_subscription_id is not null;
create index if not exists billing_subscriptions_plan_idx
  on public.billing_subscriptions (plan_id);

create index if not exists billing_subscription_changes_subscription_idx
  on public.billing_subscription_changes (subscription_id, effective_at desc);
create index if not exists billing_subscription_changes_project_idx
  on public.billing_subscription_changes (project_id, created_at desc);

create index if not exists billing_cycles_project_period_idx
  on public.billing_cycles (project_id, period_start desc, period_end desc);
create index if not exists billing_cycles_subscription_idx
  on public.billing_cycles (subscription_id)
  where subscription_id is not null;
create index if not exists billing_cycles_open_idx
  on public.billing_cycles (project_id, cycle_type)
  where status = 'open';

create unique index if not exists billing_invoices_invoice_number_uidx
  on public.billing_invoices (invoice_number)
  where invoice_number is not null;
create unique index if not exists billing_invoices_gateway_uidx
  on public.billing_invoices (gateway_provider, gateway_invoice_id)
  where gateway_invoice_id is not null;
create index if not exists billing_invoices_project_status_due_idx
  on public.billing_invoices (project_id, status, due_at);
create index if not exists billing_invoices_cycle_idx
  on public.billing_invoices (billing_cycle_id)
  where billing_cycle_id is not null;
create index if not exists billing_invoices_subscription_idx
  on public.billing_invoices (subscription_id)
  where subscription_id is not null;

create index if not exists billing_invoice_items_invoice_idx
  on public.billing_invoice_items (invoice_id);
create index if not exists billing_invoice_items_project_idx
  on public.billing_invoice_items (project_id, created_at desc);

create index if not exists billing_reprocessing_batches_project_status_idx
  on public.billing_reprocessing_batches (project_id, status, triggered_at desc);

create index if not exists billing_usage_events_project_occurred_idx
  on public.billing_usage_events (project_id, occurred_at desc);
create index if not exists billing_usage_events_subscription_idx
  on public.billing_usage_events (subscription_id)
  where subscription_id is not null;
create index if not exists billing_usage_events_cycle_idx
  on public.billing_usage_events (billing_cycle_id)
  where billing_cycle_id is not null;
create index if not exists billing_usage_events_invoice_item_idx
  on public.billing_usage_events (invoice_item_id)
  where invoice_item_id is not null;
create index if not exists billing_usage_events_pass_idx
  on public.billing_usage_events (pass_id)
  where pass_id is not null;
create index if not exists billing_usage_events_unbilled_idx
  on public.billing_usage_events (project_id, occurred_at)
  where is_billable and invoice_item_id is null;
create unique index if not exists billing_usage_events_pass_issue_once_uidx
  on public.billing_usage_events (pass_id)
  where pass_id is not null and source = 'pass_issue' and event_type = 'issue';

create index if not exists billing_credit_transactions_wallet_idx
  on public.billing_credit_transactions (wallet_id, created_at desc);
create index if not exists billing_credit_transactions_project_idx
  on public.billing_credit_transactions (project_id, created_at desc);
create index if not exists billing_credit_transactions_invoice_item_idx
  on public.billing_credit_transactions (invoice_item_id)
  where invoice_item_id is not null;
create index if not exists billing_credit_transactions_usage_event_idx
  on public.billing_credit_transactions (usage_event_id)
  where usage_event_id is not null;

create index if not exists billing_notification_rules_project_active_idx
  on public.billing_notification_rules (project_id, is_active);
create index if not exists billing_notification_deliveries_rule_sched_idx
  on public.billing_notification_deliveries (rule_id, scheduled_for);
create index if not exists billing_notification_deliveries_project_status_idx
  on public.billing_notification_deliveries (project_id, status, scheduled_for);

create index if not exists project_billing_audit_logs_project_created_idx
  on public.project_billing_audit_logs (project_id, created_at desc);

create or replace function public.can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_superadmin() or public.is_member_of_project(p_project_id);
$$;

create or replace function public.trg_sync_credit_wallet_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
begin
  if tg_op = 'INSERT' then
    update public.billing_credit_wallets
    set balance_credits = balance_credits + new.credits_delta
    where id = new.wallet_id
    returning balance_credits into v_balance;

    if not found then
      raise exception 'Credit wallet % not found', new.wallet_id;
    end if;

    if v_balance < 0 then
      raise exception 'Insufficient credits in wallet %', new.wallet_id using errcode = '23514';
    end if;

    return new;
  elsif tg_op = 'UPDATE' then
    if new.wallet_id = old.wallet_id then
      update public.billing_credit_wallets
      set balance_credits = balance_credits - old.credits_delta + new.credits_delta
      where id = new.wallet_id
      returning balance_credits into v_balance;

      if v_balance < 0 then
        raise exception 'Insufficient credits in wallet %', new.wallet_id using errcode = '23514';
      end if;
    else
      update public.billing_credit_wallets
      set balance_credits = balance_credits - old.credits_delta
      where id = old.wallet_id
      returning balance_credits into v_balance;

      if v_balance < 0 then
        raise exception 'Insufficient credits in wallet %', old.wallet_id using errcode = '23514';
      end if;

      update public.billing_credit_wallets
      set balance_credits = balance_credits + new.credits_delta
      where id = new.wallet_id
      returning balance_credits into v_balance;

      if not found then
        raise exception 'Credit wallet % not found', new.wallet_id;
      end if;

      if v_balance < 0 then
        raise exception 'Insufficient credits in wallet %', new.wallet_id using errcode = '23514';
      end if;
    end if;

    return new;
  elsif tg_op = 'DELETE' then
    update public.billing_credit_wallets
    set balance_credits = balance_credits - old.credits_delta
    where id = old.wallet_id
    returning balance_credits into v_balance;

    if not found then
      raise exception 'Credit wallet % not found', old.wallet_id;
    end if;

    if v_balance < 0 then
      raise exception 'Insufficient credits in wallet %', old.wallet_id using errcode = '23514';
    end if;

    return old;
  end if;

  return null;
end;
$$;

create or replace function public.trg_log_pass_issue_billing_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is not null then
    insert into public.billing_usage_events (
      project_id,
      pass_id,
      event_type,
      source,
      quantity,
      unit_amount_cents,
      is_billable,
      occurred_at,
      metadata
    )
    values (
      new.project_id,
      new.id,
      'issue',
      'pass_issue',
      1,
      0,
      true,
      coalesce(new.created_at, now()),
      jsonb_build_object('origin', 'passes_trigger')
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_billing_plans_updated_at on public.billing_plans;
create trigger trg_billing_plans_updated_at
before update on public.billing_plans
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_accounts_updated_at on public.billing_accounts;
create trigger trg_billing_accounts_updated_at
before update on public.billing_accounts
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_payment_methods_updated_at on public.billing_payment_methods;
create trigger trg_billing_payment_methods_updated_at
before update on public.billing_payment_methods
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_subscriptions_updated_at on public.billing_subscriptions;
create trigger trg_billing_subscriptions_updated_at
before update on public.billing_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_cycles_updated_at on public.billing_cycles;
create trigger trg_billing_cycles_updated_at
before update on public.billing_cycles
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_invoices_updated_at on public.billing_invoices;
create trigger trg_billing_invoices_updated_at
before update on public.billing_invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_credit_wallets_updated_at on public.billing_credit_wallets;
create trigger trg_billing_credit_wallets_updated_at
before update on public.billing_credit_wallets
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_notification_rules_updated_at on public.billing_notification_rules;
create trigger trg_billing_notification_rules_updated_at
before update on public.billing_notification_rules
for each row execute function public.set_updated_at();

drop trigger if exists trg_billing_credit_transactions_apply on public.billing_credit_transactions;
create trigger trg_billing_credit_transactions_apply
after insert or update or delete on public.billing_credit_transactions
for each row execute function public.trg_sync_credit_wallet_balance();

drop trigger if exists trg_passes_log_billing_usage on public.passes;
create trigger trg_passes_log_billing_usage
after insert on public.passes
for each row execute function public.trg_log_pass_issue_billing_usage();

alter table public.billing_plans enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.billing_payment_methods enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_subscription_changes enable row level security;
alter table public.billing_cycles enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_invoice_items enable row level security;
alter table public.billing_reprocessing_batches enable row level security;
alter table public.billing_usage_events enable row level security;
alter table public.billing_credit_wallets enable row level security;
alter table public.billing_credit_transactions enable row level security;
alter table public.billing_notification_rules enable row level security;
alter table public.billing_notification_deliveries enable row level security;
alter table public.project_billing_audit_logs enable row level security;

drop policy if exists billing_plans_public_read on public.billing_plans;
create policy billing_plans_public_read
on public.billing_plans
for select
to anon, authenticated
using (is_active or (select public.is_superadmin()));

drop policy if exists billing_plans_superadmin_write on public.billing_plans;
create policy billing_plans_superadmin_write
on public.billing_plans
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_accounts_member_select on public.billing_accounts;
create policy billing_accounts_member_select
on public.billing_accounts
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_accounts_member_insert on public.billing_accounts;
create policy billing_accounts_member_insert
on public.billing_accounts
for insert
to authenticated
with check ((select public.can_access_project(project_id)));

drop policy if exists billing_accounts_member_update on public.billing_accounts;
create policy billing_accounts_member_update
on public.billing_accounts
for update
to authenticated
using ((select public.can_access_project(project_id)))
with check ((select public.can_access_project(project_id)));

drop policy if exists billing_accounts_superadmin_delete on public.billing_accounts;
create policy billing_accounts_superadmin_delete
on public.billing_accounts
for delete
to authenticated
using ((select public.is_superadmin()));

drop policy if exists billing_payment_methods_member_rw on public.billing_payment_methods;
create policy billing_payment_methods_member_rw
on public.billing_payment_methods
for all
to authenticated
using ((select public.can_access_project(project_id)))
with check ((select public.can_access_project(project_id)));

drop policy if exists billing_subscriptions_member_select on public.billing_subscriptions;
create policy billing_subscriptions_member_select
on public.billing_subscriptions
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_subscriptions_member_insert on public.billing_subscriptions;
create policy billing_subscriptions_member_insert
on public.billing_subscriptions
for insert
to authenticated
with check ((select public.can_access_project(project_id)));

drop policy if exists billing_subscriptions_member_update on public.billing_subscriptions;
create policy billing_subscriptions_member_update
on public.billing_subscriptions
for update
to authenticated
using ((select public.can_access_project(project_id)))
with check ((select public.can_access_project(project_id)));

drop policy if exists billing_subscriptions_superadmin_delete on public.billing_subscriptions;
create policy billing_subscriptions_superadmin_delete
on public.billing_subscriptions
for delete
to authenticated
using ((select public.is_superadmin()));

drop policy if exists billing_subscription_changes_member_select on public.billing_subscription_changes;
create policy billing_subscription_changes_member_select
on public.billing_subscription_changes
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_subscription_changes_member_insert on public.billing_subscription_changes;
create policy billing_subscription_changes_member_insert
on public.billing_subscription_changes
for insert
to authenticated
with check ((select public.can_access_project(project_id)));

drop policy if exists billing_subscription_changes_superadmin_modify on public.billing_subscription_changes;
create policy billing_subscription_changes_superadmin_modify
on public.billing_subscription_changes
for update
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_subscription_changes_superadmin_delete on public.billing_subscription_changes;
create policy billing_subscription_changes_superadmin_delete
on public.billing_subscription_changes
for delete
to authenticated
using ((select public.is_superadmin()));

drop policy if exists billing_cycles_member_select on public.billing_cycles;
create policy billing_cycles_member_select
on public.billing_cycles
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_cycles_superadmin_write on public.billing_cycles;
create policy billing_cycles_superadmin_write
on public.billing_cycles
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_invoices_member_select on public.billing_invoices;
create policy billing_invoices_member_select
on public.billing_invoices
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_invoices_superadmin_write on public.billing_invoices;
create policy billing_invoices_superadmin_write
on public.billing_invoices
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_invoice_items_member_select on public.billing_invoice_items;
create policy billing_invoice_items_member_select
on public.billing_invoice_items
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_invoice_items_superadmin_write on public.billing_invoice_items;
create policy billing_invoice_items_superadmin_write
on public.billing_invoice_items
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_reprocessing_batches_member_select on public.billing_reprocessing_batches;
create policy billing_reprocessing_batches_member_select
on public.billing_reprocessing_batches
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_reprocessing_batches_superadmin_write on public.billing_reprocessing_batches;
create policy billing_reprocessing_batches_superadmin_write
on public.billing_reprocessing_batches
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_usage_events_member_select on public.billing_usage_events;
create policy billing_usage_events_member_select
on public.billing_usage_events
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_usage_events_superadmin_write on public.billing_usage_events;
create policy billing_usage_events_superadmin_write
on public.billing_usage_events
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_credit_wallets_member_select on public.billing_credit_wallets;
create policy billing_credit_wallets_member_select
on public.billing_credit_wallets
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_credit_wallets_superadmin_write on public.billing_credit_wallets;
create policy billing_credit_wallets_superadmin_write
on public.billing_credit_wallets
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_credit_transactions_member_select on public.billing_credit_transactions;
create policy billing_credit_transactions_member_select
on public.billing_credit_transactions
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_credit_transactions_superadmin_write on public.billing_credit_transactions;
create policy billing_credit_transactions_superadmin_write
on public.billing_credit_transactions
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_notification_rules_member_rw on public.billing_notification_rules;
create policy billing_notification_rules_member_rw
on public.billing_notification_rules
for all
to authenticated
using ((select public.can_access_project(project_id)))
with check ((select public.can_access_project(project_id)));

drop policy if exists billing_notification_deliveries_member_select on public.billing_notification_deliveries;
create policy billing_notification_deliveries_member_select
on public.billing_notification_deliveries
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_notification_deliveries_superadmin_write on public.billing_notification_deliveries;
create policy billing_notification_deliveries_superadmin_write
on public.billing_notification_deliveries
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists project_billing_audit_logs_member_select on public.project_billing_audit_logs;
create policy project_billing_audit_logs_member_select
on public.project_billing_audit_logs
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists project_billing_audit_logs_superadmin_write on public.project_billing_audit_logs;
create policy project_billing_audit_logs_superadmin_write
on public.project_billing_audit_logs
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));
