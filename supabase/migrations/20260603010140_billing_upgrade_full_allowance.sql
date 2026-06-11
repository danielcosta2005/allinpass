-- Upgrade comercial: a partir desta migration, upgrades/conversoes imediatas
-- ganham a franquia cheia do novo plano no ciclo corrente. O preco de
-- excedente efetivo do ciclo tambem passa a ficar materializado no historico.

alter table public.billing_subscription_changes
  add column if not exists effective_overage_pass_install_cents integer,
  add column if not exists effective_overage_notification_sent_cents integer;
alter table public.billing_subscription_changes
  drop constraint if exists billing_subscription_changes_allowance_proration_mode_check;
alter table public.billing_subscription_changes
  add constraint billing_subscription_changes_allowance_proration_mode_check
  check (allowance_proration_mode in ('prorated_daily', 'none', 'full_new_plan'));
alter table public.billing_subscription_changes
  alter column allowance_proration_mode set default 'full_new_plan';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'billing_subscription_changes_effective_overage_pass_install_cents_check'
  ) then
    alter table public.billing_subscription_changes
      add constraint billing_subscription_changes_effective_overage_pass_install_cents_check
      check (effective_overage_pass_install_cents is null or effective_overage_pass_install_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'billing_subscription_changes_effective_overage_notification_sent_cents_check'
  ) then
    alter table public.billing_subscription_changes
      add constraint billing_subscription_changes_effective_overage_notification_sent_cents_check
      check (effective_overage_notification_sent_cents is null or effective_overage_notification_sent_cents >= 0);
  end if;
end
$$;
create or replace function public.trg_enrich_subscription_change_proration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_plan public.billing_plans%rowtype;
  v_new_plan public.billing_plans%rowtype;
  v_cycle_start timestamptz;
  v_cycle_end timestamptz;
  v_split timestamptz;
  v_cycle_seconds numeric;
  v_old_seconds numeric;
  v_new_seconds numeric;
begin
  if new.effective_mode is null then
    new.effective_mode := case
      when new.change_type = 'downgrade' then 'next_cycle'
      else 'immediate'
    end;
  end if;

  if new.allowance_proration_mode is null then
    new.allowance_proration_mode := case
      when new.effective_mode = 'immediate'
        and new.change_type in ('upgrade', 'trial_conversion', 'plan_change')
      then 'full_new_plan'
      else 'prorated_daily'
    end;
  end if;

  if new.allowance_proration_mode = 'full_new_plan'
     and new.change_type not in ('upgrade', 'downgrade', 'trial_conversion', 'plan_change') then
    new.allowance_proration_mode := 'prorated_daily';
  end if;

  if new.previous_plan_id is not null then
    select * into v_prev_plan
    from public.billing_plans
    where id = new.previous_plan_id;
  end if;

  select * into v_new_plan
  from public.billing_plans
  where id = new.new_plan_id;

  if new.previous_included_pass_installs is null then
    new.previous_included_pass_installs := coalesce(v_prev_plan.included_pass_installs, 0);
  end if;
  if new.new_included_pass_installs is null then
    new.new_included_pass_installs := coalesce(v_new_plan.included_pass_installs, 0);
  end if;

  if new.previous_included_notification_sends is null then
    new.previous_included_notification_sends := coalesce(v_prev_plan.included_notification_sends, 0);
  end if;
  if new.new_included_notification_sends is null then
    new.new_included_notification_sends := coalesce(v_new_plan.included_notification_sends, 0);
  end if;

  if new.previous_overage_pass_install_cents is null then
    new.previous_overage_pass_install_cents := coalesce(v_prev_plan.overage_pass_install_cents, 0);
  end if;
  if new.new_overage_pass_install_cents is null then
    new.new_overage_pass_install_cents := coalesce(v_new_plan.overage_pass_install_cents, 0);
  end if;

  if new.previous_overage_notification_sent_cents is null then
    new.previous_overage_notification_sent_cents := coalesce(v_prev_plan.overage_notification_sent_cents, 0);
  end if;
  if new.new_overage_notification_sent_cents is null then
    new.new_overage_notification_sent_cents := coalesce(v_new_plan.overage_notification_sent_cents, 0);
  end if;

  if new.cycle_started_at is null or new.cycle_ends_at is null then
    select current_period_start, current_period_end
      into v_cycle_start, v_cycle_end
    from public.billing_subscriptions
    where id = new.subscription_id;

    if new.cycle_started_at is null then
      new.cycle_started_at := v_cycle_start;
    end if;
    if new.cycle_ends_at is null then
      new.cycle_ends_at := v_cycle_end;
    end if;
  end if;

  if new.effective_mode = 'next_cycle' then
    new.prorated_install_allowance := coalesce(new.previous_included_pass_installs, 0);
    new.prorated_notification_allowance := coalesce(new.previous_included_notification_sends, 0);
    new.effective_overage_pass_install_cents := coalesce(new.previous_overage_pass_install_cents, 0);
    new.effective_overage_notification_sent_cents := coalesce(new.previous_overage_notification_sent_cents, 0);
    return new;
  end if;

  if new.allowance_proration_mode = 'full_new_plan'
     and new.change_type in ('upgrade', 'downgrade', 'trial_conversion', 'plan_change') then
    new.prorated_install_allowance := coalesce(new.new_included_pass_installs, 0);
    new.prorated_notification_allowance := coalesce(new.new_included_notification_sends, 0);
    new.effective_overage_pass_install_cents := coalesce(new.new_overage_pass_install_cents, 0);
    new.effective_overage_notification_sent_cents := coalesce(new.new_overage_notification_sent_cents, 0);
    return new;
  end if;

  if new.allowance_proration_mode = 'prorated_daily'
     and new.cycle_started_at is not null
     and new.cycle_ends_at is not null
     and new.cycle_ends_at > new.cycle_started_at then

    v_cycle_seconds := extract(epoch from (new.cycle_ends_at - new.cycle_started_at));
    v_split := greatest(new.cycle_started_at, least(coalesce(new.effective_at, new.cycle_started_at), new.cycle_ends_at));
    v_old_seconds := greatest(0, extract(epoch from (v_split - new.cycle_started_at)));
    v_new_seconds := greatest(0, extract(epoch from (new.cycle_ends_at - v_split)));

    new.prorated_install_allowance := (
      (coalesce(new.previous_included_pass_installs, 0)::numeric * v_old_seconds)
      + (coalesce(new.new_included_pass_installs, 0)::numeric * v_new_seconds)
    ) / nullif(v_cycle_seconds, 0);

    new.prorated_notification_allowance := (
      (coalesce(new.previous_included_notification_sends, 0)::numeric * v_old_seconds)
      + (coalesce(new.new_included_notification_sends, 0)::numeric * v_new_seconds)
    ) / nullif(v_cycle_seconds, 0);
  end if;

  if new.prorated_install_allowance is null then
    new.prorated_install_allowance := coalesce(new.new_included_pass_installs, 0);
  end if;
  if new.prorated_notification_allowance is null then
    new.prorated_notification_allowance := coalesce(new.new_included_notification_sends, 0);
  end if;
  if new.effective_overage_pass_install_cents is null then
    new.effective_overage_pass_install_cents := coalesce(new.new_overage_pass_install_cents, 0);
  end if;
  if new.effective_overage_notification_sent_cents is null then
    new.effective_overage_notification_sent_cents := coalesce(new.new_overage_notification_sent_cents, 0);
  end if;

  return new;
end;
$$;
create or replace function public.get_billing_cycle_entitlements(
  p_subscription_id uuid,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
)
returns table (
  subscription_id uuid,
  project_id uuid,
  plan_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  install_allowance integer,
  notification_allowance integer,
  overage_pass_install_cents integer,
  overage_notification_sent_cents integer,
  plan_change_id uuid,
  allowance_source text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_subscription public.billing_subscriptions%rowtype;
  v_change public.billing_subscription_changes%rowtype;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  select *
    into v_subscription
  from public.billing_subscriptions
  where id = p_subscription_id;

  if not found then
    raise exception 'Billing subscription % not found', p_subscription_id using errcode = 'P0002';
  end if;

  v_period_start := coalesce(p_period_start, v_subscription.current_period_start, date_trunc('month', now()));
  v_period_end := coalesce(p_period_end, v_subscription.current_period_end, v_period_start + interval '1 month');

  select *
    into v_change
  from public.billing_subscription_changes bsc
  where bsc.subscription_id = p_subscription_id
    and bsc.effective_at >= v_period_start
    and bsc.effective_at < v_period_end
  order by bsc.effective_at desc, bsc.created_at desc
  limit 1;

  if v_change.id is not null then
    return query
    select
      v_subscription.id,
      v_subscription.project_id,
      v_change.new_plan_id,
      v_period_start,
      v_period_end,
      greatest(
        0,
        ceil(coalesce(
          v_change.prorated_install_allowance,
          v_change.new_included_pass_installs::numeric,
          v_subscription.included_pass_installs::numeric,
          0
        ))
      )::integer,
      greatest(
        0,
        ceil(coalesce(
          v_change.prorated_notification_allowance,
          v_change.new_included_notification_sends::numeric,
          v_subscription.included_notification_sends::numeric,
          0
        ))
      )::integer,
      coalesce(
        v_change.effective_overage_pass_install_cents,
        v_change.new_overage_pass_install_cents,
        v_subscription.overage_pass_install_cents,
        0
      ),
      coalesce(
        v_change.effective_overage_notification_sent_cents,
        v_change.new_overage_notification_sent_cents,
        v_subscription.overage_notification_sent_cents,
        0
      ),
      v_change.id,
      case
        when v_change.allowance_proration_mode = 'full_new_plan' then 'full_new_plan'
        when v_change.effective_mode = 'next_cycle' then 'previous_plan_until_next_cycle'
        else 'prorated_daily'
      end;
    return;
  end if;

  return query
  select
    v_subscription.id,
    v_subscription.project_id,
    v_subscription.plan_id,
    v_period_start,
    v_period_end,
    coalesce(v_subscription.included_pass_installs, 0),
    coalesce(v_subscription.included_notification_sends, 0),
    coalesce(v_subscription.overage_pass_install_cents, 0),
    coalesce(v_subscription.overage_notification_sent_cents, 0),
    null::uuid,
    'subscription_snapshot'::text;
end;
$$;
create or replace function public.calculate_billing_cycle_overage(
  p_subscription_id uuid,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
)
returns table (
  subscription_id uuid,
  project_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  install_allowance integer,
  notification_allowance integer,
  pass_install_usage integer,
  notification_sent_usage integer,
  pass_install_overage_quantity integer,
  notification_sent_overage_quantity integer,
  overage_pass_install_cents integer,
  overage_notification_sent_cents integer,
  pass_install_overage_cents integer,
  notification_sent_overage_cents integer,
  total_overage_cents integer,
  allowance_source text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_ent record;
  v_pass_install_usage integer;
  v_notification_sent_usage integer;
  v_pass_install_overage_quantity integer;
  v_notification_sent_overage_quantity integer;
  v_pass_install_overage_cents integer;
  v_notification_sent_overage_cents integer;
begin
  select *
    into v_ent
  from public.get_billing_cycle_entitlements(p_subscription_id, p_period_start, p_period_end)
  limit 1;

  if not found then
    raise exception 'Billing subscription % not found', p_subscription_id using errcode = 'P0002';
  end if;

  select
    coalesce(sum(quantity) filter (where resource_type = 'pass_install'), 0)::integer,
    coalesce(sum(quantity) filter (where resource_type = 'notification_sent'), 0)::integer
    into v_pass_install_usage, v_notification_sent_usage
  from public.billing_usage_events bue
  where bue.project_id = v_ent.project_id
    and bue.occurred_at >= v_ent.period_start
    and bue.occurred_at < v_ent.period_end
    and bue.is_billable = true
    and bue.event_type = 'issue';

  v_pass_install_overage_quantity := greatest(v_pass_install_usage - v_ent.install_allowance, 0);
  v_notification_sent_overage_quantity := greatest(v_notification_sent_usage - v_ent.notification_allowance, 0);
  v_pass_install_overage_cents := v_pass_install_overage_quantity * v_ent.overage_pass_install_cents;
  v_notification_sent_overage_cents := v_notification_sent_overage_quantity * v_ent.overage_notification_sent_cents;

  return query
  select
    v_ent.subscription_id,
    v_ent.project_id,
    v_ent.period_start,
    v_ent.period_end,
    v_ent.install_allowance,
    v_ent.notification_allowance,
    v_pass_install_usage,
    v_notification_sent_usage,
    v_pass_install_overage_quantity,
    v_notification_sent_overage_quantity,
    v_ent.overage_pass_install_cents,
    v_ent.overage_notification_sent_cents,
    v_pass_install_overage_cents,
    v_notification_sent_overage_cents,
    v_pass_install_overage_cents + v_notification_sent_overage_cents,
    v_ent.allowance_source;
end;
$$;
revoke all on function public.get_billing_cycle_entitlements(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_billing_cycle_entitlements(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.calculate_billing_cycle_overage(uuid, timestamptz, timestamptz) from public;
grant execute on function public.calculate_billing_cycle_overage(uuid, timestamptz, timestamptz) to authenticated, service_role;
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

  if v_session.effective_mode = 'next_cycle'
     and v_subscription.current_period_end is not null
     and v_subscription.current_period_end > now() then
    return jsonb_build_object(
      'success', true,
      'scheduled', true,
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
      'requested_effective_mode', v_requested_effective_mode
    )
  )
  returning id into v_change_id;

  update public.billing_subscriptions
  set
    plan_id = v_new_plan.id,
    status = 'active',
    trial_started_at = null,
    trial_ends_at = null,
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
      'last_requested_effective_mode', v_requested_effective_mode
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
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('billing_subscription_change_id', v_change_id)
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
      'origin', 'plan_change',
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
    'already_applied', false,
    'plan_change_session_id', v_session.id,
    'billing_subscription_change_id', v_change_id,
    'subscription_id', v_subscription.id,
    'new_plan_id', v_new_plan.id,
    'effective_mode', v_applied_effective_mode,
    'requested_effective_mode', v_requested_effective_mode,
    'plan_code', v_new_plan.code,
    'plan_name', v_new_plan.name
  );
end;
$$;
revoke all on function public.apply_billing_plan_change(uuid, uuid, text, text, text) from public;
grant execute on function public.apply_billing_plan_change(uuid, uuid, text, text, text) to service_role;
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
    from (
      select *
      from public.billing_plan_change_sessions
      where status = 'paid'
        and effective_mode = 'next_cycle'
    ) due
    join public.billing_subscriptions bs
      on bs.id = due.subscription_id
     and bs.project_id = due.project_id
    where bs.current_period_end is not null
      and bs.current_period_end <= now()
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
do $$
declare
  v_existing_job_id bigint;
begin
  select jobid
    into v_existing_job_id
    from cron.job
   where jobname = 'billing-apply-due-plan-changes'
   limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'billing-apply-due-plan-changes',
    '*/15 * * * *',
    'select public.apply_due_billing_plan_changes();'
  );
end
$$;
