-- Corrige registros legados criados pelo checkout recorrente do Asaas.
-- O ID real de assinatura do Asaas possui prefixo "sub_"; UUIDs nessa coluna
-- eram IDs de checkout e causavam PUT /subscriptions/{uuid} => 404.

update public.billing_subscriptions
set
  gateway_subscription_id = null,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'cleared_invalid_gateway_subscription_id', gateway_subscription_id,
    'cleared_invalid_gateway_subscription_id_at', now()
  )
where gateway_provider = 'asaas'
  and gateway_subscription_id is not null
  and gateway_subscription_id !~* '^sub_[a-z0-9]+$';
