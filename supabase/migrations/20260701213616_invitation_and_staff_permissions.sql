create or replace function public.fn_list_members(p_project uuid)
returns table(user_id uuid, email text, role text, created_at timestamp with time zone)
language sql
stable
security definer
set search_path = public
as $$
  select
    pm.user_id,
    (select u.email from auth.users u where u.id = pm.user_id)::text as email,
    pm.role::text,
    pm.created_at
  from public.project_members pm
  where pm.project_id = p_project
    and (
      public.can_manage_project(p_project)
      or public.is_project_staff(p_project)
    )
  order by pm.created_at desc;
$$;

revoke all on function public.fn_list_members(uuid) from public;
grant execute on function public.fn_list_members(uuid) to anon, authenticated, service_role;

drop policy if exists pm_ins on public.project_members;
drop policy if exists pm_upd on public.project_members;
drop policy if exists pm_del on public.project_members;
drop policy if exists project_members_insert_project_manager on public.project_members;
drop policy if exists project_members_update_project_manager on public.project_members;
drop policy if exists project_members_delete_project_manager on public.project_members;

create policy project_members_insert_project_manager
on public.project_members
for insert
to authenticated
with check (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
);

create policy project_members_update_project_manager
on public.project_members
for update
to authenticated
using (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
)
with check (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
);

create policy project_members_delete_project_manager
on public.project_members
for delete
to authenticated
using (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
);

drop policy if exists rewards_insert_project_staff on public.rewards;
drop policy if exists rewards_update_project_staff on public.rewards;
drop policy if exists rewards_delete_project_staff on public.rewards;
drop policy if exists rewards_insert_project_manager on public.rewards;
drop policy if exists rewards_update_project_manager on public.rewards;
drop policy if exists rewards_delete_project_manager on public.rewards;

create policy rewards_insert_project_manager
on public.rewards
for insert
to authenticated
with check (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
);

create policy rewards_update_project_manager
on public.rewards
for update
to authenticated
using (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
)
with check (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
);

create policy rewards_delete_project_manager
on public.rewards
for delete
to authenticated
using (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
);
