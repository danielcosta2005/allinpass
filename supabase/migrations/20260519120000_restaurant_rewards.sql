create table if not exists public.rewards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  points_required integer not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rewards_name_not_blank check (length(btrim(name)) > 0),
  constraint rewards_points_required_check check (points_required > 0),
  constraint rewards_status_check check (status = any (array['active'::text, 'inactive'::text]))
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reward_id uuid references public.rewards(id) on delete set null,
  user_pass_id uuid references public.user_passes(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  reward_name text not null,
  pass_token text,
  points_spent integer not null,
  points_before integer not null,
  points_after integer not null,
  notification_id uuid references public.notifications(id) on delete set null,
  notification_warning text,
  created_at timestamptz not null default now(),
  constraint reward_redemptions_points_spent_check check (points_spent > 0),
  constraint reward_redemptions_points_before_check check (points_before >= 0),
  constraint reward_redemptions_points_after_check check (points_after >= 0)
);

create index if not exists rewards_project_created_idx
  on public.rewards (project_id, created_at desc);

create index if not exists rewards_project_status_idx
  on public.rewards (project_id, status);

create index if not exists reward_redemptions_project_created_idx
  on public.reward_redemptions (project_id, created_at desc);

create index if not exists reward_redemptions_project_user_pass_idx
  on public.reward_redemptions (project_id, user_pass_id, created_at desc);

create or replace function public.set_rewards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rewards_updated_at on public.rewards;
create trigger trg_rewards_updated_at
before update on public.rewards
for each row
execute function public.set_rewards_updated_at();

create or replace function public.redeem_reward_points(
  p_project_id uuid,
  p_reward_id uuid,
  p_pass_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward record;
  v_user_pass_id uuid;
  v_pass_id uuid;
  v_pass_token text;
  v_metadata jsonb;
  v_pass_project_id uuid;
  v_customer_id uuid;
  v_points_before integer;
  v_points_after integer;
  v_redemption_id uuid;
begin
  select r.id, r.project_id, r.name, r.points_required, r.status
    into v_reward
  from public.rewards r
  where r.id = p_reward_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'reward_not_found', 'message', 'Recompensa nao encontrada.');
  end if;

  if v_reward.project_id <> p_project_id then
    return jsonb_build_object('ok', false, 'error', 'wrong_reward_project', 'message', 'Esta recompensa pertence a outro projeto.');
  end if;

  if v_reward.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'reward_inactive', 'message', 'Esta recompensa esta inativa.');
  end if;

  select up.id, up.pass_id, up.pass_token, coalesce(up.metadata, '{}'::jsonb), p.project_id
    into v_user_pass_id, v_pass_id, v_pass_token, v_metadata, v_pass_project_id
  from public.user_passes up
  join public.passes p on p.id = up.pass_id
  where up.pass_token = p_pass_token
  limit 1
  for update of up;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Passe nao encontrado para esse token.');
  end if;

  if v_pass_project_id <> p_project_id then
    return jsonb_build_object(
      'ok', false,
      'error', 'wrong_project',
      'message', 'Este QR Code pertence a outro estabelecimento.',
      'expected_project_id', v_pass_project_id,
      'received_project_id', p_project_id,
      'pass_id', v_pass_id
    );
  end if;

  v_points_before := greatest(
    case
      when coalesce(v_metadata->>'points', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (v_metadata->>'points')::numeric::integer
      else 0
    end,
    0
  );

  if v_points_before < v_reward.points_required then
    return jsonb_build_object(
      'ok', false,
      'error', 'insufficient_points',
      'message', 'Cliente nao tem pontos suficientes para esta recompensa.',
      'points', v_points_before,
      'points_required', v_reward.points_required
    );
  end if;

  v_points_after := v_points_before - v_reward.points_required;

  select c.id
    into v_customer_id
  from public.customers c
  where c.project_id = p_project_id
    and c.user_pass_id = v_user_pass_id
  order by c.created_at desc
  limit 1;

  update public.user_passes
  set metadata = v_metadata || jsonb_build_object('points', v_points_after)
  where id = v_user_pass_id;

  insert into public.reward_redemptions (
    project_id,
    reward_id,
    user_pass_id,
    customer_id,
    reward_name,
    pass_token,
    points_spent,
    points_before,
    points_after
  )
  values (
    p_project_id,
    v_reward.id,
    v_user_pass_id,
    v_customer_id,
    v_reward.name,
    v_pass_token,
    v_reward.points_required,
    v_points_before,
    v_points_after
  )
  returning id into v_redemption_id;

  return jsonb_build_object(
    'ok', true,
    'reward_id', v_reward.id,
    'reward_name', v_reward.name,
    'redemption_id', v_redemption_id,
    'user_pass_id', v_user_pass_id,
    'customer_id', v_customer_id,
    'points_spent', v_reward.points_required,
    'points_before', v_points_before,
    'points_after', v_points_after
  );
end;
$$;

alter table public.rewards enable row level security;
alter table public.reward_redemptions enable row level security;

drop policy if exists rewards_select_project_staff on public.rewards;
create policy rewards_select_project_staff
on public.rewards
for select
to authenticated
using (public.is_project_staff(project_id));

drop policy if exists rewards_insert_project_staff on public.rewards;
create policy rewards_insert_project_staff
on public.rewards
for insert
to authenticated
with check (public.is_project_staff(project_id));

drop policy if exists rewards_update_project_staff on public.rewards;
create policy rewards_update_project_staff
on public.rewards
for update
to authenticated
using (public.is_project_staff(project_id))
with check (public.is_project_staff(project_id));

drop policy if exists rewards_delete_project_staff on public.rewards;
create policy rewards_delete_project_staff
on public.rewards
for delete
to authenticated
using (public.is_project_staff(project_id));

drop policy if exists reward_redemptions_select_project_staff on public.reward_redemptions;
create policy reward_redemptions_select_project_staff
on public.reward_redemptions
for select
to authenticated
using (public.is_project_staff(project_id));

drop policy if exists reward_redemptions_insert_project_staff on public.reward_redemptions;
create policy reward_redemptions_insert_project_staff
on public.reward_redemptions
for insert
to authenticated
with check (public.is_project_staff(project_id));

grant all on table public.rewards to anon;
grant all on table public.rewards to authenticated;
grant all on table public.rewards to service_role;

grant all on table public.reward_redemptions to anon;
grant all on table public.reward_redemptions to authenticated;
grant all on table public.reward_redemptions to service_role;

revoke all on function public.redeem_reward_points(uuid, uuid, text) from public;
revoke all on function public.redeem_reward_points(uuid, uuid, text) from anon;
revoke all on function public.redeem_reward_points(uuid, uuid, text) from authenticated;
grant execute on function public.redeem_reward_points(uuid, uuid, text) to service_role;
