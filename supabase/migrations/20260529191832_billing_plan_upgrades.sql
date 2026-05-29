-- Suporte ao fluxo de upgrade de plano dentro do painel do estabelecimento.
--
-- A assinatura atual continua em public.billing_subscriptions e o historico
-- comercial continua em public.billing_subscription_changes. Esta tabela guarda
-- apenas a intencao operacional do upgrade, incluindo checkout/assinatura Asaas.

create table if not exists public.billing_plan_change_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid not null,
  previous_plan_id uuid not null references public.billing_plans(id) on delete restrict,
  new_plan_id uuid not null references public.billing_plans(id) on delete restrict,
  requested_by uuid references public.profiles(id) on delete set null,
  change_type text not null default 'upgrade'
    check (change_type in ('upgrade', 'trial_conversion')),
  effective_mode text not null default 'immediate'
    check (effective_mode in ('immediate', 'next_cycle')),
  provider text not null default 'asaas'
    check (provider in ('asaas')),
  provider_checkout_id text,
  provider_subscription_id text,
  provider_customer_id text,
  provider_payment_id text,
  external_reference text not null,
  status text not null default 'pending'
    check (status in ('pending', 'created', 'paid', 'applied', 'canceled', 'expired', 'failed')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'BRL'
    check (char_length(currency) = 3 and currency = upper(currency)),
  checkout_url text,
  success_url text,
  cancel_url text,
  expired_url text,
  paid_at timestamptz,
  expires_at timestamptz,
  applied_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plan_change_sessions_subscription_project_fk
    foreign key (subscription_id, project_id)
    references public.billing_subscriptions(id, project_id)
    on delete cascade,
  constraint billing_plan_change_sessions_paid_status_check
    check (
      (status in ('paid', 'applied') and paid_at is not null)
      or status not in ('paid', 'applied')
    )
);

create unique index if not exists billing_plan_change_sessions_external_reference_uidx
  on public.billing_plan_change_sessions (external_reference);

create unique index if not exists billing_plan_change_sessions_provider_checkout_uidx
  on public.billing_plan_change_sessions (provider, provider_checkout_id)
  where provider_checkout_id is not null;

create index if not exists billing_plan_change_sessions_project_status_idx
  on public.billing_plan_change_sessions (project_id, status, created_at desc);

create index if not exists billing_plan_change_sessions_subscription_idx
  on public.billing_plan_change_sessions (subscription_id, created_at desc);

create index if not exists billing_plan_change_sessions_requested_by_idx
  on public.billing_plan_change_sessions (requested_by, created_at desc)
  where requested_by is not null;

drop trigger if exists trg_billing_plan_change_sessions_updated_at
  on public.billing_plan_change_sessions;
create trigger trg_billing_plan_change_sessions_updated_at
before update on public.billing_plan_change_sessions
for each row execute function public.set_updated_at();

alter table public.billing_plan_change_sessions enable row level security;

revoke all on table public.billing_plan_change_sessions from anon;
revoke all on table public.billing_plan_change_sessions from authenticated;
grant select, insert, update on table public.billing_plan_change_sessions to service_role;

-- Billing sensivel deve ser mutado por Edge Functions/RPCs com validacao
-- explicita. Membros seguem podendo ler as tabelas pelas policies existentes.
drop policy if exists billing_subscriptions_member_insert on public.billing_subscriptions;
drop policy if exists billing_subscriptions_member_update on public.billing_subscriptions;
drop policy if exists billing_subscription_changes_member_insert on public.billing_subscription_changes;

create or replace function public.apply_billing_plan_change(
  p_session_id uuid,
  p_actor_user_id uuid default null,
  p_provider_subscription_id text default null,
  p_provider_customer_id text default null,
  p_provider_payment_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.billing_plan_change_sessions%rowtype;
  v_subscription public.billing_subscriptions%rowtype;
  v_new_plan public.billing_plans%rowtype;
  v_change_id uuid;
begin
  select *
    into v_session
  from public.billing_plan_change_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Plan change session % not found', p_session_id using errcode = 'P0002';
  end if;

  if v_session.status = 'applied' then
    return jsonb_build_object(
      'success', true,
      'already_applied', true,
      'plan_change_session_id', v_session.id,
      'subscription_id', v_session.subscription_id,
      'new_plan_id', v_session.new_plan_id
    );
  end if;

  if v_session.status <> 'paid' then
    raise exception 'Plan change session % is not paid', p_session_id using errcode = '23514';
  end if;

  select *
    into v_subscription
  from public.billing_subscriptions
  where id = v_session.subscription_id
    and project_id = v_session.project_id
    and status in ('trialing', 'active', 'past_due', 'paused')
  for update;

  if not found then
    raise exception 'Active subscription for plan change session % not found', p_session_id using errcode = 'P0002';
  end if;

  select *
    into v_new_plan
  from public.billing_plans
  where id = v_session.new_plan_id
    and is_active = true;

  if not found then
    raise exception 'Target billing plan % not found or inactive', v_session.new_plan_id using errcode = 'P0002';
  end if;

  insert into public.billing_subscription_changes (
    project_id,
    subscription_id,
    previous_plan_id,
    new_plan_id,
    change_type,
    change_reason,
    proration_delta_cents,
    effective_at,
    requested_by,
    effective_mode,
    metadata
  )
  values (
    v_session.project_id,
    v_session.subscription_id,
    v_session.previous_plan_id,
    v_session.new_plan_id,
    v_session.change_type,
    'manual',
    0,
    now(),
    coalesce(p_actor_user_id, v_session.requested_by),
    v_session.effective_mode,
    jsonb_build_object(
      'origin', 'billing_plan_change_session',
      'plan_change_session_id', v_session.id,
      'provider', v_session.provider,
      'provider_checkout_id', v_session.provider_checkout_id,
      'provider_subscription_id', coalesce(p_provider_subscription_id, v_session.provider_subscription_id)
    )
  )
  returning id into v_change_id;

  update public.billing_subscriptions
  set
    plan_id = v_new_plan.id,
    status = 'active',
    trial_started_at = null,
    trial_ends_at = null,
    gateway_provider = 'asaas',
    gateway_subscription_id = coalesce(
      nullif(p_provider_subscription_id, ''),
      nullif(v_session.provider_subscription_id, ''),
      gateway_subscription_id
    ),
    base_price_cents = v_new_plan.base_price_cents,
    included_pass_installs = coalesce(v_new_plan.included_pass_installs, 0),
    included_notification_sends = coalesce(v_new_plan.included_notification_sends, 0),
    overage_pass_install_cents = coalesce(v_new_plan.overage_pass_install_cents, 0),
    overage_notification_sent_cents = coalesce(v_new_plan.overage_notification_sent_cents, 0),
    currency = 'BRL',
    metadata = metadata || jsonb_build_object(
      'plan_code', v_new_plan.code,
      'last_plan_change_id', v_change_id,
      'last_plan_change_session_id', v_session.id
    )
  where id = v_subscription.id;

  update public.billing_accounts
  set
    gateway_provider = 'asaas',
    gateway_customer_id = coalesce(
      nullif(p_provider_customer_id, ''),
      nullif(v_session.provider_customer_id, ''),
      gateway_customer_id
    )
  where id = v_subscription.billing_account_id
    and project_id = v_subscription.project_id;

  insert into public.projects_notifications (
    project_id,
    notifications_limit,
    total_notifications_sent,
    recent_notifications_sent,
    notifications_exp
  )
  values (
    v_session.project_id,
    coalesce(v_new_plan.included_notification_sends, 0),
    0,
    0,
    coalesce(v_subscription.current_period_end, now() + interval '1 month')
  )
  on conflict (project_id) do update
  set
    notifications_limit = excluded.notifications_limit,
    notifications_exp = greatest(
      coalesce(public.projects_notifications.notifications_exp, excluded.notifications_exp),
      excluded.notifications_exp
    );

  update public.billing_plan_change_sessions
  set
    status = 'applied',
    applied_at = now(),
    provider_subscription_id = coalesce(nullif(p_provider_subscription_id, ''), provider_subscription_id),
    provider_customer_id = coalesce(nullif(p_provider_customer_id, ''), provider_customer_id),
    provider_payment_id = coalesce(nullif(p_provider_payment_id, ''), provider_payment_id),
    metadata = metadata || jsonb_build_object('billing_subscription_change_id', v_change_id)
  where id = v_session.id;

  insert into public.project_billing_audit_logs (
    project_id,
    actor_user_id,
    target_table,
    target_id,
    action,
    changes
  )
  values (
    v_session.project_id,
    coalesce(p_actor_user_id, v_session.requested_by),
    'billing_subscriptions',
    v_subscription.id,
    'update',
    jsonb_build_object(
      'origin', 'plan_upgrade',
      'previous_plan_id', v_session.previous_plan_id,
      'new_plan_id', v_session.new_plan_id,
      'billing_subscription_change_id', v_change_id,
      'plan_change_session_id', v_session.id
    )
  );

  return jsonb_build_object(
    'success', true,
    'already_applied', false,
    'plan_change_session_id', v_session.id,
    'billing_subscription_change_id', v_change_id,
    'subscription_id', v_subscription.id,
    'new_plan_id', v_new_plan.id,
    'plan_code', v_new_plan.code,
    'plan_name', v_new_plan.name
  );
end;
$$;

revoke all on function public.apply_billing_plan_change(uuid, uuid, text, text, text) from public;
grant execute on function public.apply_billing_plan_change(uuid, uuid, text, text, text) to service_role;
