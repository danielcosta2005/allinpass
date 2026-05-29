# Fluxo de Signup

Este documento resume o fluxo atual de cadastro do AllinPass para `free_trial` e planos pagos.

## Decisao Implementada

O signup de email novo segue este modelo:

```text
Frontend -> signup-precheck
Frontend -> pede senha
Frontend -> supabase.auth.signUp
Supabase Auth -> cria usuario em auth.users
Frontend -> signup-finalize
signup-finalize -> provisiona dados de negocio
Frontend -> refreshAuthProfile
Usuario -> /org
```

A Edge Function `signup-finalize` nao cria usuario nem recebe senha. A senha passa apenas pelo Supabase Auth e so e solicitada depois que `signup-precheck` confirma qual fluxo sera usado.

Nos planos pagos, a conta tambem nasce pelo `supabase.auth.signUp`, mas o provisionamento so acontece depois do checkout recorrente do Asaas ser criado por `signup-start-checkout` e confirmado pelo webhook `asaas-webhook`.

Quando o `signup-precheck` identifica que o email ja existe em `auth.users` com `profiles.role = customer`, o frontend nao chama `signUp`. A function grava uma intencao em `signup_existing_customer_intents`, e o frontend envia um magic link com `supabase.auth.signInWithOtp` e `shouldCreateUser=false`, reaproveitando o mesmo `auth.users.id`. No free trial, o retorno pode finalizar direto. Em plano pago, o retorno leva o usuario autenticado para criar a senha antes da etapa de checkout.

## Arquivos Principais

- `frontend/src/pages/SignupPage.jsx`: formulario e orquestracao do fluxo.
- `frontend/src/lib/signup.js`: helpers para `signup-precheck`, `signup-finalize` e `signup-start-checkout`.
- `frontend/src/contexts/SupabaseAuthContext.jsx`: sessao, papel do usuario e `refreshAuthProfile`.
- `supabase/functions/signup-finalize/index.ts`: provisionamento do Free Trial ou assinatura paga confirmada.
- `supabase/functions/signup-start-checkout/index.ts`: cria a sessao de checkout recorrente no Asaas.
- `supabase/functions/asaas-webhook/index.ts`: recebe eventos `CHECKOUT_*` do Asaas e marca o checkout como pago/cancelado/expirado.
- `frontend/src/lib/subscriptionPlans.js`: leitura dos planos em `billing_plans`.

## Fluxo Sem Confirmacao de Email

1. Usuario acessa `/cadastro?plano=free-trial`.
2. Frontend valida nome do estabelecimento, email e confirmacao de email.
3. Frontend chama `signup-precheck`.
4. Se o email estiver disponivel, frontend mostra a etapa de senha.
5. Usuario cria a senha uma unica vez.
6. Frontend chama `supabase.auth.signUp`.
7. Supabase cria o usuario em `auth.users` e retorna uma sessao.
8. Frontend chama `signup-finalize`.
9. Edge Function cria/garante perfil, projeto, assinatura trial e estruturas iniciais.
10. Frontend chama `refreshAuthProfile`.
11. Usuario acessa `/org`.

## Fluxo Com Cliente Existente

Se `signup-precheck` retornar `code = existing_customer`:

1. Frontend nao chama `supabase.auth.signUp`.
2. `signup-precheck` grava `email`, `establishment_name` e `plan_code` em `signup_existing_customer_intents`.
3. Frontend chama `supabase.auth.signInWithOtp` com `shouldCreateUser=false`.
4. O magic link tenta retornar para `/cadastro?plano=free-trial&finalizar=1&establishmentName=...&planCode=free_trial`. Em plano pago, ele retorna com `checkout=pending` e `existingCustomer=1`.
5. Ao voltar autenticado, a pagina chama `signup-finalize`; se o link cair fora de `/cadastro`, o `SupabaseAuthContext` pode sondar o backend durante o retorno de Auth.
6. Se o link abrir em outro navegador/dispositivo e os dados nao vierem pela URL/localStorage, `signup-finalize` busca a intencao pendente por `user.email`.
7. `signup-finalize` atualiza `profiles.role` para `establishment`, provisiona o projeto e marca a intencao como `completed`.
8. Como a conta ja existia e o fluxo usou magic link em vez de `signUp`, o frontend mostra a etapa "Crie sua senha de acesso" com a sessao ja autenticada.
9. O frontend chama `supabase.auth.updateUser({ password })`. No free trial, isso acontece depois de `signup-finalize`; no plano pago, acontece antes de `signup-start-checkout`.

## Fluxo Com Confirmacao de Email

Se `signUp` nao retornar sessao:

1. Frontend mostra a tela "Confirme seu email".
2. O link de confirmacao retorna para:

```text
/cadastro?plano=free-trial&finalizar=1
```

3. Ao voltar autenticado, a pagina detecta `finalizar=1`.
4. Frontend chama `signup-finalize`.
5. O fluxo continua igual ao caso sem confirmacao.

## O Que `signup-finalize` Faz

A function exige um usuario autenticado via:

```text
Authorization: Bearer <access_token>
```

Depois de validar o JWT, ela usa `SUPABASE_SERVICE_ROLE_KEY` para:

1. Buscar o plano ativo em `billing_plans`.
2. Se o plano for pago, validar uma linha paga em `signup_checkout_sessions`.
3. Atualizar/criar `profiles` com `role = 'establishment'`.
4. Criar ou reaproveitar um `projects`.
5. Garantir `project_members` com `role = 'owner'`.
6. Criar `wallet_templates` inicial para projeto novo.
7. Criar `billing_accounts` minimo.
8. Criar `billing_subscriptions`: `trialing` para free trial, `active` para plano pago.
9. Criar `billing_cycles` aberto.
10. Garantir `billing_credit_wallets`.
11. Garantir `projects_notifications` para compatibilidade com o limite legado de notificacoes.
12. Atualizar metadados do usuario no Supabase Auth.

## Tabelas Envolvidas

- `auth.users`: usuario criado pelo Supabase Auth.
- `profiles`: papel do usuario, corrigido para `establishment`.
- `projects`: projeto/estabelecimento criado no signup.
- `project_members`: vincula usuario ao projeto como `owner`.
- `wallet_templates`: template inicial da carteira.
- `billing_plans`: fonte oficial dos planos, precos, franquias, excedentes e `trial_days`.
- `billing_accounts`: conta minima de faturamento do projeto.
- `billing_subscriptions`: assinatura trial do projeto.
- `billing_cycles`: ciclo aberto do periodo trial.
- `billing_credit_wallets`: carteira de creditos inicial.
- `projects_notifications`: limite legado de notificacoes usado por telas existentes.
- `signup_existing_customer_intents`: fallback backend para finalizar cliente existente mesmo quando o magic link abre em outro dispositivo.
- `signup_checkout_sessions`: intencao de checkout pago criada antes do provisionamento definitivo.

## Regras Importantes

- O frontend nao envia preco, franquia, status ou datas de trial.
- Esses dados sempre vem de `billing_plans`.
- `free_trial` nao exige checkout nem cartao.
- Plano pago exige `checkoutSessionId` com `status = paid` em `signup_checkout_sessions`.
- A senha nunca passa pela Edge Function.
- A primeira etapa do formulario nao pede senha; ela aparece somente depois do `signup-precheck`.
- Para clientes existentes, a senha preenchida no formulario inicial nao e usada; o acesso e confirmado por magic link e a senha e criada com `supabase.auth.updateUser({ password })` usando uma sessao autenticada.
- Para clientes existentes, a intencao backend expira em 24 horas e so e acessada pelas Edge Functions com `service_role`.
- `/cadastro` nao redireciona automaticamente durante o signup, para evitar conflito enquanto `profiles.role` muda de `customer` para `establishment`.
- Depois do provisionamento, `refreshAuthProfile` recarrega `profiles` e `project_members`.

## Idempotencia

A function tolera chamadas repetidas:

- `profiles` usa `upsert`.
- `project_members` usa `upsert`.
- projeto existente e reaproveitado quando o usuario ja e `owner`.
- `billing_accounts` e `billing_subscriptions` sao consultados antes de inserir.
- `billing_credit_wallets` e `projects_notifications` usam `upsert`.

Ainda nao existe uma transacao unica para todo o provisionamento. Como melhoria futura, o provisionamento pode virar uma RPC transacional no Postgres.

## Fluxo Pago

Fluxo implementado:

```text
Frontend -> signup-precheck
Frontend -> senha
Frontend -> supabase.auth.signUp
Frontend -> signup-start-checkout
Asaas Checkout -> pagamento
asaas-webhook -> marca signup_checkout_sessions.status = paid
Frontend retorna para /cadastro?...&finalizar=1&checkoutSessionId=...
Frontend -> signup-finalize
```

O `signup-finalize` e unico para free trial e pago. A diferenca e que, para plano pago, ele so provisiona se o checkout tiver sido confirmado pelo webhook do Asaas.

Para `existing_customer` em plano pago, a ordem fica:

```text
Frontend -> signup-precheck
Frontend -> magic link com shouldCreateUser=false
Supabase Auth -> retorna autenticado para /cadastro?...&checkout=pending&existingCustomer=1
Frontend -> senha via supabase.auth.updateUser
Frontend -> signup-start-checkout
Asaas Checkout -> pagamento
Frontend retorna para /cadastro?...&finalizar=1&checkoutSessionId=...
Frontend -> signup-finalize
```

## Checklist Rapido

Para validar o fluxo:

1. Criar cadastro Free Trial com email novo.
2. Conferir usuario em `auth.users`.
3. Conferir `profiles.role = 'establishment'`.
4. Conferir `project_members.role = 'owner'`.
5. Conferir assinatura em `billing_subscriptions.status = 'trialing'`.
6. Conferir `trial_ends_at` de acordo com `billing_plans.trial_days`.
7. Conferir acesso a `/org`.
8. Repetir com email de `customer` existente e conferir que o mesmo `auth.users.id` vira `establishment`.
9. No fluxo `existing_customer`, criar a senha depois do magic link, sair da conta e validar login com email/senha.
10. Criar cadastro pago, confirmar criacao de `signup_checkout_sessions`, simular/receber `CHECKOUT_PAID` e validar assinatura `active`.

# Resumo do fluxo pago:
Usuário escolhe plano pago
Frontend chama signup-start-checkout
signup-start-checkout cria signup_checkout_sessions
signup-start-checkout cria checkout no Asaas
Asaas retorna checkout_url
Usuário paga no Asaas
Asaas chama asaas-webhook
asaas-webhook marca signup_checkout_sessions.status = paid
Frontend volta para /cadastro
Frontend chama signup-finalize
signup-finalize valida checkout paid
signup-finalize cria billing_account, billing_subscription e billing_cycle
signup-finalize marca checkout como finalized
