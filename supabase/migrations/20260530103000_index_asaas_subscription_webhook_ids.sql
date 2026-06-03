create index if not exists signup_checkout_sessions_provider_subscription_idx
  on public.signup_checkout_sessions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists billing_plan_change_sessions_provider_subscription_idx
  on public.billing_plan_change_sessions (provider, provider_subscription_id)
  where provider_subscription_id is not null;
