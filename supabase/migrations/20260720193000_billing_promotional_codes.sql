create table if not exists public.billing_promotional_codes (
  id uuid primary key default gen_random_uuid(),
  affiliate_link_id uuid references public.affiliate_links(id) on delete restrict,
  seller_id uuid references public.affiliate_sellers(id) on delete restrict,
  code text not null,
  discount_bps integer not null default 1000,
  commission_bps integer not null default 0,
  duration text not null default 'first_month',
  max_uses integer,
  redeemed_uses integer not null default 0,
  valid_until timestamptz,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_promotional_codes_code_not_blank
    check (length(btrim(code)) > 0),
  constraint billing_promotional_codes_code_format
    check (code ~ '^[a-z0-9][a-z0-9-]{5,39}$'),
  constraint billing_promotional_codes_discount_bps_check
    check (discount_bps >= 1 and discount_bps <= 10000),
  constraint billing_promotional_codes_commission_bps_check
    check (commission_bps >= 0 and commission_bps <= 10000),
  constraint billing_promotional_codes_duration_check
    check (duration in ('first_month')),
  constraint billing_promotional_codes_usage_check
    check (
      redeemed_uses >= 0
      and (max_uses is null or max_uses > 0)
      and (max_uses is null or redeemed_uses <= max_uses)
    ),
  constraint billing_promotional_codes_status_check
    check (status in ('active', 'inactive')),
  constraint billing_promotional_codes_campaign_commission_check
    check (seller_id is not null or commission_bps = 0),
  constraint billing_promotional_codes_affiliate_link_pair_check
    check (affiliate_link_id is null or seller_id is not null)
);

create unique index if not exists billing_promotional_codes_lower_code_uidx
  on public.billing_promotional_codes (lower(code));

create unique index if not exists billing_promotional_codes_affiliate_link_uidx
  on public.billing_promotional_codes (affiliate_link_id)
  where affiliate_link_id is not null;

create index if not exists billing_promotional_codes_seller_created_at_idx
  on public.billing_promotional_codes (seller_id, created_at desc)
  where seller_id is not null;

create index if not exists billing_promotional_codes_status_valid_until_idx
  on public.billing_promotional_codes (status, valid_until, created_at desc);

drop trigger if exists trg_billing_promotional_codes_updated_at
  on public.billing_promotional_codes;
create trigger trg_billing_promotional_codes_updated_at
before update on public.billing_promotional_codes
for each row execute function public.set_updated_at();

create or replace function public.validate_billing_promotional_code_affiliate_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_link_seller_id uuid;
begin
  if new.affiliate_link_id is null then
    return new;
  end if;

  select link.seller_id
  into v_link_seller_id
  from public.affiliate_links link
  where link.id = new.affiliate_link_id;

  if v_link_seller_id is null or new.seller_id is distinct from v_link_seller_id then
    raise exception 'Promotional code affiliate link seller mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_billing_promotional_codes_affiliate_link_match
  on public.billing_promotional_codes;
create trigger trg_billing_promotional_codes_affiliate_link_match
before insert or update of affiliate_link_id, seller_id
on public.billing_promotional_codes
for each row execute function public.validate_billing_promotional_code_affiliate_link();

alter table public.billing_promotional_codes enable row level security;

revoke all on table public.billing_promotional_codes from anon;
grant select, insert, update, delete on table public.billing_promotional_codes to authenticated;
grant all on table public.billing_promotional_codes to service_role;

drop policy if exists billing_promotional_codes_superadmin_select on public.billing_promotional_codes;
create policy billing_promotional_codes_superadmin_select
on public.billing_promotional_codes
for select
to authenticated
using ((select public.is_superadmin()));

drop policy if exists billing_promotional_codes_superadmin_insert on public.billing_promotional_codes;
create policy billing_promotional_codes_superadmin_insert
on public.billing_promotional_codes
for insert
to authenticated
with check ((select public.is_superadmin()));

drop policy if exists billing_promotional_codes_superadmin_update on public.billing_promotional_codes;
create policy billing_promotional_codes_superadmin_update
on public.billing_promotional_codes
for update
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists billing_promotional_codes_superadmin_delete on public.billing_promotional_codes;
create policy billing_promotional_codes_superadmin_delete
on public.billing_promotional_codes
for delete
to authenticated
using ((select public.is_superadmin()));

alter table public.signup_checkout_sessions
  add column if not exists promo_code_id uuid references public.billing_promotional_codes(id) on delete set null,
  add column if not exists promo_code text,
  add column if not exists promo_discount_bps integer not null default 0,
  add column if not exists promo_discount_cents integer not null default 0,
  add column if not exists promo_original_amount_cents integer,
  add column if not exists promo_commission_bps integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_promo_code_format_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_promo_code_format_check
      check (
        promo_code is null
        or promo_code ~ '^[a-z0-9][a-z0-9-]{5,39}$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_promo_discount_bps_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_promo_discount_bps_check
      check (promo_discount_bps >= 0 and promo_discount_bps <= 10000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_promo_discount_cents_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_promo_discount_cents_check
      check (promo_discount_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_promo_original_amount_cents_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_promo_original_amount_cents_check
      check (promo_original_amount_cents is null or promo_original_amount_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_promo_commission_bps_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_promo_commission_bps_check
      check (promo_commission_bps >= 0 and promo_commission_bps <= 10000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_promo_pair_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_promo_pair_check
      check (
        (
          promo_code_id is null
          and promo_code is null
          and promo_discount_bps = 0
          and promo_discount_cents = 0
          and promo_original_amount_cents is null
          and promo_commission_bps = 0
        )
        or (
          promo_code_id is not null
          and promo_code is not null
          and promo_discount_bps > 0
          and promo_original_amount_cents is not null
          and promo_original_amount_cents >= amount_cents
        )
      );
  end if;
end
$$;

create index if not exists signup_checkout_sessions_promo_code_idx
  on public.signup_checkout_sessions (promo_code_id)
  where promo_code_id is not null;

create index if not exists signup_checkout_sessions_promo_lower_code_idx
  on public.signup_checkout_sessions (lower(promo_code))
  where promo_code is not null;

insert into public.billing_promotional_codes (
  affiliate_link_id,
  seller_id,
  code,
  discount_bps,
  commission_bps,
  duration,
  status,
  created_by,
  updated_by,
  created_at,
  updated_at,
  metadata
)
select
  link.id,
  link.seller_id,
  link.code,
  1000,
  1000,
  'first_month',
  link.status,
  link.created_by,
  link.updated_by,
  link.created_at,
  link.updated_at,
  jsonb_build_object('origin', 'affiliate_link_backfill')
from public.affiliate_links link
where not exists (
  select 1
  from public.billing_promotional_codes promo
  where lower(promo.code) = lower(link.code)
     or promo.affiliate_link_id = link.id
);

update public.signup_checkout_sessions checkout_session
set
  promo_code_id = promo.id,
  promo_code = promo.code,
  promo_discount_bps = case
    when coalesce(checkout_session.affiliate_discount_bps, 0) > 0
      then checkout_session.affiliate_discount_bps
    else promo.discount_bps
  end,
  promo_discount_cents = case
    when coalesce(checkout_session.affiliate_discount_cents, 0) > 0
      then checkout_session.affiliate_discount_cents
    else floor(
      (
        greatest(
          coalesce(
            checkout_session.affiliate_original_amount_cents,
            checkout_session.amount_cents + coalesce(checkout_session.affiliate_discount_cents, 0),
            checkout_session.amount_cents
          ),
          checkout_session.amount_cents
        )
        * promo.discount_bps
      ) / 10000.0
    )::integer
  end,
  promo_original_amount_cents = greatest(
    coalesce(
      checkout_session.affiliate_original_amount_cents,
      checkout_session.amount_cents + coalesce(checkout_session.affiliate_discount_cents, 0),
      checkout_session.amount_cents
    ),
    checkout_session.amount_cents
  ),
  promo_commission_bps = promo.commission_bps
from public.billing_promotional_codes promo
where checkout_session.promo_code_id is null
  and checkout_session.affiliate_link_id = promo.affiliate_link_id
  and checkout_session.affiliate_seller_id is not null
  and checkout_session.affiliate_code is not null
  and promo.affiliate_link_id is not null;

create table if not exists public.billing_promotional_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.billing_promotional_codes(id) on delete cascade,
  checkout_session_id uuid not null references public.signup_checkout_sessions(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint billing_promotional_code_redemptions_checkout_uidx unique (checkout_session_id),
  constraint billing_promotional_code_redemptions_pair_uidx unique (promo_code_id, checkout_session_id)
);

create index if not exists billing_promotional_code_redemptions_promo_idx
  on public.billing_promotional_code_redemptions (promo_code_id, redeemed_at desc);

alter table public.billing_promotional_code_redemptions enable row level security;

revoke all on table public.billing_promotional_code_redemptions from anon;
grant select on table public.billing_promotional_code_redemptions to authenticated;
grant all on table public.billing_promotional_code_redemptions to service_role;

drop policy if exists billing_promotional_code_redemptions_superadmin_select
  on public.billing_promotional_code_redemptions;
create policy billing_promotional_code_redemptions_superadmin_select
on public.billing_promotional_code_redemptions
for select
to authenticated
using ((select public.is_superadmin()));

create or replace function public.confirm_billing_promotional_code_redemption(
  p_code_id uuid,
  p_checkout_session_id uuid
)
returns public.billing_promotional_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.billing_promotional_codes;
begin
  if p_code_id is null or p_checkout_session_id is null then
    return null;
  end if;

  select *
  into v_code
  from public.billing_promotional_codes
  where id = p_code_id
  for update;

  if not found then
    return null;
  end if;

  if exists (
    select 1
    from public.billing_promotional_code_redemptions redemption
    where redemption.promo_code_id = p_code_id
      and redemption.checkout_session_id = p_checkout_session_id
  ) then
    return v_code;
  end if;

  if exists (
    select 1
    from public.billing_promotional_code_redemptions redemption
    where redemption.checkout_session_id = p_checkout_session_id
  ) then
    return null;
  end if;

  if v_code.status <> 'active' then
    return null;
  end if;

  if v_code.valid_until is not null and v_code.valid_until <= now() then
    return null;
  end if;

  if v_code.max_uses is not null and v_code.redeemed_uses >= v_code.max_uses then
    return null;
  end if;

  insert into public.billing_promotional_code_redemptions (
    promo_code_id,
    checkout_session_id
  )
  values (
    p_code_id,
    p_checkout_session_id
  );

  update public.billing_promotional_codes
  set redeemed_uses = redeemed_uses + 1
  where id = p_code_id
  returning * into v_code;

  return v_code;
end;
$$;

revoke all on function public.confirm_billing_promotional_code_redemption(uuid, uuid) from public;
revoke all on function public.confirm_billing_promotional_code_redemption(uuid, uuid) from anon;
revoke all on function public.confirm_billing_promotional_code_redemption(uuid, uuid) from authenticated;
grant execute on function public.confirm_billing_promotional_code_redemption(uuid, uuid) to service_role;
