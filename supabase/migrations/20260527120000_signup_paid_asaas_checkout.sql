-- Suporte ao signup de planos pagos via Asaas Checkout.
-- A tabela abaixo registra a intencao de checkout criada antes do
-- provisionamento definitivo em signup-finalize.

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in (
        'public.billing_accounts'::regclass,
        'public.billing_payment_methods'::regclass,
        'public.billing_subscriptions'::regclass,
        'public.billing_invoices'::regclass
      )
      and pg_get_constraintdef(oid) ilike '%gateway_provider%'
  loop
    execute format('alter table %s drop constraint %I', c.table_name, c.conname);
  end loop;
end
$$;
alter table public.billing_accounts
  add constraint billing_accounts_gateway_provider_check
  check (gateway_provider in ('pagseguro', 'infinitepay', 'rede', 'asaas', 'other'));
alter table public.billing_payment_methods
  add constraint billing_payment_methods_gateway_provider_check
  check (gateway_provider in ('pagseguro', 'infinitepay', 'rede', 'asaas', 'other'));
alter table public.billing_subscriptions
  add constraint billing_subscriptions_gateway_provider_check
  check (gateway_provider is null or gateway_provider in ('pagseguro', 'infinitepay', 'rede', 'asaas', 'other'));
alter table public.billing_invoices
  add constraint billing_invoices_gateway_provider_check
  check (gateway_provider is null or gateway_provider in ('pagseguro', 'infinitepay', 'rede', 'asaas', 'other'));
create table if not exists public.signup_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  plan_code text not null,
  email text not null,
  establishment_name text not null,
  provider text not null default 'asaas'
    check (provider in ('asaas')),
  provider_checkout_id text,
  provider_subscription_id text,
  provider_customer_id text,
  provider_payment_id text,
  external_reference text not null,
  status text not null default 'pending'
    check (status in ('pending', 'created', 'paid', 'canceled', 'expired', 'failed', 'finalized')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'BRL'
    check (char_length(currency) = 3 and currency = upper(currency)),
  checkout_url text,
  success_url text,
  cancel_url text,
  expired_url text,
  paid_at timestamptz,
  expires_at timestamptz,
  finalized_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signup_checkout_sessions_email_normalized_check
    check (email = lower(btrim(email)) and email <> ''),
  constraint signup_checkout_sessions_plan_code_normalized_check
    check (plan_code = lower(btrim(plan_code)) and plan_code <> ''),
  constraint signup_checkout_sessions_establishment_name_check
    check (btrim(establishment_name) <> ''),
  constraint signup_checkout_sessions_paid_status_check
    check (
      (status in ('paid', 'finalized') and paid_at is not null)
      or status not in ('paid', 'finalized')
    )
);
create unique index if not exists signup_checkout_sessions_external_reference_uidx
  on public.signup_checkout_sessions (external_reference);
create unique index if not exists signup_checkout_sessions_provider_checkout_uidx
  on public.signup_checkout_sessions (provider, provider_checkout_id)
  where provider_checkout_id is not null;
create index if not exists signup_checkout_sessions_user_status_idx
  on public.signup_checkout_sessions (user_id, status, created_at desc);
create index if not exists signup_checkout_sessions_plan_idx
  on public.signup_checkout_sessions (plan_id);
create index if not exists signup_checkout_sessions_provider_payment_idx
  on public.signup_checkout_sessions (provider, provider_payment_id)
  where provider_payment_id is not null;
drop trigger if exists trg_signup_checkout_sessions_updated_at
  on public.signup_checkout_sessions;
create trigger trg_signup_checkout_sessions_updated_at
before update on public.signup_checkout_sessions
for each row execute function public.set_updated_at();
alter table public.signup_checkout_sessions enable row level security;
revoke all on table public.signup_checkout_sessions from anon;
revoke all on table public.signup_checkout_sessions from authenticated;
grant select, insert, update on table public.signup_checkout_sessions to service_role;
