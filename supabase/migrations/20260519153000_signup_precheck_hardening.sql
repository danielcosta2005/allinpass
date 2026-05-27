-- Hardening for signup-precheck:
-- 1) Persistent rate limit window by (ip,email) hash
-- 2) Helper RPC to consume attempts atomically

create table if not exists public.signup_precheck_rate_limits (
  key_hash text primary key,
  email_hash text not null,
  ip_hash text not null,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  blocked_until timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists signup_precheck_rate_limits_last_seen_idx
  on public.signup_precheck_rate_limits (last_seen_at desc);

create index if not exists signup_precheck_rate_limits_blocked_until_idx
  on public.signup_precheck_rate_limits (blocked_until)
  where blocked_until is not null;

drop trigger if exists trg_signup_precheck_rate_limits_updated_at on public.signup_precheck_rate_limits;
create trigger trg_signup_precheck_rate_limits_updated_at
before update on public.signup_precheck_rate_limits
for each row execute function public.set_updated_at();

alter table public.signup_precheck_rate_limits enable row level security;

drop policy if exists signup_precheck_rate_limits_service_role_only on public.signup_precheck_rate_limits;
create policy signup_precheck_rate_limits_service_role_only
on public.signup_precheck_rate_limits
for all
to service_role
using (true)
with check (true);

create or replace function public.consume_signup_precheck_rate_limit(
  p_key_hash text,
  p_email_hash text,
  p_ip_hash text,
  p_window_seconds integer default 600,
  p_max_attempts integer default 8,
  p_block_minutes integer default 20
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  attempts integer,
  blocked_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.signup_precheck_rate_limits%rowtype;
  v_window_seconds integer := greatest(coalesce(p_window_seconds, 600), 30);
  v_max_attempts integer := greatest(coalesce(p_max_attempts, 8), 1);
  v_block_minutes integer := greatest(coalesce(p_block_minutes, 20), 1);
  v_next_attempts integer;
  v_retry_seconds integer;
  v_new_blocked_until timestamptz;
begin
  if p_key_hash is null or p_key_hash = '' then
    raise exception 'p_key_hash is required';
  end if;

  select *
  into v_row
  from public.signup_precheck_rate_limits
  where key_hash = p_key_hash
  for update;

  if not found then
    insert into public.signup_precheck_rate_limits (
      key_hash,
      email_hash,
      ip_hash,
      window_started_at,
      attempt_count,
      blocked_until,
      last_seen_at
    )
    values (
      p_key_hash,
      p_email_hash,
      p_ip_hash,
      v_now,
      1,
      null,
      v_now
    );

    return query
    select true, 0, 1, null::timestamptz;
    return;
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    v_retry_seconds := greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);

    update public.signup_precheck_rate_limits
    set last_seen_at = v_now
    where key_hash = p_key_hash;

    return query
    select false, v_retry_seconds, v_row.attempt_count, v_row.blocked_until;
    return;
  end if;

  if v_row.window_started_at <= v_now - make_interval(secs => v_window_seconds) then
    v_next_attempts := 1;
  else
    v_next_attempts := v_row.attempt_count + 1;
  end if;

  if v_next_attempts > v_max_attempts then
    v_new_blocked_until := v_now + make_interval(mins => v_block_minutes);
    v_retry_seconds := ceil(extract(epoch from (v_new_blocked_until - v_now)))::integer;

    update public.signup_precheck_rate_limits
    set
      email_hash = p_email_hash,
      ip_hash = p_ip_hash,
      attempt_count = v_next_attempts,
      blocked_until = v_new_blocked_until,
      last_seen_at = v_now,
      window_started_at = case
        when v_row.window_started_at <= v_now - make_interval(secs => v_window_seconds) then v_now
        else v_row.window_started_at
      end
    where key_hash = p_key_hash;

    return query
    select false, v_retry_seconds, v_next_attempts, v_new_blocked_until;
    return;
  end if;

  update public.signup_precheck_rate_limits
  set
    email_hash = p_email_hash,
    ip_hash = p_ip_hash,
    attempt_count = v_next_attempts,
    blocked_until = null,
    last_seen_at = v_now,
    window_started_at = case
      when v_row.window_started_at <= v_now - make_interval(secs => v_window_seconds) then v_now
      else v_row.window_started_at
    end
  where key_hash = p_key_hash;

  return query
  select true, 0, v_next_attempts, null::timestamptz;
end;
$$;

grant execute on function public.consume_signup_precheck_rate_limit(text, text, text, integer, integer, integer)
to service_role;

