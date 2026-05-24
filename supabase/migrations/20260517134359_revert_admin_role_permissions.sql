drop policy if exists locations_admin_delete_own_project on public.locations;
drop policy if exists locations_admin_update_own_project on public.locations;
drop policy if exists locations_admin_insert_own_project on public.locations;
drop policy if exists locations_admin_select_own_project on public.locations;

drop policy if exists wallet_templates_admin_update_own_project on public.wallet_templates;
drop policy if exists wallet_templates_admin_insert_own_project on public.wallet_templates;

drop policy if exists projects_admin_update_own on public.projects;
drop policy if exists projects_admin_insert_own on public.projects;

drop policy if exists "apenas logado pode criar/atualizar templates" on public.wallet_templates;
create policy "apenas logado pode criar/atualizar templates"
on public.wallet_templates
for all
to authenticated
using (true)
with check (true);

drop function if exists public.can_manage_project(uuid);
drop function if exists public.is_admin();

alter table public.projects
  drop constraint if exists projects_created_by_fkey;

drop index if exists public.idx_projects_created_by;

alter table public.projects
  drop column if exists created_by;

do $$
begin
  if exists (
    select 1
    from public.profiles
    where role = 'admin'
  ) then
    raise exception
      'Cannot revert admin_role_permissions while profiles with role=admin exist. Update or remove those profiles first.';
  end if;
end $$;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array['superadmin'::text, 'establishment'::text, 'customer'::text]));
