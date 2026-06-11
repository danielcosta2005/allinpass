-- Aggregate billable pass installs and notification sends by billing cycle period.
-- billing_usage_events remains the source of truth; this table is a fast, per-cycle summary.

create table if not exists public.billing_cycle_usage_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  pass_install_quantity integer not null default 0 check (pass_install_quantity >= 0),
  notification_sent_quantity integer not null default 0 check (notification_sent_quantity >= 0),
  included_pass_installs integer not null default 0 check (included_pass_installs >= 0),
  included_notification_sends integer not null default 0 check (included_notification_sends >= 0),
  overage_pass_install_cents integer not null default 0 check (overage_pass_install_cents >= 0),
  overage_notification_sent_cents integer not null default 0 check (overage_notification_sent_cents >= 0),
  pass_install_overage_quantity integer not null default 0 check (pass_install_overage_quantity >= 0),
  notification_sent_overage_quantity integer not null default 0 check (notification_sent_overage_quantity >= 0),
  pass_install_overage_cents integer not null default 0 check (pass_install_overage_cents >= 0),
  notification_sent_overage_cents integer not null default 0 check (notification_sent_overage_cents >= 0),
  total_overage_cents integer not null default 0 check (total_overage_cents >= 0),
  allowance_source text,
  overage_recalculated_at timestamptz,
  last_usage_event_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, subscription_id, period_start, period_end),
  check (period_end > period_start)
);
create index if not exists billing_cycle_usage_summaries_project_period_idx
  on public.billing_cycle_usage_summaries(project_id, period_start desc, period_end desc);
create index if not exists billing_cycle_usage_summaries_subscription_idx
  on public.billing_cycle_usage_summaries(subscription_id, period_start desc);
create index if not exists billing_cycle_usage_summaries_cycle_idx
  on public.billing_cycle_usage_summaries(billing_cycle_id)
  where billing_cycle_id is not null;
drop trigger if exists trg_billing_cycle_usage_summaries_updated_at on public.billing_cycle_usage_summaries;
create trigger trg_billing_cycle_usage_summaries_updated_at
before update on public.billing_cycle_usage_summaries
for each row execute function public.set_updated_at();
alter table public.billing_cycle_usage_summaries enable row level security;
drop policy if exists billing_cycle_usage_summaries_member_select on public.billing_cycle_usage_summaries;
create policy billing_cycle_usage_summaries_member_select
on public.billing_cycle_usage_summaries
for select
to authenticated
using ((select public.can_access_project(project_id)));
drop policy if exists billing_cycle_usage_summaries_superadmin_write on public.billing_cycle_usage_summaries;
create policy billing_cycle_usage_summaries_superadmin_write
on public.billing_cycle_usage_summaries
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));
grant select on table public.billing_cycle_usage_summaries to authenticated;
grant select, insert, update, delete on table public.billing_cycle_usage_summaries to service_role;
create or replace function public.resolve_billing_usage_event_period(
  p_project_id uuid,
  p_subscription_id uuid,
  p_billing_cycle_id uuid,
  p_occurred_at timestamptz
)
returns table (
  subscription_id uuid,
  billing_cycle_id uuid,
  period_start timestamptz,
  period_end timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_subscription_id uuid;
  v_billing_cycle_id uuid;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if p_project_id is null or p_occurred_at is null then
    return;
  end if;

  if p_billing_cycle_id is not null then
    select bc.subscription_id, bc.id, bc.period_start, bc.period_end
      into v_subscription_id, v_billing_cycle_id, v_period_start, v_period_end
    from public.billing_cycles bc
    where bc.id = p_billing_cycle_id
      and bc.project_id = p_project_id
    limit 1;

    if found and v_subscription_id is not null then
      subscription_id := v_subscription_id;
      billing_cycle_id := v_billing_cycle_id;
      period_start := v_period_start;
      period_end := v_period_end;
      return next;
      return;
    end if;
  end if;

  select bc.subscription_id, bc.id, bc.period_start, bc.period_end
    into v_subscription_id, v_billing_cycle_id, v_period_start, v_period_end
  from public.billing_cycles bc
  where bc.project_id = p_project_id
    and p_occurred_at >= bc.period_start
    and p_occurred_at < bc.period_end
    and (p_subscription_id is null or bc.subscription_id = p_subscription_id)
  order by
    (bc.status = 'open') desc,
    (bc.subscription_id = p_subscription_id) desc,
    bc.period_start desc
  limit 1;

  if found and v_subscription_id is not null then
    subscription_id := v_subscription_id;
    billing_cycle_id := v_billing_cycle_id;
    period_start := v_period_start;
    period_end := v_period_end;
    return next;
    return;
  end if;

  select bs.id, null::uuid, bs.current_period_start, bs.current_period_end
    into v_subscription_id, v_billing_cycle_id, v_period_start, v_period_end
  from public.billing_subscriptions bs
  where bs.project_id = p_project_id
    and (p_subscription_id is null or bs.id = p_subscription_id)
    and bs.status in ('trialing', 'active', 'past_due', 'paused')
    and bs.current_period_start is not null
    and bs.current_period_end is not null
    and p_occurred_at >= bs.current_period_start
    and p_occurred_at < bs.current_period_end
  order by
    (bs.id = p_subscription_id) desc,
    bs.current_period_start desc,
    bs.created_at desc
  limit 1;

  if found and v_subscription_id is not null then
    subscription_id := v_subscription_id;
    billing_cycle_id := v_billing_cycle_id;
    period_start := v_period_start;
    period_end := v_period_end;
    return next;
  end if;
end;
$$;
alter function public.resolve_billing_usage_event_period(uuid, uuid, uuid, timestamptz)
  owner to postgres;
revoke all on function public.resolve_billing_usage_event_period(uuid, uuid, uuid, timestamptz) from public;
grant execute on function public.resolve_billing_usage_event_period(uuid, uuid, uuid, timestamptz) to service_role;
create or replace function public.trg_prepare_billing_usage_event_cycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
begin
  if new.project_id is null
     or new.occurred_at is null
     or new.is_billable is distinct from true
     or new.event_type is distinct from 'issue'
     or new.resource_type is null
     or new.resource_type not in ('pass_install', 'notification_sent') then
    return new;
  end if;

  select *
    into v_period
  from public.resolve_billing_usage_event_period(
    new.project_id,
    new.subscription_id,
    new.billing_cycle_id,
    new.occurred_at
  )
  limit 1;

  if found then
    new.subscription_id := coalesce(new.subscription_id, v_period.subscription_id);
    new.billing_cycle_id := coalesce(new.billing_cycle_id, v_period.billing_cycle_id);
  end if;

  return new;
end;
$$;
alter function public.trg_prepare_billing_usage_event_cycle()
  owner to postgres;
create or replace function public.recalculate_billing_cycle_usage_summary(
  p_summary_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary public.billing_cycle_usage_summaries%rowtype;
  v_ent record;
  v_install_allowance integer;
  v_notification_allowance integer;
  v_pass_install_overage_quantity integer;
  v_notification_sent_overage_quantity integer;
  v_pass_install_overage_cents integer;
  v_notification_sent_overage_cents integer;
begin
  if p_summary_id is null then
    return;
  end if;

  select *
    into v_summary
  from public.billing_cycle_usage_summaries
  where id = p_summary_id
  for update;

  if not found then
    return;
  end if;

  select *
    into v_ent
  from public.get_billing_cycle_entitlements(
    v_summary.subscription_id,
    v_summary.period_start,
    v_summary.period_end
  )
  limit 1;

  if not found then
    return;
  end if;

  v_install_allowance := greatest(coalesce(v_ent.install_allowance, 0), 0);
  v_notification_allowance := greatest(coalesce(v_ent.notification_allowance, 0), 0);
  v_pass_install_overage_quantity := greatest(v_summary.pass_install_quantity - v_install_allowance, 0);
  v_notification_sent_overage_quantity := greatest(v_summary.notification_sent_quantity - v_notification_allowance, 0);
  v_pass_install_overage_cents := v_pass_install_overage_quantity * greatest(coalesce(v_ent.overage_pass_install_cents, 0), 0);
  v_notification_sent_overage_cents := v_notification_sent_overage_quantity * greatest(coalesce(v_ent.overage_notification_sent_cents, 0), 0);

  update public.billing_cycle_usage_summaries
  set
    included_pass_installs = v_install_allowance,
    included_notification_sends = v_notification_allowance,
    overage_pass_install_cents = greatest(coalesce(v_ent.overage_pass_install_cents, 0), 0),
    overage_notification_sent_cents = greatest(coalesce(v_ent.overage_notification_sent_cents, 0), 0),
    pass_install_overage_quantity = v_pass_install_overage_quantity,
    notification_sent_overage_quantity = v_notification_sent_overage_quantity,
    pass_install_overage_cents = v_pass_install_overage_cents,
    notification_sent_overage_cents = v_notification_sent_overage_cents,
    total_overage_cents = v_pass_install_overage_cents + v_notification_sent_overage_cents,
    allowance_source = v_ent.allowance_source,
    overage_recalculated_at = now()
  where id = p_summary_id;
end;
$$;
alter function public.recalculate_billing_cycle_usage_summary(uuid)
  owner to postgres;
revoke all on function public.recalculate_billing_cycle_usage_summary(uuid) from public;
grant execute on function public.recalculate_billing_cycle_usage_summary(uuid) to service_role;
create or replace function public.apply_billing_cycle_usage_summary_delta(
  p_project_id uuid,
  p_subscription_id uuid,
  p_billing_cycle_id uuid,
  p_resource_type text,
  p_event_type text,
  p_quantity integer,
  p_is_billable boolean,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_pass_install_delta integer := 0;
  v_notification_sent_delta integer := 0;
  v_summary_id uuid;
begin
  if p_project_id is null
     or p_occurred_at is null
     or p_quantity is null
     or p_quantity = 0
     or p_is_billable is distinct from true
     or p_event_type is distinct from 'issue'
     or p_resource_type is null
     or p_resource_type not in ('pass_install', 'notification_sent') then
    return;
  end if;

  select *
    into v_period
  from public.resolve_billing_usage_event_period(
    p_project_id,
    p_subscription_id,
    p_billing_cycle_id,
    p_occurred_at
  )
  limit 1;

  if not found or v_period.subscription_id is null then
    return;
  end if;

  if p_resource_type = 'pass_install' then
    v_pass_install_delta := p_quantity;
  elsif p_resource_type = 'notification_sent' then
    v_notification_sent_delta := p_quantity;
  end if;

  if v_pass_install_delta < 0 or v_notification_sent_delta < 0 then
    update public.billing_cycle_usage_summaries
    set
      billing_cycle_id = coalesce(
        public.billing_cycle_usage_summaries.billing_cycle_id,
        v_period.billing_cycle_id
      ),
      pass_install_quantity = greatest(
        0,
        public.billing_cycle_usage_summaries.pass_install_quantity + v_pass_install_delta
      ),
      notification_sent_quantity = greatest(
        0,
        public.billing_cycle_usage_summaries.notification_sent_quantity + v_notification_sent_delta
      ),
      last_usage_event_at = greatest(
        coalesce(public.billing_cycle_usage_summaries.last_usage_event_at, p_occurred_at),
        p_occurred_at
      )
    where project_id = p_project_id
      and subscription_id = v_period.subscription_id
      and period_start = v_period.period_start
      and period_end = v_period.period_end
    returning id into v_summary_id;

    perform public.recalculate_billing_cycle_usage_summary(v_summary_id);

    return;
  end if;

  insert into public.billing_cycle_usage_summaries (
    project_id,
    subscription_id,
    billing_cycle_id,
    period_start,
    period_end,
    pass_install_quantity,
    notification_sent_quantity,
    last_usage_event_at,
    metadata
  )
  values (
    p_project_id,
    v_period.subscription_id,
    v_period.billing_cycle_id,
    v_period.period_start,
    v_period.period_end,
    greatest(v_pass_install_delta, 0),
    greatest(v_notification_sent_delta, 0),
    p_occurred_at,
    jsonb_build_object('origin', 'billing_usage_events_trigger')
  )
  on conflict (project_id, subscription_id, period_start, period_end) do update
  set
    billing_cycle_id = coalesce(
      public.billing_cycle_usage_summaries.billing_cycle_id,
      excluded.billing_cycle_id
    ),
    pass_install_quantity = greatest(
      0,
      public.billing_cycle_usage_summaries.pass_install_quantity + v_pass_install_delta
    ),
    notification_sent_quantity = greatest(
      0,
      public.billing_cycle_usage_summaries.notification_sent_quantity + v_notification_sent_delta
    ),
    last_usage_event_at = greatest(
      coalesce(public.billing_cycle_usage_summaries.last_usage_event_at, excluded.last_usage_event_at),
      excluded.last_usage_event_at
    )
  returning id into v_summary_id;

  perform public.recalculate_billing_cycle_usage_summary(v_summary_id);
end;
$$;
alter function public.apply_billing_cycle_usage_summary_delta(
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  boolean,
  timestamptz
)
  owner to postgres;
revoke all on function public.apply_billing_cycle_usage_summary_delta(
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  boolean,
  timestamptz
) from public;
grant execute on function public.apply_billing_cycle_usage_summary_delta(
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  boolean,
  timestamptz
) to service_role;
create or replace function public.trg_sync_billing_cycle_usage_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.apply_billing_cycle_usage_summary_delta(
      old.project_id,
      old.subscription_id,
      old.billing_cycle_id,
      old.resource_type,
      old.event_type,
      -old.quantity,
      old.is_billable,
      old.occurred_at
    );

    return old;
  end if;

  if tg_op = 'UPDATE' then
    perform public.apply_billing_cycle_usage_summary_delta(
      old.project_id,
      old.subscription_id,
      old.billing_cycle_id,
      old.resource_type,
      old.event_type,
      -old.quantity,
      old.is_billable,
      old.occurred_at
    );
  end if;

  perform public.apply_billing_cycle_usage_summary_delta(
    new.project_id,
    new.subscription_id,
    new.billing_cycle_id,
    new.resource_type,
    new.event_type,
    new.quantity,
    new.is_billable,
    new.occurred_at
  );

  return new;
end;
$$;
alter function public.trg_sync_billing_cycle_usage_summary()
  owner to postgres;
drop trigger if exists trg_prepare_billing_usage_event_cycle on public.billing_usage_events;
create trigger trg_prepare_billing_usage_event_cycle
before insert or update of project_id, subscription_id, billing_cycle_id, resource_type, event_type, is_billable, occurred_at
on public.billing_usage_events
for each row execute function public.trg_prepare_billing_usage_event_cycle();
drop trigger if exists trg_sync_billing_cycle_usage_summary on public.billing_usage_events;
create trigger trg_sync_billing_cycle_usage_summary
after insert or update of project_id, subscription_id, billing_cycle_id, resource_type, event_type, quantity, is_billable, occurred_at or delete
on public.billing_usage_events
for each row execute function public.trg_sync_billing_cycle_usage_summary();
insert into public.billing_cycle_usage_summaries (
  project_id,
  subscription_id,
  billing_cycle_id,
  period_start,
  period_end,
  pass_install_quantity,
  notification_sent_quantity,
  last_usage_event_at,
  metadata
)
select
  bue.project_id,
  resolved.subscription_id,
  (min(resolved.billing_cycle_id::text) filter (where resolved.billing_cycle_id is not null))::uuid as billing_cycle_id,
  resolved.period_start,
  resolved.period_end,
  coalesce(sum(bue.quantity) filter (where bue.resource_type = 'pass_install'), 0)::integer as pass_install_quantity,
  coalesce(sum(bue.quantity) filter (where bue.resource_type = 'notification_sent'), 0)::integer as notification_sent_quantity,
  max(bue.occurred_at) as last_usage_event_at,
  jsonb_build_object('origin', 'billing_cycle_usage_summaries_backfill') as metadata
from public.billing_usage_events bue
cross join lateral public.resolve_billing_usage_event_period(
  bue.project_id,
  bue.subscription_id,
  bue.billing_cycle_id,
  bue.occurred_at
) resolved
where bue.is_billable = true
  and bue.event_type = 'issue'
  and bue.resource_type in ('pass_install', 'notification_sent')
group by
  bue.project_id,
  resolved.subscription_id,
  resolved.period_start,
  resolved.period_end
having coalesce(sum(bue.quantity) filter (where bue.resource_type = 'pass_install'), 0) > 0
    or coalesce(sum(bue.quantity) filter (where bue.resource_type = 'notification_sent'), 0) > 0
on conflict (project_id, subscription_id, period_start, period_end) do update
set
  billing_cycle_id = coalesce(
    public.billing_cycle_usage_summaries.billing_cycle_id,
    excluded.billing_cycle_id
  ),
  pass_install_quantity = excluded.pass_install_quantity,
  notification_sent_quantity = excluded.notification_sent_quantity,
  last_usage_event_at = greatest(
    coalesce(public.billing_cycle_usage_summaries.last_usage_event_at, excluded.last_usage_event_at),
    excluded.last_usage_event_at
  ),
  metadata = public.billing_cycle_usage_summaries.metadata || excluded.metadata;
do $$
declare
  r record;
begin
  for r in
    select id
    from public.billing_cycle_usage_summaries
  loop
    perform public.recalculate_billing_cycle_usage_summary(r.id);
  end loop;
end;
$$;
