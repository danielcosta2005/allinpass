create table if not exists public.claim_preview_rate_limits (
  key_hash text primary key,
  ip_hash text not null,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  blocked_until timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists claim_preview_rate_limits_last_seen_idx
  on public.claim_preview_rate_limits (last_seen_at desc);

create index if not exists claim_preview_rate_limits_blocked_until_idx
  on public.claim_preview_rate_limits (blocked_until)
  where blocked_until is not null;

drop trigger if exists trg_claim_preview_rate_limits_updated_at
  on public.claim_preview_rate_limits;

create trigger trg_claim_preview_rate_limits_updated_at
before update on public.claim_preview_rate_limits
for each row execute function public.set_updated_at();

alter table public.claim_preview_rate_limits enable row level security;

revoke all on table public.claim_preview_rate_limits
from public, anon, authenticated;

grant all on table public.claim_preview_rate_limits
to service_role;

drop policy if exists claim_preview_rate_limits_service_role_only
  on public.claim_preview_rate_limits;

create policy claim_preview_rate_limits_service_role_only
on public.claim_preview_rate_limits
for all
to service_role
using (true)
with check (true);

create or replace function public.consume_claim_preview_rate_limit(
  p_key_hash text,
  p_ip_hash text,
  p_window_seconds integer default 600,
  p_max_attempts integer default 300,
  p_block_minutes integer default 20
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  attempts integer,
  blocked_until timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.claim_preview_rate_limits%rowtype;
  v_window_seconds integer := greatest(coalesce(p_window_seconds, 600), 30);
  v_max_attempts integer := greatest(coalesce(p_max_attempts, 300), 1);
  v_block_minutes integer := greatest(coalesce(p_block_minutes, 20), 1);
  v_inserted integer := 0;
  v_next_attempts integer;
  v_retry_seconds integer;
  v_new_blocked_until timestamptz;
begin
  if p_key_hash is null or p_key_hash = '' then
    raise exception 'p_key_hash is required';
  end if;

  if p_ip_hash is null or p_ip_hash = '' then
    raise exception 'p_ip_hash is required';
  end if;

  insert into public.claim_preview_rate_limits (
    key_hash,
    ip_hash,
    window_started_at,
    attempt_count,
    blocked_until,
    last_seen_at
  )
  values (
    p_key_hash,
    p_ip_hash,
    v_now,
    1,
    null,
    v_now
  )
  on conflict (key_hash) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    return query
    select true, 0, 1, null::timestamptz;
    return;
  end if;

  select *
  into v_row
  from public.claim_preview_rate_limits
  where key_hash = p_key_hash
  for update;

  if not found then
    raise exception 'claim_preview_rate_limit row was not available after insert';
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    v_retry_seconds := greatest(1, ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer);

    update public.claim_preview_rate_limits
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

    update public.claim_preview_rate_limits
    set
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

  update public.claim_preview_rate_limits
  set
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

revoke all on function public.consume_claim_preview_rate_limit(text, text, integer, integer, integer)
from public, anon, authenticated;

grant execute on function public.consume_claim_preview_rate_limit(text, text, integer, integer, integer)
to service_role;

update public.passes
set qr_url = split_part(qr_url, '?', 1)
where qr_url like '%/claim/%?description=%';
