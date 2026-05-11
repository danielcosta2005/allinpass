# Backend Edge Functions

Este arquivo documenta as Supabase Edge Functions do projeto, explicando o objetivo de cada funcao, quando ela e utilizada, quais payloads recebe e retorna, quais processos internos executa, quais tabelas acessa, quais erros pode gerar e quais cuidados de seguranca, idempotencia e debugging devem ser observados.

## `signup-finalize`

### Objetivo

Finaliza o cadastro Free Trial depois que o usuario ja foi criado pelo Supabase Auth.

Esta function nao cria usuario, nao recebe senha e nao executa checkout. Ela recebe uma chamada autenticada do frontend, valida o JWT do usuario recem-cadastrado e provisiona os dados de negocio iniciais para que o estabelecimento consiga acessar o painel `/org`.

### Quando e utilizada

- Apos `supabase.auth.signUp` retornar uma sessao no fluxo `/cadastro?plano=free-trial`.
- Apos confirmacao de email, quando o usuario volta para `/cadastro?plano=free-trial&finalizar=1` e ja possui sessao valida.
- Em chamadas repetidas de recuperacao do provisionamento, desde que o usuario ainda use o plano `free_trial`.

### Quem pode chamar

Apenas usuarios autenticados com `Authorization: Bearer <access_token>` valido.

Nao ha validacao de role previa, porque a propria function cria ou atualiza `profiles.role = 'establishment'`. A autorizacao manual central e confirmar que o token pertence ao usuario que sera provisionado.

### Metodo HTTP

- `POST`: executa a finalizacao do signup.
- `OPTIONS`: retorna `204` para preflight CORS.
- Outros metodos retornam `405`.

### Responsabilidades e processos internos

1. Trata CORS usando o `Origin` recebido.
2. Valida metodo HTTP.
3. Carrega `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.
4. Valida o header `Authorization` e confirma a sessao com `supabase.auth.getUser()`.
5. Le o payload JSON, tolerando body vazio ou invalido como `{}`.
6. Resolve `establishmentName` pelo body ou por `user.user_metadata.establishment_name`.
7. Resolve `planCode` pelo body, por `user.user_metadata.plan_code` ou pelo default `free_trial`.
8. Bloqueia qualquer plano diferente de `free_trial`.
9. Busca o plano `free_trial` ativo em `billing_plans`.
10. Cria ou atualiza `profiles` com papel `establishment`.
11. Reaproveita o primeiro projeto em que o usuario ja e `owner`, quando existir.
12. Se nao houver projeto, cria um novo `projects` com `auth_mode = 'form_only'` e slug gerado por nome + sufixo aleatorio.
13. Garante `project_members` com o usuario como `owner`.
14. Para projeto novo, cria o `wallet_templates` inicial com defaults de Wallet.
15. Garante `billing_accounts`, `billing_subscriptions`, `billing_cycles`, `billing_credit_wallets` e `projects_notifications`.
16. Atualiza `auth.users` com metadados de signup em `app_metadata` e `user_metadata`.
17. Retorna o projeto, a assinatura trial e o plano aplicado.

### Fluxo interno

```text
Frontend autenticado
  -> signup-finalize
  -> valida JWT com client anon + Authorization do usuario
  -> cria client admin com service_role_key
  -> busca billing_plans.free_trial ativo
  -> upsert profiles
  -> encontra ou cria projects
  -> upsert project_members
  -> cria wallet_templates se o projeto for novo
  -> cria billing account/subscription/cycle quando necessario
  -> garante credit wallet e limite legado de notificacoes
  -> atualiza metadados do usuario no Supabase Auth
  -> retorna dados para o frontend chamar refreshAuthProfile()
```

Se ocorrer erro depois da criacao de um projeto novo, a function tenta apagar esse `projects.id`. Como as tabelas ligadas usam `on delete cascade` em varios relacionamentos, isso reduz registros parciais do projeto. `profiles` e o usuario de Auth nao sao revertidos.

### Payload de input esperado

| Campo | Tipo | Obrigatorio | Descricao |
|---|---|---:|---|
| `establishmentName` | `string` | Condicional | Nome do estabelecimento usado em `profiles.name`, `projects.name`, `billing_accounts.legal_name` e defaults do Wallet. Se ausente no body, a function tenta usar `user.user_metadata.establishment_name`. |
| `planCode` | `string` | Nao | Codigo do plano solicitado. Hoje somente `free_trial` e aceito. Se ausente, usa `user.user_metadata.plan_code` ou `free_trial`. |

> O frontend nao deve enviar preco, franquias, status de assinatura, datas de trial ou valores de cobranca. Esses dados sao sempre lidos de `billing_plans`.

### Query params

Esta function nao usa query params.

### Headers relevantes

| Header | Obrigatorio | Descricao |
|---|---:|---|
| `Authorization` | Sim | Deve estar no formato `Bearer <access_token>`. E usado para validar a sessao do usuario com Supabase Auth. |
| `Content-Type` | Recomendado | Esperado como `application/json` para o body. |
| `Origin` | Nao | Usado para montar headers CORS. Se ausente, a function responde `Access-Control-Allow-Origin: *`. |
| `apikey` | Nao diretamente | Permitido no CORS para compatibilidade com `supabase.functions.invoke`. |
| `x-client-info` | Nao | Permitido no CORS para compatibilidade com o client Supabase. |

### Payload de output

Em sucesso, retorna JSON com status HTTP `200`.

| Campo | Tipo | Descricao |
|---|---|---|
| `success` | `boolean` | Sempre `true` em sucesso. |
| `project.id` | `string` | ID do projeto criado ou reaproveitado. |
| `project.slug` | `string \| null` | Slug do projeto. Para projeto novo, e gerado a partir do nome do estabelecimento. |
| `project.name` | `string` | Nome do estabelecimento usado no provisionamento. |
| `subscription.id` | `string` | ID da assinatura existente ou criada. |
| `subscription.status` | `string` | Status existente ou calculado (`trialing` quando `trial_days > 0`, senao `active`). |
| `subscription.trial_ends_at` | `string \| null` | Fim do trial existente ou calculado a partir de `billing_plans.trial_days`. |
| `subscription.current_period_end` | `string` | Fim do periodo atual da assinatura. |
| `plan.code` | `string` | Codigo do plano aplicado. |
| `plan.name` | `string` | Nome do plano aplicado. |
| `plan.trial_days` | `number` | Quantidade de dias de trial usada no calculo. |

Em erro, retorna:

| Campo | Tipo | Descricao |
|---|---|---|
| `error` | `string` | Mensagem segura para o frontend. |
| `code` | `string` | Codigo interno padronizado da function. |

### Erros possiveis

| Codigo HTTP | Codigo interno | Causa provavel | Acao recomendada |
|---:|---|---|---|
| 405 | `SIGNUP_FINALIZE_METHOD_NOT_ALLOWED` | Metodo diferente de `POST` ou `OPTIONS`. | Corrigir chamada do frontend ou teste. |
| 500 | `SIGNUP_FINALIZE_MISSING_ENV` | `SUPABASE_URL`, `SUPABASE_ANON_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` ausente. | Conferir secrets da Edge Function. |
| 401 | `SIGNUP_FINALIZE_MISSING_AUTHORIZATION` | Header `Authorization` ausente ou sem `Bearer`. | Garantir chamada via usuario autenticado. |
| 401 | `SIGNUP_FINALIZE_INVALID_SESSION` | Token expirado, invalido ou usuario nao encontrado pelo Auth. | Renovar sessao ou pedir novo login. |
| 400 | `SIGNUP_FINALIZE_MISSING_ESTABLISHMENT_NAME` | Nome do estabelecimento ausente no body e nos metadados do usuario. | Revisar formulario de signup e `user_metadata`. |
| 400 | `SIGNUP_FINALIZE_MISSING_USER_EMAIL` | Usuario autenticado nao possui email. | Conferir provedor Auth e cadastro. |
| 400 | `SIGNUP_FINALIZE_UNSUPPORTED_PLAN` | `planCode` diferente de `free_trial`. | Usar apenas o fluxo Free Trial ou implementar fluxo pago separado. |
| 404 | `SIGNUP_FINALIZE_PLAN_NOT_FOUND` | Plano `free_trial` ativo nao existe em `billing_plans`. | Rodar/validar seed de planos comerciais. |
| 500 | `SIGNUP_FINALIZE_PROJECT_NOT_CREATED` | Falha ao criar projeto depois das tentativas de slug. | Checar constraint de `projects.slug`, logs e payload. |
| 500 | `SIGNUP_FINALIZE_INTERNAL_ERROR` | Erro inesperado em operacoes Supabase ou cleanup. | Ver logs da function e conferir tabelas relacionadas. |

### Tabelas acessadas

| Tabela / recurso | Operacao | Observacao |
|---|---|---|
| `auth.users` | Leitura via `getUser()` e update via `auth.admin.updateUserById()` | Valida o JWT e grava `signup_project_id`, `signup_plan_code`, `establishment_name` e `plan_code`. |
| `public.billing_plans` | `select` | Fonte oficial do plano `free_trial`, precos, franquias e `trial_days`. |
| `public.profiles` | `upsert` | Garante `id`, `email`, `name` e `role = 'establishment'`. |
| `public.project_members` | `select`, `upsert` | Reaproveita projeto existente em que o usuario e `owner` e garante vinculo de ownership. |
| `public.projects` | `insert`, `select`, `delete` de rollback | Cria projeto com `auth_mode = 'form_only'` quando o usuario ainda nao possui projeto owner. |
| `public.wallet_templates` | `upsert` | Cria defaults de Wallet somente quando a function cria projeto novo. |
| `public.billing_accounts` | `select`, `insert` | Cria conta minima de faturamento com provider `other` quando nao existe. |
| `public.billing_subscriptions` | `select`, `insert` | Cria snapshot do plano e assinatura `trialing`/`active` quando nao existe assinatura ativa/trialing/past_due/paused. |
| `public.billing_cycles` | `insert` | Cria ciclo mensal aberto quando uma assinatura nova e criada. |
| `public.billing_credit_wallets` | `upsert` com `ignoreDuplicates` | Garante carteira de creditos inicial sem sobrescrever uma existente. |
| `public.projects_notifications` | `upsert` com `ignoreDuplicates` | Garante limite legado de notificacoes com base no plano sem sobrescrever registro existente. |

### Funcoes RPC utilizadas

Nao foram identificadas chamadas `.rpc()` nesta function.

### Integracoes externas

- Supabase Auth, via `supabase.auth.getUser()` e `supabaseAdmin.auth.admin.updateUserById()`.
- Supabase PostgREST/Admin client, via `@supabase/supabase-js`.
- Nao ha chamada para provedor de pagamento.
- Nao ha `fetch` para APIs externas. Os defaults de Wallet usam URLs publicas de assets no Supabase Storage, mas a function apenas grava essas URLs.

### Variaveis de ambiente

| Variavel | Obrigatoria | Uso |
|---|---:|---|
| `SUPABASE_URL` | Sim | URL do projeto Supabase usada pelos clients anon e admin. |
| `SUPABASE_ANON_KEY` | Sim | Client autenticado pelo JWT do usuario para validar a sessao. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Client admin usado para provisionar tabelas e atualizar Auth metadata. |

### Seguranca e autorizacao

Esta function utiliza `service_role_key`, portanto pode bypassar RLS. Por isso, toda operacao privilegiada depende das validacoes manuais feitas antes do client admin:

- exige `Authorization: Bearer <access_token>`;
- valida o token com `supabase.auth.getUser()`;
- usa `user.id` do token como usuario provisionado;
- nao aceita valores financeiros, limites, status ou datas vindos do frontend;
- aceita apenas `planCode = free_trial`;
- ao reaproveitar projeto, busca apenas `project_members.user_id = user.id` e `role = 'owner'`.

`user_metadata` e usado como fallback de dados de entrada, nao como fonte de autorizacao. O `app_metadata` e atualizado no fim do fluxo pelo backend.

Ponto de atencao: o CORS reflete qualquer `Origin` recebido ou usa `*` quando ausente. Em producao, avaliar allowlist de origens se a function ficar exposta fora do client oficial.

### Idempotencia

A function e tolerante a chamadas repetidas em sequencia:

- `profiles` usa `upsert` por `id`;
- `project_members` usa `upsert` por `project_id,user_id`;
- projeto existente e reaproveitado quando o usuario ja possui um `owner`;
- `billing_accounts` e `billing_subscriptions` sao consultados antes de inserir;
- `billing_credit_wallets` e `projects_notifications` usam `upsert` com `ignoreDuplicates`;
- existe indice unico para uma assinatura ativa/trialing/past_due/paused por projeto;
- `billing_accounts`, `billing_credit_wallets`, `projects_notifications` e `wallet_templates` possuem unicidade por projeto.

> Observacao: nao ha transacao unica envolvendo todas as tabelas. Em chamadas concorrentes logo apos o signup, ainda pode haver corrida antes do primeiro `project_members` existir. Avaliar mover o provisionamento para uma RPC transacional se o fluxo precisar suportar retries paralelos com garantia forte.

### Logs e debugging

Log atual identificado:

```text
signup-finalize error
```

Para investigar falhas, conferir:

- se os secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` existem no ambiente da function;
- se o frontend esta chamando com sessao valida e `Authorization` presente;
- se `billing_plans` possui `code = 'free_trial'` e `is_active = true`;
- se `profiles.role` foi atualizado para `establishment`;
- se existe `project_members` com `user_id` do usuario e `role = 'owner'`;
- se `billing_subscriptions` tem uma assinatura em `trialing` ou `active` para o projeto;
- se o cleanup apagou um projeto recem-criado apos erro intermediario.

Logs futuros uteis: `user.id`, `projectId`, `plan.code`, etapa atual do provisionamento e codigo de erro normalizado. Nao logar JWT completo, `service_role_key`, anon key, payloads sensiveis ou documentos.

### Cenarios de teste recomendados

- `OPTIONS` retorna `204` com CORS.
- `GET` retorna `405`.
- `POST` sem `Authorization` retorna `401`.
- `POST` com token invalido ou expirado retorna `401`.
- Payload sem `establishmentName` e sem metadata retorna `400`.
- `planCode` diferente de `free_trial` retorna `400`.
- `billing_plans.free_trial` ausente ou inativo retorna `404`.
- Signup Free Trial novo cria profile, project, membership owner, wallet template, billing account, subscription, cycle, credit wallet e projects notifications.
- Chamada repetida para o mesmo usuario reaproveita projeto/assinatura existentes.
- Usuario com projeto owner existente recebe esse projeto reaproveitado.
- Falha apos criar projeto novo remove o projeto criado e nao deixa registros dependentes principais.
- Frontend chama `refreshAuthProfile()` apos sucesso e libera acesso ao painel `/org`.

### Observacoes e riscos

- O fluxo pago (`signup_start_checkout` / `signup_finalize_paid`) ainda nao esta implementado nesta function.
- O provisionamento mistura varias tabelas sem uma transacao Postgres unica.
- O slug usa sufixo aleatorio e tenta novamente ate 3 vezes em conflito `23505`.
- O template de Wallet contem identificadores e URLs default hardcoded; revisar quando houver multi-tenant de certificados/assets.
- `projects_notifications` e mantido por compatibilidade com limite legado de notificacoes.
