delete from public.automations
where type = 'points_wallet';

alter table public.automations
drop constraint if exists automations_type_check;

alter table public.automations
add constraint automations_type_check
check (type = any (array['expiring_soon'::text, 'days_without_visit'::text]));

create or replace function public.enqueue_automation_notifications()
returns jsonb
language plpgsql
as $$
declare
  v_jobs_created integer := 0;
begin
  with eligible as (
    select
      a.id as automation_id,
      a.project_id,
      a.type,
      a.quantity,
      a.message,
      up.id as user_pass_id,
      up.install_platform,
      up.pass_token,
      up.expires_at,
      up.last_visit,
      up.metadata
    from public.automations a
    join public.user_passes up
      on up.project_id = a.project_id
    left join public.automation_dispatches ad
      on ad.automation_id = a.id
     and ad.user_pass_id = up.id
     and ad.reference_date = current_date
    where a.status = 'on'
      and up.removed_at is null
      and up.pass_token is not null
      and ad.id is null
      and (
        (
          a.type = 'days_without_visit'
          and up.last_visit is not null
          and (current_date - up.last_visit::date) = a.quantity
        )
        or
        (
          a.type = 'expiring_soon'
          and up.expires_at is not null
          and (up.expires_at::date - current_date) = a.quantity
        )
      )
  ),
  inserted_dispatches as (
    insert into public.automation_dispatches (
      automation_id,
      user_pass_id,
      reference_date
    )
    select
      e.automation_id,
      e.user_pass_id,
      current_date
    from eligible e
    on conflict (automation_id, user_pass_id, reference_date)
    do nothing
    returning automation_id, user_pass_id
  ),
  inserted_jobs as (
    insert into public.notification_jobs (
      project_id,
      notification_id,
      event_id,
      customer_id,
      user_pass_id,
      platform,
      notification_type,
      title,
      body,
      data,
      idempotency_key,
      status,
      priority,
      scheduled_for,
      available_at,
      attempts,
      max_attempts
    )
    select
      e.project_id,
      null,
      null,
      null,
      e.user_pass_id,
      e.install_platform as platform,
      'automation' as notification_type,
      case
        when e.type = 'days_without_visit' then 'Sentimos sua falta'
        when e.type = 'expiring_soon' then 'Seu passe esta prestes a expirar'
        else 'Notificacao automatica'
      end as title,
      e.message as body,
      jsonb_build_object(
        'source', 'automation',
        'automation_id', e.automation_id,
        'automation_type', e.type,
        'quantity', e.quantity,
        'pass_token', e.pass_token
      ) as data,
      'automation:' ||
        e.automation_id::text || ':' ||
        e.user_pass_id::text || ':' ||
        current_date::text as idempotency_key,
      'pending' as status,
      100 as priority,
      now() as scheduled_for,
      now() as available_at,
      0 as attempts,
      8 as max_attempts
    from eligible e
    join inserted_dispatches d
      on d.automation_id = e.automation_id
     and d.user_pass_id = e.user_pass_id
    on conflict (project_id, idempotency_key)
    do nothing
    returning id
  )
  select count(*)
  into v_jobs_created
  from inserted_jobs;

  return jsonb_build_object(
    'success', true,
    'jobs_created', v_jobs_created,
    'executed_at', now()
  );
end;
$$;

alter function public.enqueue_automation_notifications() owner to postgres;

revoke all on function public.enqueue_automation_notifications() from public;
revoke all on function public.enqueue_automation_notifications() from anon;
revoke all on function public.enqueue_automation_notifications() from authenticated;
grant execute on function public.enqueue_automation_notifications() to service_role;
