-- Plan changes must not recover a paid delinquency. The delinquency recovery
-- source of truth remains the Asaas payment webhook that clears past_due.

do $$
declare
  v_function_sql text;
  v_anchor text := $anchor$
  if not found then
    raise exception 'Eligible subscription for plan change session % not found', p_session_id using errcode = 'P0002';
  end if;
$anchor$;
  v_replacement text := $replacement$
  if not found then
    raise exception 'Eligible subscription for plan change session % not found', p_session_id using errcode = 'P0002';
  end if;

  if v_subscription.status = 'past_due' then
    raise exception 'Regularize a cobrança pendente antes de alterar o plano.' using errcode = '23514';
  end if;
$replacement$;
begin
  select pg_get_functiondef(
    'public.apply_billing_plan_change(uuid, uuid, text, text, text)'::regprocedure
  )
    into v_function_sql;

  if v_function_sql is null then
    raise exception 'Function public.apply_billing_plan_change(uuid, uuid, text, text, text) not found';
  end if;

  if position(v_replacement in v_function_sql) > 0 then
    return;
  end if;

  if position(v_anchor in v_function_sql) = 0 then
    raise exception 'apply_billing_plan_change past_due guard anchor not found';
  end if;

  execute replace(v_function_sql, v_anchor, v_replacement);
end;
$$;
