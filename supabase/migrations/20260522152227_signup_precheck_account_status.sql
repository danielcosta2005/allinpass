-- Classify an Auth email for signup-precheck without exposing auth.users to
-- the public API. The Edge Function uses this to decide whether an existing
-- customer can continue through passwordless login instead of a new signup.
create or replace function public.signup_precheck_auth_account_status(p_email text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  with matched_user as (
    select u.id
    from auth.users u
    where lower(u.email) = lower(btrim(p_email))
      and u.email is not null
      and btrim(u.email) <> ''
      and u.deleted_at is null
    order by u.created_at asc
    limit 1
  )
  select coalesce(
    (
      select case
        when p.role = 'customer' then 'existing_customer'
        when p.role = 'establishment' then 'existing_establishment'
        else 'existing_account'
      end
      from matched_user mu
      left join public.profiles p on p.id = mu.id
    ),
    'available'
  );
$$;
revoke all on function public.signup_precheck_auth_account_status(text) from public;
revoke all on function public.signup_precheck_auth_account_status(text) from anon;
revoke all on function public.signup_precheck_auth_account_status(text) from authenticated;
grant execute on function public.signup_precheck_auth_account_status(text) to service_role;
-- Remove a RPC antiga: o precheck agora usa classificacao por role.
drop function if exists public.signup_precheck_auth_email_exists(text);
