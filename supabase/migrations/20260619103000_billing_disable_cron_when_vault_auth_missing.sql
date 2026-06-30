-- Operational guard: if the billing cron was scheduled before Vault auth was
-- installed, disable it to avoid unauthorized calls every 15 minutes.
-- In fresh environments this is a no-op because the previous migration creates
-- verify_billing_cron_secret before scheduling the job.

do $$
declare
  v_existing_job_id bigint;
begin
  if to_regprocedure('public.verify_billing_cron_secret(text)') is not null then
    return;
  end if;

  select jobid
    into v_existing_job_id
    from cron.job
   where jobname = 'billing-close-cycles'
   limit 1;

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;
end
$$;
