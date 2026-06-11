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
  v_requested_effective_mode text;
  v_applied_effective_mode text;
  v_allowance_proration_mode text;
  v_effective_at timestamptz;
  v_previous_plan_code text;
  v_is_expired_trial_conversion boolean := false;
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
      'scheduled', false,
      'superseded', false,
      'plan_change_session_id', v_session.id,
      'subscription_id', v_session.subscription_id,
      'new_plan_id', v_session.new_plan_id
    );
  end if;

  if v_session.status = 'superseded' then
    return jsonb_build_object(
      'success', true,
      'already_applied', false,
      'scheduled', false,
      'superseded', true,
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
    and status in ('trialing', 'active', 'past_due', 'paused', 'expired')
  for update;

  if not found then
    raise exception 'Eligible subscription for plan change session % not found', p_session_id using errcode = 'P0002';
  end if;

  if v_subscription.plan_id <> v_session.previous_plan_id then
    update public.billing_plan_change_sessions
    set
      status = 'superseded',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'superseded_at', now(),
        'superseded_reason', 'stale_plan_change_session',
        'current_plan_id', v_subscription.plan_id,
        'expected_previous_plan_id', v_session.previous_plan_id
      )
    where id = v_session.id;

    return jsonb_build_object(
      'success', true,
      'already_applied', false,
      'scheduled', false,
      'superseded', true,
      'reason', 'stale_plan_change_session',
      'plan_change_session_id', v_session.id,
      'subscription_id', v_subscription.id,
      'new_plan_id', v_session.new_plan_id,
      'current_plan_id', v_subscription.plan_id,
      'expected_previous_plan_id', v_session.previous_plan_id
    );
  end if;

  if v_session.effective_mode = 'next_cycle'
     and v_subscription.current_period_end is not null
     and v_subscription.current_period_end > now() then
    return jsonb_build_object(
      'success', true,
      'scheduled', true,
      'superseded', false,
      'already_applied', false,
      'plan_change_session_id', v_session.id,
      'subscription_id', v_subscription.id,
      'new_plan_id', v_session.new_plan_id,
      'effective_mode', v_session.effective_mode,
      'current_period_end', v_subscription.current_period_end
    );
  end if;

  select *
    into v_new_plan
  from public.billing_plans
  where id = v_session.new_plan_id
    and is_active = true;

  if not found then
    raise exception 'Target billing plan % not found or inactive', v_session.new_plan_id using errcode = 'P0002';
  end if;

  select code
    into v_previous_plan_code
  from public.billing_plans
  where id = v_session.previous_plan_id;

  v_is_expired_trial_conversion :=
    v_subscription.status = 'expired'
    and v_session.change_type = 'trial_conversion'
    and v_previous_plan_code = 'free_trial'
    and v_new_plan.base_price_cents > 0;

  if v_subscription.status = 'expired' and not v_is_expired_trial_conversion then
    raise exception 'Expired subscription % cannot be applied by this plan change session', v_subscription.id using errcode = '23514';
  end if;

  v_requested_effective_mode := v_session.effective_mode;
  v_applied_effective_mode := case
    when v_session.effective_mode = 'next_cycle' then 'immediate'
    else v_session.effective_mode
  end;
  v_allowance_proration_mode := case
    when v_applied_effective_mode = 'immediate'
      and v_session.change_type in ('upgrade', 'downgrade', 'trial_conversion', 'plan_change')
    then 'full_new_plan'
    else 'prorated_daily'
  end;
  v_effective_at := case
    when v_session.effective_mode = 'next_cycle'
    then coalesce(v_subscription.current_period_end, now())
    else now()
  end;

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
    v_effective_at,
    coalesce(p_actor_user_id, v_session.requested_by),
    v_applied_effective_mode,
    v_allowance_proration_mode,
    jsonb_build_object(
      'origin', 'billing_plan_change_session',
      'plan_change_session_id', v_session.id,
      'provider', v_session.provider,
      'provider_checkout_id', v_session.provider_checkout_id,
      'provider_subscription_id', coalesce(p_provider_subscription_id, v_session.provider_subscription_id),
      'requested_effective_mode', v_requested_effective_mode,
      'reactivated_expired_trial', v_is_expired_trial_conversion
    )
  )
  returning id into v_change_id;

  update public.billing_subscriptions
  set
    plan_id = v_new_plan.id,
    status = 'active',
    trial_started_at = null,
    trial_ends_at = null,
    ended_at = null,
    canceled_at = null,
    current_period_start = case when v_is_expired_trial_conversion then v_effective_at else current_period_start end,
    current_period_end = case when v_is_expired_trial_conversion then v_effective_at + interval '1 month' else current_period_end end,
    gateway_provider = case
      when v_new_plan.base_price_cents > 0
        or nullif(p_provider_subscription_id, '') is not null
        or nullif(v_session.provider_subscription_id, '') is not null
      then 'asaas'
      else gateway_provider
    end,
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
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'plan_code', v_new_plan.code,
      'last_plan_change_id', v_change_id,
      'last_plan_change_session_id', v_session.id,
      'last_requested_effective_mode', v_requested_effective_mode,
      'reactivated_expired_trial_at', case when v_is_expired_trial_conversion then v_effective_at else null end
    )
  where id = v_subscription.id;

  update public.billing_accounts
  set
    gateway_provider = case
      when v_new_plan.base_price_cents > 0
        or nullif(p_provider_customer_id, '') is not null
        or nullif(v_session.provider_customer_id, '') is not null
      then 'asaas'
      else gateway_provider
    end,
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
    case
      when v_is_expired_trial_conversion then v_effective_at + interval '1 month'
      else coalesce(v_subscription.current_period_end, now() + interval '1 month')
    end
  )
  on conflict (project_id) do update
  set
    notifications_limit = excluded.notifications_limit,
    notifications_exp = greatest(
      coalesce(public.projects_notifications.notifications_exp, excluded.notifications_exp),
      excluded.notifications_exp
    );

  if v_is_expired_trial_conversion then
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
      v_session.project_id,
      v_subscription.id,
      'subscription',
      'monthly',
      v_effective_at,
      v_effective_at + interval '1 month',
      'open',
      jsonb_build_object(
        'origin', 'expired_trial_reactivation',
        'plan_change_session_id', v_session.id,
        'billing_subscription_change_id', v_change_id
      )
    )
    on conflict (project_id, cycle_type, period_start, period_end) do nothing;
  end if;

  update public.billing_plan_change_sessions
  set
    status = 'applied',
    applied_at = now(),
    provider_subscription_id = coalesce(nullif(p_provider_subscription_id, ''), provider_subscription_id),
    provider_customer_id = coalesce(nullif(p_provider_customer_id, ''), provider_customer_id),
    provider_payment_id = coalesce(nullif(p_provider_payment_id, ''), provider_payment_id),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('billing_subscription_change_id', v_change_id)
  where id = v_session.id;

  perform public.supersede_pending_next_cycle_plan_changes(
    v_session.subscription_id,
    v_session.id,
    'superseded_by_applied_plan_change'
  );

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
      'origin', 'plan_change',
      'previous_plan_id', v_session.previous_plan_id,
      'new_plan_id', v_session.new_plan_id,
      'billing_subscription_change_id', v_change_id,
      'plan_change_session_id', v_session.id,
      'requested_effective_mode', v_requested_effective_mode,
      'reactivated_expired_trial', v_is_expired_trial_conversion
    )
  );

  return jsonb_build_object(
    'success', true,
    'scheduled', false,
    'superseded', false,
    'already_applied', false,
    'plan_change_session_id', v_session.id,
    'billing_subscription_change_id', v_change_id,
    'subscription_id', v_subscription.id,
    'new_plan_id', v_new_plan.id,
    'effective_mode', v_applied_effective_mode,
    'requested_effective_mode', v_requested_effective_mode,
    'plan_code', v_new_plan.code,
    'plan_name', v_new_plan.name,
    'reactivated_expired_trial', v_is_expired_trial_conversion
  );
end;
$$;

revoke all on function public.apply_billing_plan_change(uuid, uuid, text, text, text) from public;
grant execute on function public.apply_billing_plan_change(uuid, uuid, text, text, text) to service_role;
