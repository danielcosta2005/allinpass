-- Enforce free-trial usage quotas without changing subscription status.
-- Quota exhaustion is derived from billing_cycle_usage_summaries.

create or replace function public.assert_free_trial_usage_quota_available(
  p_project_id uuid,
  p_resource_type text,
  p_quantity integer default 1,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription record;
  v_quantity integer := greatest(coalesce(p_quantity, 1), 1);
  v_limit integer := 0;
  v_used integer := 0;
begin
  if p_project_id is null then
    return;
  end if;

  if p_resource_type not in ('pass_install', 'notification_sent') then
    raise exception using
      errcode = '22023',
      message = 'invalid_usage_resource_type',
      detail = coalesce(p_resource_type, '<null>');
  end if;

  select
    bs.id,
    bp.code as plan_code,
    coalesce(bs.included_pass_installs, 0) as included_pass_installs,
    coalesce(bs.included_notification_sends, 0) as included_notification_sends
    into v_subscription
  from public.billing_subscriptions bs
  join public.billing_plans bp on bp.id = bs.plan_id
  where bs.project_id = p_project_id
    and bs.status in ('trialing', 'active', 'past_due', 'paused')
  order by
    (bs.status = 'trialing') desc,
    bs.current_period_start desc nulls last,
    bs.created_at desc
  limit 1
  for update of bs;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PROJECT_BILLING_INACTIVE',
      detail = 'Trial encerrado. Assine um plano para continuar.',
      hint = p_resource_type;
  end if;

  if v_subscription.plan_code is distinct from 'free_trial' then
    return;
  end if;

  if p_resource_type = 'pass_install' then
    v_limit := v_subscription.included_pass_installs;

    select coalesce(summary.pass_install_quantity, 0)
      into v_used
    from public.billing_cycle_usage_summaries summary
    where summary.project_id = p_project_id
      and summary.subscription_id = v_subscription.id
      and coalesce(p_now, now()) >= summary.period_start
      and coalesce(p_now, now()) < summary.period_end
    order by summary.period_start desc
    limit 1;
  elsif p_resource_type = 'notification_sent' then
    v_limit := v_subscription.included_notification_sends;

    select coalesce(summary.notification_sent_quantity, 0)
      into v_used
    from public.billing_cycle_usage_summaries summary
    where summary.project_id = p_project_id
      and summary.subscription_id = v_subscription.id
      and coalesce(p_now, now()) >= summary.period_start
      and coalesce(p_now, now()) < summary.period_end
    order by summary.period_start desc
    limit 1;
  end if;

  v_used := coalesce(v_used, 0);
  v_limit := greatest(coalesce(v_limit, 0), 0);

  if v_used + v_quantity > v_limit then
    raise exception using
      errcode = 'P0001',
      message = 'PROJECT_USAGE_LIMIT_EXCEEDED',
      detail = 'Franquia do free trial esgotada. Assine um plano para continuar.',
      hint = p_resource_type;
  end if;
end;
$$;

alter function public.assert_free_trial_usage_quota_available(uuid, text, integer, timestamptz)
  owner to postgres;

revoke all on function public.assert_free_trial_usage_quota_available(uuid, text, integer, timestamptz) from public;
grant execute on function public.assert_free_trial_usage_quota_available(uuid, text, integer, timestamptz) to service_role;

create or replace function public.trg_assert_user_pass_free_trial_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_new_status text;
  v_old_status text;
begin
  v_new_status := lower(trim(coalesce(new.install_status, '')));
  v_old_status := case
    when tg_op = 'UPDATE' then lower(trim(coalesce(old.install_status, '')))
    else null
  end;

  if v_new_status <> 'installed' then
    return new;
  end if;

  -- Count and enforce only when the pass first reaches installed.
  -- new.install_status = 'installed'
  -- old.install_status is distinct from 'installed'
  if tg_op = 'UPDATE' and v_old_status = 'installed' then
    return new;
  end if;

  v_project_id := new.project_id;
  if v_project_id is null and new.pass_id is not null then
    select p.project_id
      into v_project_id
    from public.passes p
    where p.id = new.pass_id
    limit 1;
  end if;

  perform public.assert_free_trial_usage_quota_available(
    v_project_id,
    'pass_install',
    1,
    coalesce(new.installed_at, new.created_at, now())
  );

  return new;
end;
$$;

alter function public.trg_assert_user_pass_free_trial_quota()
  owner to postgres;

drop trigger if exists user_passes_free_trial_quota_before_install on public.user_passes;
create trigger user_passes_free_trial_quota_before_install
before insert or update of install_status
on public.user_passes
for each row execute function public.trg_assert_user_pass_free_trial_quota();
