-- Persist the business signup intent for Auth users that already exist as
-- customers. This lets signup-finalize recover the establishment name even
-- when the magic link is opened on another browser/device.
create table if not exists public.signup_existing_customer_intents (
  email text primary key,
  establishment_name text not null,
  plan_code text not null default 'free_trial'
    check (plan_code = 'free_trial'),
  status text not null default 'pending'
    check (status in ('pending', 'completed')),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint signup_existing_customer_intents_email_normalized_check
    check (email = lower(btrim(email)) and email <> ''),
  constraint signup_existing_customer_intents_establishment_name_check
    check (btrim(establishment_name) <> '')
);

comment on table public.signup_existing_customer_intents is
  'Pending Free Trial signup intent for existing customer Auth accounts.';

create index if not exists signup_existing_customer_intents_status_expires_at_idx
  on public.signup_existing_customer_intents (status, expires_at);

create index if not exists signup_existing_customer_intents_user_id_idx
  on public.signup_existing_customer_intents (user_id)
  where user_id is not null;

drop trigger if exists trg_signup_existing_customer_intents_updated_at
  on public.signup_existing_customer_intents;
create trigger trg_signup_existing_customer_intents_updated_at
before update on public.signup_existing_customer_intents
for each row execute function public.set_updated_at();

alter table public.signup_existing_customer_intents enable row level security;

revoke all on table public.signup_existing_customer_intents from anon;
revoke all on table public.signup_existing_customer_intents from authenticated;
grant select, insert, update on table public.signup_existing_customer_intents to service_role;
