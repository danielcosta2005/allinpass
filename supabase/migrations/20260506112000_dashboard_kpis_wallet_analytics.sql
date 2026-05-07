-- Consolidated dashboard KPI, wallet install, and restaurant analytics updates.

create or replace function public.fn_get_global_kpis()
returns table(projects integer, customers integer, visits integer, rewards_unlocked integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.projects)::integer as projects,
    (select count(*) from public.customers)::integer as customers,
    (select count(*) from public.visits)::integer as visits,
    (select count(*) from public.events e where e.type = 'reward_unlocked')::integer as rewards_unlocked;
$$;

create or replace function public.fn_get_global_kpis_timeseries(p_months integer)
returns table(month date, visits integer, rewards integer)
language sql
stable
security definer
set search_path = public
as $$
  with months as (
    select
      date_trunc('month', (now() - (i || ' months')::interval))::date as m
    from generate_series(0, greatest(coalesce(p_months, 6) - 1, 0)) i
  )
  select
    m.m as month,
    coalesce((
      select count(*)
      from public.visits v
      where v.created_at >= m.m
        and v.created_at < (m.m + interval '1 month')
    ), 0)::integer as visits,
    coalesce((
      select count(*)
      from public.events e
      where e.type = 'reward_unlocked'
        and e.at >= m.m
        and e.at < (m.m + interval '1 month')
    ), 0)::integer as rewards
  from months m
  order by m.m;
$$;

create or replace function public.trg_user_passes_set_install_timestamps()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new_status text;
  v_old_status text;
begin
  v_new_status := lower(trim(coalesce(new.install_status, '')));

  if tg_op = 'INSERT' then
    v_old_status := null;
  else
    v_old_status := lower(trim(coalesce(old.install_status, '')));
  end if;

  if v_new_status = 'installed' then
    if v_old_status is distinct from 'installed' and new.installed_at is null then
      new.installed_at := now();
    end if;

    if v_old_status is distinct from 'installed' then
      new.removed_at := null;
    end if;
  elsif v_new_status = 'removed' then
    if v_old_status is distinct from 'removed' and new.removed_at is null then
      new.removed_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists user_passes_set_install_timestamps on public.user_passes;
create trigger user_passes_set_install_timestamps
before insert or update of install_status
on public.user_passes
for each row
execute function public.trg_user_passes_set_install_timestamps();

update public.user_passes
set installed_at = coalesce(installed_at, issued_at, created_at, now())
where lower(trim(coalesce(install_status, ''))) = 'installed'
  and installed_at is null;

update public.user_passes
set installed_at = coalesce(installed_at, removed_at, issued_at, created_at, now())
where lower(trim(coalesce(install_status, ''))) = 'removed'
  and installed_at is null;

create or replace function public.fn_get_project_kpis(p_project_id uuid)
returns table(active_customers bigint, visits_this_cycle bigint, rewards_unlocked bigint, wallet_linked bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select count(distinct c.id)
      from public.customers c
      where c.project_id = p_project_id
    ) as active_customers,
    (
      select count(*)
      from public.visits v
      where v.project_id = p_project_id
        and v.created_at >= (current_date - interval '30 days')
    ) as visits_this_cycle,
    (
      select count(*)
      from public.events e
      where e.project_id = p_project_id
        and e.type = 'reward_unlocked'
    ) as rewards_unlocked,
    (
      select count(*)
      from public.user_passes up
      where up.project_id = p_project_id
        and up.installed_at is not null
    ) as wallet_linked;
$$;

create or replace function public.fn_get_project_kpis_timeseries(p_project_id uuid, p_months integer)
returns table(month date, visits integer, rewards_unlocked integer, wallet_linked integer)
language sql
stable
security definer
set search_path = public
as $$
  with months as (
    select
      date_trunc('month', (now() - (i || ' months')::interval))::date as m
    from generate_series(0, greatest(coalesce(p_months, 6) - 1, 0)) i
  )
  select
    m.m as month,
    coalesce((
      select count(*)
      from public.visits v
      where v.project_id = p_project_id
        and v.created_at >= m.m
        and v.created_at < (m.m + interval '1 month')
    ), 0)::integer as visits,
    coalesce((
      select count(*)
      from public.events e
      where e.project_id = p_project_id
        and e.type = 'reward_unlocked'
        and e.at >= m.m
        and e.at < (m.m + interval '1 month')
    ), 0)::integer as rewards_unlocked,
    coalesce((
      select count(*)
      from public.user_passes up
      where up.project_id = p_project_id
        and up.installed_at >= m.m
        and up.installed_at < (m.m + interval '1 month')
    ), 0)::integer as wallet_linked
  from months m
  order by m.m;
$$;

create or replace function public.fn_get_project_analytics(
  p_project_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_member boolean;
  v_is_superadmin boolean;
  result jsonb;
begin
  select is_member_of(p_project_id) into v_is_member;
  select is_superadmin() into v_is_superadmin;

  if not v_is_member and not v_is_superadmin then
    raise exception 'Acesso negado.';
  end if;

  with bounds as (
    select
      least(p_start_date, p_end_date) as start_at,
      greatest(p_start_date, p_end_date) as end_at,
      'America/Sao_Paulo'::text as report_timezone
  ),
  date_series as (
    select gs.metric_date::date
    from bounds b
    cross join generate_series(
      timezone(b.report_timezone, b.start_at)::date,
      timezone(b.report_timezone, b.end_at)::date,
      interval '1 day'
    ) as gs(metric_date)
  ),
  all_project_visits as (
    select
      v.id,
      v.created_at as visited_at,
      timezone(b.report_timezone, v.created_at) as visited_local_at,
      coalesce(
        nullif(v.customer_google_sub, ''),
        nullif(lower(trim(v.customer_email)), ''),
        v.user_pass_id::text,
        v.id::text
      ) as visitor_key
    from public.visits v
    cross join bounds b
    where v.project_id = p_project_id
  ),
  visits_in_period as (
    select apv.*
    from all_project_visits apv
    cross join bounds b
    where apv.visited_at >= b.start_at
      and apv.visited_at <= b.end_at
  ),
  visitor_first_visits as (
    select visitor_key, min(visited_at) as first_visit_at
    from all_project_visits
    group by visitor_key
  ),
  active_visitors as (
    select
      vip.visitor_key,
      min(vfv.first_visit_at) as first_visit_at,
      count(*)::bigint as visit_count
    from visits_in_period vip
    join visitor_first_visits vfv on vfv.visitor_key = vip.visitor_key
    group by vip.visitor_key
  ),
  reward_events_by_date as (
    select timezone(b.report_timezone, e.at)::date as metric_date, count(*)::bigint as reward_count
    from public.events e
    cross join bounds b
    where e.project_id = p_project_id
      and e.type = 'reward_unlocked'
      and e.at >= b.start_at
      and e.at <= b.end_at
    group by 1
  ),
  rewards_by_date as (
    select
      ds.metric_date as reward_date,
      coalesce(re.reward_count, 0)::bigint as reward_count
    from date_series ds
    left join reward_events_by_date re on re.metric_date = ds.metric_date
    order by ds.metric_date
  ),
  wallet_installs_counts as (
    select timezone(b.report_timezone, up.installed_at)::date as metric_date, count(*)::bigint as install_count
    from public.user_passes up
    cross join bounds b
    where up.project_id = p_project_id
      and up.installed_at >= b.start_at
      and up.installed_at <= b.end_at
    group by 1
  ),
  wallet_installs_by_date as (
    select
      ds.metric_date as install_date,
      coalesce(wic.install_count, 0)::bigint as install_count
    from date_series ds
    left join wallet_installs_counts wic on wic.metric_date = ds.metric_date
    order by ds.metric_date
  ),
  wallet_removals_counts as (
    select timezone(b.report_timezone, up.removed_at)::date as metric_date, count(*)::bigint as removal_count
    from public.user_passes up
    cross join bounds b
    where up.project_id = p_project_id
      and up.removed_at >= b.start_at
      and up.removed_at <= b.end_at
    group by 1
  ),
  wallet_removals_by_date as (
    select
      ds.metric_date as removal_date,
      coalesce(wrc.removal_count, 0)::bigint as removal_count
    from date_series ds
    left join wallet_removals_counts wrc on wrc.metric_date = ds.metric_date
    order by ds.metric_date
  ),
  kpis as (
    select
      (
        select count(*)::bigint
        from public.customers c
        where c.project_id = p_project_id
      ) as total_customers,
      (
        select count(*)::bigint
        from active_visitors
      ) as active_customers_period,
      (
        select count(*)::bigint
        from visits_in_period
      ) as visits_in_period,
      (
        select count(*)::bigint
        from public.user_passes up
        cross join bounds b
        where up.project_id = p_project_id
          and up.installed_at >= b.start_at
          and up.installed_at <= b.end_at
      ) as wallet_linked,
      (
        select count(*)::bigint
        from public.user_passes up
        cross join bounds b
        where up.project_id = p_project_id
          and lower(trim(coalesce(up.install_status, ''))) = 'installed'
          and up.installed_at >= b.start_at
          and up.installed_at <= b.end_at
      ) as wallet_active_period,
      (
        select coalesce(sum(r.reward_count), 0)::bigint
        from rewards_by_date r
      ) as rewards_unlocked_period
  ),
  visits_by_date as (
    select
      ds.metric_date as visit_date,
      count(vip.id)::bigint as visit_count
    from date_series ds
    left join visits_in_period vip on vip.visited_local_at::date = ds.metric_date
    group by ds.metric_date
    order by ds.metric_date
  ),
  visits_by_dow as (
    select extract(dow from visited_local_at) as day_of_week_num, count(*)::bigint as visit_count
    from visits_in_period
    group by day_of_week_num
  ),
  visits_by_dom as (
    select extract(day from visited_local_at) as day_of_month, count(*)::bigint as visit_count
    from visits_in_period
    group by day_of_month
  ),
  visits_by_hod as (
    select extract(hour from visited_local_at) as hour_of_day, count(*)::bigint as visit_count
    from visits_in_period
    group by hour_of_day
  ),
  new_vs_returning_customers as (
    select
      count(*) filter (where av.first_visit_at >= b.start_at)::bigint as new_customers,
      count(*) filter (where av.first_visit_at < b.start_at)::bigint as returning_customers
    from active_visitors av
    cross join bounds b
  ),
  frequency_buckets as (
    select *
    from (
      values
        (1, '1', '1 visita'),
        (2, '2-3', '2-3 visitas'),
        (3, '4-9', '4-9 visitas'),
        (4, '10+', '10+ visitas')
    ) as bucket(bucket_order, bucket_key, bucket)
  ),
  frequency_counts as (
    select
      case
        when visit_count = 1 then '1'
        when visit_count between 2 and 3 then '2-3'
        when visit_count between 4 and 9 then '4-9'
        else '10+'
      end as bucket_key,
      count(*)::bigint as customer_count
    from active_visitors
    group by 1
  ),
  visit_frequency_distribution as (
    select
      fb.bucket_order,
      fb.bucket_key,
      fb.bucket,
      coalesce(fc.customer_count, 0)::bigint as customer_count
    from frequency_buckets fb
    left join frequency_counts fc on fc.bucket_key = fb.bucket_key
    order by fb.bucket_order
  )
  select jsonb_build_object(
    'kpis', coalesce((select to_jsonb(k) from kpis k), '{}'::jsonb),
    'visits_by_date', coalesce((select jsonb_agg(to_jsonb(v) order by v.visit_date) from visits_by_date v), '[]'::jsonb),
    'new_vs_returning_customers', coalesce((select to_jsonb(n) from new_vs_returning_customers n), jsonb_build_object('new_customers', 0, 'returning_customers', 0)),
    'visit_frequency_distribution', coalesce((select jsonb_agg(to_jsonb(v) order by v.bucket_order) from visit_frequency_distribution v), '[]'::jsonb),
    'rewards_unlocked_period', jsonb_build_object(
      'total', coalesce((select k.rewards_unlocked_period from kpis k), 0),
      'by_date', coalesce((select jsonb_agg(to_jsonb(r) order by r.reward_date) from rewards_by_date r), '[]'::jsonb)
    ),
    'wallet_installs_by_date', coalesce((select jsonb_agg(to_jsonb(w) order by w.install_date) from wallet_installs_by_date w), '[]'::jsonb),
    'wallet_removals_by_date', coalesce((select jsonb_agg(to_jsonb(w) order by w.removal_date) from wallet_removals_by_date w), '[]'::jsonb),
    'by_day_of_week', coalesce((select jsonb_agg(to_jsonb(v)) from visits_by_dow v), '[]'::jsonb),
    'by_day_of_month', coalesce((select jsonb_agg(to_jsonb(v)) from visits_by_dom v), '[]'::jsonb),
    'by_hour_of_day', coalesce((select jsonb_agg(to_jsonb(v)) from visits_by_hod v), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

grant execute on function public.fn_get_project_analytics(uuid, timestamp with time zone, timestamp with time zone) to anon, authenticated, service_role;
