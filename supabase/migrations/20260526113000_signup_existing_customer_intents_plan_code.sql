-- Allow signup intents to persist the actual selected plan code.
alter table public.signup_existing_customer_intents
  drop constraint if exists signup_existing_customer_intents_plan_code_check;
update public.signup_existing_customer_intents
set plan_code = lower(btrim(plan_code))
where plan_code is not null;
alter table public.signup_existing_customer_intents
  alter column plan_code set default 'free_trial';
alter table public.signup_existing_customer_intents
  add constraint signup_existing_customer_intents_plan_code_check
  check (plan_code = lower(btrim(plan_code)) and btrim(plan_code) <> '');
