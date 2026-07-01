-- Superadmin financial read models.
-- Frontend reads only the RPCs below; the views centralize billing joins and
-- keep the React layer from issuing N+1 queries across financial tables.

create or replace view public.v_superadmin_financial_projects
with (security_invoker = true)
as
with project_financials as (
  select
    p.id as project_id,
    p.name as project_name,
    p.created_at as project_created_at,
    ba.id as billing_account_id,
    ba.billing_email,
    ba.gateway_provider as billing_gateway_provider,
    ba.gateway_customer_id,
    ba.provider_status,
    bs.id as subscription_id,
    bs.status as subscription_status,
    bs.plan_id,
    bp.code as plan_code,
    bp.name as plan_name,
    bs.base_price_cents,
    bs.currency,
    bs.current_period_start,
    bs.current_period_end,
    bs.trial_ends_at,
    bs.cancel_at_period_end,
    bs.gateway_provider as subscription_gateway_provider,
    bs.gateway_subscription_id,
    bs.delinquent_since,
    bs.grace_ends_at,
    bs.suspended_at,
    bs.last_payment_failure_at,
    bs.delinquency_gateway_charge_id,
    bs.delinquency_reason,
    s.id as usage_summary_id,
    s.billing_cycle_id,
    s.period_start as usage_period_start,
    s.period_end as usage_period_end,
    coalesce(s.pass_install_quantity, 0) as pass_install_quantity,
    coalesce(s.included_pass_installs, 0) as included_pass_installs,
    coalesce(s.pass_install_overage_quantity, 0) as pass_install_overage_quantity,
    coalesce(s.pass_install_overage_cents, 0) as pass_install_overage_cents,
    coalesce(s.notification_sent_quantity, 0) as notification_sent_quantity,
    coalesce(s.included_notification_sends, 0) as included_notification_sends,
    coalesce(s.notification_sent_overage_quantity, 0) as notification_sent_overage_quantity,
    coalesce(s.notification_sent_overage_cents, 0) as notification_sent_overage_cents,
    coalesce(s.total_overage_cents, 0) as total_overage_cents,
    s.last_usage_event_at,
    case
      when coalesce(s.included_pass_installs, 0) > 0
        then round((coalesce(s.pass_install_quantity, 0)::numeric * 100) / s.included_pass_installs::numeric, 2)
      else null
    end as pass_usage_percent,
    case
      when coalesce(s.included_notification_sends, 0) > 0
        then round((coalesce(s.notification_sent_quantity, 0)::numeric * 100) / s.included_notification_sends::numeric, 2)
      else null
    end as notification_usage_percent,
    pcs.id as pending_plan_change_id,
    pcs.change_type as pending_change_type,
    pcs.effective_mode as pending_effective_mode,
    pcs.status as pending_change_status,
    pcs.amount_cents as pending_amount_cents,
    pcs.created_at as pending_change_created_at,
    pcs.paid_at as pending_change_paid_at,
    pending_plan.code as pending_plan_code,
    pending_plan.name as pending_plan_name,
    pending_plan.base_price_cents as pending_plan_base_price_cents
  from public.projects p
  left join lateral (
    select *
    from public.billing_subscriptions candidate
    where candidate.project_id = p.id
      and candidate.status in ('trialing', 'active', 'past_due', 'paused', 'suspended', 'expired')
    order by
      case candidate.status
        when 'active' then 1
        when 'past_due' then 2
        when 'suspended' then 3
        when 'paused' then 4
        when 'trialing' then 5
        when 'expired' then 6
        else 7
      end,
      candidate.created_at desc
    limit 1
  ) bs on true
  left join public.billing_plans bp on bp.id = bs.plan_id
  left join public.billing_accounts ba on ba.id = bs.billing_account_id
  left join lateral (
    select summary.*
    from public.billing_cycle_usage_summaries summary
    where summary.project_id = p.id
      and summary.subscription_id = bs.id
    order by
      (now() >= summary.period_start and now() < summary.period_end) desc,
      (
        summary.period_start = bs.current_period_start
        and summary.period_end = bs.current_period_end
      ) desc,
      summary.period_start desc,
      summary.created_at desc
    limit 1
  ) s on true
  left join lateral (
    select session.*
    from public.billing_plan_change_sessions session
    where session.project_id = p.id
      and (bs.id is null or session.subscription_id = bs.id)
      and session.status in ('pending', 'created', 'paid')
    order by
      (session.status = 'paid') desc,
      session.created_at desc
    limit 1
  ) pcs on true
  left join public.billing_plans pending_plan on pending_plan.id = pcs.new_plan_id
)
select
  pf.*,
  case
    when pf.subscription_id is null then 'sem_assinatura'
    when pf.subscription_status = 'suspended' then 'suspensa'
    when pf.subscription_status = 'past_due' then 'pagamento_atrasado'
    when pf.subscription_status = 'expired' then 'trial_expirado'
    when pf.subscription_status = 'trialing'
      and pf.trial_ends_at is not null
      and pf.trial_ends_at <= now() + interval '2 days'
      then 'trial_expirando'
    when greatest(
      coalesce(pf.pass_usage_percent, 0),
      coalesce(pf.notification_usage_percent, 0)
    ) >= 100 then 'limite_atingido'
    when pf.total_overage_cents > 0 then 'overage'
    when pf.pending_plan_change_id is not null then 'mudanca_pendente'
    when pf.subscription_id is not null and pf.usage_summary_id is null then 'sem_ciclo'
    else 'ok'
  end as risk_status,
  case
    when pf.subscription_id is null
      or pf.subscription_status in ('past_due', 'suspended', 'expired')
      then 'high'
    when pf.subscription_status = 'trialing'
      and pf.trial_ends_at is not null
      and pf.trial_ends_at <= now() + interval '2 days'
      then 'medium'
    when greatest(
      coalesce(pf.pass_usage_percent, 0),
      coalesce(pf.notification_usage_percent, 0)
    ) >= 100
      or pf.total_overage_cents > 0
      or pf.pending_plan_change_id is not null
      or (pf.subscription_id is not null and pf.usage_summary_id is null)
      then 'medium'
    else 'low'
  end as risk_level,
  to_jsonb(array_remove(array[
    case when pf.subscription_id is null then 'Projeto sem assinatura financeira' end,
    case when pf.subscription_status = 'suspended' then 'Assinatura suspensa por inadimplencia' end,
    case when pf.subscription_status = 'past_due' then 'Pagamento pendente dentro do prazo de regularizacao' end,
    case when pf.subscription_status = 'expired' then 'Trial expirado' end,
    case
      when pf.subscription_status = 'trialing'
        and pf.trial_ends_at is not null
        and pf.trial_ends_at <= now() + interval '2 days'
        then 'Trial perto do vencimento'
    end,
    case
      when greatest(
        coalesce(pf.pass_usage_percent, 0),
        coalesce(pf.notification_usage_percent, 0)
      ) >= 100
        then 'Franquia atingida'
    end,
    case when pf.total_overage_cents > 0 then 'Excedente no ciclo' end,
    case when pf.pending_plan_change_id is not null then 'Mudanca de plano pendente' end,
    case when pf.subscription_id is not null and pf.usage_summary_id is null then 'Sem ciclo de uso consolidado' end
  ], null)) as risk_reasons,
  case
    when pf.subscription_status = 'active'
      and coalesce(pf.base_price_cents, 0) > 0
      and coalesce(pf.plan_code, '') <> 'free_trial'
      then coalesce(pf.base_price_cents, 0)
    else 0
  end as mrr_active_cents,
  case
    when pf.subscription_status in ('past_due', 'suspended', 'paused')
      then coalesce(pf.base_price_cents, 0) + coalesce(pf.total_overage_cents, 0)
    else 0
  end as revenue_at_risk_cents,
  coalesce(pf.base_price_cents, 0) + coalesce(pf.total_overage_cents, 0) as potential_cycle_revenue_cents,
  case
    when pf.pending_plan_change_id is not null and pf.pending_plan_base_price_cents is not null
      then pf.pending_plan_base_price_cents - coalesce(pf.base_price_cents, 0)
    else null
  end as pending_mrr_delta_cents
from project_financials pf;

alter view public.v_superadmin_financial_projects owner to postgres;
revoke all on table public.v_superadmin_financial_projects from public;
revoke all on table public.v_superadmin_financial_projects from anon;
revoke all on table public.v_superadmin_financial_projects from authenticated;

create or replace view public.v_superadmin_financial_kpis
with (security_invoker = true)
as
select
  coalesce(sum(mrr_active_cents), 0)::bigint as mrr_active_cents,
  coalesce(sum(total_overage_cents), 0)::bigint as overage_projected_cents,
  coalesce(sum(revenue_at_risk_cents), 0)::bigint as revenue_at_risk_cents,
  coalesce(sum(potential_cycle_revenue_cents), 0)::bigint as potential_cycle_revenue_cents,
  count(*)::integer as total_projects,
  count(*) filter (
    where subscription_status = 'active'
      and coalesce(base_price_cents, 0) > 0
      and coalesce(plan_code, '') <> 'free_trial'
  )::integer as paid_active_projects,
  count(*) filter (where subscription_status = 'trialing')::integer as active_trials,
  count(*) filter (where subscription_status = 'expired')::integer as expired_trials,
  count(*) filter (where subscription_status = 'past_due')::integer as past_due_projects,
  count(*) filter (where subscription_status = 'suspended')::integer as suspended_projects,
  count(*) filter (where pending_plan_change_id is not null)::integer as pending_plan_changes,
  count(*) filter (where total_overage_cents > 0)::integer as projects_with_overage,
  count(*) filter (where risk_level = 'high')::integer as high_risk_projects,
  count(*) filter (where risk_level = 'medium')::integer as medium_risk_projects
from public.v_superadmin_financial_projects;

alter view public.v_superadmin_financial_kpis owner to postgres;
revoke all on table public.v_superadmin_financial_kpis from public;
revoke all on table public.v_superadmin_financial_kpis from anon;
revoke all on table public.v_superadmin_financial_kpis from authenticated;

create or replace view public.v_superadmin_financial_project_cycles
with (security_invoker = true)
as
select
  s.project_id,
  s.subscription_id,
  s.id as usage_summary_id,
  s.billing_cycle_id,
  s.period_start,
  s.period_end,
  coalesce(s.pass_install_quantity, 0) as pass_install_quantity,
  coalesce(s.included_pass_installs, 0) as included_pass_installs,
  coalesce(s.pass_install_overage_quantity, 0) as pass_install_overage_quantity,
  coalesce(s.pass_install_overage_cents, 0) as pass_install_overage_cents,
  coalesce(s.notification_sent_quantity, 0) as notification_sent_quantity,
  coalesce(s.included_notification_sends, 0) as included_notification_sends,
  coalesce(s.notification_sent_overage_quantity, 0) as notification_sent_overage_quantity,
  coalesce(s.notification_sent_overage_cents, 0) as notification_sent_overage_cents,
  coalesce(s.total_overage_cents, 0) as total_overage_cents,
  s.last_usage_event_at,
  bs.current_period_start,
  bs.current_period_end,
  coalesce(bs.base_price_cents, 0) as base_price_cents,
  coalesce(bs.currency, 'BRL') as currency,
  (
    now() >= s.period_start
    and now() < s.period_end
  ) or (
    s.period_start = bs.current_period_start
    and s.period_end = bs.current_period_end
  ) as is_current_cycle,
  bi.id as invoice_id,
  bi.invoice_number,
  bi.status as invoice_status,
  bi.total_cents as invoice_total_cents,
  bi.amount_due_cents as invoice_amount_due_cents,
  bi.amount_paid_cents as invoice_amount_paid_cents,
  bi.due_at as invoice_due_at,
  bi.paid_at as invoice_paid_at,
  batch.id as collection_batch_id,
  batch.status as collection_batch_status,
  batch.gateway_charge_status,
  batch.gateway_charge_id,
  batch.overage_cents as batch_overage_cents,
  batch.updated_payment_cents,
  batch.due_at as batch_due_at,
  batch.paid_at as batch_paid_at,
  batch.failed_at as batch_failed_at
from public.billing_cycle_usage_summaries s
join public.billing_subscriptions bs
  on bs.id = s.subscription_id
 and bs.project_id = s.project_id
left join lateral (
  select invoice.*
  from public.billing_invoices invoice
  where invoice.billing_cycle_id = s.billing_cycle_id
    and invoice.project_id = s.project_id
    and invoice.status <> 'canceled'
  order by invoice.created_at desc
  limit 1
) bi on true
left join public.billing_invoice_collection_batches batch
  on batch.id = bi.collection_batch_id;

alter view public.v_superadmin_financial_project_cycles owner to postgres;
revoke all on table public.v_superadmin_financial_project_cycles from public;
revoke all on table public.v_superadmin_financial_project_cycles from anon;
revoke all on table public.v_superadmin_financial_project_cycles from authenticated;

create or replace view public.v_superadmin_financial_project_changes
with (security_invoker = true)
as
select
  pcs.project_id,
  pcs.subscription_id,
  pcs.id as plan_change_session_id,
  pcs.change_type,
  pcs.effective_mode,
  pcs.status,
  pcs.amount_cents,
  pcs.currency,
  pcs.created_at,
  pcs.paid_at,
  pcs.expires_at,
  pcs.applied_at,
  previous_plan.code as previous_plan_code,
  previous_plan.name as previous_plan_name,
  previous_plan.base_price_cents as previous_plan_base_price_cents,
  new_plan.code as new_plan_code,
  new_plan.name as new_plan_name,
  new_plan.base_price_cents as new_plan_base_price_cents,
  case
    when new_plan.base_price_cents is not null and previous_plan.base_price_cents is not null
      then new_plan.base_price_cents - previous_plan.base_price_cents
    else null
  end as mrr_delta_cents
from public.billing_plan_change_sessions pcs
left join public.billing_plans previous_plan on previous_plan.id = pcs.previous_plan_id
left join public.billing_plans new_plan on new_plan.id = pcs.new_plan_id;

alter view public.v_superadmin_financial_project_changes owner to postgres;
revoke all on table public.v_superadmin_financial_project_changes from public;
revoke all on table public.v_superadmin_financial_project_changes from anon;
revoke all on table public.v_superadmin_financial_project_changes from authenticated;

create or replace function public.get_superadmin_financial_plan_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kpis jsonb;
  v_projects jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(to_jsonb(k), '{}'::jsonb)
    into v_kpis
  from public.v_superadmin_financial_kpis k
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(project_row) order by
    case project_row.risk_level
      when 'high' then 1
      when 'medium' then 2
      else 3
    end,
    project_row.revenue_at_risk_cents desc,
    project_row.mrr_active_cents desc,
    lower(coalesce(project_row.project_name, ''))
  ), '[]'::jsonb)
    into v_projects
  from public.v_superadmin_financial_projects project_row;

  return jsonb_build_object(
    'generated_at', now(),
    'kpis', coalesce(v_kpis, '{}'::jsonb),
    'projects', coalesce(v_projects, '[]'::jsonb)
  );
end;
$$;

alter function public.get_superadmin_financial_plan_overview() owner to postgres;
revoke all on function public.get_superadmin_financial_plan_overview() from public;
revoke all on function public.get_superadmin_financial_plan_overview() from anon;
revoke all on function public.get_superadmin_financial_plan_overview() from authenticated;
grant execute on function public.get_superadmin_financial_plan_overview() to authenticated;

create or replace function public.get_superadmin_project_financial_detail(
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_project jsonb;
  v_cycles jsonb;
  v_current_cycle jsonb;
  v_plan_changes jsonb;
  v_audit_logs jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_project_id is null then
    raise exception 'project_id is required' using errcode = '23502';
  end if;

  select to_jsonb(project_row)
    into v_project
  from public.v_superadmin_financial_projects project_row
  where project_row.project_id = p_project_id
  limit 1;

  if v_project is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(to_jsonb(cycle_row) order by cycle_row.period_start desc), '[]'::jsonb)
    into v_cycles
  from (
    select *
    from public.v_superadmin_financial_project_cycles
    where project_id = p_project_id
    order by period_start desc
    limit 12
  ) cycle_row;

  select to_jsonb(cycle_row)
    into v_current_cycle
  from public.v_superadmin_financial_project_cycles cycle_row
  where cycle_row.project_id = p_project_id
  order by cycle_row.is_current_cycle desc, cycle_row.period_start desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(change_row) order by change_row.created_at desc), '[]'::jsonb)
    into v_plan_changes
  from (
    select *
    from public.v_superadmin_financial_project_changes
    where project_id = p_project_id
    order by created_at desc
    limit 12
  ) change_row;

  select coalesce(jsonb_agg(to_jsonb(audit_row) order by audit_row.created_at desc), '[]'::jsonb)
    into v_audit_logs
  from (
    select
      id,
      project_id,
      actor_user_id,
      target_table,
      target_id,
      action,
      changes,
      created_at
    from public.project_billing_audit_logs
    where project_id = p_project_id
    order by created_at desc
    limit 10
  ) audit_row;

  return jsonb_build_object(
    'generated_at', now(),
    'project', v_project,
    'subscription', v_project,
    'current_cycle', v_current_cycle,
    'cycles', coalesce(v_cycles, '[]'::jsonb),
    'plan_changes', coalesce(v_plan_changes, '[]'::jsonb),
    'audit_logs', coalesce(v_audit_logs, '[]'::jsonb),
    'risk', jsonb_build_object(
      'status', v_project ->> 'risk_status',
      'level', v_project ->> 'risk_level',
      'reasons', coalesce(v_project -> 'risk_reasons', '[]'::jsonb),
      'revenue_at_risk_cents', coalesce((v_project ->> 'revenue_at_risk_cents')::integer, 0)
    )
  );
end;
$$;

alter function public.get_superadmin_project_financial_detail(uuid) owner to postgres;
revoke all on function public.get_superadmin_project_financial_detail(uuid) from public;
revoke all on function public.get_superadmin_project_financial_detail(uuid) from anon;
revoke all on function public.get_superadmin_project_financial_detail(uuid) from authenticated;
grant execute on function public.get_superadmin_project_financial_detail(uuid) to authenticated;

comment on view public.v_superadmin_financial_projects is
  'Internal live read model for the superadmin financial project inventory.';
comment on view public.v_superadmin_financial_kpis is
  'Internal live read model for superadmin financial KPIs.';
comment on view public.v_superadmin_financial_project_cycles is
  'Internal live read model for project billing cycles, summaries and overage invoices.';
comment on view public.v_superadmin_financial_project_changes is
  'Internal live read model for project billing plan changes.';
comment on function public.get_superadmin_financial_plan_overview() is
  'Superadmin-only JSON overview for the financial dashboard tab.';
comment on function public.get_superadmin_project_financial_detail(uuid) is
  'Superadmin-only JSON detail payload for the financial project drawer.';
