# Fluxo de Signup - Free Trial

Este documento resume o fluxo atual de cadastro do AllinPass para o plano `free_trial`.

## Decisao Implementada

O signup segue este modelo:

```text
Frontend -> signup-precheck
Frontend -> supabase.auth.signUp
Supabase Auth -> cria usuario em auth.users
Frontend -> signup-finalize
signup-finalize -> provisiona dados de negocio
Frontend -> refreshAuthProfile
Usuario -> /org
```

A Edge Function `signup-finalize` nao cria usuario nem recebe senha. A senha passa apenas pelo Supabase Auth.

Os fluxos pagos `signup_start_checkout` e `signup_finalize_paid` ficaram para uma segunda etapa.

Quando o `signup-precheck` identifica que o email ja existe em `auth.users` com `profiles.role = customer`, o frontend nao chama `signUp`. Ele envia um magic link com `supabase.auth.signInWithOtp` e `shouldCreateUser=false`, retornando para `/cadastro?...&finalizar=1` para reaproveitar o mesmo `auth.users.id`.

## Arquivos Principais

- `frontend/src/pages/SignupPage.jsx`: formulario e orquestracao do fluxo.
- `frontend/src/lib/signup.js`: helper para chamar `signup-finalize`.
- `frontend/src/contexts/SupabaseAuthContext.jsx`: sessao, papel do usuario e `refreshAuthProfile`.
- `supabase/functions/signup-finalize/index.ts`: provisionamento do Free Trial.
- `frontend/src/lib/subscriptionPlans.js`: leitura dos planos em `billing_plans`.

## Fluxo Sem Confirmacao de Email

1. Usuario acessa `/cadastro?plano=free-trial`.
2. Frontend valida nome do estabelecimento, email e senha.
3. Frontend chama `signup-precheck`.
4. Se o email estiver disponivel, frontend chama `supabase.auth.signUp`.
5. Supabase cria o usuario em `auth.users` e retorna uma sessao.
6. Frontend chama `signup-finalize`.
7. Edge Function cria/garante perfil, projeto, assinatura trial e estruturas iniciais.
8. Frontend chama `refreshAuthProfile`.
9. Usuario acessa `/org`.

## Fluxo Com Cliente Existente

Se `signup-precheck` retornar `code = existing_customer`:

1. Frontend nao chama `supabase.auth.signUp`.
2. Frontend chama `supabase.auth.signInWithOtp` com `shouldCreateUser=false`.
3. O magic link retorna para `/cadastro?plano=free-trial&finalizar=1&establishmentName=...&planCode=free_trial`.
4. Ao voltar autenticado, a pagina chama `signup-finalize`.
5. `signup-finalize` atualiza `profiles.role` para `establishment` e provisiona o projeto.

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

1. Buscar o plano `free_trial` ativo em `billing_plans`.
2. Atualizar/criar `profiles` com `role = 'establishment'`.
3. Criar ou reaproveitar um `projects`.
4. Garantir `project_members` com `role = 'owner'`.
5. Criar `wallet_templates` inicial para projeto novo.
6. Criar `billing_accounts` minimo.
7. Criar `billing_subscriptions` com `status = 'trialing'`.
8. Criar `billing_cycles` aberto.
9. Garantir `billing_credit_wallets`.
10. Garantir `projects_notifications` para compatibilidade com o limite legado de notificacoes.
11. Atualizar metadados do usuario no Supabase Auth.

## Tabelas Envolvidas

- `auth.users`: usuario criado pelo Supabase Auth.
- `profiles`: papel do usuario, corrigido para `establishment`.
- `projects`: projeto/estabelecimento criado no signup.
- `project_members`: vincula usuario ao projeto como `owner`.
- `wallet_templates`: template inicial da carteira.
- `billing_plans`: fonte oficial do plano `free_trial`, seus limites e `trial_days`.
- `billing_accounts`: conta minima de faturamento do projeto.
- `billing_subscriptions`: assinatura trial do projeto.
- `billing_cycles`: ciclo aberto do periodo trial.
- `billing_credit_wallets`: carteira de creditos inicial.
- `projects_notifications`: limite legado de notificacoes usado por telas existentes.

## Regras Importantes

- O frontend nao envia preco, franquia, status ou datas de trial.
- Esses dados sempre vem de `billing_plans`.
- A function aceita apenas `planCode = free_trial`.
- A senha nunca passa pela Edge Function.
- Para clientes existentes, a senha preenchida no formulario nao e usada; o acesso e confirmado por magic link.
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

Ainda nao implementado.

Fluxo previsto:

```text
signup_start_checkout -> inicia checkout
provedor de pagamento -> confirma pagamento
signup_finalize_paid -> provisiona assinatura paga
```

Por enquanto, o cadastro automatico atende apenas o `free_trial`.

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
