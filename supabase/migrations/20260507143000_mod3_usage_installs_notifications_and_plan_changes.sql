-- Module 3 incremental update
-- 1) Charge pass installs (user_passes installed first-time) instead of pass issuance
-- 2) Charge notifications once per notification_jobs.id when status = sent
-- 3) Add plan-change structures for proration-aware allowance snapshots

-- ------------------------------------------------------------
-- A) Plan/resource model for installs + notifications
-- ------------------------------------------------------------
alter table public.billing_plans
  add column if not exists included_pass_installs integer not null default 0,
  add column if not exists included_notification_sends integer not null default 0,
  add column if not exists overage_pass_install_cents integer not null default 0,
  add column if not exists overage_notification_sent_cents integer not null default 0;
alter table public.billing_subscriptions
  add column if not exists included_pass_installs integer not null default 0,
  add column if not exists included_notification_sends integer not null default 0,
  add column if not exists overage_pass_install_cents integer not null default 0,
  add column if not exists overage_notification_sent_cents integer not null default 0;
-- Backfill plan-level install values from legacy pass fields when possible.
update public.billing_plans
set included_pass_installs = included_passes
where included_pass_installs = 0
  and included_passes > 0;
update public.billing_plans
set overage_pass_install_cents = overage_price_cents
where overage_pass_install_cents = 0
  and overage_price_cents > 0;
-- Backfill subscription snapshots from existing legacy fields and/or plan.
update public.billing_subscriptions bs
set
  included_pass_installs = case
    when bs.included_pass_installs = 0 then coalesce(nullif(bs.included_passes, 0), bp.included_pass_installs, 0)
    else bs.included_pass_installs
  end,
  overage_pass_install_cents = case
    when bs.overage_pass_install_cents = 0 then coalesce(nullif(bs.overage_price_cents, 0), bp.overage_pass_install_cents, 0)
    else bs.overage_pass_install_cents
  end,
  included_notification_sends = coalesce(bs.included_notification_sends, 0),
  overage_notification_sent_cents = coalesce(bs.overage_notification_sent_cents, 0)
from public.billing_plans bp
where bp.id = bs.plan_id;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_plans_included_pass_installs_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_included_pass_installs_check
      check (included_pass_installs >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_plans_included_notification_sends_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_included_notification_sends_check
      check (included_notification_sends >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_plans_overage_pass_install_cents_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_overage_pass_install_cents_check
      check (overage_pass_install_cents >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_plans_overage_notification_sent_cents_check'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_overage_notification_sent_cents_check
      check (overage_notification_sent_cents >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_subscriptions_included_pass_installs_check'
  ) then
    alter table public.billing_subscriptions
      add constraint billing_subscriptions_included_pass_installs_check
      check (included_pass_installs >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_subscriptions_included_notification_sends_check'
  ) then
    alter table public.billing_subscriptions
      add constraint billing_subscriptions_included_notification_sends_check
      check (included_notification_sends >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_subscriptions_overage_pass_install_cents_check'
  ) then
    alter table public.billing_subscriptions
      add constraint billing_subscriptions_overage_pass_install_cents_check
      check (overage_pass_install_cents >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_subscriptions_overage_notification_sent_cents_check'
  ) then
    alter table public.billing_subscriptions
      add constraint billing_subscriptions_overage_notification_sent_cents_check
      check (overage_notification_sent_cents >= 0);
  end if;
end
$$;
-- ------------------------------------------------------------
-- B) Usage model and invoice item types
-- ------------------------------------------------------------
alter table public.billing_usage_events
  add column if not exists resource_type text,
  add column if not exists user_pass_id uuid,
  add column if not exists notification_job_id uuid;
alter table public.billing_usage_events
  alter column source set default 'manual';
update public.billing_usage_events
set resource_type = case
  when resource_type is not null then resource_type
  when source = 'notification_job_sent' then 'notification_sent'
  else 'pass_install'
end
where resource_type is null;
-- Remove legacy source naming from historical rows.
update public.billing_usage_events
set
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('legacy_source', source),
  source = 'manual'
where source = 'pass_issue';
-- Normalize legacy invoice item types before tightening check constraints.
update public.billing_invoice_items
set item_type = 'overage_pass_install'
where item_type = 'overage_pass';
alter table public.billing_usage_events
  alter column resource_type set not null;
do $$
declare
  c record;
begin
  -- Replace source check to include new sources.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.billing_usage_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source%'
  loop
    execute format('alter table public.billing_usage_events drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint where conname = 'billing_usage_events_source_check'
  ) then
    alter table public.billing_usage_events
      add constraint billing_usage_events_source_check
      check (
        source = any (
          array[
            'user_pass_install'::text,
            'notification_job_sent'::text,
            'manual'::text,
            'import'::text,
            'retroactive_reprocess'::text
          ]
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'billing_usage_events_resource_type_check'
  ) then
    alter table public.billing_usage_events
      add constraint billing_usage_events_resource_type_check
      check (resource_type = any (array['pass_install'::text, 'notification_sent'::text]));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'billing_usage_events_resource_ref_consistency_check'
  ) then
    alter table public.billing_usage_events
      add constraint billing_usage_events_resource_ref_consistency_check
      check (
        (resource_type = 'pass_install' and notification_job_id is null)
        or (resource_type = 'notification_sent' and user_pass_id is null)
      );
  end if;

  if to_regclass('public.user_passes') is not null and not exists (
    select 1 from pg_constraint where conname = 'billing_usage_events_user_pass_id_fkey'
  ) then
    alter table public.billing_usage_events
      add constraint billing_usage_events_user_pass_id_fkey
      foreign key (user_pass_id)
      references public.user_passes(id)
      on delete set null;
  end if;

  if to_regclass('public.notification_jobs') is not null and not exists (
    select 1 from pg_constraint where conname = 'billing_usage_events_notification_job_id_fkey'
  ) then
    alter table public.billing_usage_events
      add constraint billing_usage_events_notification_job_id_fkey
      foreign key (notification_job_id)
      references public.notification_jobs(id)
      on delete set null;
  end if;

  -- Replace item_type check with install/notification overage types.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.billing_invoice_items'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%item_type%'
  loop
    execute format('alter table public.billing_invoice_items drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint where conname = 'billing_invoice_items_item_type_check'
  ) then
    alter table public.billing_invoice_items
      add constraint billing_invoice_items_item_type_check
      check (
        item_type = any (
          array[
            'subscription_base'::text,
            'overage_pass_install'::text,
            'overage_notification_sent'::text,
            'credit_purchase'::text,
            'proration'::text,
            'retroactive_usage'::text,
            'adjustment'::text
          ]
        )
      );
  end if;
end
$$;
create index if not exists billing_usage_events_user_pass_idx
  on public.billing_usage_events(user_pass_id)
  where user_pass_id is not null;
create index if not exists billing_usage_events_notification_job_idx
  on public.billing_usage_events(notification_job_id)
  where notification_job_id is not null;
create index if not exists billing_usage_events_resource_type_occurred_idx
  on public.billing_usage_events(project_id, resource_type, occurred_at desc);
drop index if exists public.billing_usage_events_pass_issue_once_uidx;
create unique index if not exists billing_usage_events_user_pass_install_once_uidx
  on public.billing_usage_events(user_pass_id)
  where user_pass_id is not null
    and resource_type = 'pass_install'
    and event_type = 'issue';
create unique index if not exists billing_usage_events_notification_sent_once_uidx
  on public.billing_usage_events(notification_job_id)
  where notification_job_id is not null
    and resource_type = 'notification_sent'
    and event_type = 'issue';
-- ------------------------------------------------------------
-- C) Remove legacy passes trigger and add new usage triggers
-- ------------------------------------------------------------
drop trigger if exists trg_passes_log_billing_usage on public.passes;
drop function if exists public.trg_log_pass_issue_billing_usage();
create or replace function public.trg_log_user_pass_install_billing_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is null then
    return new;
  end if;

  if new.install_status is distinct from 'installed' then
    return new;
  end if;

  -- Count only the first time this row reaches installed.
  if tg_op = 'UPDATE' and old.install_status = 'installed' then
    return new;
  end if;

  insert into public.billing_usage_events (
    project_id,
    user_pass_id,
    resource_type,
    event_type,
    source,
    quantity,
    unit_amount_cents,
    is_billable,
    occurred_at,
    metadata
  )
  values (
    new.project_id,
    new.id,
    'pass_install',
    'issue',
    'user_pass_install',
    1,
    0,
    true,
    coalesce(new.installed_at, new.created_at, now()),
    jsonb_build_object(
      'origin', 'user_passes_trigger',
      'install_status', new.install_status
    )
  )
  on conflict do nothing;

  return new;
end;
$$;
create or replace function public.trg_log_notification_sent_billing_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.project_id is null then
    return new;
  end if;

  if new.status is distinct from 'sent' then
    return new;
  end if;

  -- Count only once per notification job.
  if tg_op = 'UPDATE' and old.status = 'sent' then
    return new;
  end if;

  insert into public.billing_usage_events (
    project_id,
    notification_job_id,
    resource_type,
    event_type,
    source,
    quantity,
    unit_amount_cents,
    is_billable,
    occurred_at,
    metadata
  )
  values (
    new.project_id,
    new.id,
    'notification_sent',
    'issue',
    'notification_job_sent',
    1,
    0,
    true,
    coalesce(new.sent_at, now()),
    jsonb_build_object(
      'origin', 'notification_jobs_trigger',
      'status', new.status
    )
  )
  on conflict do nothing;

  return new;
end;
$$;
drop trigger if exists trg_user_passes_log_billing_usage_on_install on public.user_passes;
create trigger trg_user_passes_log_billing_usage_on_install
after insert or update of install_status, installed_at
on public.user_passes
for each row execute function public.trg_log_user_pass_install_billing_usage();
drop trigger if exists trg_notification_jobs_log_billing_usage_on_sent on public.notification_jobs;
create trigger trg_notification_jobs_log_billing_usage_on_sent
after insert or update of status, sent_at
on public.notification_jobs
for each row execute function public.trg_log_notification_sent_billing_usage();
-- ------------------------------------------------------------
-- D) Plan change columns and proration snapshots
-- ------------------------------------------------------------
alter table public.billing_subscription_changes
  add column if not exists effective_mode text not null default 'immediate',
  add column if not exists allowance_proration_mode text not null default 'prorated_daily',
  add column if not exists cycle_started_at timestamptz,
  add column if not exists cycle_ends_at timestamptz,
  add column if not exists previous_included_pass_installs integer,
  add column if not exists new_included_pass_installs integer,
  add column if not exists previous_included_notification_sends integer,
  add column if not exists new_included_notification_sends integer,
  add column if not exists previous_overage_pass_install_cents integer,
  add column if not exists new_overage_pass_install_cents integer,
  add column if not exists previous_overage_notification_sent_cents integer,
  add column if not exists new_overage_notification_sent_cents integer,
  add column if not exists prorated_install_allowance numeric(14,4),
  add column if not exists prorated_notification_allowance numeric(14,4);
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'billing_subscription_changes_effective_mode_check'
  ) then
    alter table public.billing_subscription_changes
      add constraint billing_subscription_changes_effective_mode_check
      check (effective_mode = any (array['immediate'::text, 'next_cycle'::text]));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'billing_subscription_changes_allowance_proration_mode_check'
  ) then
    alter table public.billing_subscription_changes
      add constraint billing_subscription_changes_allowance_proration_mode_check
      check (allowance_proration_mode = any (array['prorated_daily'::text, 'none'::text]));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'billing_subscription_changes_cycle_window_check'
  ) then
    alter table public.billing_subscription_changes
      add constraint billing_subscription_changes_cycle_window_check
      check (cycle_ends_at is null or cycle_started_at is null or cycle_ends_at > cycle_started_at);
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

  return new;
end;
$$;
drop trigger if exists trg_billing_subscription_changes_enrich on public.billing_subscription_changes;
create trigger trg_billing_subscription_changes_enrich
before insert on public.billing_subscription_changes
for each row execute function public.trg_enrich_subscription_change_proration();
