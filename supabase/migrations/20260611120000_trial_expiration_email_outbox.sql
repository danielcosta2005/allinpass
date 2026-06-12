-- Operational email outbox and free-trial expiration notifications.

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (char_length(btrim(event_type)) > 0),
  project_id uuid references public.projects(id) on delete cascade,
  subscription_id uuid references public.billing_subscriptions(id) on delete cascade,
  to_email text not null check (position('@' in to_email) > 1),
  to_name text,
  subject text not null check (char_length(btrim(subject)) > 0),
  html_body text not null check (char_length(btrim(html_body)) > 0),
  text_body text not null check (char_length(btrim(text_body)) > 0),
  provider text not null default 'resend'
    check (provider in ('resend')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz default now(),
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  failed_at timestamptz,
  provider_message_id text,
  last_error text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idempotency_key),
  check (status <> 'sent' or sent_at is not null),
  check (status <> 'failed' or failed_at is not null)
);

create index if not exists email_outbox_status_next_attempt_idx
  on public.email_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'processing');

create index if not exists email_outbox_project_event_idx
  on public.email_outbox (project_id, event_type, created_at desc);

drop trigger if exists trg_email_outbox_updated_at on public.email_outbox;
create trigger trg_email_outbox_updated_at
before update on public.email_outbox
for each row execute function public.set_updated_at();

alter table public.email_outbox enable row level security;

revoke all on table public.email_outbox from public;
revoke all on table public.email_outbox from anon;
revoke all on table public.email_outbox from authenticated;
grant select, insert, update, delete on table public.email_outbox to service_role;

create or replace function public.enqueue_operational_email(
  p_event_type text,
  p_to_email text,
  p_subject text,
  p_html_body text,
  p_text_body text,
  p_idempotency_key text,
  p_project_id uuid default null,
  p_subscription_id uuid default null,
  p_to_name text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_provider text default 'resend',
  p_next_attempt_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_id uuid;
  v_event_type text := nullif(btrim(p_event_type), '');
  v_to_email text := lower(nullif(btrim(p_to_email), ''));
  v_subject text := nullif(btrim(p_subject), '');
  v_html_body text := nullif(btrim(p_html_body), '');
  v_text_body text := nullif(btrim(p_text_body), '');
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_provider text := lower(coalesce(nullif(btrim(p_provider), ''), 'resend'));
begin
  if v_event_type is null then
    raise exception 'Email event_type is required' using errcode = '23514';
  end if;

  if v_to_email is null or position('@' in v_to_email) <= 1 then
    raise exception 'Valid email recipient is required' using errcode = '23514';
  end if;

  if v_subject is null or v_html_body is null or v_text_body is null then
    raise exception 'Email subject, html_body and text_body are required' using errcode = '23514';
  end if;

  if v_idempotency_key is null then
    raise exception 'Email idempotency_key is required' using errcode = '23514';
  end if;

  insert into public.email_outbox (
    event_type,
    project_id,
    subscription_id,
    to_email,
    to_name,
    subject,
    html_body,
    text_body,
    provider,
    status,
    next_attempt_at,
    idempotency_key,
    metadata
  )
  values (
    v_event_type,
    p_project_id,
    p_subscription_id,
    v_to_email,
    nullif(btrim(p_to_name), ''),
    v_subject,
    v_html_body,
    v_text_body,
    v_provider,
    'pending',
    coalesce(p_next_attempt_at, now()),
    v_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_email_id;

  if v_email_id is null then
    select id
      into v_email_id
      from public.email_outbox
     where idempotency_key = v_idempotency_key
     limit 1;
  end if;

  return v_email_id;
end;
$$;

alter function public.enqueue_operational_email(
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  timestamptz
) owner to postgres;

revoke all on function public.enqueue_operational_email(
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  timestamptz
) from public;
revoke all on function public.enqueue_operational_email(
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  timestamptz
) from anon;
revoke all on function public.enqueue_operational_email(
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  timestamptz
) from authenticated;
grant execute on function public.enqueue_operational_email(
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  jsonb,
  text,
  timestamptz
) to service_role;

create or replace function public.claim_email_outbox_jobs(
  p_limit integer default 25,
  p_worker text default null,
  p_lock_timeout_minutes integer default 10
)
returns table (
  id uuid,
  event_type text,
  project_id uuid,
  subscription_id uuid,
  to_email text,
  to_name text,
  subject text,
  html_body text,
  text_body text,
  provider text,
  attempts integer,
  max_attempts integer,
  idempotency_key text,
  metadata jsonb
)
language sql
security definer
set search_path = public
as $$
  with stale_exhausted as (
    update public.email_outbox
       set status = 'failed',
           failed_at = coalesce(failed_at, now()),
           locked_at = null,
           locked_by = null,
           next_attempt_at = null,
           last_error = coalesce(last_error, 'Email dispatch abandoned after max attempts.'),
           updated_at = now()
     where status = 'processing'
       and attempts >= max_attempts
       and locked_at is not null
       and locked_at < now() - make_interval(mins => greatest(coalesce(p_lock_timeout_minutes, 10), 1))
    returning id
  ),
  candidate_jobs as (
    select eo.id
      from public.email_outbox eo
     where eo.status in ('pending', 'processing')
       and coalesce(eo.next_attempt_at, now()) <= now()
       and eo.attempts < eo.max_attempts
       and (
         eo.status = 'pending'
         or (
           eo.status = 'processing'
           and eo.locked_at is not null
           and eo.locked_at < now() - make_interval(mins => greatest(coalesce(p_lock_timeout_minutes, 10), 1))
         )
       )
     order by eo.next_attempt_at asc nulls first, eo.created_at asc
     limit greatest(least(coalesce(p_limit, 25), 100), 1)
     for update skip locked
  ),
  claimed as (
    update public.email_outbox eo
       set status = 'processing',
           attempts = eo.attempts + 1,
           locked_at = now(),
           locked_by = left(coalesce(nullif(btrim(p_worker), ''), 'send-email'), 120),
           updated_at = now()
      from candidate_jobs cj
     where eo.id = cj.id
    returning
      eo.id,
      eo.event_type,
      eo.project_id,
      eo.subscription_id,
      eo.to_email,
      eo.to_name,
      eo.subject,
      eo.html_body,
      eo.text_body,
      eo.provider,
      eo.attempts,
      eo.max_attempts,
      eo.idempotency_key,
      eo.metadata
  )
  select
    claimed.id,
    claimed.event_type,
    claimed.project_id,
    claimed.subscription_id,
    claimed.to_email,
    claimed.to_name,
    claimed.subject,
    claimed.html_body,
    claimed.text_body,
    claimed.provider,
    claimed.attempts,
    claimed.max_attempts,
    claimed.idempotency_key,
    claimed.metadata
  from claimed;
$$;

alter function public.claim_email_outbox_jobs(integer, text, integer)
  owner to postgres;

revoke all on function public.claim_email_outbox_jobs(integer, text, integer) from public;
revoke all on function public.claim_email_outbox_jobs(integer, text, integer) from anon;
revoke all on function public.claim_email_outbox_jobs(integer, text, integer) from authenticated;
grant execute on function public.claim_email_outbox_jobs(integer, text, integer) to service_role;

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
      bs.billing_account_id,
      bs.plan_id,
      bs.trial_started_at,
      bs.trial_ends_at
  ),
  subscription_change_rows as (
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
    from expired_rows e
    returning id
  ),
  free_trial_rows as (
    select
      e.*,
      coalesce(nullif(btrim(p.name), ''), 'seu projeto') as project_name,
      replace(
        replace(
          replace(
            replace(coalesce(nullif(btrim(p.name), ''), 'seu projeto'), '&', '&amp;'),
            '<',
            '&lt;'
          ),
          '>',
          '&gt;'
        ),
        '"',
        '&quot;'
      ) as project_name_html
    from expired_rows e
    join public.billing_plans bp
      on bp.id = e.plan_id
     and bp.code = 'free_trial'
    left join public.projects p
      on p.id = e.project_id
  ),
  owner_recipients as (
    select distinct on (f.id, lower(btrim(u.email)))
      f.id as subscription_id,
      f.project_id,
      f.trial_started_at,
      f.trial_ends_at,
      f.project_name,
      f.project_name_html,
      lower(btrim(u.email)) as to_email,
      nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name')), '') as to_name,
      'project_owner'::text as recipient_source
    from free_trial_rows f
    join public.project_members pm
      on pm.project_id = f.project_id
     and pm.role = 'owner'
    join auth.users u
      on u.id = pm.user_id
    where nullif(btrim(u.email), '') is not null
    order by f.id, lower(btrim(u.email)), pm.created_at asc
  ),
  fallback_recipients as (
    select distinct on (f.id, lower(btrim(ba.billing_email)))
      f.id as subscription_id,
      f.project_id,
      f.trial_started_at,
      f.trial_ends_at,
      f.project_name,
      f.project_name_html,
      lower(btrim(ba.billing_email)) as to_email,
      null::text as to_name,
      'billing_email'::text as recipient_source
    from free_trial_rows f
    join public.billing_accounts ba
      on ba.id = f.billing_account_id
     and ba.project_id = f.project_id
    where nullif(btrim(ba.billing_email), '') is not null
      and not exists (
        select 1
        from owner_recipients o
        where o.subscription_id = f.id
      )
    order by f.id, lower(btrim(ba.billing_email))
  ),
  email_recipients as (
    select * from owner_recipients
    union all
    select * from fallback_recipients
  ),
  email_enqueue_rows as (
    select public.enqueue_operational_email(
      p_event_type := 'trial_expired',
      p_project_id := r.project_id,
      p_subscription_id := r.subscription_id,
      p_to_email := r.to_email,
      p_to_name := r.to_name,
      p_subject := 'Seu free trial do AllinPass terminou',
      p_html_body := $email$
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>Seu free trial do AllinPass terminou</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f3ff;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Seu trial chegou ao fim. Escolha um plano pago para retomar a operacao do seu estabelecimento.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f3ff;margin:0;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e9d5ff;border-radius:24px;overflow:hidden;box-shadow:0 24px 70px rgba(79,70,229,0.14);">
            <tr>
              <td style="padding:0;background:#4f46e5;">
                <div style="background:linear-gradient(135deg,#9333EA 0%,#4F46E5 100%);padding:30px 32px 34px 32px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td style="vertical-align:middle;">
                        <div style="display:inline-block;width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.28);text-align:center;line-height:52px;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:0;">
                          AP
                        </div>
                      </td>
                      <td align="right" style="vertical-align:middle;color:#ede9fe;font-size:13px;font-weight:700;">
                        AllinPass
                      </td>
                    </tr>
                  </table>
                  <p style="margin:28px 0 10px 0;color:#ddd6fe;font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
                    Free trial encerrado
                  </p>
                  <h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.18;font-weight:800;letter-spacing:0;">
                    E hora de escolher o plano do seu estabelecimento
                  </h1>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 18px 0;color:#374151;font-size:16px;line-height:1.65;">
                  O free trial do projeto <strong style="color:#111827;">$email$ || r.project_name_html || $email$</strong> chegou ao fim.
                </p>
                <p style="margin:0 0 24px 0;color:#4b5563;font-size:15px;line-height:1.65;">
                  Seus dados, passes e historico continuam preservados. Para retomar a operacao normal do painel, acesse o AllinPass e escolha um plano pago.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;background:#faf5ff;border:1px solid #e9d5ff;border-radius:18px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <p style="margin:0 0 6px 0;color:#6d28d9;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;">
                        O que acontece agora
                      </p>
                      <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.6;">
                        O acesso operacional fica pausado ate a assinatura de um plano. O owner pode resolver isso em poucos minutos pelo painel.
                      </p>
                    </td>
                  </tr>
                </table>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px 0;">
                  <tr>
                    <td style="border-radius:14px;background:#4f46e5;background:linear-gradient(135deg,#9333EA 0%,#4F46E5 100%);">
                      <a href="{{app_org_url}}" style="display:inline-block;padding:15px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;border-radius:14px;">
                        Escolher plano
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;">
                  Se o botao nao funcionar, copie e cole este link no navegador:<br>
                  <a href="{{app_org_url}}" style="color:#4f46e5;text-decoration:underline;word-break:break-all;">{{app_org_url}}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px;background:#f8fafc;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">
                  Este aviso foi enviado porque o periodo gratuito do AllinPass terminou. Se voce ja assinou um plano, pode ignorar este email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
$email$,
      p_text_body := 'O free trial do projeto ' || r.project_name || ' chegou ao fim.'
        || E'\n\n'
        || 'Para continuar usando o AllinPass, acesse {{app_org_url}} e escolha um plano pago para retomar a operacao.',
      p_idempotency_key := 'trial_expired:' || r.subscription_id::text || ':' || md5(r.to_email),
      p_metadata := jsonb_build_object(
        'origin', 'trial_expiration_scheduler',
        'recipient_source', r.recipient_source,
        'project_name', r.project_name,
        'trial_started_at', r.trial_started_at,
        'trial_ends_at', r.trial_ends_at,
        'plan_code', 'free_trial'
      ),
      p_provider := 'resend',
      p_next_attempt_at := v_now
    ) as email_outbox_id
    from email_recipients r
  ),
  output_counts as (
    select
      (select count(*) from expired_rows) as expired_count,
      (select count(*) from subscription_change_rows) as change_count,
      (select count(*) from email_enqueue_rows where email_outbox_id is not null) as email_count
  )
  select expired_count
    into v_expired_count
  from output_counts;

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
   where jobname = 'email-dispatcher'
   limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'email-dispatcher',
    '*/5 * * * *',
    $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_dispatch_secret')
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
