alter table public.passes
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

create index if not exists passes_project_active_created_idx
  on public.passes(project_id, created_at desc)
  where deleted_at is null;

alter table public.passes enable row level security;
alter table public.pass_locations enable row level security;
alter table public.wallet_templates enable row level security;

drop policy if exists "Deny all by default" on public.passes;
drop policy if exists "Negar tudo por padrão" on public.passes;
drop policy if exists passes_select_all_auth on public.passes;
drop policy if exists passes_select_project_staff_active on public.passes;
drop policy if exists passes_insert_project_owner on public.passes;
drop policy if exists passes_update_project_owner on public.passes;

create policy passes_select_project_staff_active
on public.passes
for select
to authenticated
using (
  deleted_at is null
  and (
    public.can_manage_project(project_id)
    or public.is_project_staff(project_id)
  )
);

create policy passes_insert_project_owner
on public.passes
for insert
to authenticated
with check (
  deleted_at is null
  and (
    public.can_manage_project(project_id)
    or public.is_project_owner(project_id)
  )
);

create policy passes_update_project_owner
on public.passes
for update
to authenticated
using (
  deleted_at is null
  and (
    public.can_manage_project(project_id)
    or public.is_project_owner(project_id)
  )
)
with check (
  deleted_at is null
  and (
    public.can_manage_project(project_id)
    or public.is_project_owner(project_id)
  )
);

drop policy if exists pass_locations_select_project_staff on public.pass_locations;
drop policy if exists pass_locations_insert_project_owner on public.pass_locations;
drop policy if exists pass_locations_update_project_owner on public.pass_locations;
drop policy if exists pass_locations_delete_project_owner on public.pass_locations;

create policy pass_locations_select_project_staff
on public.pass_locations
for select
to authenticated
using (
  public.can_manage_project(project_id)
  or public.is_project_staff(project_id)
);

create policy pass_locations_insert_project_owner
on public.pass_locations
for insert
to authenticated
with check (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
);

create policy pass_locations_update_project_owner
on public.pass_locations
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

create policy pass_locations_delete_project_owner
on public.pass_locations
for delete
to authenticated
using (
  public.can_manage_project(project_id)
  or public.is_project_owner(project_id)
);

drop policy if exists "apenas logado pode criar/atualizar templates" on public.wallet_templates;
drop policy if exists wallet_templates_insert on public.wallet_templates;
drop policy if exists wallet_templates_update on public.wallet_templates;
drop policy if exists wallet_templates_admin_insert_own_project on public.wallet_templates;
drop policy if exists wallet_templates_admin_update_own_project on public.wallet_templates;
drop policy if exists wallet_templates_insert_project_owner on public.wallet_templates;
drop policy if exists wallet_templates_update_project_owner on public.wallet_templates;

create policy wallet_templates_insert_project_owner
on public.wallet_templates
for insert
to authenticated
with check (
  public.is_superadmin()
  or (
    project_id is not null
    and (
      public.can_manage_project(project_id)
      or public.is_project_owner(project_id)
    )
  )
);

create policy wallet_templates_update_project_owner
on public.wallet_templates
for update
to authenticated
using (
  public.is_superadmin()
  or (
    project_id is not null
    and (
      public.can_manage_project(project_id)
      or public.is_project_owner(project_id)
    )
  )
)
with check (
  public.is_superadmin()
  or (
    project_id is not null
    and (
      public.can_manage_project(project_id)
      or public.is_project_owner(project_id)
    )
  )
);
