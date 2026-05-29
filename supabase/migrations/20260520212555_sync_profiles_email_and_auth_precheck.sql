-- Keep public.profiles.email synchronized enough for operational views, but
-- use auth.users as the source of truth for signup account-existence checks.

-- 1) Backfill existing profiles that were created by the auth trigger before
-- it copied email from auth.users.
update public.profiles p
set email = lower(btrim(u.email))
from auth.users u
where p.id = u.id
  and (p.email is null or btrim(p.email) = '')
  and u.email is not null
  and btrim(u.email) <> '';
-- 2) Future auth-created profiles should carry the user's email immediately.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(lower(new.email), '');
begin
  insert into public.profiles (id, role, email)
  values (new.id, 'customer', v_email)
  on conflict (id) do update
  set email = coalesce(nullif(btrim(public.profiles.email), ''), excluded.email);

  return new;
end;
$$;
-- 3) signup-precheck must not depend on public.profiles.email. auth.users is
-- the authoritative source for whether an email already owns an Auth account.
create or replace function public.signup_precheck_auth_email_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(btrim(p_email))
      and u.email is not null
      and btrim(u.email) <> ''
      and u.deleted_at is null
  );
$$;
revoke all on function public.signup_precheck_auth_email_exists(text) from public;
revoke all on function public.signup_precheck_auth_email_exists(text) from anon;
revoke all on function public.signup_precheck_auth_email_exists(text) from authenticated;
grant execute on function public.signup_precheck_auth_email_exists(text) to service_role;
