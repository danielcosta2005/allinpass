-- Promotional code schema/RPC substrate.
-- Fatia 1 for PRD prd-FREELA-2026-07-21 and ARCHITECTURE-SPINE AD-3..AD-14.

alter table public.affiliate_sellers
  add column if not exists phone text,
  add column if not exists email text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_sellers_email_normalized_check'
      and conrelid = 'public.affiliate_sellers'::regclass
  ) then
    alter table public.affiliate_sellers
      add constraint affiliate_sellers_email_normalized_check
      check (
        email is null
        or (
          email = lower(btrim(email))
          and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_sellers_phone_format_check'
      and conrelid = 'public.affiliate_sellers'::regclass
  ) then
    alter table public.affiliate_sellers
      add constraint affiliate_sellers_phone_format_check
      check (phone is null or phone ~ '^\+[0-9]{8,15}$');
  end if;
end
$$;

create unique index if not exists affiliate_sellers_lower_email_uidx
  on public.affiliate_sellers (lower(email))
  where email is not null;

create table if not exists public.billing_promotional_codes (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.affiliate_sellers(id) on delete restrict,
  affiliate_link_id uuid references public.affiliate_links(id) on delete restrict,
  code text not null,
  discount_bps integer not null,
  commission_bps integer not null default 0,
  duration text not null default 'first_month',
  max_uses integer,
  redeemed_uses integer not null default 0,
  valid_until timestamptz,
  status text not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_promotional_codes_code_not_blank
    check (length(btrim(code)) > 0),
  constraint billing_promotional_codes_code_format
    check (code = lower(btrim(code)) and code ~ '^[a-z0-9]{5,10}$'),
  constraint billing_promotional_codes_discount_bps_check
    check (discount_bps >= 1 and discount_bps <= 10000),
  constraint billing_promotional_codes_commission_bps_check
    check (commission_bps >= 0 and commission_bps <= 10000),
  constraint billing_promotional_codes_campaign_commission_check
    check (
      (
        seller_id is null
        and affiliate_link_id is null
        and commission_bps = 0
      )
      or (
        seller_id is not null
        and affiliate_link_id is not null
      )
    ),
  constraint billing_promotional_codes_duration_check
    check (duration = 'first_month'),
  constraint billing_promotional_codes_max_uses_check
    check (max_uses is null or max_uses > 0),
  constraint billing_promotional_codes_redeemed_uses_check
    check (
      redeemed_uses >= 0
      and (max_uses is null or redeemed_uses <= max_uses)
    ),
  constraint billing_promotional_codes_status_check
    check (status in ('active', 'inactive'))
);

create unique index if not exists billing_promotional_codes_lower_code_uidx
  on public.billing_promotional_codes (lower(code));

create unique index if not exists billing_promotional_codes_seller_uidx
  on public.billing_promotional_codes (seller_id)
  where seller_id is not null;

create unique index if not exists billing_promotional_codes_affiliate_link_uidx
  on public.billing_promotional_codes (affiliate_link_id)
  where affiliate_link_id is not null;

create index if not exists billing_promotional_codes_status_valid_until_idx
  on public.billing_promotional_codes (status, valid_until);

create table if not exists public.billing_promotional_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.billing_promotional_codes(id) on delete restrict,
  checkout_session_id uuid not null references public.signup_checkout_sessions(id) on delete cascade,
  code_snapshot text not null,
  seller_id_snapshot uuid references public.affiliate_sellers(id) on delete set null,
  affiliate_link_id_snapshot uuid references public.affiliate_links(id) on delete set null,
  discount_bps_snapshot integer not null,
  commission_bps_snapshot integer not null default 0,
  base_amount_cents integer not null,
  discount_cents integer not null,
  final_amount_cents integer not null,
  status text not null default 'reserved',
  reserved_at timestamptz not null default now(),
  redeemed_at timestamptz,
  released_at timestamptz,
  expires_at timestamptz,
  release_reason text,
  provider_payment_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_promotional_code_redemptions_code_snapshot_format
    check (code_snapshot ~ '^[a-z0-9]{5,10}$'),
  constraint billing_promotional_code_redemptions_discount_bps_check
    check (discount_bps_snapshot >= 1 and discount_bps_snapshot <= 10000),
  constraint billing_promotional_code_redemptions_commission_bps_check
    check (commission_bps_snapshot >= 0 and commission_bps_snapshot <= 10000),
  constraint billing_promotional_code_redemptions_amounts_check
    check (
      base_amount_cents >= 0
      and discount_cents >= 0
      and discount_cents <= base_amount_cents
      and final_amount_cents = base_amount_cents - discount_cents
    ),
  constraint billing_promotional_code_redemptions_status_check
    check (status in ('reserved', 'confirmed', 'released')),
  constraint billing_promotional_code_redemptions_status_timestamps_check
    check (
      (
        status = 'reserved'
        and redeemed_at is null
        and released_at is null
      )
      or (
        status = 'confirmed'
        and redeemed_at is not null
        and released_at is null
      )
      or (
        status = 'released'
        and redeemed_at is null
        and released_at is not null
      )
    )
);

create unique index if not exists billing_promotional_code_redemptions_checkout_uidx
  on public.billing_promotional_code_redemptions (checkout_session_id);

create index if not exists billing_promotional_code_redemptions_promo_status_idx
  on public.billing_promotional_code_redemptions (promo_code_id, status, expires_at);

create index if not exists billing_promotional_code_redemptions_provider_payment_idx
  on public.billing_promotional_code_redemptions (provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists billing_promotional_code_redemptions_provider_payment_uidx
  on public.billing_promotional_code_redemptions (provider_payment_id)
  where provider_payment_id is not null;

create table if not exists public.billing_promotional_code_migration_issues (
  id uuid primary key default gen_random_uuid(),
  affiliate_link_id uuid references public.affiliate_links(id) on delete set null,
  seller_id uuid references public.affiliate_sellers(id) on delete set null,
  code text,
  normalized_code text,
  issue_code text not null,
  issue_message text not null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint billing_promotional_code_migration_issues_issue_code_not_blank
    check (length(btrim(issue_code)) > 0),
  constraint billing_promotional_code_migration_issues_issue_message_not_blank
    check (length(btrim(issue_message)) > 0)
);

create unique index if not exists billing_promotional_code_migration_issues_link_issue_uidx
  on public.billing_promotional_code_migration_issues (affiliate_link_id, issue_code)
  where affiliate_link_id is not null
    and resolved_at is null;

create index if not exists billing_promotional_code_migration_issues_unresolved_idx
  on public.billing_promotional_code_migration_issues (created_at desc)
  where resolved_at is null;

create table if not exists public.payment_provider_requests (
  id uuid primary key default gen_random_uuid(),
  checkout_session_id uuid not null references public.signup_checkout_sessions(id) on delete cascade,
  operation text not null,
  provider text not null default 'asaas',
  external_reference text not null,
  request_hash text not null,
  status text not null default 'pending',
  provider_request_id text,
  provider_checkout_id text,
  provider_subscription_id text,
  provider_payment_id text,
  checkout_url text,
  response_metadata jsonb not null default '{}'::jsonb,
  last_error text,
  attempted_at timestamptz not null default now(),
  succeeded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_provider_requests_operation_not_blank
    check (length(btrim(operation)) > 0),
  constraint payment_provider_requests_provider_check
    check (provider in ('asaas')),
  constraint payment_provider_requests_external_reference_not_blank
    check (length(btrim(external_reference)) > 0),
  constraint payment_provider_requests_request_hash_not_blank
    check (length(btrim(request_hash)) > 0),
  constraint payment_provider_requests_status_check
    check (status in ('pending', 'succeeded', 'failed', 'ambiguous'))
);

create unique index if not exists payment_provider_requests_checkout_operation_uidx
  on public.payment_provider_requests (checkout_session_id, operation);

create unique index if not exists payment_provider_requests_provider_external_operation_uidx
  on public.payment_provider_requests (provider, external_reference, operation);

create index if not exists payment_provider_requests_status_idx
  on public.payment_provider_requests (status, attempted_at desc);

create table if not exists public.affiliate_commission_reversals (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.affiliate_commissions(id) on delete cascade,
  provider_event_id text not null,
  provider_payment_id text,
  reversal_cents integer not null,
  status text not null default 'pending_finance_review',
  reason text not null,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_commission_reversals_provider_event_id_not_blank
    check (length(btrim(provider_event_id)) > 0),
  constraint affiliate_commission_reversals_reversal_cents_check
    check (reversal_cents >= 0),
  constraint affiliate_commission_reversals_status_check
    check (status in ('pending_finance_review', 'reviewed', 'canceled')),
  constraint affiliate_commission_reversals_reason_not_blank
    check (length(btrim(reason)) > 0)
);

create unique index if not exists affiliate_commission_reversals_commission_event_uidx
  on public.affiliate_commission_reversals (commission_id, provider_event_id);

create index if not exists affiliate_commission_reversals_status_idx
  on public.affiliate_commission_reversals (status, created_at desc);

alter table public.signup_checkout_sessions
  add column if not exists promo_code_id uuid references public.billing_promotional_codes(id) on delete set null,
  add column if not exists promo_redemption_id uuid references public.billing_promotional_code_redemptions(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'signup_checkout_sessions_promo_pair_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_promo_pair_check
      check (
        (promo_code_id is null and promo_redemption_id is null)
        or (promo_code_id is not null and promo_redemption_id is not null)
      );
  end if;
end
$$;

create index if not exists signup_checkout_sessions_promo_code_idx
  on public.signup_checkout_sessions (promo_code_id)
  where promo_code_id is not null;

create unique index if not exists signup_checkout_sessions_promo_redemption_uidx
  on public.signup_checkout_sessions (promo_redemption_id)
  where promo_redemption_id is not null;

alter table public.affiliate_attributions
  add column if not exists promo_redemption_id uuid references public.billing_promotional_code_redemptions(id) on delete set null,
  add column if not exists promo_code_snapshot text,
  add column if not exists commission_bps_snapshot integer,
  add column if not exists seller_id_snapshot uuid references public.affiliate_sellers(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_attributions_promo_code_snapshot_format'
      and conrelid = 'public.affiliate_attributions'::regclass
  ) then
    alter table public.affiliate_attributions
      add constraint affiliate_attributions_promo_code_snapshot_format
      check (promo_code_snapshot is null or promo_code_snapshot ~ '^[a-z0-9]{5,10}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_attributions_commission_bps_snapshot_check'
      and conrelid = 'public.affiliate_attributions'::regclass
  ) then
    alter table public.affiliate_attributions
      add constraint affiliate_attributions_commission_bps_snapshot_check
      check (commission_bps_snapshot is null or (commission_bps_snapshot >= 0 and commission_bps_snapshot <= 10000));
  end if;
end
$$;

create unique index if not exists affiliate_attributions_promo_redemption_uidx
  on public.affiliate_attributions (promo_redemption_id)
  where promo_redemption_id is not null;

alter table public.billing_invoices
  add column if not exists checkout_session_id uuid references public.signup_checkout_sessions(id) on delete set null;

create unique index if not exists billing_invoices_first_month_checkout_uidx
  on public.billing_invoices (checkout_session_id)
  where checkout_session_id is not null
    and metadata ->> 'invoice_kind' = 'subscription_first_month';

create index if not exists billing_invoices_checkout_session_idx
  on public.billing_invoices (checkout_session_id)
  where checkout_session_id is not null;

create or replace function public.trg_guard_signup_checkout_promotional_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption_promo_code_id uuid;
begin
  if new.promo_code_id is null and new.promo_redemption_id is null then
    return new;
  end if;

  if new.promo_code_id is null or new.promo_redemption_id is null then
    raise exception 'promo_code_id and promo_redemption_id must be set together'
      using errcode = '23514';
  end if;

  select redemption.promo_code_id
  into v_redemption_promo_code_id
  from public.billing_promotional_code_redemptions redemption
  where redemption.id = new.promo_redemption_id
    and redemption.checkout_session_id = new.id;

  if v_redemption_promo_code_id is null then
    raise exception 'promo_redemption_id does not belong to this checkout session'
      using errcode = '23514';
  end if;

  if v_redemption_promo_code_id <> new.promo_code_id then
    raise exception 'promo_code_id does not match redemption promo_code_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.trg_guard_affiliate_commission_reversals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_commission_cents integer;
begin
  select commission.commission_cents
  into v_commission_cents
  from public.affiliate_commissions commission
  where commission.id = new.commission_id;

  if v_commission_cents is null then
    raise exception 'affiliate commission % not found', new.commission_id
      using errcode = '23503';
  end if;

  if new.reversal_cents > v_commission_cents then
    raise exception 'commission reversal exceeds original commission'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.trg_guard_billing_promotional_codes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link_seller_id uuid;
  v_link_code text;
begin
  if (new.seller_id is null) <> (new.affiliate_link_id is null) then
    raise exception 'seller_id and affiliate_link_id must both be null or both be present'
      using errcode = '23514';
  end if;

  if new.seller_id is null and new.commission_bps <> 0 then
    raise exception 'campaign promotional codes must have zero commission'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE'
    and (
      old.seller_id is distinct from new.seller_id
      or old.affiliate_link_id is distinct from new.affiliate_link_id
    )
    and exists (
      select 1
      from public.billing_promotional_code_redemptions redemption
      where redemption.promo_code_id = old.id
    )
  then
    raise exception 'promotional code seller/link identity cannot change after redemption'
      using errcode = '23514';
  end if;

  if new.affiliate_link_id is not null then
    select link.seller_id, lower(btrim(link.code))
    into v_link_seller_id, v_link_code
    from public.affiliate_links link
    where link.id = new.affiliate_link_id;

    if v_link_seller_id is null then
      raise exception 'affiliate link % not found', new.affiliate_link_id
        using errcode = '23503';
    end if;

    if v_link_seller_id <> new.seller_id then
      raise exception 'affiliate link seller does not match promotional code seller'
        using errcode = '23514';
    end if;

    if v_link_code is distinct from new.code then
      raise exception 'seller promotional code must mirror affiliate link code'
        using errcode = '23514';
    end if;
  elsif exists (
    select 1
    from public.affiliate_links link
    where lower(btrim(link.code)) = new.code
  ) then
    raise exception 'campaign promotional code collides with an affiliate link code'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_billing_promotional_codes_guard
  on public.billing_promotional_codes;
create trigger trg_billing_promotional_codes_guard
  before insert or update on public.billing_promotional_codes
  for each row
  execute function public.trg_guard_billing_promotional_codes();

drop trigger if exists trg_signup_checkout_sessions_promo_refs_guard
  on public.signup_checkout_sessions;
create trigger trg_signup_checkout_sessions_promo_refs_guard
  before insert or update of promo_code_id, promo_redemption_id on public.signup_checkout_sessions
  for each row
  execute function public.trg_guard_signup_checkout_promotional_refs();

drop trigger if exists trg_affiliate_commission_reversals_guard
  on public.affiliate_commission_reversals;
create trigger trg_affiliate_commission_reversals_guard
  before insert or update on public.affiliate_commission_reversals
  for each row
  execute function public.trg_guard_affiliate_commission_reversals();

drop trigger if exists trg_billing_promotional_codes_updated_at
  on public.billing_promotional_codes;
create trigger trg_billing_promotional_codes_updated_at
  before update on public.billing_promotional_codes
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_billing_promotional_code_redemptions_updated_at
  on public.billing_promotional_code_redemptions;
create trigger trg_billing_promotional_code_redemptions_updated_at
  before update on public.billing_promotional_code_redemptions
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_payment_provider_requests_updated_at
  on public.payment_provider_requests;
create trigger trg_payment_provider_requests_updated_at
  before update on public.payment_provider_requests
  for each row
  execute function public.set_updated_at();

drop trigger if exists trg_affiliate_commission_reversals_updated_at
  on public.affiliate_commission_reversals;
create trigger trg_affiliate_commission_reversals_updated_at
  before update on public.affiliate_commission_reversals
  for each row
  execute function public.set_updated_at();

alter table public.billing_promotional_codes enable row level security;
alter table public.billing_promotional_code_redemptions enable row level security;
alter table public.billing_promotional_code_migration_issues enable row level security;
alter table public.payment_provider_requests enable row level security;
alter table public.affiliate_commission_reversals enable row level security;

revoke all on table public.billing_promotional_codes from anon;
revoke all on table public.billing_promotional_codes from authenticated;
grant all on table public.billing_promotional_codes to service_role;

revoke update (promo_code_id, promo_redemption_id)
  on public.signup_checkout_sessions
  from anon, authenticated;

revoke all on table public.billing_promotional_code_redemptions from anon;
revoke all on table public.billing_promotional_code_redemptions from authenticated;
grant all on table public.billing_promotional_code_redemptions to service_role;

revoke all on table public.billing_promotional_code_migration_issues from anon;
revoke all on table public.billing_promotional_code_migration_issues from authenticated;
grant all on table public.billing_promotional_code_migration_issues to service_role;

revoke all on table public.payment_provider_requests from anon;
revoke all on table public.payment_provider_requests from authenticated;
grant all on table public.payment_provider_requests to service_role;

revoke all on table public.affiliate_commission_reversals from anon;
revoke all on table public.affiliate_commission_reversals from authenticated;
grant all on table public.affiliate_commission_reversals to service_role;

create or replace function public.resolve_public_promotional_code(p_code text)
returns table (
  valid boolean,
  code text,
  discount_bps integer,
  reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_coupon public.billing_promotional_codes%rowtype;
  v_usage_count integer;
begin
  if v_code !~ '^[a-z0-9]{5,10}$' then
    return query select false, null::text, 0, 'invalid_format';
    return;
  end if;

  select *
  into v_coupon
  from public.billing_promotional_codes promo
  where promo.code = v_code;

  if not found then
    return query select false, v_code, 0, 'not_found';
    return;
  end if;

  if v_coupon.status <> 'active' then
    return query select false, v_coupon.code, 0, 'inactive';
    return;
  end if;

  if v_coupon.valid_until is not null and v_coupon.valid_until <= now() then
    return query select false, v_coupon.code, 0, 'expired';
    return;
  end if;

  if v_coupon.max_uses is not null then
    select count(*)::integer
    into v_usage_count
    from public.billing_promotional_code_redemptions redemption
    where redemption.promo_code_id = v_coupon.id
      and (
        redemption.status = 'confirmed'
        or (
          redemption.status = 'reserved'
          and (redemption.expires_at is null or redemption.expires_at > now())
        )
      );

    if v_usage_count >= v_coupon.max_uses then
      return query select false, v_coupon.code, 0, 'exhausted';
      return;
    end if;
  end if;

  return query select true, v_coupon.code, v_coupon.discount_bps, null::text;
end;
$$;

create or replace function public.reserve_promotional_code(
  p_code text,
  p_checkout_session_id uuid,
  p_base_amount_cents integer,
  p_expires_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  success boolean,
  reason text,
  promo_code_id uuid,
  redemption_id uuid,
  code text,
  discount_bps integer,
  discount_cents integer,
  final_amount_cents integer,
  commission_bps integer,
  seller_id uuid,
  affiliate_link_id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_coupon public.billing_promotional_codes%rowtype;
  v_existing public.billing_promotional_code_redemptions%rowtype;
  v_redemption public.billing_promotional_code_redemptions%rowtype;
  v_checkout_expires_at timestamptz;
  v_effective_expires_at timestamptz;
  v_usage_count integer;
  v_discount_cents integer;
  v_final_amount_cents integer;
begin
  if p_checkout_session_id is null then
    return query select false, 'invalid_checkout_session', null::uuid, null::uuid, v_code, 0, 0, 0, 0, null::uuid, null::uuid, null::text;
    return;
  end if;

  if p_base_amount_cents is null or p_base_amount_cents < 0 then
    return query select false, 'invalid_amount', null::uuid, null::uuid, v_code, 0, 0, 0, 0, null::uuid, null::uuid, null::text;
    return;
  end if;

  select checkout.expires_at
  into v_checkout_expires_at
  from public.signup_checkout_sessions checkout
  where checkout.id = p_checkout_session_id
  for update;

  if not found then
    return query select false, 'checkout_not_found', null::uuid, null::uuid, v_code, 0, 0, 0, 0, null::uuid, null::uuid, null::text;
    return;
  end if;

  select *
  into v_existing
  from public.billing_promotional_code_redemptions redemption
  where redemption.checkout_session_id = p_checkout_session_id
  for update;

  if found then
    if v_existing.status = 'reserved'
      and v_existing.expires_at is not null
      and v_existing.expires_at <= now()
    then
      update public.billing_promotional_code_redemptions redemption
      set status = 'released',
          released_at = now(),
          release_reason = 'expired',
          metadata = coalesce(redemption.metadata, '{}'::jsonb)
            || jsonb_build_object('released_by', 'reserve_promotional_code_retry')
      where redemption.id = v_existing.id
      returning * into v_existing;

      update public.signup_checkout_sessions checkout
      set promo_code_id = null,
          promo_redemption_id = null,
          amount_cents = v_existing.base_amount_cents,
          affiliate_link_id = null,
          affiliate_seller_id = null,
          affiliate_code = null,
          affiliate_discount_bps = 0,
          affiliate_discount_cents = 0,
          affiliate_original_amount_cents = null,
          metadata = coalesce(checkout.metadata, '{}'::jsonb)
            || jsonb_build_object(
              'promo_release_reason', 'expired',
              'promo_released_redemption_id', v_existing.id
            )
      where checkout.id = p_checkout_session_id;

      return query
        select
          false,
          'expired',
          v_existing.promo_code_id,
          v_existing.id,
          v_existing.code_snapshot,
          v_existing.discount_bps_snapshot,
          v_existing.discount_cents,
          v_existing.final_amount_cents,
          v_existing.commission_bps_snapshot,
          v_existing.seller_id_snapshot,
          v_existing.affiliate_link_id_snapshot,
          v_existing.status;
      return;
    end if;

    if v_existing.code_snapshot <> v_code
      or v_existing.base_amount_cents <> p_base_amount_cents
    then
      return query
        select
          false,
          'conflict',
          v_existing.promo_code_id,
          v_existing.id,
          v_existing.code_snapshot,
          v_existing.discount_bps_snapshot,
          v_existing.discount_cents,
          v_existing.final_amount_cents,
          v_existing.commission_bps_snapshot,
          v_existing.seller_id_snapshot,
          v_existing.affiliate_link_id_snapshot,
          v_existing.status;
      return;
    end if;

    return query
      select
        v_existing.status in ('reserved', 'confirmed'),
        v_existing.status,
        v_existing.promo_code_id,
        v_existing.id,
        v_existing.code_snapshot,
        v_existing.discount_bps_snapshot,
        v_existing.discount_cents,
        v_existing.final_amount_cents,
        v_existing.commission_bps_snapshot,
        v_existing.seller_id_snapshot,
        v_existing.affiliate_link_id_snapshot,
        v_existing.status;
    return;
  end if;

  if v_code !~ '^[a-z0-9]{5,10}$' then
    return query select false, 'invalid_format', null::uuid, null::uuid, v_code, 0, 0, 0, 0, null::uuid, null::uuid, null::text;
    return;
  end if;

  select *
  into v_coupon
  from public.billing_promotional_codes promo
  where promo.code = v_code
  for update;

  if not found then
    return query select false, 'not_found', null::uuid, null::uuid, v_code, 0, 0, 0, 0, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_coupon.status <> 'active' then
    return query select false, 'inactive', v_coupon.id, null::uuid, v_coupon.code, v_coupon.discount_bps, 0, p_base_amount_cents, v_coupon.commission_bps, v_coupon.seller_id, v_coupon.affiliate_link_id, v_coupon.status;
    return;
  end if;

  if v_coupon.valid_until is not null and v_coupon.valid_until <= now() then
    return query select false, 'expired', v_coupon.id, null::uuid, v_coupon.code, v_coupon.discount_bps, 0, p_base_amount_cents, v_coupon.commission_bps, v_coupon.seller_id, v_coupon.affiliate_link_id, v_coupon.status;
    return;
  end if;

  if v_coupon.max_uses is not null then
    select count(*)::integer
    into v_usage_count
    from public.billing_promotional_code_redemptions redemption
    where redemption.promo_code_id = v_coupon.id
      and (
        redemption.status = 'confirmed'
        or (
          redemption.status = 'reserved'
          and (redemption.expires_at is null or redemption.expires_at > now())
        )
      );

    if v_usage_count >= v_coupon.max_uses then
      return query select false, 'exhausted', v_coupon.id, null::uuid, v_coupon.code, v_coupon.discount_bps, 0, p_base_amount_cents, v_coupon.commission_bps, v_coupon.seller_id, v_coupon.affiliate_link_id, v_coupon.status;
      return;
    end if;
  end if;

  if p_expires_at is not null and v_checkout_expires_at is not null then
    v_effective_expires_at := least(p_expires_at, v_checkout_expires_at);
  else
    v_effective_expires_at := coalesce(p_expires_at, v_checkout_expires_at);
  end if;

  if v_effective_expires_at is null or v_effective_expires_at <= now() then
    return query select false, 'invalid_expiration', v_coupon.id, null::uuid, v_coupon.code, v_coupon.discount_bps, 0, p_base_amount_cents, v_coupon.commission_bps, v_coupon.seller_id, v_coupon.affiliate_link_id, v_coupon.status;
    return;
  end if;

  v_discount_cents := floor((p_base_amount_cents::numeric * v_coupon.discount_bps::numeric) / 10000)::integer;
  v_final_amount_cents := p_base_amount_cents - v_discount_cents;

  insert into public.billing_promotional_code_redemptions (
    promo_code_id,
    checkout_session_id,
    code_snapshot,
    seller_id_snapshot,
    affiliate_link_id_snapshot,
    discount_bps_snapshot,
    commission_bps_snapshot,
    base_amount_cents,
    discount_cents,
    final_amount_cents,
    status,
    reserved_at,
    expires_at,
    metadata
  )
  values (
    v_coupon.id,
    p_checkout_session_id,
    v_coupon.code,
    v_coupon.seller_id,
    v_coupon.affiliate_link_id,
    v_coupon.discount_bps,
    v_coupon.commission_bps,
    p_base_amount_cents,
    v_discount_cents,
    v_final_amount_cents,
    'reserved',
    now(),
    v_effective_expires_at,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_redemption;

  update public.signup_checkout_sessions checkout
  set promo_code_id = v_coupon.id,
      promo_redemption_id = v_redemption.id,
      amount_cents = v_final_amount_cents,
      affiliate_link_id = case when v_coupon.seller_id is not null then v_coupon.affiliate_link_id else null end,
      affiliate_seller_id = case when v_coupon.seller_id is not null then v_coupon.seller_id else null end,
      affiliate_code = case when v_coupon.seller_id is not null then v_coupon.code else null end,
      affiliate_discount_bps = case when v_coupon.seller_id is not null then v_coupon.discount_bps else 0 end,
      affiliate_discount_cents = case when v_coupon.seller_id is not null then v_discount_cents else 0 end,
      affiliate_original_amount_cents = case when v_coupon.seller_id is not null then p_base_amount_cents else null end,
      metadata = coalesce(checkout.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'promo_code', v_coupon.code,
          'promo_redemption_id', v_redemption.id,
          'promo_discount_cents', v_discount_cents,
          'promo_base_amount_cents', p_base_amount_cents
        )
  where checkout.id = p_checkout_session_id;

  return query
    select
      true,
      'reserved',
      v_coupon.id,
      v_redemption.id,
      v_coupon.code,
      v_coupon.discount_bps,
      v_discount_cents,
      v_final_amount_cents,
      v_coupon.commission_bps,
      v_coupon.seller_id,
      v_coupon.affiliate_link_id,
      'reserved';
end;
$$;

create or replace function public.confirm_promotional_code_redemption(
  p_checkout_session_id uuid,
  p_provider_payment_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  success boolean,
  reason text,
  redemption_id uuid,
  promo_code_id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption public.billing_promotional_code_redemptions%rowtype;
  v_coupon public.billing_promotional_codes%rowtype;
  v_confirmed_count integer;
begin
  if nullif(btrim(coalesce(p_provider_payment_id, '')), '') is null then
    return query select false, 'invalid_provider_payment', null::uuid, null::uuid, null::text;
    return;
  end if;

  select *
  into v_redemption
  from public.billing_promotional_code_redemptions redemption
  where redemption.checkout_session_id = p_checkout_session_id
  for update;

  if not found then
    return query select false, 'not_found', null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_redemption.status = 'confirmed' then
    return query select true, 'already_confirmed', v_redemption.id, v_redemption.promo_code_id, v_redemption.status;
    return;
  end if;

  if v_redemption.status = 'released' then
    return query select false, 'released', v_redemption.id, v_redemption.promo_code_id, v_redemption.status;
    return;
  end if;

  select *
  into v_coupon
  from public.billing_promotional_codes promo
  where promo.id = v_redemption.promo_code_id
  for update;

  if not found then
    return query select false, 'promo_not_found', v_redemption.id, v_redemption.promo_code_id, v_redemption.status;
    return;
  end if;

  select count(*)::integer
  into v_confirmed_count
  from public.billing_promotional_code_redemptions confirmed_redemption
  where confirmed_redemption.promo_code_id = v_coupon.id
    and confirmed_redemption.status = 'confirmed';

  if v_coupon.max_uses is not null and v_confirmed_count >= v_coupon.max_uses then
    return query select false, 'exhausted', v_redemption.id, v_redemption.promo_code_id, v_redemption.status;
    return;
  end if;

  update public.billing_promotional_code_redemptions redemption
  set status = 'confirmed',
      redeemed_at = now(),
      provider_payment_id = coalesce(p_provider_payment_id, redemption.provider_payment_id),
      metadata = coalesce(redemption.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
  where redemption.id = v_redemption.id
  returning * into v_redemption;

  update public.billing_promotional_codes promo
  set redeemed_uses = (
    select count(*)::integer
    from public.billing_promotional_code_redemptions confirmed_redemption
    where confirmed_redemption.promo_code_id = promo.id
      and confirmed_redemption.status = 'confirmed'
  )
  where promo.id = v_redemption.promo_code_id;

  return query select true, 'confirmed', v_redemption.id, v_redemption.promo_code_id, v_redemption.status;
end;
$$;

create or replace function public.release_promotional_code_redemption(
  p_checkout_session_id uuid,
  p_reason text default 'manual',
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  success boolean,
  reason text,
  redemption_id uuid,
  promo_code_id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption public.billing_promotional_code_redemptions%rowtype;
begin
  select *
  into v_redemption
  from public.billing_promotional_code_redemptions redemption
  where redemption.checkout_session_id = p_checkout_session_id
  for update;

  if not found then
    return query select true, 'not_found', null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_redemption.status = 'confirmed' then
    return query select true, 'already_confirmed', v_redemption.id, v_redemption.promo_code_id, v_redemption.status;
    return;
  end if;

  if v_redemption.status = 'released' then
    return query select true, 'already_released', v_redemption.id, v_redemption.promo_code_id, v_redemption.status;
    return;
  end if;

  update public.billing_promotional_code_redemptions redemption
  set status = 'released',
      released_at = now(),
      release_reason = coalesce(nullif(btrim(p_reason), ''), 'manual'),
      metadata = coalesce(redemption.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
  where redemption.id = v_redemption.id
  returning * into v_redemption;

  update public.signup_checkout_sessions checkout
  set promo_code_id = null,
      promo_redemption_id = null,
      amount_cents = v_redemption.base_amount_cents,
      affiliate_link_id = null,
      affiliate_seller_id = null,
      affiliate_code = null,
      affiliate_discount_bps = 0,
      affiliate_discount_cents = 0,
      affiliate_original_amount_cents = null,
      metadata = coalesce(checkout.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'promo_release_reason', v_redemption.release_reason,
          'promo_released_redemption_id', v_redemption.id
        )
  where checkout.id = p_checkout_session_id;

  return query select true, 'released', v_redemption.id, v_redemption.promo_code_id, v_redemption.status;
end;
$$;

revoke execute on function public.resolve_public_promotional_code(text) from public, anon, authenticated;
grant execute on function public.resolve_public_promotional_code(text) to service_role;

revoke execute on function public.reserve_promotional_code(text, uuid, integer, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_promotional_code(text, uuid, integer, timestamptz, jsonb) to service_role;

revoke execute on function public.confirm_promotional_code_redemption(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_promotional_code_redemption(uuid, text, jsonb) to service_role;

revoke execute on function public.release_promotional_code_redemption(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.release_promotional_code_redemption(uuid, text, jsonb) to service_role;

with legacy_links as (
  select
    link.id as affiliate_link_id,
    link.seller_id,
    link.code,
    lower(btrim(link.code)) as normalized_code,
    link.status as link_status,
    seller.status as seller_status,
    count(*) over (partition by lower(btrim(link.code))) as normalized_code_count
  from public.affiliate_links link
  join public.affiliate_sellers seller
    on seller.id = link.seller_id
)
insert into public.billing_promotional_code_migration_issues (
  affiliate_link_id,
  seller_id,
  code,
  normalized_code,
  issue_code,
  issue_message,
  metadata
)
select
  legacy_links.affiliate_link_id,
  legacy_links.seller_id,
  legacy_links.code,
  legacy_links.normalized_code,
  case
    when legacy_links.normalized_code is null
      or legacy_links.normalized_code !~ '^[a-z0-9]{5,10}$' then 'invalid_code_format'
    else 'duplicate_legacy_code'
  end,
  case
    when legacy_links.normalized_code is null
      or legacy_links.normalized_code !~ '^[a-z0-9]{5,10}$'
      then 'Legacy affiliate link code does not match ^[a-z0-9]{5,10}$ and was not backfilled.'
    else 'Legacy affiliate link code collides case-insensitively and was not backfilled.'
  end,
  jsonb_build_object(
    'source', '20260721173935_promotional_codes_schema_rpcs',
    'link_status', legacy_links.link_status,
    'seller_status', legacy_links.seller_status
  )
from legacy_links
where legacy_links.normalized_code is null
   or legacy_links.normalized_code !~ '^[a-z0-9]{5,10}$'
   or legacy_links.normalized_code_count > 1
on conflict do nothing;

with valid_legacy_links as (
  select
    link.id as affiliate_link_id,
    link.seller_id,
    link.code,
    lower(btrim(link.code)) as normalized_code,
    link.status as link_status,
    seller.status as seller_status,
    count(*) over (partition by lower(btrim(link.code))) as normalized_code_count
  from public.affiliate_links link
  join public.affiliate_sellers seller
    on seller.id = link.seller_id
),
conflicting_legacy_links as (
  select
    valid_legacy_links.*,
    case
      when exists (
        select 1
        from public.billing_promotional_codes promo
        where promo.code = valid_legacy_links.normalized_code
          and promo.affiliate_link_id is distinct from valid_legacy_links.affiliate_link_id
      ) then 'existing_code_conflict'
      when exists (
        select 1
        from public.billing_promotional_codes promo
        where promo.seller_id = valid_legacy_links.seller_id
          and promo.affiliate_link_id is distinct from valid_legacy_links.affiliate_link_id
      ) then 'existing_seller_conflict'
      when exists (
        select 1
        from public.billing_promotional_codes promo
        where promo.affiliate_link_id = valid_legacy_links.affiliate_link_id
          and promo.code is distinct from valid_legacy_links.normalized_code
      ) then 'existing_link_conflict'
    end as issue_code
  from valid_legacy_links
  where valid_legacy_links.normalized_code ~ '^[a-z0-9]{5,10}$'
    and valid_legacy_links.normalized_code_count = 1
)
insert into public.billing_promotional_code_migration_issues (
  affiliate_link_id,
  seller_id,
  code,
  normalized_code,
  issue_code,
  issue_message,
  metadata
)
select
  conflicting_legacy_links.affiliate_link_id,
  conflicting_legacy_links.seller_id,
  conflicting_legacy_links.code,
  conflicting_legacy_links.normalized_code,
  conflicting_legacy_links.issue_code,
  'Legacy affiliate link matched an existing promotional code uniqueness boundary and was not backfilled.',
  jsonb_build_object(
    'source', '20260721173935_promotional_codes_schema_rpcs',
    'link_status', conflicting_legacy_links.link_status,
    'seller_status', conflicting_legacy_links.seller_status
  )
from conflicting_legacy_links
where conflicting_legacy_links.issue_code is not null
on conflict do nothing;

with valid_legacy_links as (
  select
    link.id as affiliate_link_id,
    link.seller_id,
    lower(btrim(link.code)) as normalized_code,
    link.status as link_status,
    seller.status as seller_status,
    count(*) over (partition by lower(btrim(link.code))) as normalized_code_count
  from public.affiliate_links link
  join public.affiliate_sellers seller
    on seller.id = link.seller_id
)
insert into public.billing_promotional_codes (
  seller_id,
  affiliate_link_id,
  code,
  discount_bps,
  commission_bps,
  duration,
  status,
  metadata
)
select
  valid_legacy_links.seller_id,
  valid_legacy_links.affiliate_link_id,
  valid_legacy_links.normalized_code,
  1000,
  1000,
  'first_month',
  case
    when valid_legacy_links.link_status = 'active'
      and valid_legacy_links.seller_status = 'active'
      then 'active'
    else 'inactive'
  end,
  jsonb_build_object(
    'backfilled_from', 'affiliate_links',
    'backfilled_at', now(),
    'legacy_link_status', valid_legacy_links.link_status,
    'legacy_seller_status', valid_legacy_links.seller_status
  )
from valid_legacy_links
where valid_legacy_links.normalized_code ~ '^[a-z0-9]{5,10}$'
  and valid_legacy_links.normalized_code_count = 1
  and not exists (
    select 1
    from public.billing_promotional_code_migration_issues issue
    where issue.affiliate_link_id = valid_legacy_links.affiliate_link_id
      and issue.resolved_at is null
  )
  and not exists (
    select 1
    from public.billing_promotional_codes promo
    where promo.code = valid_legacy_links.normalized_code
       or promo.seller_id = valid_legacy_links.seller_id
       or promo.affiliate_link_id = valid_legacy_links.affiliate_link_id
  );

/*
Rollback notes for local/staging before dependent code is shipped:
  drop trigger if exists trg_affiliate_commission_reversals_guard on public.affiliate_commission_reversals;
  drop trigger if exists trg_signup_checkout_sessions_promo_refs_guard on public.signup_checkout_sessions;
  drop trigger if exists trg_billing_promotional_codes_guard on public.billing_promotional_codes;
  drop trigger if exists trg_affiliate_commission_reversals_updated_at on public.affiliate_commission_reversals;
  drop trigger if exists trg_payment_provider_requests_updated_at on public.payment_provider_requests;
  drop trigger if exists trg_billing_promotional_code_redemptions_updated_at on public.billing_promotional_code_redemptions;
  drop trigger if exists trg_billing_promotional_codes_updated_at on public.billing_promotional_codes;
  drop function if exists public.release_promotional_code_redemption(uuid, text, jsonb);
  drop function if exists public.confirm_promotional_code_redemption(uuid, text, jsonb);
  drop function if exists public.reserve_promotional_code(text, uuid, integer, timestamptz, jsonb);
  drop function if exists public.resolve_public_promotional_code(text);
  drop function if exists public.trg_guard_affiliate_commission_reversals();
  drop function if exists public.trg_guard_signup_checkout_promotional_refs();
  drop function if exists public.trg_guard_billing_promotional_codes();
  alter table public.billing_invoices drop column if exists checkout_session_id;
  alter table public.affiliate_attributions drop column if exists seller_id_snapshot;
  alter table public.affiliate_attributions drop column if exists commission_bps_snapshot;
  alter table public.affiliate_attributions drop column if exists promo_code_snapshot;
  alter table public.affiliate_attributions drop column if exists promo_redemption_id;
  alter table public.signup_checkout_sessions drop column if exists promo_redemption_id;
  alter table public.signup_checkout_sessions drop column if exists promo_code_id;
  drop table if exists public.affiliate_commission_reversals;
  drop table if exists public.payment_provider_requests;
  drop table if exists public.billing_promotional_code_migration_issues;
  drop table if exists public.billing_promotional_code_redemptions;
  drop table if exists public.billing_promotional_codes;
  drop index if exists public.affiliate_sellers_lower_email_uidx;
  alter table public.affiliate_sellers drop column if exists email;
  alter table public.affiliate_sellers drop column if exists phone;
Original affiliate sellers, links, attributions, commissions, and payouts are preserved.
*/
