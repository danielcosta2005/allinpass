-- Operational billing emails for usage thresholds, overage start, and delinquency status changes.

create or replace function public.billing_operational_email_recipients(
  p_project_id uuid,
  p_billing_account_id uuid default null
)
returns table (
  to_email text,
  to_name text,
  recipient_source text
)
language sql
stable
security definer
set search_path = public
as $$
  with owner_recipients as (
    select distinct on (lower(btrim(u.email)))
      lower(btrim(u.email)) as to_email,
      nullif(btrim(coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name')), '') as to_name,
      'project_owner'::text as recipient_source
    from public.project_members pm
    join auth.users u
      on u.id = pm.user_id
    where pm.project_id = p_project_id
      and pm.role = 'owner'
      and nullif(btrim(u.email), '') is not null
    order by lower(btrim(u.email)), pm.created_at asc
  ),
  fallback_recipients as (
    select distinct on (lower(btrim(ba.billing_email)))
      lower(btrim(ba.billing_email)) as to_email,
      null::text as to_name,
      'billing_email'::text as recipient_source
    from public.billing_accounts ba
    where ba.project_id = p_project_id
      and (p_billing_account_id is null or ba.id = p_billing_account_id)
      and nullif(btrim(ba.billing_email), '') is not null
      and not exists (select 1 from owner_recipients)
    order by lower(btrim(ba.billing_email)), ba.created_at asc
  )
  select owner_recipients.to_email, owner_recipients.to_name, owner_recipients.recipient_source
  from owner_recipients
  union all
  select fallback_recipients.to_email, fallback_recipients.to_name, fallback_recipients.recipient_source
  from fallback_recipients;
$$;

alter function public.billing_operational_email_recipients(uuid, uuid)
  owner to postgres;

revoke all on function public.billing_operational_email_recipients(uuid, uuid) from public;
revoke all on function public.billing_operational_email_recipients(uuid, uuid) from anon;
revoke all on function public.billing_operational_email_recipients(uuid, uuid) from authenticated;
grant execute on function public.billing_operational_email_recipients(uuid, uuid) to service_role;

create or replace function public.billing_email_escape_html(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select replace(
    replace(
      replace(
        replace(coalesce(p_value, ''), '&', '&amp;'),
        '<',
        '&lt;'
      ),
      '>',
      '&gt;'
    ),
    '"',
    '&quot;'
  );
$$;

alter function public.billing_email_escape_html(text)
  owner to postgres;

revoke all on function public.billing_email_escape_html(text) from public;
revoke all on function public.billing_email_escape_html(text) from anon;
revoke all on function public.billing_email_escape_html(text) from authenticated;
grant execute on function public.billing_email_escape_html(text) to service_role;

create or replace function public.enqueue_billing_usage_operational_email(
  p_summary_id uuid,
  p_resource_type text,
  p_event_type text,
  p_threshold integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary record;
  v_resource_type text := lower(nullif(btrim(p_resource_type), ''));
  v_event_type text := lower(nullif(btrim(p_event_type), ''));
  v_project_name text;
  v_project_name_html text;
  v_resource_label text;
  v_usage_quantity integer;
  v_included_quantity integer;
  v_overage_unit_cents integer;
  v_subject text;
  v_html_body text;
  v_text_body text;
begin
  if p_summary_id is null
     or v_resource_type is null
     or v_resource_type not in ('pass_install', 'notification_sent')
     or v_event_type is null
     or v_event_type not in ('billing_usage_threshold_reached', 'billing_usage_overage_started') then
    return;
  end if;

  if v_event_type = 'billing_usage_threshold_reached'
     and (p_threshold is null or p_threshold not in (50, 75, 90)) then
    return;
  end if;

  select
    s.id,
    s.project_id,
    s.subscription_id,
    s.period_start,
    s.period_end,
    s.pass_install_quantity,
    s.notification_sent_quantity,
    s.included_pass_installs,
    s.included_notification_sends,
    s.overage_pass_install_cents,
    s.overage_notification_sent_cents,
    bs.billing_account_id,
    coalesce(nullif(btrim(p.name), ''), 'seu projeto') as project_name
    into v_summary
  from public.billing_cycle_usage_summaries s
  left join public.billing_subscriptions bs
    on bs.id = s.subscription_id
  left join public.projects p
    on p.id = s.project_id
  where s.id = p_summary_id
  limit 1;

  if not found then
    return;
  end if;

  v_project_name := v_summary.project_name;
  v_project_name_html := public.billing_email_escape_html(v_project_name);

  if v_resource_type = 'pass_install' then
    v_resource_label := 'instalacoes de cartao';
    v_usage_quantity := greatest(coalesce(v_summary.pass_install_quantity, 0), 0);
    v_included_quantity := greatest(coalesce(v_summary.included_pass_installs, 0), 0);
    v_overage_unit_cents := greatest(coalesce(v_summary.overage_pass_install_cents, 0), 0);
  else
    v_resource_label := 'notificacoes enviadas';
    v_usage_quantity := greatest(coalesce(v_summary.notification_sent_quantity, 0), 0);
    v_included_quantity := greatest(coalesce(v_summary.included_notification_sends, 0), 0);
    v_overage_unit_cents := greatest(coalesce(v_summary.overage_notification_sent_cents, 0), 0);
  end if;

  if v_event_type = 'billing_usage_threshold_reached' then
    v_subject := 'AllinPass: ' || v_resource_label || ' atingiu ' || p_threshold::text || '% do plano';
    v_text_body := 'O projeto ' || v_project_name || ' atingiu ' || p_threshold::text || '% do limite mensal de '
      || v_resource_label || '. Uso atual: ' || v_usage_quantity::text || ' de '
      || v_included_quantity::text || '.';
    v_html_body := '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Arial,sans-serif;color:#111827;">'
      || '<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:28px;">'
      || '<p style="margin:0 0 8px 0;color:#4f46e5;font-size:13px;font-weight:800;text-transform:uppercase;">Uso do plano</p>'
      || '<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;color:#111827;">Seu uso chegou a ' || p_threshold::text || '%</h1>'
      || '<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">O projeto <strong>' || v_project_name_html || '</strong> atingiu '
      || p_threshold::text || '% do limite mensal de ' || public.billing_email_escape_html(v_resource_label) || '.</p>'
      || '<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">Uso atual: <strong>' || v_usage_quantity::text || '</strong> de <strong>'
      || v_included_quantity::text || '</strong>.</p>'
      || '</div></body></html>';
  else
    v_subject := 'AllinPass: excedente de ' || v_resource_label || ' iniciado';
    v_text_body := 'O projeto ' || v_project_name || ' ultrapassou o limite mensal de '
      || v_resource_label || ' e comecou a gerar excedente. Uso atual: '
      || v_usage_quantity::text || ' de ' || v_included_quantity::text || '.';
    v_html_body := '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Arial,sans-serif;color:#111827;">'
      || '<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #fecdd3;border-radius:18px;padding:28px;">'
      || '<p style="margin:0 0 8px 0;color:#be123c;font-size:13px;font-weight:800;text-transform:uppercase;">Excedente iniciado</p>'
      || '<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;color:#111827;">Seu uso passou do limite incluido</h1>'
      || '<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">O projeto <strong>' || v_project_name_html || '</strong> ultrapassou o limite mensal de '
      || public.billing_email_escape_html(v_resource_label) || '.</p>'
      || '<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">Uso atual: <strong>' || v_usage_quantity::text || '</strong> de <strong>'
      || v_included_quantity::text || '</strong>. Valor unitario de excedente: <strong>R$ '
      || to_char((v_overage_unit_cents::numeric / 100), 'FM999999990D00') || '</strong>.</p>'
      || '</div></body></html>';
  end if;

  perform public.enqueue_operational_email(
    p_event_type := v_event_type,
    p_project_id := v_summary.project_id,
    p_subscription_id := v_summary.subscription_id,
    p_to_email := r.to_email,
    p_to_name := r.to_name,
    p_subject := v_subject,
    p_html_body := v_html_body,
    p_text_body := v_text_body,
    p_idempotency_key := case
      when v_event_type = 'billing_usage_threshold_reached' then
        'billing_usage_threshold:' || p_summary_id::text || ':' || v_resource_type || ':' || p_threshold::text || ':' || md5(r.to_email)
      else
        'billing_usage_overage:' || p_summary_id::text || ':' || v_resource_type || ':' || md5(r.to_email)
    end,
    p_metadata := jsonb_build_object(
      'origin', 'billing_cycle_usage_summaries_trigger',
      'recipient_source', r.recipient_source,
      'summary_id', p_summary_id,
      'project_name', v_project_name,
      'resource_type', v_resource_type,
      'resource_label', v_resource_label,
      'threshold_percent', p_threshold,
      'usage_quantity', v_usage_quantity,
      'included_quantity', v_included_quantity,
      'overage_unit_cents', v_overage_unit_cents,
      'period_start', v_summary.period_start,
      'period_end', v_summary.period_end
    ),
    p_provider := 'resend',
    p_next_attempt_at := now()
  )
  from public.billing_operational_email_recipients(
    v_summary.project_id,
    v_summary.billing_account_id
  ) r;
end;
$$;

alter function public.enqueue_billing_usage_operational_email(uuid, text, text, integer)
  owner to postgres;

revoke all on function public.enqueue_billing_usage_operational_email(uuid, text, text, integer) from public;
revoke all on function public.enqueue_billing_usage_operational_email(uuid, text, text, integer) from anon;
revoke all on function public.enqueue_billing_usage_operational_email(uuid, text, text, integer) from authenticated;
grant execute on function public.enqueue_billing_usage_operational_email(uuid, text, text, integer) to service_role;

create or replace function public.trg_enqueue_billing_usage_operational_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thresholds integer[] := array[50, 75, 90];
  v_threshold integer;
  previous_quantity integer;
  current_quantity integer;
  included_quantity integer;
  previous_usage_percent numeric;
  current_usage_percent numeric;
begin
  if new.id is null then
    return new;
  end if;

  previous_quantity := case when tg_op = 'UPDATE' then greatest(coalesce(old.pass_install_quantity, 0), 0) else 0 end;
  current_quantity := greatest(coalesce(new.pass_install_quantity, 0), 0);
  included_quantity := greatest(coalesce(new.included_pass_installs, 0), 0);

  if included_quantity > 0 then
    previous_usage_percent := (previous_quantity::numeric * 100) / included_quantity::numeric;
    current_usage_percent := (current_quantity::numeric * 100) / included_quantity::numeric;

    foreach v_threshold in array v_thresholds loop
      if previous_usage_percent < v_threshold
         and current_usage_percent >= v_threshold then
        perform public.enqueue_billing_usage_operational_email(
          new.id,
          'pass_install',
          'billing_usage_threshold_reached',
          v_threshold
        );
      end if;
    end loop;
  end if;

  if previous_quantity <= included_quantity
     and current_quantity > included_quantity
     and greatest(coalesce(new.overage_pass_install_cents, 0), 0) > 0 then
    perform public.enqueue_billing_usage_operational_email(
      new.id,
      'pass_install',
      'billing_usage_overage_started',
      null
    );
  end if;

  previous_quantity := case when tg_op = 'UPDATE' then greatest(coalesce(old.notification_sent_quantity, 0), 0) else 0 end;
  current_quantity := greatest(coalesce(new.notification_sent_quantity, 0), 0);
  included_quantity := greatest(coalesce(new.included_notification_sends, 0), 0);

  if included_quantity > 0 then
    previous_usage_percent := (previous_quantity::numeric * 100) / included_quantity::numeric;
    current_usage_percent := (current_quantity::numeric * 100) / included_quantity::numeric;

    foreach v_threshold in array v_thresholds loop
      if previous_usage_percent < v_threshold
         and current_usage_percent >= v_threshold then
        perform public.enqueue_billing_usage_operational_email(
          new.id,
          'notification_sent',
          'billing_usage_threshold_reached',
          v_threshold
        );
      end if;
    end loop;
  end if;

  if previous_quantity <= included_quantity
     and current_quantity > included_quantity
     and greatest(coalesce(new.overage_notification_sent_cents, 0), 0) > 0 then
    perform public.enqueue_billing_usage_operational_email(
      new.id,
      'notification_sent',
      'billing_usage_overage_started',
      null
    );
  end if;

  return new;
end;
$$;

alter function public.trg_enqueue_billing_usage_operational_emails()
  owner to postgres;

drop trigger if exists trg_enqueue_billing_usage_operational_emails on public.billing_cycle_usage_summaries;
create trigger trg_enqueue_billing_usage_operational_emails
after insert or update of pass_install_quantity, notification_sent_quantity, included_pass_installs, included_notification_sends, overage_pass_install_cents, overage_notification_sent_cents
on public.billing_cycle_usage_summaries
for each row execute function public.trg_enqueue_billing_usage_operational_emails();

create or replace function public.enqueue_billing_subscription_status_operational_email(
  p_subscription_id uuid,
  p_event_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription record;
  v_event_type text := lower(nullif(btrim(p_event_type), ''));
  v_project_name text;
  v_project_name_html text;
  v_subject text;
  v_html_body text;
  v_text_body text;
  v_status_key text;
begin
  if p_subscription_id is null
     or v_event_type is null
     or v_event_type not in ('billing_subscription_past_due', 'billing_subscription_suspended') then
    return;
  end if;

  select
    bs.id,
    bs.project_id,
    bs.billing_account_id,
    bs.status,
    bs.grace_ends_at,
    bs.suspended_at,
    bs.delinquency_gateway_charge_id,
    coalesce(nullif(btrim(p.name), ''), 'seu projeto') as project_name
    into v_subscription
  from public.billing_subscriptions bs
  left join public.projects p
    on p.id = bs.project_id
  where bs.id = p_subscription_id
  limit 1;

  if not found then
    return;
  end if;

  v_project_name := v_subscription.project_name;
  v_project_name_html := public.billing_email_escape_html(v_project_name);

  if v_event_type = 'billing_subscription_past_due' then
    v_subject := 'AllinPass: pagamento pendente da sua assinatura';
    v_text_body := 'A assinatura do projeto ' || v_project_name || ' esta com pagamento pendente.'
      || E'\n\n'
      || 'O periodo de regularizacao e de 10 dias. Depois desse prazo, a conta sera suspensa se o pagamento nao for regularizado.'
      || case
        when v_subscription.grace_ends_at is not null then E'\n\nPrazo estimado: ' || to_char(v_subscription.grace_ends_at, 'DD/MM/YYYY HH24:MI TZ')
        else ''
      end
      || E'\n\nAcesse o painel para regularizar o pagamento.';
    v_html_body := '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Arial,sans-serif;color:#111827;">'
      || '<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #fcd34d;border-radius:18px;padding:28px;">'
      || '<p style="margin:0 0 8px 0;color:#b45309;font-size:13px;font-weight:800;text-transform:uppercase;">Pagamento pendente</p>'
      || '<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;color:#111827;">Regularize sua assinatura em ate 10 dias</h1>'
      || '<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">A assinatura do projeto <strong>' || v_project_name_html || '</strong> esta com pagamento pendente.</p>'
      || '<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">Depois do periodo de 10 dias, a conta sera suspensa se o pagamento nao for regularizado.</p>'
      || '</div></body></html>';
  else
    v_subject := 'AllinPass: sua conta foi suspensa';
    v_text_body := 'A conta do projeto ' || v_project_name || ' foi suspensa por pagamento pendente.'
      || E'\n\n'
      || 'Para reativar o acesso, regularize o pagamento no painel do AllinPass. Depois da confirmacao, a assinatura volta ao status ativo.';
    v_html_body := '<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Arial,sans-serif;color:#111827;">'
      || '<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #fecdd3;border-radius:18px;padding:28px;">'
      || '<p style="margin:0 0 8px 0;color:#be123c;font-size:13px;font-weight:800;text-transform:uppercase;">Conta suspensa</p>'
      || '<h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.25;color:#111827;">Sua conta foi suspensa</h1>'
      || '<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">A conta do projeto <strong>' || v_project_name_html || '</strong> foi suspensa por pagamento pendente.</p>'
      || '<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">Para reativar o acesso, regularize o pagamento no painel do AllinPass.</p>'
      || '</div></body></html>';
  end if;

  v_status_key := coalesce(
    nullif(v_subscription.delinquency_gateway_charge_id, ''),
    v_subscription.suspended_at::text,
    v_subscription.grace_ends_at::text,
    'none'
  );

  perform public.enqueue_operational_email(
    p_event_type := v_event_type,
    p_project_id := v_subscription.project_id,
    p_subscription_id := v_subscription.id,
    p_to_email := r.to_email,
    p_to_name := r.to_name,
    p_subject := v_subject,
    p_html_body := v_html_body,
    p_text_body := v_text_body,
    p_idempotency_key := 'billing_subscription_status:' || p_subscription_id::text || ':' || v_event_type || ':' || v_status_key || ':' || md5(r.to_email),
    p_metadata := jsonb_build_object(
      'origin', 'billing_subscriptions_trigger',
      'recipient_source', r.recipient_source,
      'project_name', v_project_name,
      'subscription_id', p_subscription_id,
      'event_type', v_event_type,
      'status', v_subscription.status,
      'grace_ends_at', v_subscription.grace_ends_at,
      'suspended_at', v_subscription.suspended_at,
      'delinquency_gateway_charge_id', v_subscription.delinquency_gateway_charge_id
    ),
    p_provider := 'resend',
    p_next_attempt_at := now()
  )
  from public.billing_operational_email_recipients(
    v_subscription.project_id,
    v_subscription.billing_account_id
  ) r;
end;
$$;

alter function public.enqueue_billing_subscription_status_operational_email(uuid, text)
  owner to postgres;

revoke all on function public.enqueue_billing_subscription_status_operational_email(uuid, text) from public;
revoke all on function public.enqueue_billing_subscription_status_operational_email(uuid, text) from anon;
revoke all on function public.enqueue_billing_subscription_status_operational_email(uuid, text) from authenticated;
grant execute on function public.enqueue_billing_subscription_status_operational_email(uuid, text) to service_role;

create or replace function public.trg_enqueue_billing_subscription_status_operational_emails()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
     and new.status = 'past_due' then
    perform public.enqueue_billing_subscription_status_operational_email(
      new.id,
      'billing_subscription_past_due'
    );
  elsif old.status is distinct from new.status
     and new.status = 'suspended' then
    perform public.enqueue_billing_subscription_status_operational_email(
      new.id,
      'billing_subscription_suspended'
    );
  end if;

  return new;
end;
$$;

alter function public.trg_enqueue_billing_subscription_status_operational_emails()
  owner to postgres;

drop trigger if exists trg_enqueue_billing_subscription_status_operational_emails on public.billing_subscriptions;
create trigger trg_enqueue_billing_subscription_status_operational_emails
after update of status, grace_ends_at, suspended_at, delinquency_gateway_charge_id
on public.billing_subscriptions
for each row execute function public.trg_enqueue_billing_subscription_status_operational_emails();
