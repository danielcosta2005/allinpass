create or replace function public.reactivate_billing_subscription(
  p_subscription_id uuid,
  p_actor_user_id uuid default null,
  p_provider_subscription_id text default null,
  p_provider_customer_id text default null,
  p_effective_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_subscription public.billing_subscriptions%rowtype;
  v_change_id uuid;
  v_effective_at timestamptz := coalesce(p_effective_at, now());
  v_period_end timestamptz := coalesce(p_effective_at, now()) + interval '1 month';
  v_provider_subscription_id text := nullif(trim(coalesce(p_provider_subscription_id, '')), '');
  v_provider_customer_id text := nullif(trim(coalesce(p_provider_customer_id, '')), '');
begin
  select *
    into v_subscription
  from public.billing_subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    raise exception 'billing subscription not found'
      using errcode = 'P0002';
  end if;

  v_provider_subscription_id := coalesce(v_provider_subscription_id, nullif(trim(coalesce(v_subscription.gateway_subscription_id, '')), ''));

  if v_subscription.status = 'active' then
    return jsonb_build_object(
      'success', true,
      'already_active', true,
      'subscription_id', v_subscription.id,
      'project_id', v_subscription.project_id,
      'provider_subscription_id', v_provider_subscription_id,
      'current_period_start', v_subscription.current_period_start,
      'current_period_end', v_subscription.current_period_end
    );
  end if;

  if v_subscription.status <> 'canceled' then
    raise exception 'billing subscription is not canceled'
      using errcode = 'P0001';
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
    allowance_proration_mode,
    cycle_started_at,
    cycle_ends_at,
    metadata
  )
  values (
    v_subscription.project_id,
    v_subscription.id,
    v_subscription.plan_id,
    v_subscription.plan_id,
    'reactivation',
    'manual',
    0,
    v_effective_at,
    p_actor_user_id,
    'immediate',
    'none',
    v_effective_at,
    v_period_end,
    jsonb_build_object(
      'origin', 'billing_subscription_reactivation',
      'provider', 'asaas',
      'provider_subscription_id', v_provider_subscription_id,
      'provider_customer_id', v_provider_customer_id
    )
  )
  returning id into v_change_id;

  update public.billing_subscriptions
  set
    status = 'active',
    current_period_start = v_effective_at,
    current_period_end = v_period_end,
    cancel_at_period_end = false,
    canceled_at = null,
    ended_at = null,
    trial_started_at = null,
    trial_ends_at = null,
    gateway_provider = case when v_provider_subscription_id is not null then 'asaas' else gateway_provider end,
    gateway_subscription_id = coalesce(v_provider_subscription_id, gateway_subscription_id),
    delinquent_since = null,
    grace_ends_at = null,
    suspended_at = null,
    last_payment_failure_at = null,
    delinquency_gateway_charge_id = null,
    delinquency_reason = null,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'last_reactivation_id', v_change_id,
      'last_reactivated_at', v_effective_at,
      'last_reactivation_provider_subscription_id', v_provider_subscription_id
    )
  where id = v_subscription.id;

  if v_provider_customer_id is not null then
    update public.billing_accounts
    set
      gateway_provider = 'asaas',
      gateway_customer_id = v_provider_customer_id
    where id = v_subscription.billing_account_id
      and project_id = v_subscription.project_id;
  end if;

  insert into public.billing_cycles (
    project_id,
    subscription_id,
    cycle_type,
    frequency,
    period_start,
    period_end,
    status,
    metadata
  )
  values (
    v_subscription.project_id,
    v_subscription.id,
    'subscription',
    'monthly',
    v_effective_at,
    v_period_end,
    'open',
    jsonb_build_object(
      'origin', 'billing_subscription_reactivation',
      'billing_subscription_change_id', v_change_id,
      'provider_subscription_id', v_provider_subscription_id
    )
  )
  on conflict (project_id, cycle_type, period_start, period_end) do nothing;

  insert into public.projects_notifications (
    project_id,
    notifications_limit,
    total_notifications_sent,
    recent_notifications_sent,
    notifications_exp
  )
  values (
    v_subscription.project_id,
    coalesce(v_subscription.included_notification_sends, 0),
    0,
    0,
    v_period_end
  )
  on conflict (project_id) do update
  set
    notifications_limit = excluded.notifications_limit,
    notifications_exp = excluded.notifications_exp;

  update public.billing_plan_change_sessions
  set
    status = 'superseded',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'superseded_by_subscription_reactivation', true,
      'superseded_by_billing_subscription_change_id', v_change_id
    )
  where subscription_id = v_subscription.id
    and status in ('pending', 'created', 'paid')
    and effective_mode = 'next_cycle';

  insert into public.project_billing_audit_logs (
    project_id,
    actor_user_id,
    target_table,
    target_id,
    action,
    changes
  )
  values (
    v_subscription.project_id,
    p_actor_user_id,
    'billing_subscriptions',
    v_subscription.id,
    'update',
    jsonb_build_object(
      'origin', 'billing_subscription_reactivation',
      'previous_status', v_subscription.status,
      'new_status', 'active',
      'billing_subscription_change_id', v_change_id,
      'provider_subscription_id', v_provider_subscription_id
    )
  );

  return jsonb_build_object(
    'success', true,
    'already_active', false,
    'subscription_id', v_subscription.id,
    'project_id', v_subscription.project_id,
    'billing_subscription_change_id', v_change_id,
    'provider_subscription_id', v_provider_subscription_id,
    'current_period_start', v_effective_at,
    'current_period_end', v_period_end
  );
end;
$$;

revoke all on function public.reactivate_billing_subscription(uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.reactivate_billing_subscription(uuid, uuid, text, text, timestamptz) to service_role;
