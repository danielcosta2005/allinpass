-- Recalculate live cycle usage summaries as soon as a billing plan change is recorded.
-- billing_cycle_usage_summaries is a cache; billing_subscription_changes is the
-- source that determines the effective allowance/overage prices for a cycle.

create or replace function public.recalculate_billing_cycle_usage_summaries_for_subscription_change(
  p_project_id uuid,
  p_subscription_id uuid,
  p_effective_at timestamptz,
  p_cycle_started_at timestamptz,
  p_cycle_ends_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start timestamptz := p_cycle_started_at;
  v_period_end timestamptz := p_cycle_ends_at;
  v_summary_id uuid;
  v_recalculated_count integer := 0;
begin
  if p_project_id is null or p_subscription_id is null then
    return 0;
  end if;

  if v_period_start is null or v_period_end is null then
    select bs.current_period_start, bs.current_period_end
      into v_period_start, v_period_end
    from public.billing_subscriptions bs
    where bs.id = p_subscription_id
      and bs.project_id = p_project_id;
  end if;

  for v_summary_id in
    select distinct summary.id
    from public.billing_cycle_usage_summaries summary
    where summary.project_id = p_project_id
      and summary.subscription_id = p_subscription_id
      and (
        (
          p_effective_at is not null
          and p_effective_at >= summary.period_start
          and p_effective_at < summary.period_end
        )
        or (
          v_period_start is not null
          and v_period_end is not null
          and summary.period_start < v_period_end
          and summary.period_end > v_period_start
        )
      )
  loop
    perform public.recalculate_billing_cycle_usage_summary(v_summary_id);
    v_recalculated_count := v_recalculated_count + 1;
  end loop;

  return v_recalculated_count;
end;
$$;

alter function public.recalculate_billing_cycle_usage_summaries_for_subscription_change(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
) owner to postgres;

revoke all on function public.recalculate_billing_cycle_usage_summaries_for_subscription_change(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
) from public;
grant execute on function public.recalculate_billing_cycle_usage_summaries_for_subscription_change(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz
) to service_role;

create or replace function public.trg_recalculate_usage_summary_on_subscription_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalculate_billing_cycle_usage_summaries_for_subscription_change(
      old.project_id,
      old.subscription_id,
      old.effective_at,
      old.cycle_started_at,
      old.cycle_ends_at
    );

    return old;
  end if;

  if tg_op = 'UPDATE' then
    perform public.recalculate_billing_cycle_usage_summaries_for_subscription_change(
      old.project_id,
      old.subscription_id,
      old.effective_at,
      old.cycle_started_at,
      old.cycle_ends_at
    );
  end if;

  perform public.recalculate_billing_cycle_usage_summaries_for_subscription_change(
    new.project_id,
    new.subscription_id,
    new.effective_at,
    new.cycle_started_at,
    new.cycle_ends_at
  );

  return new;
end;
$$;

alter function public.trg_recalculate_usage_summary_on_subscription_change()
  owner to postgres;

revoke all on function public.trg_recalculate_usage_summary_on_subscription_change() from public;
grant execute on function public.trg_recalculate_usage_summary_on_subscription_change() to service_role;

drop trigger if exists trg_billing_subscription_changes_recalculate_usage_summary
  on public.billing_subscription_changes;
create trigger trg_billing_subscription_changes_recalculate_usage_summary
after insert or update or delete
on public.billing_subscription_changes
for each row execute function public.trg_recalculate_usage_summary_on_subscription_change();
