drop function if exists public.update_superadmin_project_usage_limits(uuid, uuid, integer, integer);

create or replace function public.update_superadmin_project_usage_limits(
  p_project_id uuid,
  p_subscription_id uuid,
  p_included_pass_installs integer,
  p_included_notification_sends integer,
  p_trial_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.billing_subscriptions%rowtype;
  v_summary public.billing_cycle_usage_summaries%rowtype;
  v_plan record;
  v_pass_install_overage_quantity integer;
  v_notification_sent_overage_quantity integer;
  v_overage_pass_install_cents integer;
  v_overage_notification_sent_cents integer;
  v_pass_install_overage_cents integer;
  v_notification_sent_overage_cents integer;
  v_previous_trial_ends_at timestamptz;
  v_previous_current_period_start timestamptz;
  v_previous_current_period_end timestamptz;
  v_is_free_trial boolean := false;
  v_extending_trial boolean := false;
  v_cycle_id uuid;
  v_actor_user_id uuid := auth.uid();
begin
  if not public.is_superadmin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_project_id is null or p_subscription_id is null then
    raise exception 'Assinatura ativa não encontrada para este projeto.' using errcode = 'P0002';
  end if;

  if p_included_pass_installs is null
    or p_included_notification_sends is null
    or p_included_pass_installs < 0
    or p_included_notification_sends < 0
  then
    raise exception 'Os limites devem ser inteiros maiores ou iguais a zero.' using errcode = '22023';
  end if;

  select *
    into v_subscription
  from public.billing_subscriptions
  where id = p_subscription_id
    and project_id = p_project_id
    and status = any (array['trialing', 'active', 'past_due', 'paused', 'suspended', 'expired'])
  for update;

  if not found then
    raise exception 'Assinatura ativa não encontrada para este projeto.' using errcode = 'P0002';
  end if;

  select code, name
    into v_plan
  from public.billing_plans
  where id = v_subscription.plan_id
  limit 1;

  v_is_free_trial := coalesce(v_plan.code, '') = 'free_trial';
  v_extending_trial := v_is_free_trial and p_trial_ends_at is not null;
  v_previous_trial_ends_at := v_subscription.trial_ends_at;
  v_previous_current_period_start := v_subscription.current_period_start;
  v_previous_current_period_end := v_subscription.current_period_end;

  if p_trial_ends_at is not null and not v_is_free_trial then
    raise exception 'Somente assinaturas free trial podem ter o período estendido.' using errcode = '22023';
  end if;

  if v_extending_trial and p_trial_ends_at <= now() then
    raise exception 'A nova data do free trial deve ser futura.' using errcode = '22023';
  end if;

  if v_extending_trial
    and v_subscription.current_period_start is not null
    and p_trial_ends_at <= v_subscription.current_period_start
  then
    raise exception 'A nova data do free trial deve ser posterior ao início do período.' using errcode = '22023';
  end if;

  update public.billing_subscriptions
  set
    included_pass_installs = p_included_pass_installs,
    included_notification_sends = p_included_notification_sends,
    trial_ends_at = case
      when v_extending_trial then p_trial_ends_at
      else trial_ends_at
    end,
    status = case
      when v_extending_trial then 'trialing'
      else status
    end,
    trial_started_at = case
      when v_extending_trial then coalesce(trial_started_at, current_period_start, now())
      else trial_started_at
    end,
    current_period_start = case
      when v_extending_trial then coalesce(current_period_start, trial_started_at, now())
      else current_period_start
    end,
    current_period_end = case
      when v_extending_trial then p_trial_ends_at
      else current_period_end
    end,
    ended_at = case when v_extending_trial then null else ended_at end,
    canceled_at = case when v_extending_trial then null else canceled_at end,
    cancel_at_period_end = case when v_extending_trial then false else cancel_at_period_end end,
    suspended_at = case when v_extending_trial then null else suspended_at end,
    delinquent_since = case when v_extending_trial then null else delinquent_since end,
    grace_ends_at = case when v_extending_trial then null else grace_ends_at end,
    last_payment_failure_at = case when v_extending_trial then null else last_payment_failure_at end,
    delinquency_gateway_charge_id = case when v_extending_trial then null else delinquency_gateway_charge_id end,
    delinquency_reason = case when v_extending_trial then null else delinquency_reason end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'superadmin_usage_limits_updated_at', now(),
      'superadmin_usage_limits_updated_by', v_actor_user_id,
      'superadmin_trial_extended_at', case when v_extending_trial then now() else null end
    )
  where id = v_subscription.id
  returning * into v_subscription;

  if v_extending_trial
    and v_subscription.current_period_start is not null
    and v_subscription.current_period_end is not null
  then
    select id
      into v_cycle_id
    from public.billing_cycles
    where project_id = p_project_id
      and subscription_id = p_subscription_id
      and cycle_type = 'subscription'
      and (
        (
          v_previous_current_period_start is not null
          and v_previous_current_period_end is not null
          and period_start = v_previous_current_period_start
          and period_end = v_previous_current_period_end
        )
        or (
          period_start <= now()
          and period_end > now()
        )
      )
    order by (status = 'open') desc, period_start desc
    limit 1
    for update;

    if v_cycle_id is not null then
      update public.billing_cycles
      set
        period_start = v_subscription.current_period_start,
        period_end = v_subscription.current_period_end,
        status = 'open',
        closed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'superadmin_trial_extended_at', now(),
          'previous_period_end', v_previous_current_period_end
        )
      where id = v_cycle_id;
    else
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
        v_subscription.current_period_start,
        v_subscription.current_period_end,
        'open',
        jsonb_build_object('origin', 'superadmin_trial_extension')
      )
      on conflict (project_id, cycle_type, period_start, period_end) do update
      set
        subscription_id = excluded.subscription_id,
        status = 'open',
        closed_at = null,
        metadata = coalesce(public.billing_cycles.metadata, '{}'::jsonb)
          || jsonb_build_object('superadmin_trial_extended_at', now())
      returning id into v_cycle_id;
    end if;
  end if;

  select *
    into v_summary
  from public.billing_cycle_usage_summaries
  where project_id = p_project_id
    and subscription_id = p_subscription_id
    and period_start <= now()
    and period_end > now()
  order by period_start desc
  limit 1
  for update;

  if v_summary.id is null
    and v_previous_current_period_start is not null
    and v_previous_current_period_end is not null
  then
    select *
      into v_summary
    from public.billing_cycle_usage_summaries
    where project_id = p_project_id
      and subscription_id = p_subscription_id
      and period_start = v_previous_current_period_start
      and period_end = v_previous_current_period_end
    order by period_start desc
    limit 1
    for update;
  end if;

  if v_summary.id is null
    and v_extending_trial
    and v_subscription.current_period_start is not null
    and v_subscription.current_period_end is not null
  then
    insert into public.billing_cycle_usage_summaries (
      project_id,
      subscription_id,
      billing_cycle_id,
      period_start,
      period_end,
      included_pass_installs,
      included_notification_sends,
      overage_pass_install_cents,
      overage_notification_sent_cents,
      allowance_source,
      overage_recalculated_at,
      metadata
    )
    values (
      v_subscription.project_id,
      v_subscription.id,
      v_cycle_id,
      v_subscription.current_period_start,
      v_subscription.current_period_end,
      p_included_pass_installs,
      p_included_notification_sends,
      greatest(coalesce(v_subscription.overage_pass_install_cents, 0), 0),
      greatest(coalesce(v_subscription.overage_notification_sent_cents, 0), 0),
      'superadmin_manual_override',
      now(),
      jsonb_build_object('origin', 'superadmin_trial_extension')
    )
    on conflict (project_id, subscription_id, period_start, period_end) do update
    set
      billing_cycle_id = coalesce(public.billing_cycle_usage_summaries.billing_cycle_id, excluded.billing_cycle_id),
      included_pass_installs = excluded.included_pass_installs,
      included_notification_sends = excluded.included_notification_sends,
      allowance_source = excluded.allowance_source,
      overage_recalculated_at = excluded.overage_recalculated_at,
      metadata = coalesce(public.billing_cycle_usage_summaries.metadata, '{}'::jsonb)
        || jsonb_build_object('superadmin_trial_extended_at', now())
    returning * into v_summary;
  end if;

  if v_summary.id is not null then
    v_overage_pass_install_cents := greatest(
      coalesce(v_summary.overage_pass_install_cents, v_subscription.overage_pass_install_cents, 0),
      0
    );
    v_overage_notification_sent_cents := greatest(
      coalesce(v_summary.overage_notification_sent_cents, v_subscription.overage_notification_sent_cents, 0),
      0
    );
    v_pass_install_overage_quantity := greatest(
      coalesce(v_summary.pass_install_quantity, 0) - p_included_pass_installs,
      0
    );
    v_notification_sent_overage_quantity := greatest(
      coalesce(v_summary.notification_sent_quantity, 0) - p_included_notification_sends,
      0
    );
    v_pass_install_overage_cents := v_pass_install_overage_quantity * v_overage_pass_install_cents;
    v_notification_sent_overage_cents := v_notification_sent_overage_quantity * v_overage_notification_sent_cents;

    update public.billing_cycle_usage_summaries
    set
      billing_cycle_id = coalesce(billing_cycle_id, v_cycle_id),
      period_end = case when v_extending_trial then v_subscription.current_period_end else period_end end,
      included_pass_installs = p_included_pass_installs,
      included_notification_sends = p_included_notification_sends,
      overage_pass_install_cents = v_overage_pass_install_cents,
      overage_notification_sent_cents = v_overage_notification_sent_cents,
      pass_install_overage_quantity = v_pass_install_overage_quantity,
      notification_sent_overage_quantity = v_notification_sent_overage_quantity,
      pass_install_overage_cents = v_pass_install_overage_cents,
      notification_sent_overage_cents = v_notification_sent_overage_cents,
      total_overage_cents = v_pass_install_overage_cents + v_notification_sent_overage_cents,
      allowance_source = 'superadmin_manual_override',
      overage_recalculated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'usage_limit_override_at', now(),
        'usage_limit_override_by', v_actor_user_id,
        'trial_ends_at', case when v_extending_trial then p_trial_ends_at else null end
      ),
      updated_at = now()
    where id = v_summary.id;
  end if;

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
    v_actor_user_id,
    'billing_subscriptions',
    v_subscription.id,
    'update',
    jsonb_build_object(
      'origin', 'superadmin_usage_limits',
      'included_pass_installs', p_included_pass_installs,
      'included_notification_sends', p_included_notification_sends,
      'previous_trial_ends_at', v_previous_trial_ends_at,
      'new_trial_ends_at', v_subscription.trial_ends_at,
      'current_cycle_summary_id', v_summary.id
    )
  );

  return jsonb_build_object(
    'id', v_subscription.id,
    'project_id', v_subscription.project_id,
    'status', v_subscription.status,
    'current_period_start', v_subscription.current_period_start,
    'current_period_end', v_subscription.current_period_end,
    'trial_ends_at', v_subscription.trial_ends_at,
    'included_pass_installs', v_subscription.included_pass_installs,
    'included_notification_sends', v_subscription.included_notification_sends,
    'billing_plans', case
      when v_plan.code is null and v_plan.name is null then null
      else jsonb_build_object(
        'code', v_plan.code,
        'name', coalesce(v_plan.name, v_plan.code, 'Plano')
      )
    end
  );
end;
$$;

alter function public.update_superadmin_project_usage_limits(uuid, uuid, integer, integer, timestamptz)
  owner to postgres;

revoke all on function public.update_superadmin_project_usage_limits(uuid, uuid, integer, integer, timestamptz) from public;
revoke all on function public.update_superadmin_project_usage_limits(uuid, uuid, integer, integer, timestamptz) from anon;
revoke all on function public.update_superadmin_project_usage_limits(uuid, uuid, integer, integer, timestamptz) from authenticated;
grant execute on function public.update_superadmin_project_usage_limits(uuid, uuid, integer, integer, timestamptz) to authenticated;
grant execute on function public.update_superadmin_project_usage_limits(uuid, uuid, integer, integer, timestamptz) to service_role;

comment on function public.update_superadmin_project_usage_limits(uuid, uuid, integer, integer, timestamptz) is
  'Allows superadmins to update manual usage limits, extend free trials, and refresh the current cycle summary.';
