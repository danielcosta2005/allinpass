-- Keep customer-facing notifications on their current one-minute cadence.
-- The other workers do not require minute-level precision and are staggered
-- so they do not contend for Postgres/pg_net resources at the same instant.
do $$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
    from cron.job
   where jobname = 'automations-runner-every-minute'
   limit 1;

  if v_job_id is null then
    raise exception 'Missing required cron job: automations-runner-every-minute';
  end if;

  perform cron.alter_job(
    job_id := v_job_id,
    schedule := '2-59/15 * * * *'
  );

  select jobid
    into v_job_id
    from cron.job
   where jobname = 'email-dispatcher'
   limit 1;

  if v_job_id is null then
    raise exception 'Missing required cron job: email-dispatcher';
  end if;

  perform cron.alter_job(
    job_id := v_job_id,
    schedule := '1-59/5 * * * *'
  );

  select jobid
    into v_job_id
    from cron.job
   where jobname = 'pass-updates-runner'
   limit 1;

  if v_job_id is null then
    raise exception 'Missing required cron job: pass-updates-runner';
  end if;

  perform cron.alter_job(
    job_id := v_job_id,
    schedule := '3-59/5 * * * *'
  );
end
$$;

-- pg_cron keeps this execution history indefinitely. Retain seven days of
-- diagnostic data, then vacuum both technical-history tables during low use.
do $$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
    from cron.job
   where jobname = 'delete-cron-job-run-details-after-seven-days'
   limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'delete-cron-job-run-details-after-seven-days',
      '15 4 * * *',
      'delete from cron.job_run_details where end_time < now() - interval ''7 days'';'
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '15 4 * * *',
      command := 'delete from cron.job_run_details where end_time < now() - interval ''7 days'';',
      active := true
    );
  end if;

  select jobid
    into v_job_id
    from cron.job
   where jobname = 'vacuum-cron-job-run-details-daily'
   limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'vacuum-cron-job-run-details-daily',
      '30 4 * * *',
      'vacuum (analyze) cron.job_run_details;'
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '30 4 * * *',
      command := 'vacuum (analyze) cron.job_run_details;',
      active := true
    );
  end if;

  select jobid
    into v_job_id
    from cron.job
   where jobname = 'vacuum-pg-net-http-responses-daily'
   limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'vacuum-pg-net-http-responses-daily',
      '45 4 * * *',
      'vacuum (analyze) net._http_response;'
    );
  else
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '45 4 * * *',
      command := 'vacuum (analyze) net._http_response;',
      active := true
    );
  end if;
end
$$;
