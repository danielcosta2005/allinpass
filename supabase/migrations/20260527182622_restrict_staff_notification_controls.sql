create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.role = 'owner'
  );
$$;

grant execute on function public.is_project_owner(uuid) to anon, authenticated, service_role;

alter table public.automations enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_jobs enable row level security;

drop policy if exists automations_select_project_staff on public.automations;
create policy automations_select_project_staff
on public.automations
for select
to authenticated
using (public.is_project_staff(project_id));

drop policy if exists automations_insert_project_owner on public.automations;
create policy automations_insert_project_owner
on public.automations
for insert
to authenticated
with check (public.is_project_owner(project_id));

drop policy if exists automations_update_project_owner on public.automations;
create policy automations_update_project_owner
on public.automations
for update
to authenticated
using (public.is_project_owner(project_id))
with check (public.is_project_owner(project_id));

drop policy if exists automations_delete_project_owner on public.automations;
create policy automations_delete_project_owner
on public.automations
for delete
to authenticated
using (public.is_project_owner(project_id));

drop policy if exists notifications_insert_project_staff on public.notifications;
drop policy if exists notifications_insert_project_owner on public.notifications;
create policy notifications_insert_project_owner
on public.notifications
for insert
to authenticated
with check (public.is_project_owner(project_id));

drop policy if exists notifications_update_project_owner on public.notifications;
create policy notifications_update_project_owner
on public.notifications
for update
to authenticated
using (public.is_project_owner(project_id))
with check (public.is_project_owner(project_id));

drop policy if exists notifications_select_project_staff on public.notifications;
drop policy if exists notifications_select_project_staff_sent on public.notifications;
create policy notifications_select_project_staff_sent
on public.notifications
for select
to authenticated
using (
  public.is_project_owner(project_id)
  or (
    public.is_project_staff(project_id)
    and sent_at is not null
  )
);

drop policy if exists notification_jobs_insert_project_staff on public.notification_jobs;
drop policy if exists notification_jobs_insert_project_owner on public.notification_jobs;
create policy notification_jobs_insert_project_owner
on public.notification_jobs
for insert
to authenticated
with check (public.is_project_owner(project_id));

drop policy if exists notification_jobs_update_project_owner on public.notification_jobs;
create policy notification_jobs_update_project_owner
on public.notification_jobs
for update
to authenticated
using (public.is_project_owner(project_id))
with check (public.is_project_owner(project_id));

drop policy if exists notification_jobs_select_project_staff on public.notification_jobs;
drop policy if exists notification_jobs_select_project_staff_sent on public.notification_jobs;
create policy notification_jobs_select_project_staff_sent
on public.notification_jobs
for select
to authenticated
using (
  public.is_project_owner(project_id)
  or (
    public.is_project_staff(project_id)
    and exists (
      select 1
      from public.notifications n
      where n.id = notification_jobs.notification_id
        and n.sent_at is not null
    )
  )
);
