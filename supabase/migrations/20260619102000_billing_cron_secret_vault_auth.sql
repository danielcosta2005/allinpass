-- Secure billing-close-cycles cron auth with a dedicated Vault secret.
-- This migration is incremental because the initial closure migration may have
-- been applied before cron_secret existed in Vault.

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
