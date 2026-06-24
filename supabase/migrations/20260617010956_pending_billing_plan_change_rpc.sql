-- Expose the active next-cycle billing plan change for the current project member.
-- billing_plan_change_sessions remains private; the UI only receives the minimal
-- data needed to mark a scheduled downgrade.

create or replace function public.get_pending_billing_plan_change(
  p_project_id uuid
)
returns table (
  id uuid,
  project_id uuid,
  subscription_id uuid,
  previous_plan_id uuid,
  new_plan_id uuid,
  new_plan_code text,
  new_plan_name text,
  change_type text,
  effective_mode text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    bpcs.id,
    bpcs.project_id,
    bpcs.subscription_id,
    bpcs.previous_plan_id,
    bpcs.new_plan_id,
    bp.code as new_plan_code,
    bp.name as new_plan_name,
    bpcs.change_type,
    bpcs.effective_mode,
    bpcs.status,
    bs.current_period_end,
    bpcs.created_at
  from public.billing_plan_change_sessions bpcs
  join public.billing_plans bp
    on bp.id = bpcs.new_plan_id
  join public.billing_subscriptions bs
    on bs.id = bpcs.subscription_id
   and bs.project_id = bpcs.project_id
  where bpcs.project_id = p_project_id
    and bpcs.effective_mode = 'next_cycle'
    and bpcs.status in ('pending', 'created', 'paid')
    and public.can_access_project(bpcs.project_id)
  order by bpcs.created_at desc
  limit 1;
$$;

alter function public.get_pending_billing_plan_change(uuid)
  owner to postgres;

revoke all on function public.get_pending_billing_plan_change(uuid) from public;
grant execute on function public.get_pending_billing_plan_change(uuid) to authenticated;
