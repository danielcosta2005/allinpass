create or replace function public.can_manage_staff_project_members(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_superadmin()
    or exists (
      select 1
      from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
        and pm.role = 'owner'
    );
$$;

revoke all on function public.can_manage_staff_project_members(uuid) from public;
revoke all on function public.can_manage_staff_project_members(uuid) from anon;
grant execute on function public.can_manage_staff_project_members(uuid) to authenticated, service_role;

create or replace function public.can_read_project_members(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_superadmin()
    or exists (
      select 1
      from public.project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
        and pm.role in ('owner', 'staff')
    )
    or exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.created_by = auth.uid()
    );
$$;

revoke all on function public.can_read_project_members(uuid) from public;
revoke all on function public.can_read_project_members(uuid) from anon;
grant execute on function public.can_read_project_members(uuid) to authenticated, service_role;

create or replace function public.fn_list_members(p_project uuid)
returns table(user_id uuid, email text, role text, created_at timestamp with time zone)
language sql
stable
security definer
set search_path = public
as $$
  select
    pm.user_id,
    au.email::text,
    pm.role::text,
    pm.created_at
  from public.project_members pm
  left join auth.users au on au.id = pm.user_id
  where pm.project_id = p_project
    and public.can_read_project_members(p_project)
  order by pm.created_at desc;
$$;

revoke all on function public.fn_list_members(uuid) from public;
revoke all on function public.fn_list_members(uuid) from anon;
grant execute on function public.fn_list_members(uuid) to authenticated, service_role;

alter table public.project_members enable row level security;

drop policy if exists "Allow_menagement_for_fellow_project_members" on public.project_members;
drop policy if exists "pm member read" on public.project_members;
drop policy if exists "pm superadmin del" on public.project_members;
drop policy if exists "pm superadmin ins" on public.project_members;
drop policy if exists "pm superadmin upd" on public.project_members;
drop policy if exists "pm_cud" on public.project_members;
drop policy if exists "pm_del" on public.project_members;
drop policy if exists "pm_ins" on public.project_members;
drop policy if exists "pm_read" on public.project_members;
drop policy if exists "pm_select" on public.project_members;
drop policy if exists "pm_upd" on public.project_members;
drop policy if exists project_members_select_project_staff on public.project_members;
drop policy if exists project_members_insert_staff_by_owner on public.project_members;
drop policy if exists project_members_update_staff_by_owner on public.project_members;
drop policy if exists project_members_delete_staff_by_owner on public.project_members;

create policy project_members_select_project_staff
on public.project_members
for select
to authenticated
using (public.can_read_project_members(project_id));

create policy project_members_insert_staff_by_owner
on public.project_members
for insert
to authenticated
with check (
  role = 'staff'
  and public.can_manage_staff_project_members(project_id)
);

create policy project_members_update_staff_by_owner
on public.project_members
for update
to authenticated
using (
  role = 'staff'
  and public.can_manage_staff_project_members(project_id)
)
with check (
  role = 'staff'
  and public.can_manage_staff_project_members(project_id)
);

create policy project_members_delete_staff_by_owner
on public.project_members
for delete
to authenticated
using (
  role = 'staff'
  and public.can_manage_staff_project_members(project_id)
);
