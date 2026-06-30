-- Support collecting overage through a temporary Asaas subscription value
-- adjustment when card subscriptions do not expose an editable pending payment.

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
  check (
    collection_mode in (
      'subscription_payment_adjustment',
      'subscription_value_adjustment'
    )
  );

create unique index if not exists billing_invoice_collection_batches_subscription_value_uidx
  on public.billing_invoice_collection_batches(gateway_provider, gateway_subscription_id)
  where collection_mode = 'subscription_value_adjustment'
    and status in ('pending', 'open', 'past_due');

comment on column public.billing_invoice_collection_batches.collection_mode is
  'subscription_payment_adjustment updates an existing Asaas payment; subscription_value_adjustment temporarily updates the Asaas subscription value until the next card charge is confirmed.';
