-- Reagenda o dispatcher de emails operacionais para reduzir a latencia da outbox.

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
    '* * * * *',
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
