# Arquitetura de seguranca

Este documento mapeia a arquitetura de seguranca do Allin Pass a partir do checkout atual. O objetivo e inventariar componentes, fronteiras e fluxos. Nao ha analise de vulnerabilidades neste arquivo.

## Escopo e fontes

Fontes usadas:

- `supabase/migrations/*.sql`;
- `supabase/config.toml`;
- `supabase/functions/*/index.ts`;
- `frontend/src/contexts/SupabaseAuthContext.jsx`;
- `frontend/src/layouts/ProtectedLayout.jsx`;
- `frontend/src/App.jsx`;
- `frontend/src/lib/*.js`;
- `docs/fluxo-autenticacao.md`;
- `docs/database/schema_17_05_26.md`.

Limitacoes do mapeamento:

- O schema foi inferido por arquivos versionados. Nao houve introspeccao de um banco Supabase em execucao.
- `docs/database/schema_17_05_26.md` e um snapshot anterior a varias migrations de maio; as tabelas e policies posteriores foram complementadas pelas migrations.
- Policies efetivas foram inferidas pela ordem dos `create policy` e `drop policy if exists`; blocos condicionais e estado real do banco precisam ser confirmados posteriormente.
- Configuracoes de deploy do Supabase Dashboard, secrets e `verify_jwt` de functions nao listadas em `supabase/config.toml` precisam ser verificadas posteriormente.

## Modelo de seguranca em alto nivel

O sistema usa Supabase Auth para identidade e uma camada propria de autorizacao por role e por projeto.

Principais identidades:

- Usuario Supabase Auth: fonte da sessao e do JWT.
- `profiles`: classifica o usuario por role global.
- `project_members`: vincula usuarios a projetos e define role operacional por projeto.
- `projects.created_by`: vincula projetos criados por usuarios `admin`.

Roles globais em `profiles.role`:

- `superadmin`;
- `admin`;
- `establishment`;
- `customer`.

Roles por projeto em `project_members.role`:

- `owner`;
- `staff`.

Padroes de autorizacao:

- Frontend usa `VITE_SUPABASE_ANON_KEY` e sessao Supabase persistida.
- RLS protege acesso direto via Data API nas tabelas onde esta ativa.
- Edge Functions usam dois modelos:
  - cliente com anon key + `Authorization` do usuario para validar contexto por `auth.getUser()`;
  - cliente com `SUPABASE_SERVICE_ROLE_KEY` para operacoes administrativas, filas, webhooks, cron e integracoes externas.
- Algumas RPCs `SECURITY DEFINER` encapsulam consultas, helpers de autorizacao, provisionamento, billing e operacoes atomicas.

## Tabelas

Inventario por dominio, conforme migrations:

| Dominio | Tabelas |
|---|---|
| Identidade e tenancy | `profiles`, `projects`, `project_members`, `orgs`, `org_members`, `clients` |
| Wallet e passes | `passes`, `user_passes`, `wallet_templates`, `wallet_configs`, `wallet_configs_history`, `wallet_links`, `project_wallets`, `locations`, `pass_locations`, `passkit_events`, `passkit_registrations`, `user_wallets`, `wallet.issued_passes`, `wallet.projects`, `wallet.templates` |
| Clientes, visitas e fidelidade | `customers`, `visits`, `events`, `loyalty_states`, `rewards`, `reward_redemptions` |
| Notificacoes e automacoes | `notifications`, `notification_jobs`, `projects_notifications`, `automations`, `automation_dispatches` |
| Billing | `billing_plans`, `billing_accounts`, `billing_payment_methods`, `billing_subscriptions`, `billing_subscription_changes`, `billing_cycles`, `billing_invoices`, `billing_invoice_items`, `billing_usage_events`, `billing_credit_wallets`, `billing_credit_transactions`, `billing_notification_rules`, `billing_notification_deliveries`, `billing_reprocessing_batches`, `billing_plan_change_sessions`, `project_billing_audit_logs` |
| Signup e controles operacionais | `signup_precheck_rate_limits`, `signup_finalizations`, `signup_existing_customer_intents`, `signup_checkout_sessions`, `function_logs`, `secrets` |

Status RLS inferido:

| Status | Tabelas |
|---|---|
| RLS ativa com policies efetivas inferidas | `automation_dispatches`, `automations`, `billing_accounts`, `billing_credit_transactions`, `billing_credit_wallets`, `billing_cycles`, `billing_invoice_items`, `billing_invoices`, `billing_notification_deliveries`, `billing_notification_rules`, `billing_payment_methods`, `billing_plans`, `billing_reprocessing_batches`, `billing_subscription_changes`, `billing_subscriptions`, `billing_usage_events`, `customers`, `events`, `locations`, `loyalty_states`, `notification_jobs`, `notifications`, `org_members`, `orgs`, `passes`, `profiles`, `project_billing_audit_logs`, `project_members`, `project_wallets`, `projects`, `projects_notifications`, `reward_redemptions`, `rewards`, `signup_precheck_rate_limits`, `user_wallets`, `visits`, `wallet_configs`, `wallet_configs_history`, `wallet_links`, `wallet_templates`, `wallet.templates` |
| RLS ativa sem policy efetiva inferida | `billing_plan_change_sessions`, `clients`, `secrets`, `signup_checkout_sessions`, `signup_existing_customer_intents`, `signup_finalizations`, `wallet.issued_passes` |
| Sem `enable row level security` identificado nas migrations | `function_logs`, `pass_locations`, `passkit_events`, `passkit_registrations`, `user_passes`, `wallet.projects` |

Storage identificado no snapshot de schema:

| Bucket | Publico | Observacao |
|---|---:|---|
| `pass-assets` | Sim | Assets e arquivos de passes. |
| `project-logos` | Sim | Logos de projetos. |
| `secrets` | Nao | Arquivos sensiveis de wallet/certificados. |

## Relacionamentos

Relacionamentos centrais:

- `projects` e o agregado multi-tenant principal.
- Muitas tabelas carregam `project_id` e apontam para `projects.id`.
- `project_members` e a tabela de autorizacao por projeto.
- `profiles` armazena role global e e usada por helpers e Edge Functions.
- `user_passes` conecta `passes`, cliente final, instalacao de wallet e eventos de visita/notificacao.
- Billing referencia `projects`, `billing_plans`, `billing_subscriptions`, invoices/cycles e eventos de uso.

Mapa de FKs principais por destino:

| Destino | Origens |
|---|---|
| `projects.id` | `automations.project_id`, `billing_accounts.project_id`, `billing_cycles.project_id`, `billing_credit_transactions.project_id`, `billing_credit_wallets.project_id`, `billing_invoice_items.project_id`, `billing_invoices.project_id`, `billing_notification_deliveries.project_id`, `billing_notification_rules.project_id`, `billing_payment_methods.project_id`, `billing_reprocessing_batches.project_id`, `billing_subscription_changes.project_id`, `billing_subscriptions.project_id`, `billing_usage_events.project_id`, `customers.project_id`, `events.project_id`, `locations.project_id`, `loyalty_states.project_id`, `notification_jobs.project_id`, `notifications.project_id`, `pass_locations.project_id`, `passes.project_id`, `project_billing_audit_logs.project_id`, `project_members.project_id`, `project_wallets.project_id`, `projects_notifications.project_id`, `visits.project_id`, `wallet_configs.project_id`, `wallet_configs_history.project_id`, `wallet_links.project_id`, `wallet_templates.project_id`, `rewards.project_id`, `reward_redemptions.project_id`, `billing_plan_change_sessions.project_id`, `signup_finalizations.project_id` |
| `profiles.id` | `projects.created_by`, `billing_credit_transactions.created_by`, `billing_reprocessing_batches.created_by`, `billing_subscription_changes.requested_by`, `project_billing_audit_logs.actor_user_id`, `billing_plan_change_sessions.requested_by` |
| `auth.users.id` | `signup_finalizations.user_id`, `signup_existing_customer_intents.user_id`, `signup_checkout_sessions.user_id`; `auth.users` tambem dispara `handle_new_user()` para sincronizar `profiles` |
| `project_members` | Nao e destino comum; e a fonte das checagens de membership em RLS, RPCs e Edge Functions |
| `passes` | `user_passes.pass_id`, `pass_locations.pass_id`, `billing_usage_events.pass_id` |
| `user_passes` | `automation_dispatches.user_pass_id`, `billing_usage_events.user_pass_id`, `customers.user_pass_id`, `notification_jobs.user_pass_id`, `passkit_registrations.user_pass_id`, `reward_redemptions.user_pass_id`, `visits.user_pass_id` |
| `customers` | `events.customer_id`, `loyalty_states.customer_id`, `notification_jobs.customer_id`, `reward_redemptions.customer_id`, `wallet_links.customer_id` |
| `notifications` | `notification_jobs.notification_id`, `reward_redemptions.notification_id` |
| `automations` | `automation_dispatches.automation_id` |
| `locations` | `pass_locations.location_id` |
| `wallet_configs` | `wallet_configs_history.wallet_config_id` |
| `orgs` | `org_members.org_id` |
| `billing_plans` | `billing_plans.auto_upgrade_to_plan_id`, `billing_subscription_changes.previous_plan_id`, `billing_subscription_changes.new_plan_id`, `billing_subscriptions.plan_id`, `signup_checkout_sessions.plan_id`, `billing_plan_change_sessions.previous_plan_id`, `billing_plan_change_sessions.new_plan_id` |
| `billing_accounts` | `billing_invoices.billing_account_id`, `billing_payment_methods.billing_account_id`, `billing_subscriptions.billing_account_id` |
| `billing_subscriptions` | `billing_cycles.subscription_id`, `billing_invoices.subscription_id`, `billing_notification_deliveries.subscription_id`, `billing_subscription_changes.subscription_id`, `billing_usage_events.subscription_id`, `billing_plan_change_sessions.subscription_id` |
| `billing_cycles` | `billing_invoices.billing_cycle_id`, `billing_usage_events.billing_cycle_id` |
| `billing_invoices` | `billing_invoice_items.invoice_id`, `billing_notification_deliveries.invoice_id` |
| `billing_invoice_items` | `billing_credit_transactions.invoice_item_id`, `billing_usage_events.invoice_item_id` |
| `billing_usage_events` | `billing_credit_transactions.usage_event_id` |
| `billing_notification_rules` | `billing_notification_deliveries.rule_id` |
| `billing_reprocessing_batches` | `billing_usage_events.reprocessing_batch_id` |
| `rewards` | `reward_redemptions.reward_id` |

Relacionamentos compostos observados:

- `pass_locations` valida consistencia entre `project_id`, `pass_id` e `location_id`.
- `user_passes` valida par `pass_id`/`project_id` contra `passes`.
- `billing_payment_methods` e `billing_subscriptions` validam pares com `billing_accounts`.
- `billing_invoice_items` valida par com `billing_invoices`.
- `billing_subscription_changes` e `billing_plan_change_sessions` validam pares com `billing_subscriptions`.
- `billing_credit_transactions` valida par com `billing_credit_wallets`.

## RLS e policies

Helpers de autorizacao usados em policies:

- `is_superadmin()`: consulta `profiles.role = 'superadmin'`.
- `is_admin()`: consulta `profiles.role = 'admin'`.
- `can_manage_project(project_id)`: permite `superadmin` ou `admin` criador do projeto.
- `is_member_of_project(...)`: verifica membership em `project_members`.
- `is_project_staff(project_id)`: verifica membership em projeto.
- `is_project_owner(project_id)`: verifica `project_members.role = 'owner'`.
- `is_member_of_org(...)` e `is_org_admin(...)`: helpers para organizacoes.
- `can_access_project(project_id)`: helper usado no modulo de billing.

Resumo de policies efetivas inferidas por tabela:

| Tabela | Policies |
|---|---|
| `automation_dispatches` | `automation_dispatches_select_project_staff` |
| `automations` | `automations_select_project_staff`, `automations_insert_project_owner`, `automations_update_project_owner`, `automations_delete_project_owner` |
| `billing_accounts` | `billing_accounts_member_select`, `billing_accounts_member_insert`, `billing_accounts_member_update`, `billing_accounts_superadmin_delete` |
| `billing_credit_transactions` | `billing_credit_transactions_member_select`, `billing_credit_transactions_superadmin_write` |
| `billing_credit_wallets` | `billing_credit_wallets_member_select`, `billing_credit_wallets_superadmin_write` |
| `billing_cycles` | `billing_cycles_member_select`, `billing_cycles_superadmin_write` |
| `billing_invoice_items` | `billing_invoice_items_member_select`, `billing_invoice_items_superadmin_write` |
| `billing_invoices` | `billing_invoices_member_select`, `billing_invoices_superadmin_write` |
| `billing_notification_deliveries` | `billing_notification_deliveries_member_select`, `billing_notification_deliveries_superadmin_write` |
| `billing_notification_rules` | `billing_notification_rules_member_rw` |
| `billing_payment_methods` | `billing_payment_methods_member_rw` |
| `billing_plans` | `billing_plans_public_read`, `billing_plans_superadmin_write` |
| `billing_reprocessing_batches` | `billing_reprocessing_batches_member_select`, `billing_reprocessing_batches_superadmin_write` |
| `billing_subscription_changes` | `billing_subscription_changes_member_select`, `billing_subscription_changes_superadmin_modify`, `billing_subscription_changes_superadmin_delete` |
| `billing_subscriptions` | `billing_subscriptions_member_select`, `billing_subscriptions_superadmin_delete` |
| `billing_usage_events` | `billing_usage_events_member_select`, `billing_usage_events_superadmin_write` |
| `customers` | `Allow anonymous insert on customers`, `Allow anonymous read on customers`, `Allow inserts for service role`, `Allow selects for service role`, `Full access for service_role`, `clientes_insert`, `clientes_select`, `clientes_update`, `cust_del`, `cust_ins`, `cust_read`, `cust_upd`, `customers member read`, `customers_insert_member`, `customers_rw`, `customers_select_member`, `customers_update_member` |
| `events` | `events member read`, `events_ins`, `events_read`, `events_rw` |
| `locations` | `loc_del`, `loc_delete`, `loc_ins`, `loc_insert`, `loc_read`, `loc_upd`, `loc_update`, `locations_admin_delete_own_project`, `locations_admin_insert_own_project`, `locations_admin_select_own_project`, `locations_admin_update_own_project`, `locations_delete`, `locations_insert`, `locations_rw`, `locations_select`, `locations_update` |
| `loyalty_states` | `Customers can view their own loyalty state.`, `loyalty member read`, `loyalty_states_member_select`, `loyalty_states_member_update`, `loyalty_states_rw`, `loyalty_states_select`, `ls_rw` |
| `notification_jobs` | `notification_jobs_select_project_staff_sent`, `notification_jobs_insert_project_owner`, `notification_jobs_update_project_owner`, `notification_jobs_delete_project_owner` |
| `notifications` | `notifications_select_project_staff_sent`, `notifications_insert_project_owner`, `notifications_update_project_owner`, `notifications_delete_project_owner` |
| `org_members` | `Org admins can manage members`, `Org members can view other members` |
| `orgs` | `Authenticated users can create orgs.`, `Org owners can update their org.`, `Owners and members can view their org.` |
| `passes` | `Deny all by default`, `Negar tudo por padrão`, `passes_select_all_auth` |
| `profiles` | `Users can view their own profile.`, `Users can update their own profile.`, `profiles_self_view`, `profiles_self_update`, `profiles_insert_auth` |
| `project_billing_audit_logs` | `project_billing_audit_logs_member_select`, `project_billing_audit_logs_superadmin_write` |
| `project_members` | `Allow_menagement_for_fellow_project_members`, `pm member read`, `pm superadmin del`, `pm superadmin ins`, `pm superadmin upd`, `pm_cud`, `pm_del`, `pm_ins`, `pm_read`, `pm_select`, `pm_upd` |
| `project_wallets` | `pm_read` |
| `projects` | `Allow authenticated read access`, `Members can read their projects`, `Superadmin can read all projects`, `Allow superadmins to insert projects`, `Allow superadmins to update projects`, `Allow superadmins to delete projects`, `Allow service role to update projects`, `Allow service role to delete projects`, `projects_admin_insert_own`, `projects_admin_update_own` |
| `projects_notifications` | `projects_notifications_select_member_or_superadmin`, `projects_notifications_insert_superadmin`, `projects_notifications_update_superadmin`, `projects_notifications_delete_superadmin` |
| `reward_redemptions` | `reward_redemptions_select_project_staff`, `reward_redemptions_insert_project_staff` |
| `rewards` | `rewards_select_project_staff`, `rewards_insert_project_staff`, `rewards_update_project_staff`, `rewards_delete_project_staff` |
| `signup_precheck_rate_limits` | `signup_precheck_rate_limits_service_role_only` |
| `user_passes` | `user_passes_owner_select`, `user_passes_owner_insert`, `user_passes_owner_update`, `user_passes_owner_delete`, `user_passes_select_project_member` |
| `user_wallets` | `Users can view their own wallets`, `Users can insert their own wallets`, `Users can delete their own wallets` |
| `visits` | `visits_select_member`, `visits_insert_member`, `visits_insert_service` |
| `wallet_configs` | `Allow admins`, `Public read access to wallet configs`, `anon read wallet_configs`, `wallet_configs_member_insert`, `wallet_configs_member_select`, `wallet_configs_member_update`, `wallet_configs_select`, `wallet_cud`, `wallet_ins`, `wallet_insert`, `wallet_update_superadmin`, `wallet_upsert`, `wallet_upsert_superadmin` |
| `wallet_configs_history` | `Enable read access for project members` |
| `wallet_links` | `wallet_links member read`, `wallet_links_member_insert`, `wallet_links_member_read`, `wallet_links_member_select`, `wl_rw` |
| `wallet_templates` | `qualquer um pode ler templates`, `wallet_templates_select`, `wallet_templates_insert`, `wallet_templates_update`, `wallet_templates_delete`, `wallet_templates_admin_insert_own_project`, `wallet_templates_admin_update_own_project` |
| `storage.objects` | `logos_public_read`, `logos_auth_insert`, `logos_auth_update`, `logos_auth_upload`, `logos_owner_write`, `pass-assets read (public)`, `pass-assets upload (authenticated)`, `pass-assets update (authenticated)`, `pass_assets_public_read`, `pass_assets_member_insert`, `secrets_owner_access` |
| `wallet.templates` | `public read templates`, `Allow_access_to_own_project_members_templates` |

Policies recentes relevantes:

- Notificacoes e jobs: `owner` pode inserir/alterar/remover; `staff` visualiza apenas enviados por meio de `sent_at`.
- Automacoes: `staff` visualiza; `owner` cria, altera e remove.
- `projects_notifications`: membros ou superadmin leem; apenas superadmin insere, atualiza e remove.
- Rewards: `project_staff` seleciona/insere/atualiza/remove rewards e insere redemptions.
- Signup tables recentes ficam com RLS ativa e sem policy de client, com grants especificos para `service_role`.

## RPCs e funcoes SQL

Funcoes/RPCs de autorizacao:

| Funcao | Seguranca | Papel arquitetural |
|---|---|---|
| `is_superadmin()` | `SECURITY DEFINER` | Role global `superadmin`. |
| `is_admin()` | `SECURITY DEFINER` | Role global `admin`. |
| `can_manage_project(uuid)` | `SECURITY DEFINER` | `superadmin` ou `admin` criador do projeto. |
| `can_access_project(uuid)` | `SECURITY DEFINER` | Membership de projeto para billing. |
| `is_member_of_project(uuid)` | `SECURITY DEFINER` | Membership do usuario autenticado. |
| `is_member_of_project(uuid, uuid)` | `SECURITY DEFINER` | Membership para usuario explicito. |
| `is_project_staff(uuid)` | invoker/default | Membership de staff/owner em projeto. |
| `is_project_owner(uuid)` | invoker/default | `project_members.role = 'owner'`. |
| `is_member_of_org(uuid, uuid)` | `SECURITY DEFINER` | Membership em organizacao. |
| `is_org_admin(uuid, uuid)` | `SECURITY DEFINER` | Admin de organizacao. |
| `is_pass_belongs_to_current_user_by_token(text)` | `SECURITY DEFINER` | Relacao entre token de passe e usuario atual. |

RPCs operacionais ou expostas ao app:

| Funcao/RPC | Seguranca | Uso observado |
|---|---|---|
| `fn_get_global_kpis()` | `SECURITY DEFINER` | Dashboard global. |
| `fn_get_global_kpis_timeseries(integer)` | `SECURITY DEFINER` | Dashboard global. |
| `fn_get_project_kpis(uuid)` | `SECURITY DEFINER` | KPIs do projeto. |
| `fn_get_project_kpis_timeseries(uuid, integer)` | `SECURITY DEFINER` | Serie temporal do projeto. |
| `fn_get_project_analytics(uuid, timestamptz, timestamptz)` | `SECURITY DEFINER` | Analytics do projeto. |
| `fn_get_stats(uuid)` | `SECURITY DEFINER` | Estatisticas legadas. |
| `fn_get_stats_all()` | `SECURITY DEFINER` | Estatisticas globais legadas. |
| `fn_list_members(uuid)` | `SECURITY DEFINER` | Lista membros de projeto. |
| `fn_list_customers_with_visits(uuid)` | invoker/default | Lista clientes/visitas. |
| `fn_list_visits(uuid)` | invoker/default | Lista visitas. |
| `fn_link_member_by_email(text, uuid, text)` | `SECURITY DEFINER` | Vinculo de membro por email. |
| `fn_find_user_id(text)` | `SECURITY DEFINER` | Busca usuario por email. |
| `fn_scanner_visit(uuid, text)` | `SECURITY DEFINER` | Registro de visita legado. |
| `fn_upsert_customer(...)` | `SECURITY DEFINER` | Upsert de customer. |
| `fn_upsert_customer_v2(...)` | `SECURITY DEFINER` | Upsert de customer. |
| `get_pass_owner(text)` | `SECURITY DEFINER` | Resolve dono por token. |
| `get_wallet_link_and_customer_points(uuid, text)` | invoker/default | Wallet/customer points. |
| `update_wallet_link_google_object_id(uuid, text)` | `SECURITY DEFINER` | Atualiza objeto Google Wallet. |
| `redeem_reward_points(uuid, uuid, text)` | `SECURITY DEFINER`; execute para `service_role` | Resgate de reward via backend. |

RPCs de fila, billing e signup:

| Funcao/RPC | Seguranca | Grant/restricao observada |
|---|---|---|
| `claim_notification_jobs(integer, text, integer)` | invoker/default | Revogada de `public`, `anon`, `authenticated`; concedida a `service_role`. |
| `enqueue_automation_notifications()` | invoker/default | Revogada de `public`, `anon`, `authenticated`; concedida a `service_role`. |
| `check_and_increment_notifications(uuid)` | invoker/default | Revogada de `public`, `anon`, `authenticated`; concedida a `service_role`. |
| `apply_billing_plan_change(uuid, uuid, text, text, text)` | `SECURITY DEFINER` | Revogada de `public`; concedida a `service_role`. |
| `get_pending_billing_plan_change(uuid)` | `SECURITY DEFINER` | Revogada de `public`; concedida a `authenticated`; valida acesso por `can_access_project`. |
| `consume_signup_precheck_rate_limit(...)` | `SECURITY DEFINER` | Concedida a `service_role`. |
| `signup_precheck_auth_account_status(text)` | `SECURITY DEFINER` | Revogada de client roles; concedida a `service_role`. |
| `signup_precheck_auth_email_exists(text)` | `SECURITY DEFINER` | Revogada de client roles; concedida a `service_role`. |
| `expire_trial_subscriptions()` | `SECURITY DEFINER` | Scheduler/cron de expiracao de trial. |

Funcoes de trigger:

- `handle_new_user()`;
- `handle_new_auth_user()`;
- `prevent_multiple_sessions()`;
- `set_updated_at()`;
- `set_rewards_updated_at()`;
- `log_wallet_config_change()`;
- `trg_sync_customer_from_user_passes()`;
- `trg_set_last_visit_on_points_change()`;
- `trg_insert_visit_on_customer_visits_change()`;
- `trg_user_passes_set_install_timestamps()`;
- `trg_sync_credit_wallet_balance()`;
- `trg_log_pass_issue_billing_usage()`;
- `trg_log_user_pass_install_billing_usage()`;
- `trg_log_notification_sent_billing_usage()`;
- `trg_enrich_subscription_change_proration()`;
- `trg_notification_jobs_enforce_limit_on_sent()`.

## Triggers

Triggers identificados:

| Trigger | Tabela | Funcao |
|---|---|---|
| `on_auth_user_created` | `auth.users` | `handle_new_user()` |
| `single_session_per_user` | `auth.sessions` | `prevent_multiple_sessions()` |
| `customers_insert_visit_on_visits_change` | `customers` | `trg_insert_visit_on_customer_visits_change()` |
| `trg_loyalty_states_set_updated_at` | `loyalty_states` | `set_updated_at()` |
| `trg_notification_jobs_updated_at` | `notification_jobs` | `set_updated_at()` |
| `user_passes_set_last_visit_on_points_change` | `user_passes` | `trg_set_last_visit_on_points_change()` |
| `user_passes_sync_customer` | `user_passes` | `trg_sync_customer_from_user_passes()` |
| `wallet_config_update_trigger` | `wallet_configs` | `log_wallet_config_change()` |
| `trg_billing_plans_updated_at` | `billing_plans` | `set_updated_at()` |
| `trg_billing_accounts_updated_at` | `billing_accounts` | `set_updated_at()` |
| `trg_billing_payment_methods_updated_at` | `billing_payment_methods` | `set_updated_at()` |
| `trg_billing_subscriptions_updated_at` | `billing_subscriptions` | `set_updated_at()` |
| `trg_billing_cycles_updated_at` | `billing_cycles` | `set_updated_at()` |
| `trg_billing_invoices_updated_at` | `billing_invoices` | `set_updated_at()` |
| `trg_billing_credit_wallets_updated_at` | `billing_credit_wallets` | `set_updated_at()` |
| `trg_billing_notification_rules_updated_at` | `billing_notification_rules` | `set_updated_at()` |
| `trg_billing_credit_transactions_apply` | `billing_credit_transactions` | `trg_sync_credit_wallet_balance()` |
| `trg_passes_log_billing_usage` | `passes` | `trg_log_pass_issue_billing_usage()` |
| `user_passes_set_install_timestamps` | `user_passes` | `trg_user_passes_set_install_timestamps()` |
| `trg_user_passes_log_billing_usage_on_install` | `user_passes` | `trg_log_user_pass_install_billing_usage()` |
| `trg_notification_jobs_log_billing_usage_on_sent` | `notification_jobs` | `trg_log_notification_sent_billing_usage()` |
| `trg_billing_subscription_changes_enrich` | `billing_subscription_changes` | `trg_enrich_subscription_change_proration()` |
| `trg_rewards_updated_at` | `rewards` | `set_rewards_updated_at()` |
| `trg_signup_precheck_rate_limits_updated_at` | `signup_precheck_rate_limits` | `set_updated_at()` |
| `trg_signup_existing_customer_intents_updated_at` | `signup_existing_customer_intents` | `set_updated_at()` |
| `trg_signup_checkout_sessions_updated_at` | `signup_checkout_sessions` | `set_updated_at()` |
| `trg_billing_plan_change_sessions_updated_at` | `billing_plan_change_sessions` | `set_updated_at()` |
| `trg_notification_jobs_enforce_limit_on_sent` | `notification_jobs` | `trg_notification_jobs_enforce_limit_on_sent()` |

## Edge Functions

Inventario estatico:

| Function | Autenticacao/autorizacao inferida | Uso de `service_role` | Recursos principais |
|---|---|---:|---|
| `admin-create-member` | Nao foi identificado `Authorization`/`getUser` no arquivo; usa service role. | Sim | `profiles`, `project_members` |
| `admin-create-member-teste` | Exige `Authorization`; valida usuario por `auth.getUser`; exige `profiles.role = superadmin`. | Sim | `profiles`, `project_members` |
| `admin-remove-member` | Exige `Authorization`; valida usuario com anon client; exige superadmin. | Sim | `profiles`, `project_members` |
| `admin-update-member` | Usa `Authorization` do request; exige superadmin. | Sim | `profiles`, `project_members` |
| `superadmin-create-admin` | Exige `Authorization`; valida caller; exige superadmin. | Sim | `profiles`, Auth Admin |
| `superadmin-list-admins` | Exige `Authorization`; valida caller; exige superadmin. | Sim | `profiles`, `projects` |
| `superadmin-remove-admin` | Exige `Authorization`; valida caller; exige superadmin. | Sim | `profiles`, Auth Admin |
| `create-project` | Nao foi identificado `Authorization`/`getUser` no arquivo; usa service role. | Sim | `projects`, `wallet_templates` |
| `create-project-teste` | Exige `Authorization`; valida caller; permite `superadmin`/`admin`. | Sim | `profiles`, `projects`, `wallet_templates` |
| `create-pass` | Nao foi identificado `getUser`; usa service role. | Sim | `passes`, `locations`, `pass_locations`, `wallet_templates` |
| `create-pass-teste` | Exige `Authorization`; valida caller; permite superadmin ou admin criador do projeto. | Sim | `profiles`, `projects`, `passes`, `locations`, `pass_locations`, `wallet_templates` |
| `update-pass` | Nao foi identificado `getUser`; usa service role. | Sim | `passes`, `locations`, `pass_locations`, `user_passes` |
| `update-pass-teste` | Exige `Authorization`; valida caller; permite superadmin ou admin criador do projeto. | Sim | `profiles`, `projects`, `passes`, `locations`, `pass_locations`, `user_passes`, `pass-assets` |
| `create-automation` | Exige `Authorization`; valida usuario por `auth.getUser`; checa `project_members`. | Nao | `automations`, `project_members` |
| `notifications-enqueue` | Exige `Authorization`; valida usuario por `auth.getUser`; exige `project_members.role = owner`; usa service role para gravar campanha/jobs. | Sim | `notifications`, `notification_jobs`, `customers`, `user_passes`, `project_members` |
| `notifications-runner` | Usa `CRON_SECRET` ou bearer de service role; chama `claim_notification_jobs`. | Sim | `notification_jobs`, `notifications`, `customers`, `user_passes` |
| `automations-runner` | Usa `CRON_SECRET` ou bearer de service role; chama `enqueue_automation_notifications`. | Sim | RPC |
| `scanner-visit` | Exige `Authorization`; valida usuario; usa anti-replay com `SCAN_CONFIRM_SECRET`; usa service role para escrita/processamento. | Sim | `passes`, `user_passes`, `visits`, `rewards` |
| `scanner-reward` | Exige `Authorization`; valida usuario; usa service role. | Sim | `project_members` e fluxo de reward |
| `signup-precheck` | Publica, sem sessao; usa captcha/rate limit e service role. | Sim | `signup_precheck_rate_limits`, `auth.users`, `profiles`, `signup_existing_customer_intents`, `function_logs` |
| `signup-finalize` | Exige `Authorization`; valida usuario por `auth.getUser`; usa service role para provisionar perfil/projeto/billing. | Sim | `profiles`, `project_members`, `projects`, `wallet_templates`, `projects_notifications`, billing, signup tables |
| `signup-start-checkout` | Exige `Authorization`; valida usuario; usa service role e Asaas. | Sim | `billing_plans`, `signup_checkout_sessions` |
| `signup-status` | Exige `Authorization`; valida usuario; usa service role para consultar estado de cadastro. | Sim | `project_members`, `signup_checkout_sessions`, `signup_existing_customer_intents` |
| `asaas-webhook` | Sem JWT; valida `ASAAS_WEBHOOK_TOKEN` quando configurado; usa service role. | Sim | `signup_checkout_sessions`, `billing_plan_change_sessions`, `billing_subscriptions` |
| `billing-start-plan-change` | Exige `Authorization`; valida usuario; exige `project_members.role = owner`; usa service role e Asaas. | Sim | billing plan/subscription/change session |
| `billing-finalize-plan-change` | Exige `Authorization`; valida usuario; exige `project_members.role = owner`; chama `apply_billing_plan_change`. | Sim | `billing_plan_change_sessions`, `project_members` |
| `apple-pass` | Usa service role; opera por token/assinatura conforme codigo; gera pass Apple. | Sim | `user_passes`, `passes`, `projects`, `locations`, `pass_locations`, `wallet_templates`, `rewards` |
| `google-pass` | Usa service role; gera objeto Google Wallet. | Sim | `passes`, `projects`, `locations`, `pass_locations`, `wallet_templates` |
| `universal-link` | Usa service role; pode ler usuario via `Authorization`; cria/reaproveita `user_passes`. | Sim | `passes`, `user_passes`, `pass-assets` |
| `apple-push` | Usa service role; processa push Apple por `pass_token`. | Sim | `user_passes`, `passkit_registrations`, `pass-assets` |
| `google-push` | Usa service role; processa push Google por `pass_token`. | Sim | `user_passes`, `passes`, `locations`, `wallet_templates`, `pass_locations` |
| `send-apple-notification` | Usa `INTERNAL_FN_SECRET` quando configurado; usa service role. | Sim | `user_passes` |
| `send-google-notificatoin` | Usa `WALLET_TEST_SECRET` em alguns caminhos; usa service role. | Sim | `user_passes` |
| `google-notificatoin` | Usa `WALLET_TEST_SECRET` em alguns caminhos; usa service role. | Sim | `user_passes` |
| `geocode-search` | Usa chave server-side de Google Maps; sem Supabase DB. | Nao | Google Maps |

Configuracao local de functions em `supabase/config.toml`:

- `verify_jwt = true`: `signup-finalize`, `signup-start-checkout`, `signup-status`, `billing-start-plan-change`, `billing-finalize-plan-change`.
- `verify_jwt = false`: `asaas-webhook`.
- Functions nao listadas dependem do default/deploy e precisam de verificacao posterior.

## Uso de service role

Padroes de uso:

- Functions administrativas: criacao/edicao/remocao de membros/admins, projetos e passes.
- Functions de signup e billing: provisionamento, checkout, webhook e mudanca de plano.
- Runners: notificacoes e automacoes via cron.
- Wallet/pass generation: Apple/Google pass, push e notificacoes.
- Fluxos autenticados com operacao privilegiada: primeiro validam o usuario com anon client + JWT, depois usam service role para gravar/consultar recursos sensiveis.

Variaveis sensiveis observadas:

- `SUPABASE_SERVICE_ROLE_KEY`;
- `CRON_SECRET`;
- `ASAAS_WEBHOOK_TOKEN`;
- `INTERNAL_FN_SECRET`;
- `SIGNER_SECRET`;
- `SCAN_CONFIRM_SECRET`;
- `WALLET_TEST_SECRET`;
- secrets Apple/Google Wallet;
- chaves Google Maps/Asaas.

No frontend, o cliente Supabase usa apenas:

- `VITE_SUPABASE_URL`;
- `VITE_SUPABASE_ANON_KEY`.

## Fluxo de autenticacao

### Login administrativo por email e senha

1. Usuario acessa `/login`.
2. `SupabaseAuthContext.signIn()` chama `supabase.auth.signInWithPassword`.
3. `onAuthStateChange` e `getSession` sincronizam `user` e `session`.
4. O contexto consulta `profiles.role`.
5. Para `establishment`, consulta `project_members` para obter `projectId`.
6. O usuario e redirecionado por role:
   - `superadmin`/`admin` -> `/admin`;
   - `establishment`/`customer` -> `/org`;
   - role ausente/invalida -> `/nao-autorizado`.

### Cadastro free trial/pago

1. Frontend chama `signup-precheck` antes do signup.
2. Precheck usa rate limit, captcha opcional, `auth.users` como fonte de existencia de conta e `profiles.role` para classificacao.
3. Fluxo novo usa `supabase.auth.signUp`.
4. Fluxo de `existing_customer` usa magic link por `supabase.auth.signInWithOtp`.
5. Depois de sessao valida, `signup-finalize` provisiona `profiles`, `projects`, `project_members`, billing inicial e templates.
6. Para planos pagos, `signup-start-checkout` cria sessao Asaas e `asaas-webhook` confirma pagamento.

### OAuth publico de claim

1. Usuario acessa `/claim/:c`.
2. Frontend inicia Google OAuth com `supabase.auth.signInWithOAuth`.
3. Callback retorna para `/claim/callback`.
4. `ClaimCallback` recupera a sessao/access token.
5. `universal-link` recebe contexto autenticado quando disponivel, vincula/gera `user_passes` e redireciona para carteira.

### Controle de sessao

- `supabaseClient` usa `persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: true`.
- `SupabaseAuthContext` trata falhas de refresh com contador temporario em `sessionStorage`.
- Logout limpa estado React, storage local Supabase e estado de UI salvo.
- `authSession.js` possui wrapper `invokeAuthenticatedFunction()` que renova sessao se perto de expirar e injeta `Authorization: Bearer <access_token>`.

## Fluxo de autorizacao

### Frontend

- `ProtectedLayout` bloqueia rotas protegidas sem usuario autenticado.
- `/admin` aceita `superadmin` e `admin`.
- `/org` aceita `establishment` e `customer`.
- `adminPermissions.js` modela permissoes de UI:
  - `superadmin` acessa tudo no admin;
  - `admin` pode gerenciar projeto se `projects.created_by` for igual ao usuario.

### Banco/RLS

- Policies usam `auth.uid()` e helpers SQL para restringir linhas por role global ou por `project_members`.
- Billing usa majoritariamente `can_access_project(project_id)` para leitura por membro e escrita por superadmin/service role.
- Notificacoes e automacoes usam separacao `owner`/`staff`.
- Signup/control tables recentes usam RLS ativa e grants a `service_role`, deixando client roles sem policies inferidas.

### Edge Functions

- Functions de usuario validam JWT com `auth.getUser()` antes de operar.
- Functions de projeto cruzam o usuario com `profiles`, `projects.created_by` ou `project_members`.
- Functions de cron/webhook usam segredos (`CRON_SECRET`, `ASAAS_WEBHOOK_TOKEN`) ou service role.
- Functions publicas/externas operam por tokens de negocio (`pass_token`, callbacks Apple/Google/Asaas) e service role.

## Views

View identificada:

- `v_passes`: seleciona campos de `passes`.

Hipotese para verificacao posterior: confirmar no banco se a view esta com configuracao adequada ao modelo de RLS esperado e se seu acesso direto e necessario.

## Hipoteses para verificacao posterior

1. O banco remoto/producao esta com todas as migrations aplicadas ate `20260531124500_clear_invalid_asaas_subscription_ids.sql`.
2. O estado real de `pg_tables`, `pg_policies`, `information_schema`, grants e triggers coincide com a simulacao por arquivos.
3. As tabelas listadas como RLS ativa sem policy (`billing_plan_change_sessions`, `clients`, `secrets`, `signup_checkout_sessions`, `signup_existing_customer_intents`, `signup_finalizations`, `wallet.issued_passes`) estao intencionalmente restritas a service role ou a fluxos internos.
4. As tabelas sem `enable row level security` nas migrations (`function_logs`, `pass_locations`, `passkit_events`, `passkit_registrations`, `user_passes`, `wallet.projects`) refletem uma decisao atual e nao divergencia entre snapshot e migrations.
5. As policies antigas e duplicadas presentes no dump inicial continuam ou nao no banco real conforme esperado; confirmar com `pg_policies`.
6. Os grants/revokes de RPCs sensiveis (`claim_notification_jobs`, `enqueue_automation_notifications`, `check_and_increment_notifications`, `apply_billing_plan_change`, `redeem_reward_points`, `signup_precheck_*`) estao efetivos no banco remoto.
7. Todas as `SECURITY DEFINER` atuais possuem `search_path`, owner e grants alinhados ao modelo pretendido.
8. O `service_role` nao e exposto em bundles frontend, variaveis `VITE_*`, logs, artefatos de build ou responses.
9. O `verify_jwt` real de cada Edge Function no Supabase Dashboard/deploy corresponde ao esperado; especialmente functions nao listadas em `supabase/config.toml`.
10. Functions legadas sem `getUser` identificado (`create-project`, `create-pass`, `update-pass`, `admin-create-member`) ainda estao ou nao deployadas/roteadas.
11. Secrets obrigatorios (`CRON_SECRET`, `ASAAS_WEBHOOK_TOKEN`, `INTERNAL_FN_SECRET`, `SCAN_CONFIRM_SECRET`, `SIGNER_SECRET`, `WALLET_TEST_SECRET`) estao configurados em todos os ambientes que usam as respectivas functions.
12. `CRON_SECRET` existe em producao para `notifications-runner` e `automations-runner`.
13. `ASAAS_WEBHOOK_TOKEN` existe em producao e o provedor envia o header esperado.
14. Configuracao de Auth em producao coincide com a local quando relevante: `jwt_expiry`, refresh rotation, redirect URLs, email confirmations, OAuth providers e rate limits.
15. A Data API exposta em producao usa os schemas esperados (`public`, `graphql_public`) e nao expoe schemas adicionais sem revisao.
16. O modelo de `profiles.role` (`superadmin`, `admin`, `establishment`, `customer`) e `project_members.role` (`owner`, `staff`) cobre todos os fluxos atuais do produto.
17. O acesso de `customer` a `/org` e intencional no fluxo atual.
18. O uso de `user_metadata` no signup e apenas para fluxo de onboarding, nao para autorizacao persistente.
19. A view `v_passes` deve ser verificada no banco real quanto a grants, owner e comportamento de RLS.
20. Buckets e policies de Storage reais coincidem com o snapshot: `pass-assets`, `project-logos` publicos e `secrets` privado.
21. Logs em `function_logs` e payloads de webhook/notificacao nao armazenam dados alem do necessario para debugging.
22. Triggers de billing/notificacao (`status = sent`, instalacao de passe, mudanca de plano) disparam nos mesmos eventos em producao.
23. RLS e autorizacao para staff em notificacoes seguem a regra documentada: staff visualiza apenas campanhas/jobs enviados.
24. Testes de integracao existentes cobrem os fluxos de Edge Functions criticos ou precisam ser ampliados depois do mapeamento.
