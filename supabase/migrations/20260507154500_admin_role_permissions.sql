alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['superadmin'::text, 'admin'::text, 'establishment'::text, 'customer'::text]));

alter table public.projects
  add column if not exists created_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.projects'::regclass
      and conname = 'projects_created_by_fkey'
  ) then
    alter table public.projects
      add constraint projects_created_by_fkey
      foreign key (created_by)
      references public.profiles(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_projects_created_by
  on public.projects(created_by);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

create or replace function public.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_superadmin()
    or exists (
      select 1
      from public.projects pr
      join public.profiles p on p.id = auth.uid()
      where pr.id = p_project_id
        and pr.created_by = auth.uid()
        and p.role = 'admin'
    );
$$;

grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.can_manage_project(uuid) to anon, authenticated, service_role;

drop policy if exists projects_admin_insert_own on public.projects;
create policy projects_admin_insert_own
on public.projects
for insert
to authenticated
with check (public.is_admin() and created_by = auth.uid());

drop policy if exists projects_admin_update_own on public.projects;
create policy projects_admin_update_own
on public.projects
for update
to authenticated
using (public.is_admin() and created_by = auth.uid())
with check (public.is_admin() and created_by = auth.uid());

drop policy if exists "apenas logado pode criar/atualizar templates" on public.wallet_templates;

drop policy if exists wallet_templates_admin_insert_own_project on public.wallet_templates;
create policy wallet_templates_admin_insert_own_project
on public.wallet_templates
for insert
to authenticated
with check (project_id is not null and public.can_manage_project(project_id));

drop policy if exists wallet_templates_admin_update_own_project on public.wallet_templates;
create policy wallet_templates_admin_update_own_project
on public.wallet_templates
for update
to authenticated
using (project_id is not null and public.can_manage_project(project_id))
with check (project_id is not null and public.can_manage_project(project_id));

drop policy if exists locations_admin_select_own_project on public.locations;
create policy locations_admin_select_own_project
on public.locations
for select
to authenticated
using (public.can_manage_project(project_id));

drop policy if exists locations_admin_insert_own_project on public.locations;
create policy locations_admin_insert_own_project
on public.locations
for insert
to authenticated
with check (public.can_manage_project(project_id));

drop policy if exists locations_admin_update_own_project on public.locations;
create policy locations_admin_update_own_project
on public.locations
for update
to authenticated
using (public.can_manage_project(project_id))
with check (public.can_manage_project(project_id));

drop policy if exists locations_admin_delete_own_project on public.locations;
create policy locations_admin_delete_own_project
on public.locations
for delete
to authenticated
using (public.can_manage_project(project_id));
