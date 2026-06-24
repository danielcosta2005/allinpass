# Schema Modulo 3 - Visao de Negocio (Consolidado)

Este documento descreve o estado atual do modulo considerando:
- `supabase/migrations/20260430120220_schema_mod3.sql`
- `supabase/migrations/20260507143000_mod3_usage_installs_notifications_and_plan_changes.sql`
- `supabase/migrations/20260527120000_signup_paid_asaas_checkout.sql`
- `supabase/migrations/20260529191832_billing_plan_upgrades.sql`

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

### `public.billing_plan_change_sessions`
Registra a intencao operacional de mudanca de plano criada dentro do painel do estabelecimento, depois que o projeto e a assinatura ja existem.

Colunas principais:
- vinculo: `project_id`, `subscription_id`, `previous_plan_id`, `new_plan_id`, `requested_by`
- mudanca: `change_type` (`upgrade`, `downgrade`, `trial_conversion` ou `plan_change`), `effective_mode`
- gateway: `provider`, `provider_checkout_id`, `provider_subscription_id`, `provider_customer_id`, `provider_payment_id`
- controle: `external_reference`, `status`, `amount_cents`, `currency`
- retorno: `checkout_url`, `success_url`, `cancel_url`, `expired_url`
- datas: `paid_at`, `expires_at`, `applied_at`

Fluxo esperado:
- `billing-start-plan-change` valida o usuario owner, a assinatura atual e o plano destino.
- Para trial/free sem assinatura Asaas, cria checkout recorrente e registra a sessao.
- Para assinatura paga existente no Asaas, atualiza a assinatura no gateway. Upgrade aplica localmente na hora; downgrade fica `paid` + `next_cycle`.
- Downgrade nao altera cobrancas pendentes no Asaas (`updatePendingPayments = false`) e mantem o snapshot local do plano atual ate `current_period_end`.
- So existe uma mudanca `next_cycle` ativa por assinatura. Uma nova mudanca agendada marca a anterior como `superseded`.
- Uma mudanca imediata aplicada tambem marca qualquer `next_cycle` pendente da mesma assinatura como `superseded`.
- `asaas-webhook` marca a sessao de mudanca de plano como `paid` e chama a aplicacao transacional; se for `next_cycle` antes do fim do ciclo, a RPC retorna `scheduled`.
- `billing-finalize-plan-change` permite finalizar pelo retorno do `/org` quando o webhook ja confirmou o pagamento.
- `apply_due_billing_plan_changes()` roda via cron e aplica sessoes `paid` + `next_cycle` quando `current_period_end <= now()`.
- `get_pending_billing_plan_change(project_id)` expoe ao frontend somente a mudanca `next_cycle` ativa do projeto acessivel, para desabilitar o plano ja agendado na UI.

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

Para Asaas, `gateway_subscription_id` deve conter somente o ID real da assinatura (`sub_...`). IDs UUID de checkout pertencem a `signup_checkout_sessions.provider_checkout_id` ou `billing_plan_change_sessions.provider_checkout_id` e nao devem ser usados em `/subscriptions/{id}`.

### `public.billing_subscription_changes`
Historico de troca de plano e base para franquia efetiva do ciclo.

Colunas principais:
- vinculo: `project_id`, `subscription_id`
- mudanca: `previous_plan_id`, `new_plan_id`, `change_type`, `effective_at`
- politica: `effective_mode` (`immediate` ou `next_cycle`)
- franquia efetiva: `prorated_install_allowance`, `prorated_notification_allowance`
- preco efetivo de excedente: `effective_overage_pass_install_cents`, `effective_overage_notification_sent_cents`
- rastreio de calculo: snapshots `previous_*` / `new_*`

## 4) Ciclo, fatura e itens

### `public.billing_cycles`
Controla a janela de apuracao mensal (ou retroativa).

Colunas principais:
- escopo: `project_id`, `subscription_id`
- janela: `period_start`, `period_end`
- tipo/estado: `cycle_type`, `status`

### `public.billing_invoices`
Cabecalho da fatura interna de excedente do ciclo. A mensalidade base continua sendo cobrada pela assinatura recorrente do Asaas; esta tabela registra apenas o snapshot financeiro do excedente apurado.

Colunas principais:
- vinculo: `project_id`, `billing_cycle_id`, `subscription_id`
- status financeiro: `status`, `issued_at`, `due_at`, `paid_at`
- totais: `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents`
- gateway: `gateway_provider`, `gateway_invoice_id`, `gateway_charge_id`
- coleta: `collection_batch_id`

### `public.billing_invoice_collection_batches`
Agrupa uma ou mais invoices de excedente que serao cobradas junto da mensalidade Asaas.

Colunas principais:
- vinculo: `project_id`, `subscription_id`, `billing_account_id`
- gateway: `gateway_provider`, `gateway_subscription_id`, `gateway_charge_id`, `gateway_charge_status`
- modo: `collection_mode` em `subscription_payment_adjustment` ou `subscription_value_adjustment`
- valores: `original_subscription_payment_cents`, `overage_cents`, `updated_payment_cents`
- estado: `status`, `attempt_count`, `last_attempt_at`, `paid_at`, `failed_at`

Uso esperado:
- nao cria cobranca avulsa automaticamente;
- em `subscription_payment_adjustment`, atualiza uma cobranca Asaas especifica (`/payments/{id}`);
- em `subscription_value_adjustment`, prepara temporariamente uma assinatura `CREDIT_CARD` com `value = mensalidade + excedente`;
- o webhook reseta a assinatura para o valor original quando o batch temporario chega a estado terminal;
- permite carregar invoices `draft` para a proxima cobranca mensal editavel quando nenhuma cobranca pendente existir no momento do fechamento e a assinatura nao for cartao.

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

### `public.billing_cycle_usage_summaries`
Resumo operacional de consumo por ciclo/periodo.

Colunas principais:
- vinculo: `project_id`, `subscription_id`, `billing_cycle_id`
- janela: `period_start`, `period_end`
- contadores: `pass_install_quantity`, `notification_sent_quantity`
- franquia/preco efetivos: `included_pass_installs`, `included_notification_sends`, `overage_pass_install_cents`, `overage_notification_sent_cents`
- excedente vivo: `pass_install_overage_quantity`, `notification_sent_overage_quantity`, `pass_install_overage_cents`, `notification_sent_overage_cents`, `total_overage_cents`
- auditoria leve: `last_usage_event_at`, `metadata`

Uso esperado:
- `billing_usage_events` continua sendo o ledger auditavel e fonte da verdade.
- `billing_cycle_usage_summaries` evita somas repetidas para dashboard, limite do ciclo e pre-fechamento.
- os campos de excedente sao recalculados a partir do uso agregado e da franquia/preco efetivos do ciclo.
- mudancas em `billing_subscription_changes` disparam recalc imediato dos resumos do ciclo afetado.
- `billing_invoices` e `billing_invoice_items` continuam sendo snapshot financeiro gerado no fechamento, nao contador vivo.
- antes de fechar um ciclo, `refresh_billing_cycle_usage_summary_for_cycle(cycle_id)` re-soma os eventos do ciclo e atualiza o summary usado pela invoice.

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

### Triggers de resumo por ciclo em `billing_usage_events`
- `trg_prepare_billing_usage_event_cycle`: antes de inserir/alterar campos de apuracao, tenta preencher `subscription_id` e `billing_cycle_id` usando `billing_cycles` ou a janela atual de `billing_subscriptions`.
- `trg_sync_billing_cycle_usage_summary`: depois de inserir/alterar/remover eventos de uso, aplica o delta em `billing_cycle_usage_summaries`.
- `trg_billing_subscription_changes_recalculate_usage_summary`: depois de inserir/alterar/remover mudanca de plano, recalcula os summaries do ciclo afetado para refletir a franquia/preco efetivos.

Regras de contagem:
- so considera `is_billable = true`
- so considera `event_type = 'issue'`
- so considera `resource_type in ('pass_install', 'notification_sent')`
- se nao houver ciclo/assinatura resolvivel, o evento permanece no ledger mas nao entra no resumo

Garantia operacional:
- a chave unica `(project_id, subscription_id, period_start, period_end)` evita duplicidade de resumo
- updates/deletes raros aplicam delta reverso para manter o agregado consistente
- `public.recalculate_billing_cycle_usage_summary(summary_id)` usa `get_billing_cycle_entitlements` para atualizar franquia/preco efetivos e excedentes sem re-somar `billing_usage_events`
- `public.recalculate_billing_cycle_usage_summaries_for_subscription_change(...)` localiza summaries afetados por uma linha de `billing_subscription_changes` e chama o recalc individual.
- um backfill na migration recalcula resumos para eventos ja existentes

## D) Enriquecimento de mudanca de plano, franquia e excedente

### Trigger `trg_billing_subscription_changes_enrich`
- tabela/evento: `before insert` em `public.billing_subscription_changes`
- funcao: `public.trg_enrich_subscription_change_proration()`

Responsabilidades:
- definir/completar politica de ciclo:
  - `effective_mode`: modo de aplicacao informado pelo fluxo (`immediate` ou `next_cycle`)
  - `allowance_proration_mode`: `full_new_plan` quando nao informado em mudancas de plano
- preencher snapshots na linha de mudanca:
  - franquias anteriores/novas (`*_included_pass_installs`, `*_included_notification_sends`)
  - precos de excedente anteriores/novos (`*_overage_*_cents`)
- completar janela do ciclo (`cycle_started_at`, `cycle_ends_at`) usando `billing_subscriptions` quando faltar
- calcular a franquia efetiva do ciclo em `prorated_install_allowance` e `prorated_notification_allowance`:
  - `next_cycle`: usa franquia anterior inteira
  - `immediate` + `full_new_plan`: usa franquia cheia do novo plano
  - `immediate` + `prorated_daily`: faz media ponderada por tempo dentro do ciclo
- calcular o preco efetivo de excedente:
  - `full_new_plan`: usa preco de excedente do novo plano
  - `next_cycle`: usa preco de excedente do plano anterior

Resultado pratico: upgrade entrega beneficio cheio no ciclo atual, e o fechamento mensal consegue calcular excedente com o preco correto do plano efetivo.

### Funcoes auxiliares de apuracao

- `public.get_billing_cycle_entitlements(subscription_id, period_start, period_end)`: retorna a franquia e os precos de excedente efetivos para um ciclo.
- `public.calculate_billing_cycle_overage(subscription_id, period_start, period_end)`: soma `billing_usage_events`, compara com a franquia efetiva e retorna quantidades/valores de excedente.
- `public.refresh_billing_cycle_usage_summary_for_cycle(cycle_id)`: reatribui eventos do periodo ao ciclo, re-soma quantidades e recalcula franquia/preco/excedente no summary.

### Funcao `close_billing_cycle_for_overage(cycle_id)`
Fecha um ciclo de assinatura vencido e gera invoice interna somente quando ha excedente.

Responsabilidades:
- bloquear o ciclo e a assinatura;
- atualizar `billing_cycle_usage_summaries` a partir de `billing_usage_events`;
- criar `billing_invoices` e `billing_invoice_items` apenas para `total_overage_cents > 0`;
- marcar ciclo sem excedente como `closed` e ciclo com excedente como `invoiced`;
- aplicar mudancas `next_cycle` pagas depois de fechar o ciclo antigo;
- avancar `billing_subscriptions.current_period_start/current_period_end`;
- abrir o proximo `billing_cycles` e precriar summary zerado.

Resultado pratico: downgrades agendados so alteram a assinatura depois que o ciclo anterior foi faturado com franquia/preco antigos.

### Funcao `verify_billing_cron_secret(token)`
Valida o bearer enviado pelo `pg_cron` para chamar `billing-close-cycles`.

Responsabilidades:
- comparar o token recebido com o secret `cron_secret` armazenado no Supabase Vault;
- retornar somente booleano;
- ficar restrita a `service_role`, sem grant para `anon` ou `authenticated`.

## E) Rastreio dos free trials (cron que roda a função de 15 em 15 minutos)
### Função `expire_trial_subscriptions()`
Expira assinaturas em trial quando o prazo acabar.
Regras:
 - So expira registros com status = 'trialing' e trial_ends_at <= now()
 - trial_days = 0 nao entra nesse fluxo (normalmente nao fica como trialing)
 - Registra historico em billing_subscription_changes

## F) Aplicacao transacional de mudanca de plano
### Funcao `apply_billing_plan_change(...)`
Aplica uma sessao paga de `billing_plan_change_sessions` em uma unica transacao.

Responsabilidades:
- bloquear a sessao e a assinatura atual para evitar aplicacao duplicada;
- retornar `scheduled` sem alterar a assinatura quando a sessao for `next_cycle` e o ciclo atual ainda nao terminou;
- marcar a sessao como `superseded` quando o plano atual da assinatura ja nao bate com `previous_plan_id`;
- inserir `billing_subscription_changes`;
- atualizar `billing_subscriptions` com `plan_id`, status `active`, snapshots comerciais e IDs Asaas;
- atualizar `billing_accounts.gateway_customer_id` quando o Asaas informar cliente;
- atualizar `projects_notifications.notifications_limit` para manter compatibilidade com telas legadas;
- marcar a sessao como `applied`;
- marcar outras sessoes `next_cycle` ativas da mesma assinatura como `superseded`;
- registrar `project_billing_audit_logs`.

Resultado pratico: o frontend e o webhook nao atualizam tabelas sensiveis diretamente; eles chamam a RPC via service role depois de validar o fluxo. Upgrade aplica imediatamente; downgrade so aplica no proximo ciclo.

### Funcao `supersede_pending_next_cycle_plan_changes(...)`
Invalida mudancas agendadas antigas da mesma assinatura.

Responsabilidades:
- localizar sessoes `effective_mode = 'next_cycle'` com `status` em `pending`, `created` ou `paid`;
- mudar essas sessoes para `superseded`;
- preservar `metadata` existente e adicionar `superseded_at`, `superseded_reason` e, quando houver, `superseded_by_session_id`.

Resultado pratico: o sistema mantem historico das decisoes antigas, mas so a mudanca agendada mais recente continua ativa.

### Funcao `apply_due_billing_plan_changes()`
Aplica downgrades agendados para o proximo ciclo.

Responsabilidades:
- buscar sessoes em `billing_plan_change_sessions` com `status = 'paid'` e `effective_mode = 'next_cycle'`;
- filtrar assinaturas cujo `current_period_end <= now()` e cujo ciclo corrente ja esteja `closed`, `invoiced`, `paid` ou sem ciclo legado;
- chamar `apply_billing_plan_change(...)` para cada sessao vencida;
- rodar a cada 15 minutos pelo cron `billing-apply-due-plan-changes`.

### Funcao `get_pending_billing_plan_change(project_id)`
Retorna a mudanca `next_cycle` ativa para o projeto acessivel pelo usuario logado.

Responsabilidades:
- manter `billing_plan_change_sessions` privada para escrita/leitura direta;
- expor somente dados minimos do plano destino e status da sessao;
- permitir que a UI mostre `Downgrade ja agendado` e bloqueie nova tentativa para o mesmo plano.

## Regras de negocio principais

1. Instalacao de passe so conta 1 vez por `user_passes.id`.
2. Notificacao enviada so conta 1 vez por `notification_jobs.id`.
3. Excedente por recurso = `max(consumo - franquia efetiva do ciclo, 0)`.
4. Upgrade e conversao de trial aplicam imediatamente; downgrade fica agendado para o proximo ciclo.
5. Upgrade imediato recebe franquia cheia do novo plano no ciclo atual.
6. Downgrade mantem franquia e preco de excedente do plano atual ate o fim do ciclo ja pago; no ciclo seguinte usa franquia cheia e preco de excedente do novo plano menor.
7. Apenas uma mudanca `next_cycle` pode ficar ativa por assinatura; novas decisoes substituem a pendente anterior.
8. Uma sessao antiga nao pode aplicar se `billing_subscriptions.plan_id` for diferente de `billing_plan_change_sessions.previous_plan_id`.
9. Invoice interna de fechamento cobra apenas excedentes; a assinatura base continua recorrente no Asaas.
10. Mudanca de plano iniciada pelo painel usa `billing_plan_change_sessions`; `signup_checkout_sessions` continua exclusivo do cadastro pago.
11. `free_trial` pode ser plano de origem, mas nao pode ser destino de mudanca depois que o projeto ja existe.
12. Excedente e cobrado junto com uma cobranca mensal Asaas editavel; se nao houver cobranca pendente/vencida, a invoice permanece `draft` para carry-forward.

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

1. `billing-close-cycles` localiza `billing_cycles` vencidos.
2. `close_billing_cycle_for_overage` re-soma `billing_usage_events` no `billing_cycle_usage_summaries`.
3. Se nao houver excedente, marca o ciclo como `closed` e abre o proximo ciclo.
4. Se houver excedente, cria `billing_invoices` em `draft` e itens `overage_*`.
5. Aplica downgrades `next_cycle` pagos somente depois do fechamento do ciclo antigo.
6. A Edge Function busca uma cobranca mensal Asaas `PENDING`/`OVERDUE` da assinatura e atualiza essa cobranca com mensalidade + excedente.
7. Se a assinatura for `CREDIT_CARD` e nao houver cobranca editavel, a Edge Function prepara temporariamente o valor da assinatura com mensalidade + excedente.
8. O webhook `PAYMENT_*` marca o batch e as invoices como `paid`, `past_due`, `failed`, `canceled` ou `refunded`.
9. Para batches `subscription_value_adjustment`, o webhook reseta o valor da assinatura Asaas para a mensalidade original.

## Cenario D - Troca de plano no meio do ciclo

1. Insere em `billing_subscription_changes`.
2. Trigger enriquece snapshots antigo/novo e calcula a franquia efetiva.
3. Para upgrade/conversao imediata, a franquia efetiva e a franquia cheia do novo plano.
4. No fechamento, usa a franquia efetiva e o preco de excedente efetivo para calcular excedente corretamente.

## Dependencias operacionais externas ao modulo

O billing depende dessas tabelas para medir consumo:
- `public.user_passes`
- `public.notification_jobs`

Elas pertencem a outros modulos, mas alimentam `billing_usage_events`.
