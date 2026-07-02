alter table public.signup_checkout_sessions
  add column if not exists affiliate_link_id uuid references public.affiliate_links(id) on delete set null,
  add column if not exists affiliate_seller_id uuid references public.affiliate_sellers(id) on delete set null,
  add column if not exists affiliate_code text,
  add column if not exists affiliate_discount_bps integer not null default 0,
  add column if not exists affiliate_discount_cents integer not null default 0,
  add column if not exists affiliate_original_amount_cents integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_affiliate_code_format_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_affiliate_code_format_check
      check (
        affiliate_code is null
        or affiliate_code ~ '^[a-z0-9][a-z0-9-]{5,39}$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_affiliate_discount_bps_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_affiliate_discount_bps_check
      check (affiliate_discount_bps >= 0 and affiliate_discount_bps <= 10000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_affiliate_discount_cents_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_affiliate_discount_cents_check
      check (affiliate_discount_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_affiliate_original_amount_cents_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_affiliate_original_amount_cents_check
      check (affiliate_original_amount_cents is null or affiliate_original_amount_cents >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'signup_checkout_sessions_affiliate_pair_check'
      and conrelid = 'public.signup_checkout_sessions'::regclass
  ) then
    alter table public.signup_checkout_sessions
      add constraint signup_checkout_sessions_affiliate_pair_check
      check (
        (
          affiliate_link_id is null
          and affiliate_seller_id is null
          and affiliate_code is null
          and affiliate_discount_bps = 0
          and affiliate_discount_cents = 0
          and affiliate_original_amount_cents is null
        )
        or (
          affiliate_link_id is not null
          and affiliate_seller_id is not null
          and affiliate_code is not null
          and affiliate_discount_bps > 0
          and affiliate_original_amount_cents is not null
          and affiliate_original_amount_cents >= amount_cents
        )
      );
  end if;
end
$$;

create index if not exists signup_checkout_sessions_affiliate_link_idx
  on public.signup_checkout_sessions (affiliate_link_id)
  where affiliate_link_id is not null;

create index if not exists signup_checkout_sessions_affiliate_seller_idx
  on public.signup_checkout_sessions (affiliate_seller_id)
  where affiliate_seller_id is not null;

create table if not exists public.affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.affiliate_sellers(id) on delete restrict,
  link_id uuid not null references public.affiliate_links(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid not null references public.billing_subscriptions(id) on delete cascade,
  checkout_session_id uuid references public.signup_checkout_sessions(id) on delete set null,
  plan_id uuid references public.billing_plans(id) on delete set null,
  source_code text not null,
  status text not null default 'active',
  attributed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_attributions_source_code_not_blank check (length(btrim(source_code)) > 0),
  constraint affiliate_attributions_source_code_format check (source_code ~ '^[a-z0-9][a-z0-9-]{5,39}$'),
  constraint affiliate_attributions_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists affiliate_attributions_project_uidx
  on public.affiliate_attributions (project_id);

create unique index if not exists affiliate_attributions_subscription_uidx
  on public.affiliate_attributions (subscription_id);

create unique index if not exists affiliate_attributions_checkout_session_uidx
  on public.affiliate_attributions (checkout_session_id)
  where checkout_session_id is not null;

create index if not exists affiliate_attributions_seller_created_at_idx
  on public.affiliate_attributions (seller_id, created_at desc);

create index if not exists affiliate_attributions_link_created_at_idx
  on public.affiliate_attributions (link_id, created_at desc);

create index if not exists affiliate_attributions_user_idx
  on public.affiliate_attributions (user_id)
  where user_id is not null;

create index if not exists affiliate_attributions_project_idx
  on public.affiliate_attributions (project_id);

create index if not exists affiliate_attributions_subscription_idx
  on public.affiliate_attributions (subscription_id);

drop trigger if exists trg_affiliate_attributions_updated_at on public.affiliate_attributions;
create trigger trg_affiliate_attributions_updated_at
  before update on public.affiliate_attributions
  for each row
  execute function public.set_updated_at();

alter table public.affiliate_attributions enable row level security;

revoke all on table public.affiliate_attributions from anon;
grant select, insert, update, delete on table public.affiliate_attributions to authenticated;
grant all on table public.affiliate_attributions to service_role;

drop policy if exists affiliate_attributions_superadmin_select on public.affiliate_attributions;
create policy affiliate_attributions_superadmin_select
on public.affiliate_attributions
for select
to authenticated
using ((select public.is_superadmin()));

drop policy if exists affiliate_attributions_superadmin_insert on public.affiliate_attributions;
create policy affiliate_attributions_superadmin_insert
on public.affiliate_attributions
for insert
to authenticated
with check ((select public.is_superadmin()));

drop policy if exists affiliate_attributions_superadmin_update on public.affiliate_attributions;
create policy affiliate_attributions_superadmin_update
on public.affiliate_attributions
for update
to authenticated
using ((select public.is_superadmin()))
with check ((select public.is_superadmin()));

drop policy if exists affiliate_attributions_superadmin_delete on public.affiliate_attributions;
create policy affiliate_attributions_superadmin_delete
on public.affiliate_attributions
for delete
to authenticated
using ((select public.is_superadmin()));
