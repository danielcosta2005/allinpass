-- Expira assinaturas em trial quando o prazo acabar.
-- Regras:
-- 1) So expira registros com status = 'trialing' e trial_ends_at <= now()
-- 2) trial_days = 0 nao entra nesse fluxo (normalmente nao fica como trialing)
-- 3) Registra historico em billing_subscription_changes

create index if not exists billing_subscriptions_trial_expiration_idx
  on public.billing_subscriptions (trial_ends_at)
  where status = 'trialing' and trial_ends_at is not null;

create or replace function public.expire_trial_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_expired_count integer := 0;
begin
  with expired_rows as (
    update public.billing_subscriptions bs
       set status = 'expired',
           ended_at = coalesce(bs.ended_at, v_now)
     where bs.status = 'trialing'
       and bs.trial_ends_at is not null
       and bs.trial_ends_at <= v_now
    returning
      bs.id,
      bs.project_id,
      bs.plan_id,
      bs.trial_started_at,
      bs.trial_ends_at
  )
  insert into public.billing_subscription_changes (
    project_id,
    subscription_id,
    previous_plan_id,
    new_plan_id,
    change_type,
    change_reason,
    effective_at,
    metadata
  )
  select
    e.project_id,
    e.id,
    e.plan_id,
    e.plan_id,
    'cancellation',
    'system',
    v_now,
    jsonb_build_object(
      'origin', 'trial_expiration_scheduler',
      'reason', 'trial_ended',
      'trial_started_at', e.trial_started_at,
      'trial_ends_at', e.trial_ends_at
    )
  from expired_rows e;

  get diagnostics v_expired_count = row_count;

  return v_expired_count;
end;
$$;

do $$
declare
  v_existing_job_id bigint;
begin
  select jobid
    into v_existing_job_id
    from cron.job
   where jobname = 'billing-expire-trials'
   limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'billing-expire-trials',
    '*/15 * * * *',
    'select public.expire_trial_subscriptions();'
  );
end
$$;
