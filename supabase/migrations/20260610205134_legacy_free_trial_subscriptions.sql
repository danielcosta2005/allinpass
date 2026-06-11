-- Backfill free_trial billing for legacy projects that already have members
-- but have never had any billing_subscriptions row.
do $$
begin
  if not exists (
    select 1
    from public.billing_plans
    where code = 'free_trial'
      and is_active = true
  ) then
    raise exception 'Active free_trial billing plan not found for legacy_free_trial_backfill.';
  end if;
end $$;
with runtime as (
  select now() as started_at
),
free_plan as (
  select
    bp.id,
    bp.code,
    bp.trial_days,
    bp.base_price_cents,
    bp.included_pass_installs,
    bp.included_notification_sends,
    bp.overage_pass_install_cents,
    bp.overage_notification_sent_cents
  from public.billing_plans bp
  where bp.code = 'free_trial'
    and bp.is_active = true
  order by bp.created_at desc
  limit 1
),
eligible_projects as (
  select
    p.id as project_id,
    coalesce(nullif(trim(p.name), ''), 'Projeto') as project_name,
    coalesce(
      (
        select pr.email
        from public.project_members pm
        join public.profiles pr on pr.id = pm.user_id
        where pm.project_id = p.id
          and nullif(trim(pr.email), '') is not null
        order by case when pm.role = 'owner' then 0 else 1 end
        limit 1
      ),
      'billing+' || replace(p.id::text, '-', '') || '@allinpass.local'
    ) as billing_email
  from public.projects p
  where exists (select 1 from public.project_members pm where pm.project_id = p.id)
    and not exists (select 1 from public.billing_subscriptions bs where bs.project_id = p.id)
),
billing_account_rows as (
  insert into public.billing_accounts as existing_billing_account (
    project_id,
    legal_name,
    billing_email,
    document_type,
    document_number,
    address,
    gateway_provider,
    provider_status,
    metadata
  )
  select
    ep.project_id,
    ep.project_name,
    ep.billing_email,
    'other',
    'pending',
    '{}'::jsonb,
    'other',
    'active',
    jsonb_build_object(
      'origin', 'legacy_free_trial_backfill',
      'plan_code', fp.code
    )
  from eligible_projects ep
  cross join free_plan fp
  on conflict (project_id) do update
  set
    metadata = coalesce(existing_billing_account.metadata, '{}'::jsonb)
      || jsonb_build_object('legacy_free_trial_backfill_checked_at', now()),
    updated_at = now()
  returning id, project_id
),
subscription_rows as (
  insert into public.billing_subscriptions (
    project_id,
    billing_account_id,
    plan_id,
    status,
    trial_started_at,
    trial_ends_at,
    current_period_start,
    current_period_end,
    gateway_provider,
    base_price_cents,
    included_pass_installs,
    included_notification_sends,
    overage_pass_install_cents,
    overage_notification_sent_cents,
    currency,
    metadata
  )
  select
    ba.project_id,
    ba.id,
    fp.id,
    case when coalesce(fp.trial_days, 0) > 0 then 'trialing' else 'active' end as status,
    case when coalesce(fp.trial_days, 0) > 0 then rt.started_at else null end as trial_started_at,
    case
      when coalesce(fp.trial_days, 0) > 0
        then rt.started_at + make_interval(days => coalesce(fp.trial_days, 0))
      else null
    end as trial_ends_at,
    rt.started_at as current_period_start,
    case
      when coalesce(fp.trial_days, 0) > 0
        then rt.started_at + make_interval(days => coalesce(fp.trial_days, 0))
      else rt.started_at + interval '1 month'
    end as current_period_end,
    'other' as gateway_provider,
    coalesce(fp.base_price_cents, 0),
    coalesce(fp.included_pass_installs, 0),
    coalesce(fp.included_notification_sends, 0),
    coalesce(fp.overage_pass_install_cents, 0),
    coalesce(fp.overage_notification_sent_cents, 0),
    'BRL',
    jsonb_build_object(
      'origin', 'legacy_free_trial_backfill',
      'plan_code', fp.code
    )
  from billing_account_rows ba
  cross join free_plan fp
  cross join runtime rt
  where not exists (select 1 from public.billing_subscriptions bs where bs.project_id = ba.project_id)
  returning
    id,
    project_id,
    current_period_start,
    current_period_end,
    included_notification_sends
),
cycle_rows as (
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
  select
    sr.project_id,
    sr.id,
    'subscription',
    'monthly',
    sr.current_period_start,
    sr.current_period_end,
    'open',
    jsonb_build_object(
      'origin', 'legacy_free_trial_backfill',
      'plan_code', 'free_trial'
    )
  from subscription_rows sr
  on conflict (project_id, cycle_type, period_start, period_end) do nothing
  returning 1
),
wallet_rows as (
  insert into public.billing_credit_wallets (
    project_id,
    balance_credits,
    low_balance_threshold,
    auto_recharge_enabled
  )
  select
    sr.project_id,
    0,
    0,
    false
  from subscription_rows sr
  on conflict (project_id) do nothing
  returning 1
),
notification_rows as (
  insert into public.projects_notifications (
    project_id,
    notifications_limit,
    total_notifications_sent,
    recent_notifications_sent,
    notifications_exp
  )
  select
    sr.project_id,
    sr.included_notification_sends,
    0,
    0,
    sr.current_period_end
  from subscription_rows sr
  on conflict (project_id) do update
  set
    notifications_limit = excluded.notifications_limit,
    recent_notifications_sent = 0,
    notifications_exp = excluded.notifications_exp
  returning 1
)
select count(*) as legacy_free_trial_subscriptions_created
from subscription_rows;
