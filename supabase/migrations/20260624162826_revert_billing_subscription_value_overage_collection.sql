-- Revert the temporary fallback that collected overage by changing the Asaas
-- subscription recurring value. Overage collection must target a concrete
-- editable subscription payment instead.

do $$
declare
  v_legacy_count bigint;
begin
  select count(*)
    into v_legacy_count
  from public.billing_invoice_collection_batches
  where collection_mode <> 'subscription_payment_adjustment';

  if v_legacy_count > 0 then
    raise exception
      'Cannot revert subscription value overage collection while % legacy collection batch(es) still exist.',
      v_legacy_count;
  end if;
end
$$;

drop index if exists public.billing_invoice_collection_batches_subscription_value_uidx;

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.billing_invoice_collection_batches'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%collection_mode%'
  loop
    execute format(
      'alter table public.billing_invoice_collection_batches drop constraint if exists %I',
      v_constraint_name
    );
  end loop;
end
$$;

alter table public.billing_invoice_collection_batches
  add constraint billing_invoice_collection_batches_collection_mode_check
  check (collection_mode in ('subscription_payment_adjustment'));

comment on column public.billing_invoice_collection_batches.collection_mode is
  'subscription_payment_adjustment updates an existing editable Asaas subscription payment for overage collection.';
