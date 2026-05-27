# Schema Modulo 3 - Visao de Negocio (Consolidado)

Este documento descreve o estado atual do modulo considerando:
- `supabase/migrations/20260430120220_schema_mod3.sql`
- `supabase/migrations/20260507143000_mod3_usage_installs_notifications_and_plan_changes.sql`
- `supabase/migrations/20260527120000_signup_paid_asaas_checkout.sql`

O objetivo aqui e explicar a logica do modelo de cobranca em alto nivel.

## Modelo de cobranca

O modulo opera com:
- assinatura mensal (preco base do plano)
- franquia mensal por recurso
- cobranca por excedente

Recursos cobrados:
- instalacoes de passe (`user_passes` quando vira `install_status='installed'`)
- notificacoes enviadas (`notification_jobs` quando vira `status='sent'`)

## Papel de cada tabela (com colunas principais)

## 0) Signup e checkout pago

### `public.signup_checkout_sessions`
Registra a intencao de checkout criada durante o cadastro de um plano pago, antes do provisionamento definitivo.

Colunas principais:
- vinculo: `user_id`, `plan_id`, `plan_code`
- cliente: `email`, `establishment_name`
- gateway: `provider`, `provider_checkout_id`, `provider_subscription_id`, `provider_customer_id`, `provider_payment_id`
- controle: `external_reference`, `status`, `amount_cents`, `currency`
- retorno: `checkout_url`, `success_url`, `cancel_url`, `expired_url`
- datas: `paid_at`, `expires_at`, `finalized_at`

Fluxo esperado:
- `signup-start-checkout` cria a linha e chama o Asaas.
- `asaas-webhook` muda `status` para `paid`, `canceled` ou `expired`.
- `signup-finalize` so provisiona plano pago quando essa linha esta `paid`; depois marca como `finalized`.

## 1) Catalogo comercial

### `public.billing_plans`
Define o que cada plano oferece e quanto custa.

Colunas principais:
- identificacao: `id`, `code`, `name`
- base: `base_price_cents`, `billing_interval`, `trial_days`
- franquias: `included_pass_installs`, `included_notification_sends`
- excedente: `overage_pass_install_cents`, `overage_notification_sent_cents`
- governanca: `is_active`, `auto_upgrade_to_plan_id`

Observação: apenas o plano free trial vai ter trial_days != 0

## 2) Conta de cobranca do cliente

### `public.billing_accounts`
Representa o perfil de faturamento por projeto.

Colunas principais:
- vinculo: `project_id`
- dados de faturamento: `legal_name`, `billing_email`, `document_type`, `document_number`, `address`
- integracao gateway: `gateway_provider`, `gateway_customer_id`, `provider_status`

### `public.billing_payment_methods`
Guarda os metodos/token de pagamento.

Colunas principais:
- vinculo: `project_id`, `billing_account_id`
- token gateway: `gateway_provider`, `gateway_payment_method_id`
- dados de exibicao: `brand`, `last4`, `exp_month`, `exp_year`
- operacao: `is_default`, `status`

## 3) Assinatura e mudancas de plano

### `public.billing_subscriptions`
Estado atual da assinatura ativa do projeto.

Colunas principais:
- vinculo: `project_id`, `billing_account_id`, `plan_id`
- estado: `status`, `current_period_start`, `current_period_end`
- comercial snapshot: `base_price_cents`, `included_pass_installs`, `included_notification_sends`
- preco de excedente snapshot: `overage_pass_install_cents`, `overage_notification_sent_cents`
- gateway: `gateway_provider`, `gateway_subscription_id`

### `public.billing_subscription_changes`
Historico de troca de plano e base para prorrata.

Colunas principais:
- vinculo: `project_id`, `subscription_id`
- mudanca: `previous_plan_id`, `new_plan_id`, `change_type`, `effective_at`
- politica: `effective_mode` (`immediate` ou `next_cycle`)
- prorrata: `prorated_install_allowance`, `prorated_notification_allowance`
- rastreio de calculo: snapshots `previous_*` / `new_*`

## 4) Ciclo, fatura e itens

### `public.billing_cycles`
Controla a janela de apuracao mensal (ou retroativa).

Colunas principais:
- escopo: `project_id`, `subscription_id`
- janela: `period_start`, `period_end`
- tipo/estado: `cycle_type`, `status`

### `public.billing_invoices`
Cabecalho da fatura do ciclo.

Colunas principais:
- vinculo: `project_id`, `billing_cycle_id`, `subscription_id`
- status financeiro: `status`, `issued_at`, `due_at`, `paid_at`
- totais: `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`
- gateway: `gateway_provider`, `gateway_invoice_id`, `gateway_charge_id`

### `public.billing_invoice_items`
Detalha como a fatura foi composta.

Colunas principais:
- vinculo: `project_id`, `invoice_id`
- tipo: `item_type` (`subscription_base`, `overage_pass_install`, `overage_notification_sent`, `proration`, etc.)
- valores: `quantity`, `unit_amount_cents`, `line_total_cents`
- periodo: `period_start`, `period_end`

## 5) Medicao de consumo

### `public.billing_usage_events`
Ledger de uso que alimenta a cobranca de excedente.

Colunas principais:
- vinculo: `project_id`, `subscription_id`
- classificacao: `resource_type` (`pass_install` ou `notification_sent`), `event_type`, `source`
- referencias de origem: `user_pass_id`, `notification_job_id`
- cobranca: `quantity`, `unit_amount_cents`, `is_billable`, `occurred_at`
- conciliacao: `billing_cycle_id`, `invoice_item_id`

## 6) Retroativo e creditos

### `public.billing_reprocessing_batches`
Executa e controla cobrancas retroativas.

Colunas principais:
- vinculo: `project_id`
- janela: `period_start`, `period_end`, `lookback_months`
- execucao: `status`, `triggered_at`, `completed_at`

### `public.billing_credit_wallets`
Saldo de creditos do projeto.

Colunas principais:
- vinculo: `project_id`
- saldo/politica: `balance_credits`, `low_balance_threshold`, `auto_recharge_enabled`

### `public.billing_credit_transactions`
Movimentacoes da carteira de creditos.

Colunas principais:
- vinculo: `project_id`, `wallet_id`
- tipo e valor: `transaction_type`, `credits_delta`
- conciliacao: `invoice_item_id`, `usage_event_id`

## 7) Notificacao financeira e auditoria

### `public.billing_notification_rules`
Regras de notificacao do proprio billing (vencimento, falha, renovacao etc).

Colunas principais:
- vinculo: `project_id`
- regra: `event_type`, `channel`, `recurrence_unit`, `recurrence_interval`
- execucao: `is_active`, `next_run_at`, `last_run_at`

### `public.billing_notification_deliveries`
Historico de envios das regras acima.

Colunas principais:
- vinculo: `project_id`, `rule_id`
- contexto: `invoice_id`, `subscription_id`
- entrega: `status`, `scheduled_for`, `sent_at`, `error_message`

### `public.project_billing_audit_logs`
Trilha de auditoria do modulo.

Colunas principais:
- vinculo: `project_id`
- acao: `target_table`, `target_id`, `action`
- rastreio: `actor_user_id`, `changes`, `created_at`

## Triggers do modulo (estado consolidado)

Os triggers abaixo sao os ativos apos aplicar as migrations listadas no inicio deste documento.

## A) Manutencao automatica de `updated_at`

O modulo usa `before update` + `public.set_updated_at()` para manter carimbo de ultima alteracao consistente.

Triggers:
- `trg_billing_plans_updated_at` em `public.billing_plans`
- `trg_billing_accounts_updated_at` em `public.billing_accounts`
- `trg_billing_payment_methods_updated_at` em `public.billing_payment_methods`
- `trg_billing_subscriptions_updated_at` em `public.billing_subscriptions`
- `trg_billing_cycles_updated_at` em `public.billing_cycles`
- `trg_billing_invoices_updated_at` em `public.billing_invoices`
- `trg_billing_credit_wallets_updated_at` em `public.billing_credit_wallets`
- `trg_billing_notification_rules_updated_at` em `public.billing_notification_rules`
- `trg_signup_checkout_sessions_updated_at` em `public.signup_checkout_sessions`

## B) Sincronizacao da carteira de creditos

### Trigger `trg_billing_credit_transactions_apply`
- tabela/evento: `after insert or update or delete` em `public.billing_credit_transactions`
- funcao: `public.trg_sync_credit_wallet_balance()`

Efeito:
- no `insert`: soma `credits_delta` no `balance_credits` da carteira
- no `update`: recalcula diferenca (inclusive mudanca de carteira)
- no `delete`: desfaz o efeito do lancamento removido
- se carteira nao existir, gera erro
- se saldo ficar negativo, gera erro e aborta a transacao

Resultado pratico: `billing_credit_wallets.balance_credits` vira um saldo derivado e consistente com o ledger (`billing_credit_transactions`).

## C) Medicao automatica de consumo (usage metering)

### Trigger `trg_user_passes_log_billing_usage_on_install`
- tabela/evento: `after insert or update of install_status, installed_at` em `public.user_passes`
- funcao: `public.trg_log_user_pass_install_billing_usage()`
- condicoes de contagem:
  - `project_id` precisa existir
  - so conta quando `install_status = 'installed'`
  - em `update`, se ja era `installed`, nao conta de novo

Escreve em `public.billing_usage_events` com:
- `resource_type = 'pass_install'`
- `event_type = 'issue'`
- `source = 'user_pass_install'`
- `user_pass_id = new.id`

### Trigger `trg_notification_jobs_log_billing_usage_on_sent`
- tabela/evento: `after insert or update of status, sent_at` em `public.notification_jobs`
- funcao: `public.trg_log_notification_sent_billing_usage()`
- condicoes de contagem:
  - `project_id` precisa existir
  - so conta quando `status = 'sent'`
  - em `update`, se ja era `sent`, nao conta de novo

Escreve em `public.billing_usage_events` com:
- `resource_type = 'notification_sent'`
- `event_type = 'issue'`
- `source = 'notification_job_sent'`
- `notification_job_id = new.id`

Garantia de idempotencia (sem dupla contagem):
- `on conflict do nothing` no insert do trigger
- indice unico `billing_usage_events_user_pass_install_once_uidx`
- indice unico `billing_usage_events_notification_sent_once_uidx`

Observacao de consolidacao:
- o trigger legado `trg_passes_log_billing_usage` (em `public.passes`) foi removido
- o modelo atual mede consumo por instalacao (`user_passes`) e envio (`notification_jobs`)

## D) Enriquecimento de mudanca de plano e prorrata

### Trigger `trg_billing_subscription_changes_enrich`
- tabela/evento: `before insert` em `public.billing_subscription_changes`
- funcao: `public.trg_enrich_subscription_change_proration()`

Responsabilidades:
- definir defaults de politica:
  - `effective_mode`: downgrade tende a `next_cycle`, outros a `immediate`
  - `allowance_proration_mode`: `prorated_daily` quando nao informado
- preencher snapshots na linha de mudanca:
  - franquias anteriores/novas (`*_included_pass_installs`, `*_included_notification_sends`)
  - precos de excedente anteriores/novos (`*_overage_*_cents`)
- completar janela do ciclo (`cycle_started_at`, `cycle_ends_at`) usando `billing_subscriptions` quando faltar
- calcular `prorated_install_allowance` e `prorated_notification_allowance`:
  - `next_cycle`: usa franquia anterior inteira
  - `immediate` + `prorated_daily`: faz media ponderada por tempo dentro do ciclo

Resultado pratico: fechamento mensal consegue calcular excedente com base no contexto real da troca de plano, sem depender do estado atual do plano no momento da leitura.

## E) Rastreio dos free trials (cron que roda a função de 15 em 15 minutos)
### Função `expire_trial_subscriptions()`
Expira assinaturas em trial quando o prazo acabar.
Regras:
 - So expira registros com status = 'trialing' e trial_ends_at <= now()
 - trial_days = 0 nao entra nesse fluxo (normalmente nao fica como trialing)
 - Registra historico em billing_subscription_changes

## Regras de negocio principais

1. Instalacao de passe so conta 1 vez por `user_passes.id`.
2. Notificacao enviada so conta 1 vez por `notification_jobs.id`.
3. Excedente por recurso = `max(consumo - franquia, 0)`.
4. Upgrade preferencialmente imediato com prorrata; downgrade no proximo ciclo.
5. Fatura final combina assinatura base + excedentes + prorrata (quando houver).

## Fluxo de negocio (fim a fim)

## Cenario A - Cliente faz checkout e escolhe plano

1. Frontend cria usuario via Supabase Auth.
2. `signup-start-checkout` cria `signup_checkout_sessions` e checkout recorrente no Asaas.
3. Asaas confirma pagamento pelo webhook e a sessao fica `paid`.
4. Frontend retorna para `/cadastro` e chama `signup-finalize`.
5. `signup-finalize` cria/atualiza `billing_accounts`.
6. `signup-finalize` cria `billing_subscriptions` com snapshot comercial do plano.
7. `signup-finalize` abre o primeiro `billing_cycles`.

## Cenario B - Cliente consome recursos no mes

1. Passe instalado -> trigger gera evento `pass_install` em `billing_usage_events`.
2. Notificacao enviada -> trigger gera evento `notification_sent` em `billing_usage_events`.
3. Indices unicos garantem que nao haja dupla contagem por id de origem.

## Cenario C - Fechamento mensal

1. Sistema define janela em `billing_cycles`.
2. Soma consumo por recurso em `billing_usage_events`.
3. Compara com franquias do snapshot da assinatura.
4. Calcula excedentes e cria `billing_invoices`.
5. Gera `billing_invoice_items` (base + excedente + prorrata).

## Cenario D - Troca de plano no meio do ciclo

1. Insere em `billing_subscription_changes`.
2. Trigger enriquece snapshots antigo/novo e calcula franquia prorrateada.
3. No fechamento, usa franquia prorrateada para calcular excedente corretamente.

## Dependencias operacionais externas ao modulo

O billing depende dessas tabelas para medir consumo:
- `public.user_passes`
- `public.notification_jobs`

Elas pertencem a outros modulos, mas alimentam `billing_usage_events`.
