-- Paid subscription delinquency policy.
-- past_due keeps access during the grace period; suspended is the blocking state.

alter table public.billing_subscriptions
  add column if not exists delinquent_since timestamptz,
  add column if not exists grace_ends_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists last_payment_failure_at timestamptz,
  add column if not exists delinquency_gateway_charge_id text,
  add column if not exists delinquency_reason text;

alter table public.billing_subscriptions
  drop constraint if exists billing_subscriptions_status_check;

alter table public.billing_subscriptions
  add constraint billing_subscriptions_status_check
  check (status in ('trialing', 'active', 'past_due', 'paused', 'suspended', 'canceled', 'expired'));

create index if not exists billing_subscriptions_past_due_grace_idx
  on public.billing_subscriptions(grace_ends_at)
  where status = 'past_due'
    and grace_ends_at is not null;

create index if not exists billing_subscriptions_delinquency_charge_idx
  on public.billing_subscriptions(gateway_provider, delinquency_gateway_charge_id)
  where delinquency_gateway_charge_id is not null;

comment on column public.billing_subscriptions.delinquent_since is
  'First timestamp when the current paid-subscription delinquency was observed.';
comment on column public.billing_subscriptions.grace_ends_at is
  'When past_due should become suspended if payment is not recovered.';
comment on column public.billing_subscriptions.suspended_at is
  'When access was blocked because paid delinquency exceeded the grace period.';
comment on column public.billing_subscriptions.last_payment_failure_at is
  'Most recent failed or overdue payment event observed for the subscription.';
comment on column public.billing_subscriptions.delinquency_gateway_charge_id is
  'Asaas payment id responsible for the current delinquency, used to clear only matching recoveries.';
comment on column public.billing_subscriptions.delinquency_reason is
  'Normalized reason that moved the paid subscription into delinquency.';
