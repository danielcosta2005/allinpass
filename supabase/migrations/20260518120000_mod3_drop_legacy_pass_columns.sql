-- Consolidado: remove colunas legadas de passe em billing_plans e billing_subscriptions.
-- Colunas oficiais:
-- - included_pass_installs
-- - overage_pass_install_cents

-- ------------------------------------------------------------------
-- 1) billing_plans
-- ------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_plans'
      and column_name = 'included_passes'
  ) then
    execute $sql$
      update public.billing_plans
      set included_pass_installs = greatest(
        coalesce(included_pass_installs, 0),
        coalesce(included_passes, 0)
      )
      where included_passes is not null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_plans'
      and column_name = 'overage_price_cents'
  ) then
    execute $sql$
      update public.billing_plans
      set overage_pass_install_cents = greatest(
        coalesce(overage_pass_install_cents, 0),
        coalesce(overage_price_cents, 0)
      )
      where overage_price_cents is not null
    $sql$;
  end if;
end
$$;

alter table public.billing_plans
  drop column if exists included_passes,
  drop column if exists overage_price_cents;

-- ------------------------------------------------------------------
-- 2) billing_subscriptions
-- ------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_subscriptions'
      and column_name = 'included_passes'
  ) then
    execute $sql$
      update public.billing_subscriptions
      set included_pass_installs = greatest(
        coalesce(included_pass_installs, 0),
        coalesce(included_passes, 0)
      )
      where included_passes is not null
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_subscriptions'
      and column_name = 'overage_price_cents'
  ) then
    execute $sql$
      update public.billing_subscriptions
      set overage_pass_install_cents = greatest(
        coalesce(overage_pass_install_cents, 0),
        coalesce(overage_price_cents, 0)
      )
      where overage_price_cents is not null
    $sql$;
  end if;
end
$$;

alter table public.billing_subscriptions
  drop column if exists included_passes,
  drop column if exists overage_price_cents;
