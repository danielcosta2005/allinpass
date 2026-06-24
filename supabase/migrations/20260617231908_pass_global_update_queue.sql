alter table public.passes
  add column if not exists wallet_revision integer not null default 1,
  add column if not exists wallet_updated_at timestamptz not null default now();

create table if not exists public.pass_update_campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  pass_id uuid not null,
  revision integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'partial_failed', 'failed', 'canceled')),
  reason text not null default 'global_pass_edit',
  total_jobs integer not null default 0 check (total_jobs >= 0),
  completed_jobs integer not null default 0 check (completed_jobs >= 0),
  failed_jobs integer not null default 0 check (failed_jobs >= 0),
  canceled_jobs integer not null default 0 check (canceled_jobs >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (pass_id, project_id)
    references public.passes(id, project_id)
    on delete cascade
);

create unique index if not exists pass_update_campaigns_pass_revision_key
  on public.pass_update_campaigns(pass_id, revision);

create index if not exists pass_update_campaigns_project_created_idx
  on public.pass_update_campaigns(project_id, created_at desc);

create index if not exists pass_update_campaigns_status_idx
  on public.pass_update_campaigns(status, created_at);

create table if not exists public.pass_update_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.pass_update_campaigns(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  pass_id uuid not null,
  user_pass_id uuid references public.user_passes(id) on delete cascade,
  platform text not null check (platform in ('apple', 'google')),
  job_type text not null check (job_type in ('apple_push', 'google_class_patch', 'google_object_patch')),
  target_token text,
  google_class_id text,
  data jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'canceled')),
  priority integer not null default 100,
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  last_error text,
  last_error_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (pass_id, project_id)
    references public.passes(id, project_id)
    on delete cascade,
  check (
    (job_type = 'apple_push' and target_token is not null)
    or (job_type = 'google_class_patch' and google_class_id is not null)
    or (job_type = 'google_object_patch' and target_token is not null)
  )
);

create unique index if not exists pass_update_jobs_project_idem_key
  on public.pass_update_jobs(project_id, idempotency_key);

create index if not exists pass_update_jobs_pick_idx
  on public.pass_update_jobs(status, available_at, priority, created_at);

create index if not exists pass_update_jobs_campaign_idx
  on public.pass_update_jobs(campaign_id, status, created_at);

create index if not exists pass_update_jobs_pass_idx
  on public.pass_update_jobs(pass_id, platform, job_type);

create or replace function public.claim_pass_update_jobs(
  p_limit integer,
  p_worker text,
  p_lock_timeout_minutes integer default 5
)
returns setof public.pass_update_jobs
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_lock_expired_before timestamptz := now() - (p_lock_timeout_minutes || ' minutes')::interval;
begin
  return query
  with cte as (
    select id
      from public.pass_update_jobs
     where (
       (status = 'pending' and available_at <= v_now)
       or (status = 'processing' and locked_at is not null and locked_at < v_lock_expired_before)
     )
     order by priority asc, created_at asc
     limit greatest(least(coalesce(p_limit, 25), 200), 1)
     for update skip locked
  )
  update public.pass_update_jobs j
     set status = 'processing',
         locked_at = v_now,
         locked_by = p_worker,
         updated_at = v_now
    from cte
   where j.id = cte.id
  returning j.*;
end;
$$;

create or replace function public.refresh_pass_update_campaign_status(
  p_campaign_id uuid
)
returns void
language plpgsql
as $$
declare
  v_total integer := 0;
  v_done integer := 0;
  v_failed integer := 0;
  v_canceled integer := 0;
  v_pending integer := 0;
  v_processing integer := 0;
  v_status text;
begin
  select
    count(*)::integer,
    count(*) filter (where status = 'done')::integer,
    count(*) filter (where status = 'failed')::integer,
    count(*) filter (where status = 'canceled')::integer,
    count(*) filter (where status = 'pending')::integer,
    count(*) filter (where status = 'processing')::integer
  into v_total, v_done, v_failed, v_canceled, v_pending, v_processing
  from public.pass_update_jobs
  where campaign_id = p_campaign_id;

  if v_total = 0 then
    v_status := 'completed';
  elsif v_pending > 0 or v_processing > 0 then
    v_status := 'processing';
  elsif v_done = v_total then
    v_status := 'completed';
  elsif v_done > 0 and (v_failed > 0 or v_canceled > 0) then
    v_status := 'partial_failed';
  elsif v_failed > 0 or v_canceled > 0 then
    v_status := 'failed';
  else
    v_status := 'processing';
  end if;

  update public.pass_update_campaigns
     set status = v_status,
         total_jobs = v_total,
         completed_jobs = v_done,
         failed_jobs = v_failed,
         canceled_jobs = v_canceled,
         completed_at = case
           when v_status in ('completed', 'partial_failed', 'failed') then coalesce(completed_at, now())
           else null
         end,
         updated_at = now()
   where id = p_campaign_id;
end;
$$;

drop trigger if exists trg_pass_update_campaigns_updated_at on public.pass_update_campaigns;
create trigger trg_pass_update_campaigns_updated_at
before update on public.pass_update_campaigns
for each row execute function public.set_updated_at();

drop trigger if exists trg_pass_update_jobs_updated_at on public.pass_update_jobs;
create trigger trg_pass_update_jobs_updated_at
before update on public.pass_update_jobs
for each row execute function public.set_updated_at();

alter table public.pass_update_campaigns enable row level security;
alter table public.pass_update_jobs enable row level security;

drop policy if exists pass_update_campaigns_select_project_staff on public.pass_update_campaigns;
create policy pass_update_campaigns_select_project_staff
on public.pass_update_campaigns
for select
to authenticated
using (
  public.can_manage_project(project_id)
  or public.is_project_staff(project_id)
);

drop policy if exists pass_update_jobs_select_project_staff on public.pass_update_jobs;
create policy pass_update_jobs_select_project_staff
on public.pass_update_jobs
for select
to authenticated
using (
  public.can_manage_project(project_id)
  or public.is_project_staff(project_id)
);

grant select on public.pass_update_campaigns to authenticated;
grant select on public.pass_update_jobs to authenticated;
grant all on public.pass_update_campaigns to service_role;
grant all on public.pass_update_jobs to service_role;

revoke all on function public.claim_pass_update_jobs(integer, text, integer) from public;
revoke all on function public.claim_pass_update_jobs(integer, text, integer) from anon;
revoke all on function public.claim_pass_update_jobs(integer, text, integer) from authenticated;
grant execute on function public.claim_pass_update_jobs(integer, text, integer) to service_role;

revoke all on function public.refresh_pass_update_campaign_status(uuid) from public;
revoke all on function public.refresh_pass_update_campaign_status(uuid) from anon;
revoke all on function public.refresh_pass_update_campaign_status(uuid) from authenticated;
grant execute on function public.refresh_pass_update_campaign_status(uuid) to service_role;

do $$
declare
  v_existing_job_id bigint;
begin
  select jobid
    into v_existing_job_id
    from cron.job
   where jobname = 'pass-updates-runner'
   limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'pass-updates-runner',
    '* * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/pass-updates-runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := jsonb_build_object(
        'source', 'cron',
        'limit', 50
      )
    );
    $cron$
  );
end
$$;
