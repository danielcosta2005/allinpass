-- Scheduled plan cancellation reuses next-cycle plan-change sessions.

alter table public.billing_plan_change_sessions
  drop constraint if exists billing_plan_change_sessions_change_type_check;

alter table public.billing_plan_change_sessions
  add constraint billing_plan_change_sessions_change_type_check
  check (change_type in ('upgrade', 'downgrade', 'trial_conversion', 'plan_change', 'cancellation'));

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
  v_session_metadata jsonb;
  v_provider_cancellation_confirmed boolean := false;
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

  v_session_metadata := coalesce(v_session.metadata, '{}'::jsonb);
  v_provider_cancellation_confirmed :=
    coalesce((v_session_metadata ->> 'provider_cancellation_confirmed')::boolean, false)
    or coalesce(length(nullif(v_session_metadata ->> 'provider_cancellation_confirmed_at', '')), 0) > 0
    or coalesce((v_session_metadata ->> 'provider_cancellation_not_required')::boolean, false);

  if v_session.change_type = 'cancellation'
     and v_subscription.gateway_provider = 'asaas'
     and nullif(v_subscription.gateway_subscription_id, '') is not null
     and not v_provider_cancellation_confirmed then
    return jsonb_build_object(
      'success', true,
      'scheduled', true,
      'provider_cancellation_required', true,
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
      'origin', case when v_session.change_type = 'cancellation' then 'plan_cancellation' else 'billing_plan_change_session' end,
      'plan_change_session_id', v_session.id,
      'provider', v_session.provider,
      'provider_checkout_id', v_session.provider_checkout_id,
      'provider_subscription_id', coalesce(p_provider_subscription_id, v_session.provider_subscription_id),
      'requested_effective_mode', v_requested_effective_mode,
      'reactivated_expired_trial', v_is_expired_trial_conversion
    )
  )
  returning id into v_change_id;

  if v_session.change_type = 'cancellation' then
    update public.billing_subscriptions
    set
      status = 'canceled',
      cancel_at_period_end = false,
      canceled_at = coalesce(canceled_at, now()),
      ended_at = v_effective_at,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'last_plan_cancellation_id', v_change_id,
        'last_plan_cancellation_session_id', v_session.id,
        'last_requested_effective_mode', v_requested_effective_mode
      )
    where id = v_subscription.id;

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

    update public.billing_cycles
    set
      status = 'void',
      closed_at = coalesce(closed_at, now()),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'skip_next_cycle', true,
        'void_reason', 'subscription_canceled',
        'plan_change_session_id', v_session.id
      )
    where subscription_id = v_subscription.id
      and project_id = v_subscription.project_id
      and cycle_type = 'subscription'
      and status = 'open'
      and period_start >= v_effective_at;

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
        'origin', 'plan_cancellation',
        'previous_plan_id', v_session.previous_plan_id,
        'new_plan_id', v_session.new_plan_id,
        'billing_subscription_change_id', v_change_id,
        'plan_change_session_id', v_session.id,
        'requested_effective_mode', v_requested_effective_mode
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
      'canceled', true,
      'ended_at', v_effective_at
    );
  end if;

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

create or replace function public.close_billing_cycle_for_overage(
  p_cycle_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.billing_cycles%rowtype;
  v_subscription public.billing_subscriptions%rowtype;
  v_summary public.billing_cycle_usage_summaries%rowtype;
  v_summary_id uuid;
  v_existing_invoice_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_due_at timestamptz;
  v_next_period_start timestamptz;
  v_next_period_end timestamptz;
  v_next_cycle_id uuid;
  v_interval interval;
  v_applied_plan_changes integer := 0;
  v_plan_change record;
  v_pending_cancellation_id uuid;
begin
  if p_cycle_id is null then
    raise exception 'Billing cycle id is required' using errcode = '23502';
  end if;

  select *
    into v_cycle
  from public.billing_cycles
  where id = p_cycle_id
  for update;

  if not found then
    raise exception 'Billing cycle % not found', p_cycle_id using errcode = 'P0002';
  end if;

  if v_cycle.status in ('closed', 'invoiced', 'paid') then
    select id
      into v_existing_invoice_id
    from public.billing_invoices
    where billing_cycle_id = v_cycle.id
      and status <> 'canceled'
      and (metadata ->> 'invoice_kind') = 'overage'
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'success', true,
      'already_closed', true,
      'billing_cycle_id', v_cycle.id,
      'invoice_id', v_existing_invoice_id,
      'status', v_cycle.status
    );
  end if;

  if v_cycle.status <> 'open' then
    raise exception 'Billing cycle % is not open', p_cycle_id using errcode = '23514';
  end if;

  if v_cycle.cycle_type <> 'subscription' or v_cycle.subscription_id is null then
    raise exception 'Billing cycle % is not a subscription cycle', p_cycle_id using errcode = '23514';
  end if;

  if v_cycle.period_end > now() then
    raise exception 'Billing cycle % is not due for closure', p_cycle_id using errcode = '23514';
  end if;

  select *
    into v_subscription
  from public.billing_subscriptions
  where id = v_cycle.subscription_id
    and project_id = v_cycle.project_id
  for update;

  if not found then
    raise exception 'Billing subscription % not found', v_cycle.subscription_id using errcode = 'P0002';
  end if;

  if v_subscription.status not in ('active', 'past_due', 'paused') then
    update public.billing_cycles
    set
      status = 'closed',
      closed_at = coalesce(closed_at, now()),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'close_reason', 'subscription_status_not_billable',
        'subscription_status', v_subscription.status
      )
    where id = v_cycle.id;

    return jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', 'subscription_status_not_billable',
      'billing_cycle_id', v_cycle.id,
      'subscription_status', v_subscription.status
    );
  end if;

  v_summary_id := public.refresh_billing_cycle_usage_summary_for_cycle(v_cycle.id);

  select *
    into v_summary
  from public.billing_cycle_usage_summaries
  where id = v_summary_id
  for update;

  select id
    into v_existing_invoice_id
  from public.billing_invoices
  where billing_cycle_id = v_cycle.id
    and status <> 'canceled'
    and (metadata ->> 'invoice_kind') = 'overage'
  order by created_at desc
  limit 1;

  v_due_at := v_cycle.period_end + interval '2 days';

  if v_existing_invoice_id is null and coalesce(v_summary.total_overage_cents, 0) > 0 then
    v_invoice_number := 'OVG-' || to_char(v_cycle.period_end at time zone 'UTC', 'YYYYMMDD')
      || '-' || left(replace(v_cycle.id::text, '-', ''), 10);

    insert into public.billing_invoices (
      project_id,
      subscription_id,
      billing_cycle_id,
      billing_account_id,
      invoice_number,
      gateway_provider,
      status,
      currency,
      subtotal_cents,
      amount_due_cents,
      issued_at,
      due_at,
      metadata
    )
    values (
      v_cycle.project_id,
      v_cycle.subscription_id,
      v_cycle.id,
      v_subscription.billing_account_id,
      v_invoice_number,
      'asaas',
      'draft',
      coalesce(v_subscription.currency, 'BRL'),
      v_summary.total_overage_cents,
      v_summary.total_overage_cents,
      now(),
      v_due_at,
      jsonb_build_object(
        'invoice_kind', 'overage',
        'source', 'close_billing_cycle_for_overage',
        'summary_id', v_summary.id,
        'period_start', v_cycle.period_start,
        'period_end', v_cycle.period_end,
        'collection_strategy', 'subscription_payment_adjustment',
        'collection_buffer_days', 2,
        'allow_standalone_charge', false,
        'allowance_source', v_summary.allowance_source
      )
    )
    returning id into v_invoice_id;

    if v_summary.pass_install_overage_quantity > 0
       and v_summary.pass_install_overage_cents > 0 then
      insert into public.billing_invoice_items (
        project_id,
        invoice_id,
        item_type,
        description,
        quantity,
        unit_amount_cents,
        period_start,
        period_end,
        metadata
      )
      values (
        v_cycle.project_id,
        v_invoice_id,
        'overage_pass_install',
        'Excedente de instalações de passes',
        v_summary.pass_install_overage_quantity,
        v_summary.overage_pass_install_cents,
        v_cycle.period_start,
        v_cycle.period_end,
        jsonb_build_object(
          'summary_id', v_summary.id,
          'included_quantity', v_summary.included_pass_installs,
          'usage_quantity', v_summary.pass_install_quantity
        )
      );
    end if;

    if v_summary.notification_sent_overage_quantity > 0
       and v_summary.notification_sent_overage_cents > 0 then
      insert into public.billing_invoice_items (
        project_id,
        invoice_id,
        item_type,
        description,
        quantity,
        unit_amount_cents,
        period_start,
        period_end,
        metadata
      )
      values (
        v_cycle.project_id,
        v_invoice_id,
        'overage_notification_sent',
        'Excedente de notificações enviadas',
        v_summary.notification_sent_overage_quantity,
        v_summary.overage_notification_sent_cents,
        v_cycle.period_start,
        v_cycle.period_end,
        jsonb_build_object(
          'summary_id', v_summary.id,
          'included_quantity', v_summary.included_notification_sends,
          'usage_quantity', v_summary.notification_sent_quantity
        )
      );
    end if;
  else
    v_invoice_id := v_existing_invoice_id;
  end if;

  update public.billing_cycles
  set
    status = case
      when coalesce(v_summary.total_overage_cents, 0) > 0 then 'invoiced'
      else 'closed'
    end,
    closed_at = coalesce(closed_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'closed_by', 'close_billing_cycle_for_overage',
      'closed_summary_id', v_summary.id,
      'overage_invoice_id', v_invoice_id,
      'total_overage_cents', coalesce(v_summary.total_overage_cents, 0)
    )
  where id = v_cycle.id;

  for v_plan_change in
    select
      bpcs.id,
      bpcs.requested_by,
      bpcs.provider_subscription_id,
      bpcs.provider_customer_id,
      bpcs.provider_payment_id
    from public.billing_plan_change_sessions bpcs
    where bpcs.subscription_id = v_cycle.subscription_id
      and bpcs.project_id = v_cycle.project_id
      and bpcs.status = 'paid'
      and bpcs.effective_mode = 'next_cycle'
      and bpcs.change_type <> 'cancellation'
    order by bpcs.created_at asc
  loop
    perform public.apply_billing_plan_change(
      v_plan_change.id,
      v_plan_change.requested_by,
      v_plan_change.provider_subscription_id,
      v_plan_change.provider_customer_id,
      v_plan_change.provider_payment_id
    );
    v_applied_plan_changes := v_applied_plan_changes + 1;
  end loop;

  select *
    into v_subscription
  from public.billing_subscriptions
  where id = v_cycle.subscription_id
  for update;

  select bpcs.id
    into v_pending_cancellation_id
  from public.billing_plan_change_sessions bpcs
  where bpcs.subscription_id = v_cycle.subscription_id
    and bpcs.project_id = v_cycle.project_id
    and bpcs.status = 'paid'
    and bpcs.effective_mode = 'next_cycle'
    and bpcs.change_type = 'cancellation'
  order by bpcs.created_at asc
  limit 1;

  if v_pending_cancellation_id is not null then
    update public.billing_cycles
    set
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'skip_next_cycle', true,
        'pending_plan_cancellation_id', v_pending_cancellation_id
      )
    where id = v_cycle.id;

    return jsonb_build_object(
      'success', true,
      'already_closed', false,
      'billing_cycle_id', v_cycle.id,
      'summary_id', v_summary.id,
      'invoice_id', v_invoice_id,
      'total_overage_cents', coalesce(v_summary.total_overage_cents, 0),
      'applied_plan_changes', v_applied_plan_changes,
      'skip_next_cycle', true,
      'pending_plan_cancellation_id', v_pending_cancellation_id,
      'next_billing_cycle_id', null
    );
  end if;

  v_interval := case v_cycle.frequency
    when 'weekly' then interval '1 week'
    when 'monthly' then interval '1 month'
    else greatest(v_cycle.period_end - v_cycle.period_start, interval '1 day')
  end;

  v_next_period_start := v_cycle.period_end;
  v_next_period_end := v_next_period_start + v_interval;

  update public.billing_subscriptions
  set
    current_period_start = v_next_period_start,
    current_period_end = v_next_period_end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'last_closed_billing_cycle_id', v_cycle.id,
      'last_closed_billing_cycle_at', now(),
      'next_collection_due_at', v_next_period_end + interval '2 days'
    )
  where id = v_cycle.subscription_id
    and status in ('active', 'past_due', 'paused');

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
    v_cycle.project_id,
    v_cycle.subscription_id,
    'subscription',
    v_cycle.frequency,
    v_next_period_start,
    v_next_period_end,
    'open',
    jsonb_build_object(
      'origin', 'close_billing_cycle_for_overage',
      'previous_cycle_id', v_cycle.id
    )
  )
  on conflict (project_id, cycle_type, period_start, period_end) do update
  set
    subscription_id = excluded.subscription_id,
    metadata = coalesce(public.billing_cycles.metadata, '{}'::jsonb)
      || jsonb_build_object('last_reopened_by', 'close_billing_cycle_for_overage')
  returning id into v_next_cycle_id;

  insert into public.billing_cycle_usage_summaries (
    project_id,
    subscription_id,
    billing_cycle_id,
    period_start,
    period_end,
    metadata
  )
  values (
    v_cycle.project_id,
    v_cycle.subscription_id,
    v_next_cycle_id,
    v_next_period_start,
    v_next_period_end,
    jsonb_build_object('origin', 'close_billing_cycle_for_overage_next_cycle')
  )
  on conflict (project_id, subscription_id, period_start, period_end) do nothing;

  return jsonb_build_object(
    'success', true,
    'already_closed', false,
    'billing_cycle_id', v_cycle.id,
    'summary_id', v_summary.id,
    'invoice_id', v_invoice_id,
    'total_overage_cents', coalesce(v_summary.total_overage_cents, 0),
    'applied_plan_changes', v_applied_plan_changes,
    'skip_next_cycle', false,
    'next_billing_cycle_id', v_next_cycle_id,
    'next_period_start', v_next_period_start,
    'next_period_end', v_next_period_end,
    'next_collection_due_at', v_next_period_end + interval '2 days'
  );
end;
$$;

alter function public.close_billing_cycle_for_overage(uuid)
  owner to postgres;

revoke all on function public.close_billing_cycle_for_overage(uuid) from public;
grant execute on function public.close_billing_cycle_for_overage(uuid) to service_role;

create or replace function public.apply_due_billing_plan_changes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_applied_count integer := 0;
begin
  for v_session in
    select
      due.id,
      due.requested_by,
      due.provider_subscription_id,
      due.provider_customer_id,
      due.provider_payment_id
    from public.billing_plan_change_sessions due
    join public.billing_subscriptions bs
      on bs.id = due.subscription_id
     and bs.project_id = due.project_id
    left join public.billing_cycles bc
      on bc.subscription_id = bs.id
     and bc.project_id = bs.project_id
     and bc.cycle_type = 'subscription'
     and bc.period_start = bs.current_period_start
     and bc.period_end = bs.current_period_end
    where due.status = 'paid'
      and due.effective_mode = 'next_cycle'
      and due.change_type <> 'cancellation'
      and bs.current_period_end is not null
      and bs.current_period_end <= now()
      and (bc.id is null or bc.status in ('closed', 'invoiced', 'paid', 'void'))
    order by bs.current_period_end asc, due.created_at asc
  loop
    perform public.apply_billing_plan_change(
      v_session.id,
      v_session.requested_by,
      v_session.provider_subscription_id,
      v_session.provider_customer_id,
      v_session.provider_payment_id
    );
    v_applied_count := v_applied_count + 1;
  end loop;

  return v_applied_count;
end;
$$;

revoke all on function public.apply_due_billing_plan_changes() from public;
grant execute on function public.apply_due_billing_plan_changes() to service_role;
