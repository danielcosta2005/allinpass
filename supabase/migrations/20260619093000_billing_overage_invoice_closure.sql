-- Overage cycle closure and collection through an editable Asaas subscription payment.
-- Internal invoices created by this flow represent usage overage only; the base
-- subscription charge remains owned by Asaas subscriptions.

alter table public.billing_invoices
  add column if not exists collection_batch_id uuid;

create table if not exists public.billing_invoice_collection_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
  billing_account_id uuid references public.billing_accounts(id) on delete set null,
  gateway_provider text not null default 'asaas'
    check (gateway_provider in ('asaas')),
  gateway_subscription_id text not null,
  gateway_charge_id text,
  gateway_charge_status text,
  collection_mode text not null default 'subscription_payment_adjustment'
    check (collection_mode in ('subscription_payment_adjustment')),
  status text not null default 'pending'
    check (status in ('pending', 'open', 'paid', 'past_due', 'failed', 'canceled', 'refunded')),
  invoice_count integer not null default 0 check (invoice_count >= 0),
  original_subscription_payment_cents integer not null default 0 check (original_subscription_payment_cents >= 0),
  overage_cents integer not null default 0 check (overage_cents >= 0),
  updated_payment_cents integer not null default 0 check (updated_payment_cents >= 0),
  currency text not null default 'BRL'
    check (char_length(currency) = 3 and currency = upper(currency)),
  due_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_invoices_collection_batch_id_fkey'
  ) then
    alter table public.billing_invoices
      add constraint billing_invoices_collection_batch_id_fkey
      foreign key (collection_batch_id)
      references public.billing_invoice_collection_batches(id)
      on delete set null;
  end if;
end
$$;

create index if not exists billing_invoices_collection_batch_idx
  on public.billing_invoices(collection_batch_id)
  where collection_batch_id is not null;

create unique index if not exists billing_invoices_overage_cycle_uidx
  on public.billing_invoices(billing_cycle_id)
  where billing_cycle_id is not null
    and status <> 'canceled'
    and (metadata ->> 'invoice_kind') = 'overage';

create index if not exists billing_invoices_draft_overage_collection_idx
  on public.billing_invoices(project_id, subscription_id, due_at)
  where status = 'draft'
    and collection_batch_id is null
    and (metadata ->> 'invoice_kind') = 'overage';

create unique index if not exists billing_invoice_collection_batches_gateway_charge_uidx
  on public.billing_invoice_collection_batches(gateway_provider, gateway_charge_id)
  where gateway_charge_id is not null
    and status in ('pending', 'open', 'paid', 'past_due');

create index if not exists billing_invoice_collection_batches_project_status_idx
  on public.billing_invoice_collection_batches(project_id, status, due_at);

drop trigger if exists trg_billing_invoice_collection_batches_updated_at
  on public.billing_invoice_collection_batches;
create trigger trg_billing_invoice_collection_batches_updated_at
before update on public.billing_invoice_collection_batches
for each row execute function public.set_updated_at();

alter table public.billing_invoice_collection_batches enable row level security;

drop policy if exists billing_invoice_collection_batches_member_select
  on public.billing_invoice_collection_batches;
create policy billing_invoice_collection_batches_member_select
on public.billing_invoice_collection_batches
for select
to authenticated
using ((select public.can_access_project(project_id)));

drop policy if exists billing_invoice_collection_batches_superadmin_write
  on public.billing_invoice_collection_batches;
create policy billing_invoice_collection_batches_superadmin_write
on public.billing_invoice_collection_batches
for all
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

grant select on table public.billing_invoice_collection_batches to authenticated;
grant select, insert, update, delete on table public.billing_invoice_collection_batches to service_role;

do $$
begin
  if not exists (
    select 1
      from vault.decrypted_secrets
     where name = 'cron_secret'
  ) then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Internal authorization secret for scheduled Edge Functions'
    );
  end if;
end
$$;

create or replace function public.verify_billing_cron_secret(
  p_token text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(length(trim(p_token)), 0) > 0
     and exists (
       select 1
         from vault.decrypted_secrets
        where name = 'cron_secret'
          and decrypted_secret = p_token
     );
$$;

alter function public.verify_billing_cron_secret(text)
  owner to postgres;

revoke all on function public.verify_billing_cron_secret(text) from public;
revoke all on function public.verify_billing_cron_secret(text) from anon;
revoke all on function public.verify_billing_cron_secret(text) from authenticated;
grant execute on function public.verify_billing_cron_secret(text) to service_role;

create or replace function public.refresh_billing_cycle_usage_summary_for_cycle(
  p_cycle_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.billing_cycles%rowtype;
  v_summary_id uuid;
  v_pass_install_quantity integer := 0;
  v_notification_sent_quantity integer := 0;
  v_last_usage_event_at timestamptz;
begin
  if p_cycle_id is null then
    raise exception 'Billing cycle id is required' using errcode = '23502';
  end if;

  select *
    into v_cycle
  from public.billing_cycles
  where id = p_cycle_id;

  if not found then
    raise exception 'Billing cycle % not found', p_cycle_id using errcode = 'P0002';
  end if;

  if v_cycle.subscription_id is null then
    raise exception 'Billing cycle % has no subscription', p_cycle_id using errcode = '23514';
  end if;

  update public.billing_usage_events bue
  set
    subscription_id = coalesce(bue.subscription_id, v_cycle.subscription_id),
    billing_cycle_id = coalesce(bue.billing_cycle_id, v_cycle.id)
  where bue.project_id = v_cycle.project_id
    and bue.occurred_at >= v_cycle.period_start
    and bue.occurred_at < v_cycle.period_end
    and bue.is_billable = true
    and bue.event_type = 'issue'
    and bue.resource_type in ('pass_install', 'notification_sent')
    and (bue.subscription_id is null or bue.subscription_id = v_cycle.subscription_id)
    and (bue.billing_cycle_id is null or bue.billing_cycle_id = v_cycle.id);

  select
    coalesce(sum(quantity) filter (where resource_type = 'pass_install'), 0)::integer,
    coalesce(sum(quantity) filter (where resource_type = 'notification_sent'), 0)::integer,
    max(occurred_at)
    into v_pass_install_quantity, v_notification_sent_quantity, v_last_usage_event_at
  from public.billing_usage_events bue
  where bue.project_id = v_cycle.project_id
    and bue.subscription_id = v_cycle.subscription_id
    and bue.occurred_at >= v_cycle.period_start
    and bue.occurred_at < v_cycle.period_end
    and bue.is_billable = true
    and bue.event_type = 'issue'
    and bue.resource_type in ('pass_install', 'notification_sent');

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
    v_cycle.project_id,
    v_cycle.subscription_id,
    v_cycle.id,
    v_cycle.period_start,
    v_cycle.period_end,
    greatest(coalesce(v_pass_install_quantity, 0), 0),
    greatest(coalesce(v_notification_sent_quantity, 0), 0),
    v_last_usage_event_at,
    jsonb_build_object('origin', 'billing_cycle_close_refresh')
  )
  on conflict (project_id, subscription_id, period_start, period_end) do update
  set
    billing_cycle_id = coalesce(public.billing_cycle_usage_summaries.billing_cycle_id, excluded.billing_cycle_id),
    pass_install_quantity = excluded.pass_install_quantity,
    notification_sent_quantity = excluded.notification_sent_quantity,
    last_usage_event_at = excluded.last_usage_event_at,
    metadata = coalesce(public.billing_cycle_usage_summaries.metadata, '{}'::jsonb)
      || jsonb_build_object('last_close_refresh_at', now())
  returning id into v_summary_id;

  perform public.recalculate_billing_cycle_usage_summary(v_summary_id);

  return v_summary_id;
end;
$$;

alter function public.refresh_billing_cycle_usage_summary_for_cycle(uuid)
  owner to postgres;

revoke all on function public.refresh_billing_cycle_usage_summary_for_cycle(uuid) from public;
grant execute on function public.refresh_billing_cycle_usage_summary_for_cycle(uuid) to service_role;

create or replace function public.close_billing_cycle_for_overage(
  p_cycle_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.billing_cycles%rowtype;
  v_subscription public.billing_subscriptions%rowtype;
  v_summary public.billing_cycle_usage_summaries%rowtype;
  v_summary_id uuid;
  v_existing_invoice_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_due_at timestamptz;
  v_next_period_start timestamptz;
  v_next_period_end timestamptz;
  v_next_cycle_id uuid;
  v_interval interval;
  v_applied_plan_changes integer := 0;
  v_plan_change record;
begin
  if p_cycle_id is null then
    raise exception 'Billing cycle id is required' using errcode = '23502';
  end if;

  select *
    into v_cycle
  from public.billing_cycles
  where id = p_cycle_id
  for update;

  if not found then
    raise exception 'Billing cycle % not found', p_cycle_id using errcode = 'P0002';
  end if;

  if v_cycle.status in ('closed', 'invoiced', 'paid') then
    select id
      into v_existing_invoice_id
    from public.billing_invoices
    where billing_cycle_id = v_cycle.id
      and status <> 'canceled'
      and (metadata ->> 'invoice_kind') = 'overage'
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'success', true,
      'already_closed', true,
      'billing_cycle_id', v_cycle.id,
      'invoice_id', v_existing_invoice_id,
      'status', v_cycle.status
    );
  end if;

  if v_cycle.status <> 'open' then
    raise exception 'Billing cycle % is not open', p_cycle_id using errcode = '23514';
  end if;

  if v_cycle.cycle_type <> 'subscription' or v_cycle.subscription_id is null then
    raise exception 'Billing cycle % is not a subscription cycle', p_cycle_id using errcode = '23514';
  end if;

  if v_cycle.period_end > now() then
    raise exception 'Billing cycle % is not due for closure', p_cycle_id using errcode = '23514';
  end if;

  select *
    into v_subscription
  from public.billing_subscriptions
  where id = v_cycle.subscription_id
    and project_id = v_cycle.project_id
  for update;

  if not found then
    raise exception 'Billing subscription % not found', v_cycle.subscription_id using errcode = 'P0002';
  end if;

  if v_subscription.status not in ('active', 'past_due', 'paused') then
    update public.billing_cycles
    set
      status = 'closed',
      closed_at = coalesce(closed_at, now()),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'close_reason', 'subscription_status_not_billable',
        'subscription_status', v_subscription.status
      )
    where id = v_cycle.id;

    return jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', 'subscription_status_not_billable',
      'billing_cycle_id', v_cycle.id,
      'subscription_status', v_subscription.status
    );
  end if;

  v_summary_id := public.refresh_billing_cycle_usage_summary_for_cycle(v_cycle.id);

  select *
    into v_summary
  from public.billing_cycle_usage_summaries
  where id = v_summary_id
  for update;

  select id
    into v_existing_invoice_id
  from public.billing_invoices
  where billing_cycle_id = v_cycle.id
    and status <> 'canceled'
    and (metadata ->> 'invoice_kind') = 'overage'
  order by created_at desc
  limit 1;

  v_due_at := v_cycle.period_end + interval '2 days';

  if v_existing_invoice_id is null and coalesce(v_summary.total_overage_cents, 0) > 0 then
    v_invoice_number := 'OVG-' || to_char(v_cycle.period_end at time zone 'UTC', 'YYYYMMDD')
      || '-' || left(replace(v_cycle.id::text, '-', ''), 10);

    insert into public.billing_invoices (
      project_id,
      subscription_id,
      billing_cycle_id,
      billing_account_id,
      invoice_number,
      gateway_provider,
      status,
      currency,
      subtotal_cents,
      amount_due_cents,
      issued_at,
      due_at,
      metadata
    )
    values (
      v_cycle.project_id,
      v_cycle.subscription_id,
      v_cycle.id,
      v_subscription.billing_account_id,
      v_invoice_number,
      'asaas',
      'draft',
      coalesce(v_subscription.currency, 'BRL'),
      v_summary.total_overage_cents,
      v_summary.total_overage_cents,
      now(),
      v_due_at,
      jsonb_build_object(
        'invoice_kind', 'overage',
        'source', 'close_billing_cycle_for_overage',
        'summary_id', v_summary.id,
        'period_start', v_cycle.period_start,
        'period_end', v_cycle.period_end,
        'collection_strategy', 'subscription_payment_adjustment',
        'collection_buffer_days', 2,
        'allow_standalone_charge', false,
        'allowance_source', v_summary.allowance_source
      )
    )
    returning id into v_invoice_id;

    if v_summary.pass_install_overage_quantity > 0
       and v_summary.pass_install_overage_cents > 0 then
      insert into public.billing_invoice_items (
        project_id,
        invoice_id,
        item_type,
        description,
        quantity,
        unit_amount_cents,
        period_start,
        period_end,
        metadata
      )
      values (
        v_cycle.project_id,
        v_invoice_id,
        'overage_pass_install',
        'Excedente de instalacoes de passes',
        v_summary.pass_install_overage_quantity,
        v_summary.overage_pass_install_cents,
        v_cycle.period_start,
        v_cycle.period_end,
        jsonb_build_object(
          'summary_id', v_summary.id,
          'included_quantity', v_summary.included_pass_installs,
          'usage_quantity', v_summary.pass_install_quantity
        )
      );
    end if;

    if v_summary.notification_sent_overage_quantity > 0
       and v_summary.notification_sent_overage_cents > 0 then
      insert into public.billing_invoice_items (
        project_id,
        invoice_id,
        item_type,
        description,
        quantity,
        unit_amount_cents,
        period_start,
        period_end,
        metadata
      )
      values (
        v_cycle.project_id,
        v_invoice_id,
        'overage_notification_sent',
        'Excedente de notificacoes enviadas',
        v_summary.notification_sent_overage_quantity,
        v_summary.overage_notification_sent_cents,
        v_cycle.period_start,
        v_cycle.period_end,
        jsonb_build_object(
          'summary_id', v_summary.id,
          'included_quantity', v_summary.included_notification_sends,
          'usage_quantity', v_summary.notification_sent_quantity
        )
      );
    end if;
  else
    v_invoice_id := v_existing_invoice_id;
  end if;

  update public.billing_cycles
  set
    status = case
      when coalesce(v_summary.total_overage_cents, 0) > 0 then 'invoiced'
      else 'closed'
    end,
    closed_at = coalesce(closed_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'closed_by', 'close_billing_cycle_for_overage',
      'closed_summary_id', v_summary.id,
      'overage_invoice_id', v_invoice_id,
      'total_overage_cents', coalesce(v_summary.total_overage_cents, 0)
    )
  where id = v_cycle.id;

  for v_plan_change in
    select
      bpcs.id,
      bpcs.requested_by,
      bpcs.provider_subscription_id,
      bpcs.provider_customer_id,
      bpcs.provider_payment_id
    from public.billing_plan_change_sessions bpcs
    where bpcs.subscription_id = v_cycle.subscription_id
      and bpcs.project_id = v_cycle.project_id
      and bpcs.status = 'paid'
      and bpcs.effective_mode = 'next_cycle'
    order by bpcs.created_at asc
  loop
    perform public.apply_billing_plan_change(
      v_plan_change.id,
      v_plan_change.requested_by,
      v_plan_change.provider_subscription_id,
      v_plan_change.provider_customer_id,
      v_plan_change.provider_payment_id
    );
    v_applied_plan_changes := v_applied_plan_changes + 1;
  end loop;

  select *
    into v_subscription
  from public.billing_subscriptions
  where id = v_cycle.subscription_id
  for update;

  v_interval := case v_cycle.frequency
    when 'weekly' then interval '1 week'
    when 'monthly' then interval '1 month'
    else greatest(v_cycle.period_end - v_cycle.period_start, interval '1 day')
  end;

  v_next_period_start := v_cycle.period_end;
  v_next_period_end := v_next_period_start + v_interval;

  update public.billing_subscriptions
  set
    current_period_start = v_next_period_start,
    current_period_end = v_next_period_end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'last_closed_billing_cycle_id', v_cycle.id,
      'last_closed_billing_cycle_at', now(),
      'next_collection_due_at', v_next_period_end + interval '2 days'
    )
  where id = v_cycle.subscription_id
    and status in ('active', 'past_due', 'paused');

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
  values (
    v_cycle.project_id,
    v_cycle.subscription_id,
    'subscription',
    v_cycle.frequency,
    v_next_period_start,
    v_next_period_end,
    'open',
    jsonb_build_object(
      'origin', 'close_billing_cycle_for_overage',
      'previous_cycle_id', v_cycle.id
    )
  )
  on conflict (project_id, cycle_type, period_start, period_end) do update
  set
    subscription_id = excluded.subscription_id,
    metadata = coalesce(public.billing_cycles.metadata, '{}'::jsonb)
      || jsonb_build_object('last_reopened_by', 'close_billing_cycle_for_overage')
  returning id into v_next_cycle_id;

  insert into public.billing_cycle_usage_summaries (
    project_id,
    subscription_id,
    billing_cycle_id,
    period_start,
    period_end,
    metadata
  )
  values (
    v_cycle.project_id,
    v_cycle.subscription_id,
    v_next_cycle_id,
    v_next_period_start,
    v_next_period_end,
    jsonb_build_object('origin', 'close_billing_cycle_for_overage_next_cycle')
  )
  on conflict (project_id, subscription_id, period_start, period_end) do nothing;

  return jsonb_build_object(
    'success', true,
    'already_closed', false,
    'billing_cycle_id', v_cycle.id,
    'summary_id', v_summary.id,
    'invoice_id', v_invoice_id,
    'total_overage_cents', coalesce(v_summary.total_overage_cents, 0),
    'applied_plan_changes', v_applied_plan_changes,
    'next_billing_cycle_id', v_next_cycle_id,
    'next_period_start', v_next_period_start,
    'next_period_end', v_next_period_end,
    'next_collection_due_at', v_next_period_end + interval '2 days'
  );
end;
$$;

alter function public.close_billing_cycle_for_overage(uuid)
  owner to postgres;

revoke all on function public.close_billing_cycle_for_overage(uuid) from public;
grant execute on function public.close_billing_cycle_for_overage(uuid) to service_role;

-- Downgrades are now applied as part of cycle closure, after the old cycle was
-- billed with its previous-plan allowance. The cron fallback below only applies
-- due changes once the matching cycle has already been closed/invoiced.
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
    from public.billing_plan_change_sessions due
    join public.billing_subscriptions bs
      on bs.id = due.subscription_id
     and bs.project_id = due.project_id
    left join public.billing_cycles bc
      on bc.subscription_id = bs.id
     and bc.project_id = bs.project_id
     and bc.cycle_type = 'subscription'
     and bc.period_start = bs.current_period_start
     and bc.period_end = bs.current_period_end
    where due.status = 'paid'
      and due.effective_mode = 'next_cycle'
      and bs.current_period_end is not null
      and bs.current_period_end <= now()
      and (bc.id is null or bc.status in ('closed', 'invoiced', 'paid', 'void'))
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
   where jobname = 'billing-close-cycles'
   limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'billing-close-cycles',
    '*/15 * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/billing-close-cycles',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := jsonb_build_object(
        'source', 'cron',
        'limit', 25
      )
    );
    $cron$
  );
end
$$;
