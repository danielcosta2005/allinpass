# README do Schema - Modulo 3

Este documento explica o schema criado na migration `20260430120220_schema_mod3.sql`.

## Objetivo

Atender aos requisitos da sprint para:
- ciclo de vida de trial e assinatura
- cobranca recorrente e cobranca por uso
- cobranca retroativa por lotes
- gestao de creditos
- notificacoes financeiras
- auditoria operacional de billing

## Tabelas por Dominio

### Catalogo de Planos e Identidade de Cobranca

#### `public.billing_plans`
Catalogo de planos usado pelas assinaturas.

Campos principais:
- identidade do catalogo: `code`, `name`, `description`
- modelo comercial: `base_price_cents`, `included_passes`, `overage_price_cents`
- periodicidade e trial: `billing_interval`, `trial_days`
- caminho de upgrade automatico: `auto_upgrade_to_plan_id`
- flags comerciais: `is_active`, `features`

Por que existe:
- centralizar preco e limites
- suportar upgrade automatico de plano

#### `public.billing_accounts`
Perfil de faturamento de cada projeto (`unique(project_id)`).

Campos principais:
- vinculo: `project_id`
- dados legais: `legal_name`, `billing_email`, `document_type`, `document_number`, `address`
- vinculo com gateway: `gateway_provider`, `gateway_customer_id`, `provider_status`
- dados extras: `metadata`

Por que existe:
- separar o perfil legal/financeiro dos dados operacionais do projeto

#### `public.billing_payment_methods`
Metodos de pagamento tokenizados vinculados a conta de faturamento.

Campos principais:
- vinculo: `project_id`, `billing_account_id`
- referencia do gateway: `gateway_provider`, `gateway_payment_method_id`
- snapshot do cartao: `brand`, `last4`, `exp_month`, `exp_year`, `holder_name`
- estado e padrao: `status`, `is_default`

Por que existe:
- permitir atualizacao autonoma do meio de pagamento
- manter controle de metodo padrao e fallback

### Ciclo de Vida da Assinatura

#### `public.billing_subscriptions`
Estado da assinatura por projeto.

Campos principais:
- vinculo: `project_id`, `billing_account_id`, `plan_id`
- ciclo de vida: `status` (`trialing`, `active`, `past_due`, `paused`, `canceled`, `expired`)
- trial e periodo: `trial_started_at`, `trial_ends_at`, `current_period_start`, `current_period_end`
- controle de cancelamento: `cancel_at_period_end`, `canceled_at`, `ended_at`
- referencia de gateway: `gateway_provider`, `gateway_subscription_id`
- snapshot comercial: `base_price_cents`, `included_passes`, `overage_price_cents`, `currency`

Por que existe:
- controlar conversao de trial e transicoes da cobranca recorrente

#### `public.billing_subscription_changes`
Historico de transicoes da assinatura.

Campos principais:
- vinculo: `project_id`, `subscription_id`
- transicao: `previous_plan_id`, `new_plan_id`, `change_type`
- motivo e impacto financeiro: `change_reason`, `proration_delta_cents`
- rastreabilidade: `effective_at`, `requested_by`, `metadata`

Por que existe:
- registrar upgrade/downgrade/renovacao/cancelamento para suporte e auditoria

### Ciclos e Faturas

#### `public.billing_cycles`
Periodos faturaveis para assinatura, uso ou retroativo.

Campos principais:
- vinculo: `project_id`, `subscription_id` (opcional)
- semantica de periodo: `cycle_type`, `frequency`, `period_start`, `period_end`
- estado operacional: `status`, `closed_at`

Por que existe:
- normalizar fechamento de ciclo e geracao de faturas por periodo

#### `public.billing_invoices`
Cabecalho das faturas.

Campos principais:
- vinculo: `project_id`
- relacoes opcionais: `subscription_id`, `billing_cycle_id`, `billing_account_id`
- referencias externas: `invoice_number`, `gateway_invoice_id`, `gateway_charge_id`
- ciclo de vida: `status` (`draft`, `open`, `paid`, `past_due`, `failed`, `canceled`, `refunded`)
- valores: `subtotal_cents`, `tax_cents`, `discount_cents`, `total_cents`, `amount_paid_cents`, `amount_due_cents`
- datas: `issued_at`, `due_at`, `paid_at`, `failed_at`

Por que existe:
- armazenar o estado oficial de cobranca e pagamento

#### `public.billing_invoice_items`
Itens de linha da fatura.

Campos principais:
- vinculo: `project_id`, `invoice_id`
- tipo: `item_type` (`subscription_base`, `overage_pass`, `credit_purchase`, `proration`, `retroactive_usage`, `adjustment`)
- composicao da linha: `description`, `quantity`, `unit_amount_cents`, `line_total_cents`
- recorte opcional de periodo: `period_start`, `period_end`

Por que existe:
- dar transparencia total da composicao de cada cobranca

### Medicao de Uso e Cobranca Retroativa

#### `public.billing_usage_events`
Ledger atomico de uso para cobranca por passes.

Campos principais:
- vinculo: `project_id`
- relacoes opcionais: `subscription_id`, `billing_cycle_id`, `invoice_item_id`, `reprocessing_batch_id`, `pass_id`
- semantica do evento: `event_type` (`issue`, `reversal`, `adjustment`), `source` (`pass_issue`, `manual`, `import`, `retroactive_reprocess`)
- dados de cobranca: `quantity`, `unit_amount_cents`, `is_billable`, `occurred_at`

Por que existe:
- viabilizar acumulo de uso e cobranca consolidada
- permitir estorno/ajuste e rastreio do retroativo

#### `public.billing_reprocessing_batches`
Controle dos lotes de cobranca retroativa.

Campos principais:
- vinculo: `project_id`, `created_by`
- estado do lote: `status` (`pending`, `running`, `completed`, `failed`, `canceled`)
- janela retroativa: `lookback_months`, `period_start`, `period_end`
- datas: `triggered_at`, `completed_at`

Por que existe:
- suportar regras de cobranca tardia em periodos passados

### Creditos

#### `public.billing_credit_wallets`
Saldo de creditos por projeto (`unique(project_id)`).

Campos principais:
- vinculo: `project_id`
- saldo e politica: `balance_credits`, `low_balance_threshold`, `auto_recharge_enabled`, `auto_recharge_pack_size`

Por que existe:
- suportar modelo pre-pago e compra adicional de creditos

#### `public.billing_credit_transactions`
Ledger de movimentacoes de credito.

Campos principais:
- vinculo: `project_id`, `wallet_id`
- tipo de movimento: `transaction_type` (`grant`, `purchase`, `consume`, `expire`, `refund`, `adjustment`, `reversal`)
- valor: `credits_delta`
- referencias opcionais: `invoice_item_id`, `usage_event_id`
- rastreabilidade: `reason`, `created_by`, `metadata`

Por que existe:
- oferecer trilha auditavel para conciliacao de creditos

### Notificacoes Financeiras

#### `public.billing_notification_rules`
Regras de notificacao financeira recorrente.

Campos principais:
- vinculo: `project_id`
- gatilho e canal: `event_type`, `channel`
- recorrencia: `recurrence_unit` (`day`, `week`, `month`), `recurrence_interval`
- estado do agendamento: `is_active`, `next_run_at`, `last_run_at`
- template de payload: `payload_template`

Por que existe:
- permitir lembretes recorrentes para eventos de cobranca

#### `public.billing_notification_deliveries`
Log de execucoes/envios de notificacoes.

Campos principais:
- vinculo: `project_id`, `rule_id`
- contexto opcional: `invoice_id`, `subscription_id`
- estado de entrega: `status` (`queued`, `sent`, `failed`, `skipped`)
- detalhes de execucao: `scheduled_for`, `sent_at`, `error_message`, `payload`

Por que existe:
- dar observabilidade e base para retentativas

### Auditoria de Billing

#### `public.project_billing_audit_logs`
Auditoria transversal do dominio de cobranca.

Campos principais:
- vinculo: `project_id`
- ator: `actor_user_id`
- alvo: `target_table`, `target_id`
- acao: `action` (`insert`, `update`, `delete`, `sync_gateway`)
- mudancas: `changes`

Por que existe:
- garantir rastreabilidade operacional e forense

## Seguranca (RLS)

Todas as tabelas novas estao com RLS habilitado.

Estrategia de politicas:
- acesso por membro do projeto ou superadmin via `public.can_access_project(project_id)`
- `billing_plans` permite leitura publica apenas de planos ativos
- escrita superadmin-only em tabelas financeiras sensiveis

## Funcoes e Triggers

### `public.can_access_project(p_project_id uuid)`
Funcao auxiliar de seguranca para RLS. Retorna true quando o usuario e superadmin ou membro do projeto.

### `public.trg_sync_credit_wallet_balance()`
Mantem `billing_credit_wallets.balance_credits` com base em insert/update/delete de `billing_credit_transactions`.

Regras:
- aplica delta no saldo da carteira
- bloqueia operacoes que deixariam saldo negativo

### `public.trg_log_pass_issue_billing_usage()`
Apos insert em `public.passes`, cria evento de uso em `billing_usage_events` (`event_type='issue'`, `source='pass_issue'`).

### `public.set_updated_at()`
Trigger existente reaproveitada para manter `updated_at` nas tabelas mutaveis do modulo.

## Estrategia de Indices

O schema inclui:
- indices de FK e joins para relacoes criticas
- indices parciais para subconjuntos quentes (`open` cycles, uso nao faturado, metodo padrao ativo)
- indices unicos para ids externos de gateway e invariantes de negocio
- indices compostos por `project_id + status + data` para dashboard e backoffice

## Invariantes de Negocio

- uma conta de faturamento por projeto
- no maximo uma assinatura active-like por projeto (indice parcial em `trialing|active|past_due|paused`)
- validacoes de nao-negatividade para valores monetarios e limites
- carteira de creditos nao pode ficar negativa (validacao em trigger)

## Fluxos Principais

1. Trial para pago:
- assinatura inicia em `trialing`
- conversao atualiza assinatura e registra `billing_subscription_changes`

2. Cobranca por uso:
- emissao de passe gera `billing_usage_events`
- ciclo fecha em `billing_cycles`
- fatura/itens sao gerados em `billing_invoices` / `billing_invoice_items`

3. Retroativo:
- lote criado em `billing_reprocessing_batches`
- eventos retroativos e itens de fatura sao gerados e vinculados

4. Creditos:
- movimentos em `billing_credit_transactions`
- saldo da carteira atualizado automaticamente em `billing_credit_wallets`

## Referencias de Arquivos

- Migration: `supabase/migrations/20260430120220_schema_mod3.sql`
- README: `supabase/migrations/README_schema_mod3.md`
