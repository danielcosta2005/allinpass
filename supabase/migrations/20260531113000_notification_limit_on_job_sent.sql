-- Enforce notification quota only when delivery is effectively marked as sent.
-- Historical counters are preserved (no backfill).

create or replace function public.trg_notification_jobs_enforce_limit_on_sent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  if new.project_id is null then
    return new;
  end if;

  if new.status is distinct from 'sent' then
    return new;
  end if;

  -- Prevent double counting when a row that is already sent is updated again.
  if tg_op = 'UPDATE' and old.status = 'sent' then
    return new;
  end if;

  v_allowed := public.check_and_increment_notifications(new.project_id);

  if not coalesce(v_allowed, false) then
    new.status := 'canceled';
    new.sent_at := null;
    new.last_error := 'notifications_limit_reached';
    new.last_error_at := now();
  end if;

  return new;
end;
$$;

alter function public.trg_notification_jobs_enforce_limit_on_sent()
  owner to postgres;

drop trigger if exists trg_notification_jobs_enforce_limit_on_sent on public.notification_jobs;
create trigger trg_notification_jobs_enforce_limit_on_sent
before insert or update of status
on public.notification_jobs
for each row execute function public.trg_notification_jobs_enforce_limit_on_sent();
