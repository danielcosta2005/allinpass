alter table if exists public.rewards
  drop constraint if exists rewards_notification_message_not_blank;

alter table if exists public.rewards
  drop column if exists notification_message;

alter table if exists public.reward_redemptions
  drop column if exists notification_message;

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

revoke all on function public.redeem_reward_points(uuid, uuid, text) from public;
revoke all on function public.redeem_reward_points(uuid, uuid, text) from anon;
revoke all on function public.redeem_reward_points(uuid, uuid, text) from authenticated;
grant execute on function public.redeem_reward_points(uuid, uuid, text) to service_role;
