-- Remove colunas de apresentacao em billing_plans.
-- Conteudo de marketing (features/description) fica no frontend.
-- O banco fica como fonte de verdade dos dados comerciais e de cobranca.

alter table public.billing_plans
  drop column if exists features,
  drop column if exists description;
