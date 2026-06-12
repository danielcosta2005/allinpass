-- Force expire_trial_subscriptions() to evaluate the email enqueue CTE.
-- The previous definition computed email_count but only selected expired_count,
-- so PostgreSQL could prune the enqueue CTE before executing it.

create or replace function public.expire_trial_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_expired_count integer := 0;
  v_change_count integer := 0;
  v_enqueued_count integer := 0;
begin
  with newly_expired_rows as (
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
      bs.trial_ends_at,
      'newly_expired'::text as email_source
  ),
  recent_missing_email_rows as (
    select
      bs.id,
      bs.project_id,
      bs.billing_account_id,
      bs.plan_id,
      bs.trial_started_at,
      bs.trial_ends_at,
      'recent_missing_email_backfill'::text as email_source
    from public.billing_subscriptions bs
    join public.billing_plans bp
      on bp.id = bs.plan_id
     and bp.code = 'free_trial'
    where bs.status = 'expired'
      and bs.ended_at is not null
      and bs.ended_at >= v_now - interval '48 hours'
      and not exists (
        select 1
        from public.email_outbox eo
        where eo.event_type = 'trial_expired'
          and eo.subscription_id = bs.id
      )
  ),
  email_source_rows as (
    select * from newly_expired_rows
    union all
    select * from recent_missing_email_rows
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
    from newly_expired_rows e
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
    from email_source_rows e
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
      f.email_source,
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
      f.email_source,
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
        'email_source', r.email_source,
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
      (select count(*) from newly_expired_rows) as expired_count,
      (select count(*) from subscription_change_rows) as change_count,
      (select count(*) from email_enqueue_rows where email_outbox_id is not null) as email_count
  )
  select expired_count, change_count, email_count
    into v_expired_count, v_change_count, v_enqueued_count
  from output_counts;

  return v_expired_count;
end;
$$;
