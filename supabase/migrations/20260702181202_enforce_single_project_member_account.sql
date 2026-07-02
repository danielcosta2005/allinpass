-- A restaurant login can belong to only one project in Allin Pass.
-- The trigger blocks new duplicated memberships even if an environment already
-- has legacy duplicates that must be cleaned before the unique index can exist.
create or replace function public.prevent_multiple_project_memberships()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.project_members pm
    where pm.user_id = new.user_id
      and pm.id is distinct from new.id
  ) then
    raise exception 'A restaurant login can belong to only one project.'
      using errcode = '23505',
            constraint = 'project_members_single_project_per_user';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_project_members_single_project_per_user on public.project_members;
create trigger trg_project_members_single_project_per_user
before insert or update of user_id, project_id on public.project_members
for each row
execute function public.prevent_multiple_project_memberships();

do $$
begin
  if exists (
    select 1
    from public.project_members
    group by user_id
    having count(*) > 1
  ) then
    raise notice 'Skipping project_members_single_project_per_user_idx because legacy duplicated memberships exist.';
  else
    create unique index if not exists project_members_single_project_per_user_idx
      on public.project_members (user_id);
  end if;
end;
$$;

-- Pending member invitations are also global by email. This prevents two
-- projects from holding simultaneous active invitations for the same login.
drop index if exists public.user_invitations_pending_project_email_idx;

create unique index if not exists user_invitations_pending_project_member_email_idx
  on public.user_invitations (lower(email))
  where invite_type = 'project_member' and status in ('invited', 'expired');
