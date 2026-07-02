create table if not exists public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invite_type text not null,
  role text not null,
  project_id uuid references public.projects(id) on delete cascade,
  invited_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'invited',
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  accepted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint user_invitations_email_not_blank check (length(btrim(email)) > 0),
  constraint user_invitations_invite_type_check check (invite_type = any (array['admin'::text, 'project_member'::text])),
  constraint user_invitations_status_check check (status = any (array['invited'::text, 'active'::text, 'expired'::text, 'cancelled'::text])),
  constraint user_invitations_scope_check check (
    (
      invite_type = 'admin'
      and project_id is null
      and role = any (array['admin'::text, 'superadmin'::text])
    )
    or (
      invite_type = 'project_member'
      and project_id is not null
      and role = any (array['owner'::text, 'staff'::text])
    )
  )
);

create index if not exists user_invitations_email_idx
  on public.user_invitations (lower(email));

create index if not exists user_invitations_project_status_idx
  on public.user_invitations (project_id, status, created_at desc)
  where invite_type = 'project_member';

create unique index if not exists user_invitations_pending_admin_email_idx
  on public.user_invitations (lower(email))
  where invite_type = 'admin' and status = 'invited';

create unique index if not exists user_invitations_pending_project_email_idx
  on public.user_invitations (project_id, lower(email))
  where invite_type = 'project_member' and status = 'invited';

drop trigger if exists trg_user_invitations_updated_at on public.user_invitations;
create trigger trg_user_invitations_updated_at
before update on public.user_invitations
for each row
execute function public.set_updated_at();

alter table public.user_invitations enable row level security;

drop policy if exists user_invitations_select_authorized on public.user_invitations;
create policy user_invitations_select_authorized
on public.user_invitations
for select
to authenticated
using (
  public.is_superadmin()
  or (
    invite_type = 'project_member'
    and project_id is not null
    and public.can_read_project_members(project_id)
  )
  or invited_user_id = auth.uid()
);

grant all on table public.user_invitations to service_role;
grant select on table public.user_invitations to authenticated;

drop function if exists public.fn_list_members(uuid);
create function public.fn_list_members(p_project uuid)
returns table(
  user_id uuid,
  email text,
  role text,
  created_at timestamptz,
  status text,
  invitation_id uuid,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pm.user_id,
    au.email::text,
    pm.role::text,
    pm.created_at,
    'active'::text as status,
    null::uuid as invitation_id,
    null::timestamptz as expires_at
  from public.project_members pm
  left join auth.users au on au.id = pm.user_id
  where pm.project_id = p_project
    and public.can_read_project_members(p_project)

  union all

  select
    null::uuid as user_id,
    ui.email::text,
    ui.role::text,
    ui.created_at,
    case when ui.status = 'expired' or ui.expires_at <= now() then 'expired'::text else 'invited'::text end as status,
    ui.id as invitation_id,
    ui.expires_at
  from public.user_invitations ui
  where ui.invite_type = 'project_member'
    and ui.project_id = p_project
    and ui.status in ('invited', 'expired')
    and public.can_read_project_members(p_project)
    and not exists (
      select 1
      from public.project_members pm
      left join auth.users au on au.id = pm.user_id
      where pm.project_id = ui.project_id
        and (
          pm.user_id = ui.invited_user_id
          or lower(coalesce(au.email, '')) = lower(ui.email)
        )
    )
  order by created_at desc;
$$;

revoke all on function public.fn_list_members(uuid) from public;
grant execute on function public.fn_list_members(uuid) to authenticated, service_role;

drop policy if exists rewards_insert_project_staff on public.rewards;
drop policy if exists rewards_update_project_staff on public.rewards;
drop policy if exists rewards_delete_project_staff on public.rewards;
drop policy if exists rewards_insert_project_owner on public.rewards;
drop policy if exists rewards_update_project_owner on public.rewards;
drop policy if exists rewards_delete_project_owner on public.rewards;

create policy rewards_insert_project_owner
on public.rewards
for insert
to authenticated
with check (
  public.is_superadmin()
  or public.is_project_owner(project_id)
);

create policy rewards_update_project_owner
on public.rewards
for update
to authenticated
using (
  public.is_superadmin()
  or public.is_project_owner(project_id)
)
with check (
  public.is_superadmin()
  or public.is_project_owner(project_id)
);

create policy rewards_delete_project_owner
on public.rewards
for delete
to authenticated
using (
  public.is_superadmin()
  or public.is_project_owner(project_id)
);
