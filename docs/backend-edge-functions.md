# Backend Edge Functions

Este arquivo documenta as Supabase Edge Functions do projeto, explicando o objetivo de cada funcao, quando ela e utilizada, quais payloads recebe e retorna, quais processos internos executa, quais tabelas acessa, quais erros pode gerar e quais cuidados de seguranca, idempotencia e debugging devem ser observados.

## `signup-precheck`

### Objetivo

Executa a verificacao previa do cadastro Free Trial antes de criar o usuario no Supabase Auth.

Ela protege o fluxo contra tentativas abusivas, valida captcha quando configurado e verifica se o email ja pertence a uma conta existente. A fonte da verdade para existencia de conta e `auth.users`, com `public.profiles.role` usado apenas para classificar contas existentes.

### Quando e utilizada

- No frontend de cadastro Free Trial, antes de chamar `supabase.auth.signUp`.
- Quando o usuario informa email, nome do estabelecimento e, se ativo, o token do Cloudflare Turnstile.
- Em tentativas repetidas de signup, para aplicar rate limit por combinacao de IP e email.

### Quem pode chamar

Pode ser chamada pelo frontend publico, sem sessao autenticada. Por isso, a function usa `SUPABASE_SERVICE_ROLE_KEY` internamente e precisa validar manualmente abuso, captcha e existencia de conta.

### Metodo HTTP

- `POST`: executa o precheck.
- `OPTIONS`: retorna `204` para preflight CORS.
- Outros metodos retornam `405`.

### Responsabilidades e processos internos

1. Trata CORS usando o `Origin` recebido.
2. Valida metodo HTTP.
3. Carrega `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e secrets opcionais de captcha/hash.
4. Le o payload JSON, tolerando body invalido como `{}`.
5. Normaliza `email` para lowercase.
6. Extrai IP do cliente por `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip` ou `unknown`.
7. Calcula hashes de email, IP e chave de rate limit usando `SIGNUP_PRECHECK_HASH_SALT`.
8. Consome rate limit pela RPC `consume_signup_precheck_rate_limit`.
9. Se captcha estiver obrigatorio, valida presenca de secret e token.
10. Quando ha token e secret, valida o token no Cloudflare Turnstile.
11. Classifica o email pela RPC `signup_precheck_auth_account_status`, cruzando `auth.users` com `profiles.role`.
12. Grava logs sanitizados em `function_logs`.
13. Para `existing_customer`, grava uma intencao em `signup_existing_customer_intents` com email, estabelecimento e plano.
14. Retorna `can_proceed = true` para email novo ou para `existing_customer`, que segue por magic link em vez de `signUp`.

### Fluxo interno

```text
Frontend publico
  -> signup-precheck
  -> normaliza email e extrai IP
  -> gera hashes com salt
  -> consume_signup_precheck_rate_limit
  -> valida Turnstile quando requerido
  -> signup_precheck_auth_account_status(auth.users + profiles.role)
  -> grava signup_existing_customer_intents quando existing_customer
  -> grava function_logs
  -> retorna can_proceed
```

### Payload de input esperado

| Campo | Tipo | Obrigatorio | Descricao |
|---|---|---:|---|
| `email` | `string` | Sim | Email que sera usado no signup. E normalizado com `trim().toLowerCase()`. |
| `establishmentName` | `string` | Nao | Nome do estabelecimento. Hoje e usado apenas para logging sanitizado (`has_establishment_name`). |
| `captchaToken` | `string` | Condicional | Token retornado pelo Cloudflare Turnstile quando `SIGNUP_PRECHECK_CAPTCHA_REQUIRED=true`. |

### Query params

Esta function nao usa query params.

### Headers relevantes

| Header | Obrigatorio | Descricao |
|---|---:|---|
| `Origin` | Nao | Usado para montar headers CORS. |
| `x-forwarded-for` | Nao | Primeira fonte para identificar IP do cliente. |
| `x-real-ip` | Nao | Fallback para IP do cliente. |
| `cf-connecting-ip` | Nao | Fallback quando trafega por Cloudflare. |
| `Content-Type` | Recomendado | Esperado como `application/json`. |

### Payload de output

Em sucesso permitido:

| Campo | Tipo | Descricao |
|---|---|---|
| `can_proceed` | `boolean` | `true` quando o frontend pode seguir para `supabase.auth.signUp`. |
| `code` | `string` | `ok`. |
| `message` | `string` | `ok`. |

Em conta cliente existente:

| Campo | Tipo | Descricao |
|---|---|---|
| `can_proceed` | `boolean` | `true`, mas o frontend deve seguir por `supabase.auth.signInWithOtp` com `shouldCreateUser=false`. |
| `code` | `string` | `existing_customer`. |
| `message` | `string` | Mensagem orientando o envio de link de acesso. |

Em bloqueio ou indisponibilidade:

| Campo | Tipo | Descricao |
|---|---|---|
| `can_proceed` | `boolean` | `false`. |
| `code` | `string` | Codigo padronizado do precheck. |
| `message` | `string` | Mensagem generica segura para o frontend. |
| `retry_after_seconds` | `number` | Presente em bloqueio por rate limit. |

### Erros possiveis

| Codigo HTTP | Codigo interno | Causa provavel | Acao recomendada |
|---:|---|---|---|
| 400 | sem `code` | `email` ausente. | Corrigir formulario/chamada. |
| 403 | `signup_precheck_blocked` | Captcha ausente, captcha invalido ou conta existente sem fluxo alternativo seguro. | Mostrar mensagem generica e orientar login quando aplicavel. |
| 405 | sem `code` | Metodo diferente de `POST` ou `OPTIONS`. | Corrigir chamada. |
| 429 | `signup_precheck_blocked` | Rate limit excedido para hash de IP/email. | Respeitar `retry_after_seconds`. |
| 503 | `signup_precheck_unavailable` | Captcha obrigatorio, mas `SIGNUP_PRECHECK_CAPTCHA_SECRET` ausente. | Configurar secret ou desligar obrigatoriedade. |
| 500 | `signup_precheck_unavailable` | Erro inesperado em RPC, Supabase ou logging. | Ver logs da function e migrations relacionadas. |

### Tabelas acessadas

| Tabela / recurso | Operacao | Observacao |
|---|---|---|
| `public.signup_precheck_rate_limits` | `select`, `insert`, `update` via RPC | Guarda tentativas por hash de IP/email, janela, bloqueio e `last_seen_at`. |
| `auth.users` | `select` via RPC | Fonte da verdade para existencia de conta por email. Ignora usuarios deletados (`deleted_at is null`). |
| `public.profiles` | `select` via RPC | Classifica a conta existente por `role`, sem depender de `profiles.email`. |
| `public.signup_existing_customer_intents` | `upsert` | Guarda a intencao de Free Trial para conta `customer` existente, permitindo finalizar em outro dispositivo. |
| `public.function_logs` | `insert` | Logs sanitizados com hashes, outcome, tentativas e duracao. |

### Funcoes RPC utilizadas

| RPC | Uso |
|---|---|
| `public.consume_signup_precheck_rate_limit(...)` | Consome a tentativa de forma atomica, cria/atualiza janela e retorna `allowed`, `retry_after_seconds`, `attempts`, `blocked_until`. |
| `public.signup_precheck_auth_account_status(p_email text)` | Retorna `available`, `existing_customer`, `existing_establishment` ou `existing_account` a partir de `auth.users` e `profiles.role`. |

### Integracoes externas

- Cloudflare Turnstile: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- Supabase PostgREST/Admin client via `@supabase/supabase-js`.

### Variaveis de ambiente

| Variavel | Obrigatoria | Uso |
|---|---:|---|
| `SUPABASE_URL` | Sim | URL do projeto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Client admin para RPCs e logs. |
| `SIGNUP_PRECHECK_HASH_SALT` | Recomendado | Salt para hashes de email, IP e chave de rate limit. Se ausente, usa fallback inseguro para producao. |
| `SIGNUP_PRECHECK_CAPTCHA_SECRET` | Condicional | Secret do Cloudflare Turnstile. Obrigatorio quando captcha requerido. |
| `SIGNUP_PRECHECK_CAPTCHA_REQUIRED` | Nao | Quando `true`, exige `captchaToken` valido. |

### Seguranca e autorizacao

Esta function usa `service_role_key` e e chamada por usuario nao autenticado. Por isso:

- retorna apenas o status minimo necessario para o fluxo; `existing_customer` e permitido somente depois de rate limit/captcha;
- nao grava email/IP em claro nos logs ou rate limit, apenas hashes com salt;
- aplica rate limit antes de captcha e antes de verificar existencia de conta;
- usa `auth.users` como fonte da verdade para evitar inconsistencias de `profiles.email`;
- usa `profiles.role` apenas para decidir se uma conta `customer` pode receber magic link;
- executa RPCs liberadas para `service_role`.

Ponto de atencao: `SIGNUP_PRECHECK_HASH_SALT` deve ser longo, aleatorio e secreto. Se o fallback default for usado em producao, hashes ficam mais faceis de correlacionar.

### Idempotencia

A function nao provisiona recursos de negocio permanentes. Para `existing_customer`, ela grava ou atualiza uma intencao temporaria em `signup_existing_customer_intents`.

O rate limit e atomico via `for update` dentro da RPC `consume_signup_precheck_rate_limit`.

Chamadas repetidas para o mesmo email `existing_customer` sobrescrevem a intencao pendente e renovam `expires_at` para 24 horas.

### Logs e debugging

Logs sao gravados em `public.function_logs` com `function_name = 'signup-precheck'`.

Outcomes relevantes:

- `rate_limited`
- `captcha_secret_missing`
- `captcha_missing`
- `captcha_failed`
- `existing_customer`
- `existing_establishment`
- `existing_account`
- `allowed`
- `internal_error`

Para debugar:

- conferir secrets de Turnstile e salt;
- verificar se `SIGNUP_PRECHECK_CAPTCHA_REQUIRED` esta alinhado com o widget frontend;
- consultar `signup_precheck_rate_limits` por hashes quando possivel;
- validar se `signup_precheck_auth_account_status` foi aplicada pela migration;
- checar logs de erro sem expor email, IP, JWT ou secrets.

### Cenarios de teste recomendados

- `OPTIONS` retorna `204`.
- `GET` retorna `405`.
- `POST` sem email retorna `400`.
- Captcha obrigatorio sem secret retorna `503`.
- Captcha obrigatorio sem token retorna `403`.
- Token Turnstile invalido retorna `403`.
- Rate limit excedido retorna `429` com `retry_after_seconds`.
- Email existente com `profiles.role = customer` retorna `can_proceed=true` e `code=existing_customer`.
- Email existente com `profiles.role = establishment` retorna `can_proceed=false`.
- Email inexistente com captcha valido retorna `can_proceed=true`.

### Observacoes e riscos

- O precheck nao substitui validacoes do Supabase Auth; ele apenas evita chamadas indevidas antes do signup.
- Como a mensagem de bloqueio e generica, o frontend deve tratar o texto com cuidado para nao permitir enumeracao de emails.
- A migration `20260520212555_sync_profiles_email_and_auth_precheck.sql` tambem corrige `handle_new_user()` para novos `profiles` nascerem com `email = lower(new.email)`, mas `signup-precheck` nao depende mais de `profiles.email`.

## `signup-finalize`

### Objetivo

Finaliza o cadastro Free Trial ou pago depois que o usuario ja foi criado pelo Supabase Auth.

Esta function nao cria usuario, nao recebe senha e nao cria checkout. Ela recebe uma chamada autenticada do frontend, valida o JWT do usuario recem-cadastrado e provisiona os dados de negocio iniciais para que o estabelecimento consiga acessar o painel `/org`. Quando a finalizacao vem de `existing_customer`, ela retorna um sinal para o frontend pedir a criacao de senha depois do magic link. Para plano pago, ela tambem exige um checkout confirmado em `signup_checkout_sessions`.

### Quando e utilizada

- Apos `supabase.auth.signUp` retornar uma sessao no fluxo `/cadastro?plano=free-trial`.
- Apos confirmacao de email, quando o usuario volta para `/cadastro?plano=free-trial&finalizar=1` e ja possui sessao valida.
- Apos retorno de sucesso do Asaas para `/cadastro?...&finalizar=1&checkoutSessionId=...`, desde que o webhook ja tenha marcado o checkout como pago.
- Em recuperacao automatica feita pelo frontend quando o Auth redireciona o usuario antes de provisionar o projeto.
- Em retorno de magic link `existing_customer` aberto em outro dispositivo, mesmo sem dados locais, desde que exista intencao pendente em `signup_existing_customer_intents`.
- Em chamadas repetidas de recuperacao do provisionamento.

### Quem pode chamar

Apenas usuarios autenticados com `Authorization: Bearer <access_token>` valido.

Nao ha validacao de role previa, porque a propria function cria ou atualiza `profiles.role = 'establishment'`. A autorizacao manual central e confirmar que o token pertence ao usuario que sera provisionado.

### Metodo HTTP

- `POST`: executa ou reutiliza a finalizacao do signup.
- `OPTIONS`: retorna `204` para preflight CORS.
- Outros metodos retornam `405`.

### Responsabilidades e processos internos

1. Trata CORS usando o `Origin` recebido.
2. Valida metodo HTTP.
3. Carrega `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`.
4. Valida o header `Authorization` e confirma a sessao com `supabase.auth.getUser()`.
5. Le o payload JSON, tolerando body vazio ou invalido como `{}`.
6. Busca uma intencao pendente em `signup_existing_customer_intents` pelo email autenticado, quando existir.
7. Resolve `establishmentName` pelo body, por `user.user_metadata.establishment_name` ou pela intencao de cliente existente.
8. Resolve `planCode` pelo body, por `user.user_metadata.plan_code`, pela intencao ou pelo default `free_trial`.
9. Busca o plano ativo em `billing_plans`.
10. Para plano pago, valida `checkoutSessionId`, `status = paid`, `paid_at` e valor do plano em `signup_checkout_sessions`.
11. Reivindica a finalizacao persistida em `signup_finalizations`.
12. Se a finalizacao ja estiver completa, retorna a resposta persistida e marca a intencao como `completed`.
13. Se outra chamada estiver processando, aguarda por um curto periodo e reutiliza a resposta quando disponivel.
14. Cria ou atualiza `profiles` com papel `establishment`.
15. Reaproveita o primeiro projeto em que o usuario ja e `owner`, quando existir.
16. Se nao houver projeto, cria um novo `projects` com `auth_mode = 'form_only'` e slug gerado por nome + sufixo aleatorio.
17. Garante `project_members` com o usuario como `owner`.
18. Para projeto novo, cria o `wallet_templates` inicial com defaults de Wallet.
19. Garante `billing_accounts`, `billing_subscriptions`, `billing_cycles`, `billing_credit_wallets` e `projects_notifications`.
20. Atualiza `auth.users` com metadados de signup em `app_metadata` e `user_metadata`.
21. Inclui `auth.password_setup_required = true` na resposta quando havia intencao pendente de `existing_customer`.
22. Marca `signup_finalizations` como `completed`, marca a intencao como `completed` e persiste a resposta final.

### Fluxo interno

```text
Frontend autenticado
  -> signup-finalize
  -> valida JWT com client anon + Authorization do usuario
  -> cria client admin com service_role_key
  -> busca signup_existing_customer_intents por user.email quando necessario
  -> claimSignupFinalization(user.id)
     -> completed: retorna resposta persistida
     -> processing: espera ate ~7s por resposta concluida ou retorna 409
     -> proceed: continua provisionamento
  -> busca billing_plans ativo pelo planCode
  -> se plano pago, valida signup_checkout_sessions.status = paid
  -> upsert profiles
  -> encontra ou cria projects
  -> upsert project_members
  -> cria wallet_templates se o projeto for novo
  -> cria billing account/subscription/cycle quando necessario
  -> garante credit wallet e limite legado de notificacoes
  -> atualiza metadados do usuario no Supabase Auth
  -> completeSignupFinalization()
  -> completeExistingCustomerSignupIntent()
  -> retorna resposta
```

Se ocorrer erro depois da criacao de um projeto novo, a function tenta apagar esse `projects.id`. Como as tabelas ligadas usam `on delete cascade` em varios relacionamentos, isso reduz registros parciais do projeto. `profiles`, o usuario de Auth e a linha de `signup_finalizations` nao sao apagados; a finalizacao e marcada como `failed` para permitir retry.

### Payload de input esperado

| Campo | Tipo | Obrigatorio | Descricao |
|---|---|---:|---|
| `establishmentName` | `string` | Condicional | Nome do estabelecimento usado em `profiles.name`, `projects.name`, `billing_accounts.legal_name` e defaults do Wallet. Se ausente no body, a function tenta usar `user.user_metadata.establishment_name` ou a intencao pendente em `signup_existing_customer_intents`. |
| `planCode` | `string` | Nao | Codigo do plano solicitado. Se ausente, usa `user.user_metadata.plan_code`, a intencao pendente ou `free_trial`. |
| `checkoutSessionId` | `uuid` | Condicional | Obrigatorio para planos pagos. Deve apontar para uma sessao paga em `signup_checkout_sessions`. |

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
| `auth.password_setup_required` | `boolean` | `true` quando a finalizacao veio de `existing_customer`; o frontend deve pedir uma nova senha e chamar `supabase.auth.updateUser({ password })` com sessao autenticada. |
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
| `checkout` | `object \| null` | Dados do checkout pago usado na finalizacao; `null` no free trial. |

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
| 404 | `SIGNUP_FINALIZE_PLAN_NOT_FOUND` | Plano ativo nao existe em `billing_plans`. | Rodar/validar seed de planos comerciais. |
| 400/404 | `SIGNUP_FINALIZE_CHECKOUT_NOT_FOUND` | Plano pago sem checkout ou checkout nao pertence ao usuario/plano. | Recriar checkout com `signup-start-checkout`. |
| 402/409 | `SIGNUP_FINALIZE_PAYMENT_NOT_CONFIRMED` | Checkout pago ainda nao recebeu confirmacao do Asaas. | Aguardar webhook ou reenviar evento no Asaas. |
| 409 | `SIGNUP_FINALIZE_PAYMENT_AMOUNT_MISMATCH` | Valor pago no checkout diverge do preco atual do plano. | Investigar plano alterado apos checkout ou tentativa invalida. |
| 409 | `SIGNUP_FINALIZE_IN_PROGRESS` | Outra chamada esta processando e nao concluiu dentro da janela de espera. | Aguardar alguns segundos e tentar novamente. |
| 500 | `SIGNUP_FINALIZE_PROJECT_NOT_CREATED` | Falha ao criar projeto depois das tentativas de slug. | Checar constraint de `projects.slug`, logs e payload. |
| 500 | `SIGNUP_FINALIZE_INTERNAL_ERROR` | Erro inesperado em operacoes Supabase ou cleanup. | Ver logs da function e conferir tabelas relacionadas. |

### Tabelas acessadas

| Tabela / recurso | Operacao | Observacao |
|---|---|---|
| `auth.users` | Leitura via `getUser()` e update via `auth.admin.updateUserById()` | Valida o JWT e grava `signup_project_id`, `signup_plan_code`, `establishment_name` e `plan_code`. |
| `public.signup_finalizations` | `insert`, `select`, `update` | Guarda status de idempotencia por `auth.users.id`, resposta final, erro e tentativas. |
| `public.signup_existing_customer_intents` | `select`, `update` | Fallback para recuperar `establishmentName` e `planCode` de cliente existente quando o magic link abre em outro dispositivo. |
| `public.billing_plans` | `select` | Fonte oficial do plano, precos, franquias e `trial_days`. |
| `public.signup_checkout_sessions` | `select`, `update` | Valida checkout pago confirmado e marca a sessao como `finalized`. |
| `public.profiles` | `upsert` | Garante `id`, `email`, `name` e `role = 'establishment'`. |
| `public.project_members` | `select`, `upsert` | Reaproveita projeto existente em que o usuario e `owner` e garante vinculo de ownership. |
| `public.projects` | `insert`, `select`, `delete` de rollback | Cria projeto com `auth_mode = 'form_only'` quando o usuario ainda nao possui projeto owner. |
| `public.wallet_templates` | `upsert` | Cria defaults de Wallet somente quando a function cria projeto novo. |
| `public.billing_accounts` | `select`, `insert`, `update` | Cria conta minima de faturamento com provider `other` no free trial e `asaas` no pago. |
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
- usa `signup_finalizations.user_id = user.id` como chave de idempotencia;
- busca intencao de cliente existente apenas pelo `user.email` ja autenticado;
- nunca recebe nem persiste senha; o frontend so pede senha depois do `signup-precheck` e, em `existing_customer`, apenas orienta o frontend a criar a senha autenticada via Supabase Auth;
- nao aceita valores financeiros, limites, status ou datas vindos do frontend;
- aceita apenas `planCode = free_trial`;
- ao reaproveitar projeto, busca apenas `project_members.user_id = user.id` e `role = 'owner'`.

`user_metadata` e usado como fallback de dados de entrada, nao como fonte de autorizacao. O `app_metadata` e atualizado no fim do fluxo pelo backend.

Ponto de atencao: o CORS reflete qualquer `Origin` recebido ou usa `*` quando ausente. Em producao, avaliar allowlist de origens se a function ficar exposta fora do client oficial.

### Idempotencia

A idempotencia forte do backend e feita por `public.signup_finalizations`, cuja chave primaria e `user_id`.

Comportamento:

- primeira chamada insere `status = 'processing'` e executa o provisionamento;
- chamadas concorrentes para o mesmo usuario recebem conflito de chave e nao executam provisionamento;
- se a primeira chamada concluir, grava `status = 'completed'`, `project_id` e a `response` JSON;
- chamadas repetidas apos conclusao retornam a resposta persistida;
- chamadas concorrentes aguardam ate `FINALIZATION_WAIT_ATTEMPTS * FINALIZATION_WAIT_DELAY_MS` (aprox. 7s) por uma resposta completa;
- se ainda estiver processando apos a espera, retorna `409 SIGNUP_FINALIZE_IN_PROGRESS`;
- se a tentativa falhar, grava `status = 'failed'`, `error_code` e `error_message`, permitindo retry;
- se `processing` ficar travado por mais de `FINALIZATION_STALE_AFTER_MS` (2min), uma chamada posterior pode reassumir a finalizacao.
- quando usa ou reutiliza uma finalizacao de `existing_customer`, marca `signup_existing_customer_intents.status = 'completed'`.
- para `existing_customer`, a resposta persistida tambem mantem `auth.password_setup_required = true`, evitando que chamadas repetidas redirecionem direto para `/org` antes da senha ser criada.

Tambem ha protecoes locais:

- `profiles` usa `upsert` por `id`;
- `project_members` usa `upsert` por `project_id,user_id`;
- projeto existente e reaproveitado quando o usuario ja possui um `owner`;
- `billing_accounts` e `billing_subscriptions` sao consultados antes de inserir;
- `billing_credit_wallets` e `projects_notifications` usam `upsert` com `ignoreDuplicates`.

> Observacao: a function ainda nao envolve todo o provisionamento em uma transacao Postgres unica. A tabela `signup_finalizations` reduz a corrida entre invocacoes concorrentes da Edge Function. Se novas regras criticas forem adicionadas, considerar mover o provisionamento para uma RPC transacional.

### Logs e debugging

Log atual identificado:

```text
signup-finalize error
signup-finalize failed to persist failure state
```

Para investigar falhas, conferir:

- se a migration `20260521133225_signup_finalize_idempotency.sql` foi aplicada antes do deploy da function;
- se existe linha em `signup_finalizations` para o `user.id`, com `status`, `attempts`, `project_id`, `error_code` e `error_message`;
- se existe linha pendente em `signup_existing_customer_intents` para `lower(user.email)`, ainda dentro de `expires_at`, quando o fluxo for de cliente existente;
- se os secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` existem no ambiente da function;
- se o frontend esta chamando com sessao valida e `Authorization` presente;
- se `billing_plans` possui o `planCode` solicitado e `is_active = true`;
- se `signup_checkout_sessions` recebeu o webhook do Asaas e esta com `status = paid`, quando o plano for pago;
- se `profiles.role` foi atualizado para `establishment`;
- se existe `project_members` com `user_id` do usuario e `role = 'owner'`;
- se `billing_subscriptions` tem uma assinatura em `trialing` ou `active` para o projeto;
- se o cleanup apagou um projeto recem-criado apos erro intermediario.

Logs futuros uteis: `user.id`, `projectId`, `plan.code`, etapa atual do provisionamento, status da idempotencia e codigo de erro normalizado. Nao logar JWT completo, `service_role_key`, anon key, payloads sensiveis ou documentos.

### Cenarios de teste recomendados

- `OPTIONS` retorna `204` com CORS.
- `GET` retorna `405`.
- `POST` sem `Authorization` retorna `401`.
- `POST` com token invalido ou expirado retorna `401`.
- Payload sem `establishmentName` e sem metadata retorna `400`.
- Cliente existente sem dados no frontend finaliza usando `signup_existing_customer_intents`.
- Cliente existente recebe `auth.password_setup_required = true`, cria a senha no frontend autenticado e depois consegue login com email/senha.
- Plano pago sem `checkoutSessionId` retorna erro de checkout ausente.
- Plano pago com checkout ainda nao confirmado retorna erro de pagamento nao confirmado.
- Plano pago com valor diferente do plano retorna erro de divergencia de valor.
- `billing_plans` ausente ou inativo para o `planCode` retorna `404`.
- Signup Free Trial novo cria profile, project, membership owner, wallet template, billing account, subscription, cycle, credit wallet, projects notifications e signup finalization completed.
- Chamada repetida para o mesmo usuario retorna a mesma resposta persistida em `signup_finalizations`.
- Chamadas concorrentes para o mesmo usuario executam apenas um provisionamento real.
- Usuario com projeto owner existente recebe esse projeto reaproveitado.
- Falha apos criar projeto novo remove o projeto criado e marca `signup_finalizations.status = 'failed'`.
- Frontend chama `refreshAuthProfile()` apos sucesso e libera acesso ao painel `/org`.

### Observacoes e riscos

- O fluxo pago usa `signup-start-checkout`, `asaas-webhook` e a propria `signup-finalize`; nao existe uma function separada `signup-finalize-paid`.
- O provisionamento mistura varias tabelas sem uma transacao Postgres unica.
- O slug usa sufixo aleatorio e tenta novamente ate 3 vezes em conflito `23505`.
- O template de Wallet contem identificadores e URLs default hardcoded; revisar quando houver multi-tenant de certificados/assets.
- `projects_notifications` e mantido por compatibilidade com limite legado de notificacoes.
- A tabela `signup_finalizations` deve ser aplicada no banco antes do deploy desta versao da Edge Function.

## `signup-start-checkout`

### Objetivo

Inicia o checkout recorrente do Asaas para um plano pago durante o fluxo de cadastro.

Esta function nao cria usuario, nao provisiona projeto e nao ativa assinatura. Ela assume que o usuario ja existe no Supabase Auth, valida a sessao autenticada, busca o plano pago em `billing_plans`, registra uma intencao em `signup_checkout_sessions` e cria um checkout recorrente no Asaas. A ativacao real do plano pago so acontece depois que `asaas-webhook` confirma o pagamento e `signup-finalize` provisiona a conta.

### Quando e utilizada

- Depois de `supabase.auth.signUp` criar o usuario no fluxo de plano pago.
- Depois de um cliente existente acessar por magic link e voltar autenticado para a etapa de pagamento.
- Quando o frontend precisa redirecionar o usuario para o checkout seguro do Asaas.
- Quando ja existe um checkout pendente/criado e ainda valido para o mesmo usuario e plano, para reutilizar o link em vez de criar outro.

### Quem pode chamar

Apenas usuarios autenticados com `Authorization: Bearer <access_token>` valido.

A function nao confia no frontend para preco, franquia ou status do plano. O plano e sempre lido de `billing_plans`.

### Metodo HTTP

- `POST`: cria ou reutiliza uma sessao de checkout.
- `OPTIONS`: retorna `204` para preflight CORS.
- Outros metodos retornam `405`.

### Responsabilidades e processos internos

1. Trata CORS usando o `Origin` recebido.
2. Valida metodo HTTP.
3. Carrega `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `ASAAS_API_KEY`.
4. Valida `Authorization` e confirma a sessao com `supabase.auth.getUser()`.
5. Resolve `establishmentName` pelo body ou por `user.user_metadata.establishment_name`.
6. Resolve e normaliza `planCode` pelo body ou por `user.user_metadata.plan_code`.
7. Bloqueia `free_trial`, porque checkout pago exige plano pago.
8. Busca plano ativo, mensal e com `base_price_cents > 0` em `billing_plans`.
9. Reutiliza checkout pendente/criado ainda nao expirado para o mesmo usuario e plano, quando existir.
10. Cria uma linha `pending` em `signup_checkout_sessions`.
11. Monta URLs de sucesso, cancelamento e expiracao para `/cadastro`.
12. Atualiza a linha local com as URLs de callback.
13. Chama `POST /checkouts` no Asaas com cobrança recorrente mensal.
14. Em erro do Asaas, marca a sessao como `failed` e salva metadados de request/response.
15. Em sucesso, grava `provider_checkout_id`, `checkout_url`, `status = created` e metadados.
16. Atualiza `user_metadata` do usuario com `establishment_name` e `plan_code`.
17. Retorna URL de checkout para o frontend redirecionar o usuario.

### Fluxo interno

```text
Frontend autenticado
  -> signup-start-checkout
  -> valida JWT com client anon + Authorization
  -> busca billing_plans pelo planCode
  -> procura checkout local reutilizavel
  -> cria signup_checkout_sessions pending
  -> monta callback URLs para /cadastro
  -> chama Asaas /checkouts
  -> atualiza signup_checkout_sessions para created
  -> retorna checkout_url
```

### Payload de input esperado

| Campo | Tipo | Obrigatorio | Descricao |
|---|---|---:|---|
| `establishmentName` | `string` | Condicional | Nome do estabelecimento. Se ausente no body, tenta usar `user.user_metadata.establishment_name`. |
| `planCode` | `string` | Sim | Codigo do plano pago. Deve existir em `billing_plans`, estar ativo, ser mensal e ter preco maior que zero. |

> O frontend nao deve enviar valor do plano, moeda, periodo, franquias ou preco de excedente. Esses dados sao sempre lidos de `billing_plans`.

### Query params

Esta function nao usa query params.

### Headers relevantes

| Header | Obrigatorio | Descricao |
|---|---:|---|
| `Authorization` | Sim | Deve estar no formato `Bearer <access_token>`. Usado para validar a sessao do usuario. |
| `Content-Type` | Recomendado | Esperado como `application/json`. |
| `Origin` | Nao confiavel | Pode existir em chamadas do frontend, mas nao deve ser usado em checkout local porque `localhost` e rejeitado pelo Asaas. |
| `apikey` | Nao diretamente | Permitido no CORS para compatibilidade com `supabase.functions.invoke`. |
| `x-client-info` | Nao | Permitido no CORS para compatibilidade com o client Supabase. |

### Payload de output

Em sucesso, retorna JSON com status HTTP `200`.

| Campo | Tipo | Descricao |
|---|---|---|
| `success` | `boolean` | Sempre `true` em sucesso. |
| `checkout_session_id` | `uuid` | ID local em `signup_checkout_sessions`. Deve voltar no retorno do checkout para `signup-finalize`. |
| `provider` | `string` | Provider de pagamento. Hoje sempre `asaas`. |
| `provider_checkout_id` | `string \| null` | ID do checkout no Asaas. |
| `checkout_url` | `string` | URL para redirecionar o usuario ao checkout do Asaas. |
| `expires_at` | `string \| null` | Data/hora de expiracao local do checkout. |
| `reused` | `boolean` | `true` quando a function reaproveitou checkout pendente/criado ainda valido. |

Em erro, retorna:

| Campo | Tipo | Descricao |
|---|---|---|
| `error` | `string` | Mensagem segura para o frontend. |
| `code` | `string` | Codigo interno padronizado da function. |

### Erros possiveis

| Codigo HTTP | Codigo interno | Causa provavel | Acao recomendada |
|---:|---|---|---|
| 405 | `SIGNUP_CHECKOUT_METHOD_NOT_ALLOWED` | Metodo diferente de `POST` ou `OPTIONS`. | Corrigir chamada do frontend ou teste. |
| 500 | `SIGNUP_CHECKOUT_MISSING_ENV` | Env obrigatoria ausente. | Conferir secrets da Edge Function. |
| 401 | `SIGNUP_CHECKOUT_MISSING_AUTHORIZATION` | Header `Authorization` ausente ou sem `Bearer`. | Garantir chamada com usuario autenticado. |
| 401 | `SIGNUP_CHECKOUT_INVALID_SESSION` | Token invalido, expirado ou usuario nao encontrado. | Renovar sessao ou pedir novo login. |
| 400 | `SIGNUP_CHECKOUT_MISSING_USER_EMAIL` | Usuario autenticado sem email. | Conferir cadastro no Supabase Auth. |
| 400 | `SIGNUP_CHECKOUT_MISSING_ESTABLISHMENT_NAME` | Nome do estabelecimento ausente no body e nos metadados. | Revisar formulario e `user_metadata`. |
| 400 | `SIGNUP_CHECKOUT_UNSUPPORTED_PLAN` | `planCode` ausente ou igual a `free_trial`. | Usar esta function apenas para planos pagos. |
| 404 | `SIGNUP_CHECKOUT_PLAN_NOT_FOUND` | Plano pago ativo/mensal nao encontrado ou preco zerado. | Validar seed de `billing_plans`. |
| 500 | `SIGNUP_CHECKOUT_MISSING_APP_BASE_URL` | `ASAAS_CALLBACK_BASE_URL`/`APP_BASE_URL` ausente. | Configurar uma URL publica HTTPS. |
| 500 | `SIGNUP_CHECKOUT_INVALID_APP_BASE_URL` | Callback em `localhost`, IP privado, HTTP ou URL invalida. | Usar dominio publico HTTPS, tunnel HTTPS ou ambiente de staging. |
| 502 | `SIGNUP_CHECKOUT_ASAAS_ERROR` | Asaas retornou erro ao criar checkout. | Conferir payload, chave Asaas, ambiente e resposta salva em `metadata`. |
| 502 | `SIGNUP_CHECKOUT_ASAAS_MISSING_ID` | Asaas respondeu sem ID de checkout. | Verificar mudanca de contrato/API do Asaas. |
| 500 | `SIGNUP_CHECKOUT_INTERNAL_ERROR` | Erro inesperado em Supabase, Asaas ou update local. | Ver logs da function e `signup_checkout_sessions`. |

### Tabelas acessadas

| Tabela / recurso | Operacao | Observacao |
|---|---|---|
| `auth.users` | Leitura via `getUser()` e update via `auth.admin.updateUserById()` | Valida JWT e grava `establishment_name`/`plan_code` em `user_metadata`. |
| `public.billing_plans` | `select` | Fonte oficial de plano, preco e intervalo. |
| `public.signup_checkout_sessions` | `select`, `insert`, `update` | Guarda intencao local do checkout, status, URLs de callback e IDs do Asaas. |

### Funcoes RPC utilizadas

Nao foram identificadas chamadas `.rpc()` nesta function.

### Integracoes externas

- Asaas Checkout: `POST {ASAAS_API_BASE_URL}/checkouts`.
- Supabase Auth, via `supabase.auth.getUser()` e `supabaseAdmin.auth.admin.updateUserById()`.
- Supabase PostgREST/Admin client, via `@supabase/supabase-js`.

Payload enviado ao Asaas inclui:

- `billingTypes = ["CREDIT_CARD"]`;
- `chargeTypes = ["RECURRENT"]`;
- `externalReference` com referencia local;
- callbacks de sucesso, cancelamento e expiracao para `/cadastro`;
- item unico com nome do plano e valor em reais;
- dados basicos do cliente (`name`, `email`);
- assinatura mensal (`cycle = MONTHLY`).

### Variaveis de ambiente

| Variavel | Obrigatoria | Uso |
|---|---:|---|
| `SUPABASE_URL` | Sim | URL do projeto Supabase. |
| `SUPABASE_ANON_KEY` | Sim | Client autenticado pelo JWT do usuario para validar sessao. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Client admin para ler/gravar tabelas e atualizar Auth metadata. |
| `ASAAS_API_KEY` | Sim | Chave usada no header `access_token` para criar checkout no Asaas. |
| `ASAAS_API_BASE_URL` | Nao | Override explicito da base da API Asaas. |
| `ASAAS_CHECKOUT_BASE_URL` | Nao | Override explicito da base do link de checkout quando resposta nao trouxer `link`. |
| `ASAAS_ENV` | Nao | Define `sandbox` ou `production` quando os overrides nao existem. Default: `sandbox`. |
| `ASAAS_CALLBACK_BASE_URL` | Recomendado | Base publica HTTPS usada especificamente para callbacks do Asaas. Tem prioridade sobre `APP_BASE_URL`. |
| `APP_BASE_URL` | Recomendado | Base publica HTTPS usada para montar callbacks de retorno quando `ASAAS_CALLBACK_BASE_URL` nao existe. |

### Seguranca e autorizacao

Esta function utiliza `service_role_key`, portanto pode bypassar RLS. As protecoes manuais sao:

- exige JWT valido;
- usa `user.id` do token como dono de `signup_checkout_sessions`;
- nao aceita `user_id`, `plan_id`, preco ou status vindos do frontend;
- busca o plano no banco e rejeita `free_trial`;
- rejeita callbacks que nao sejam URL publica HTTPS;
- grava apenas providers permitidos pela migration (`asaas`);
- reutiliza somente checkout do mesmo `user_id` e `plan_id`;
- nao coleta nem processa dados de cartao no AllinPass; o cartao fica no ambiente do Asaas.

Ponto de atencao: a function salva `asaas_request` e `asaas_response` em `metadata`. Nao incluir dados sensiveis nesses payloads sem revisar mascaramento.

### Idempotencia

A function possui idempotencia operacional por reutilizacao de checkout:

- antes de criar novo checkout, busca `signup_checkout_sessions` do mesmo usuario e plano;
- reutiliza somente status `pending` ou `created`;
- exige `expires_at > now()`;
- retorna `reused = true` quando reaproveita o link.

Se a chamada ao Asaas falhar, a sessao local e marcada como `failed`, permitindo nova tentativa posterior criar outro checkout.

### Logs e debugging

Log atual identificado:

```text
signup-start-checkout error
```

Para investigar falhas:

- conferir envs `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_CALLBACK_BASE_URL`/`APP_BASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
- consultar `signup_checkout_sessions` por `user_id`, `plan_code`, `status`, `provider_checkout_id`, `checkout_url`, `expires_at`;
- verificar `metadata.asaas_request` e `metadata.asaas_response` quando `status = failed`;
- confirmar se `billing_plans.code` esta ativo, mensal e com `base_price_cents > 0`;
- confirmar se o frontend recebeu `checkout_url` e redirecionou corretamente.

Nao logar `ASAAS_API_KEY`, JWT completo, `service_role_key`, documentos pessoais ou dados de cartao.

### Cenarios de teste recomendados

- `OPTIONS` retorna `204`.
- `GET` retorna `405`.
- `POST` sem `Authorization` retorna `401`.
- `POST` com token invalido retorna `401`.
- `POST` com `planCode = free_trial` retorna `400`.
- `POST` sem `establishmentName` e sem metadata retorna `400`.
- Plano pago inexistente/inativo retorna `404`.
- Env `ASAAS_CALLBACK_BASE_URL`/`APP_BASE_URL` ausente retorna `500`.
- Callback com `http://localhost`, IP privado ou sem HTTPS retorna `500` antes de chamar o Asaas.
- Erro do Asaas marca `signup_checkout_sessions.status = failed`.
- Sucesso cria `signup_checkout_sessions.status = created` e retorna `checkout_url`.
- Segunda chamada para mesmo usuario/plano antes de expirar retorna `reused = true`.

### Observacoes e riscos

- O contrato do payload do Asaas deve ser revisado quando houver mudanca de API do provider.
- O fallback `ASAAS_CHECKOUT_BASE_URL?id=<checkoutId>` so e usado se a resposta do Asaas nao trouxer `link`.
- O checkout expira localmente em 60 minutos (`DEFAULT_CHECKOUT_EXPIRATION_MINUTES`).
- O provisionamento nao acontece nesta function; ele depende do webhook marcar pagamento e do frontend chamar `signup-finalize`.

## `asaas-webhook`

### Objetivo

Recebe eventos de checkout do Asaas e sincroniza o status local em `signup_checkout_sessions`.

Esta function e o ponto confiavel de confirmacao de pagamento para o signup pago. O retorno visual do cliente para `/cadastro` nao basta para ativar assinatura; `signup-finalize` exige que esta function tenha marcado a sessao como `paid`.

### Quando e utilizada

- Quando o Asaas dispara eventos de checkout para a URL configurada no painel/provider.
- Quando um checkout pago muda para pago, cancelado, expirado ou criado/ativo.
- Antes de `signup-finalize` liberar uma assinatura paga.

### Quem pode chamar

E chamada pelo Asaas, sem JWT Supabase.

No `supabase/config.toml`, esta function deve ficar com `verify_jwt = false`, porque webhooks externos nao enviam token Supabase. A autorizacao propria e feita pelo header `asaas-access-token` quando `ASAAS_WEBHOOK_TOKEN` estiver configurado.

### Metodo HTTP

- `POST`: processa o webhook.
- `OPTIONS`: retorna `204` para preflight CORS.
- Outros metodos retornam `405`.

### Responsabilidades e processos internos

1. Trata CORS usando o `Origin` recebido.
2. Valida metodo HTTP.
3. Se `ASAAS_WEBHOOK_TOKEN` existir, compara com o header `asaas-access-token`.
4. Le o payload JSON, tolerando body invalido como `{}`.
5. Normaliza `event` e `checkout.status`.
6. Mapeia eventos/status do Asaas para status locais:
   - `CHECKOUT_PAID` ou `PAID` -> `paid`;
   - `CHECKOUT_CANCELED` ou `CANCELED` -> `canceled`;
   - `CHECKOUT_EXPIRED` ou `EXPIRED` -> `expired`;
   - `CHECKOUT_CREATED` ou `ACTIVE` -> `created`.
7. Ignora payload sem `checkout.id` ou sem status reconhecido.
8. Busca `signup_checkout_sessions` pelo provider `asaas` e `provider_checkout_id`, desde que ainda nao esteja `finalized`.
9. Se nao encontrar sessao local, retorna sucesso ignorado para evitar retry infinito inutil.
10. Mescla `metadata` existente com `last_asaas_webhook`.
11. Atualiza `status` local.
12. Quando status local e `paid`, grava `paid_at`, `provider_customer_id`, `provider_subscription_id` e `provider_payment_id` quando existirem no payload.

### Fluxo interno

```text
Asaas
  -> asaas-webhook
  -> valida asaas-access-token quando configurado
  -> normaliza event/status
  -> localiza signup_checkout_sessions por provider_checkout_id
  -> atualiza status local
  -> em pagamento, grava paid_at e IDs externos
  -> retorna received=true
```

### Payload de input esperado

O payload vem do Asaas. A function usa principalmente:

| Campo | Tipo | Obrigatorio | Descricao |
|---|---|---:|---|
| `event` | `string` | Condicional | Nome do evento do Asaas, como `CHECKOUT_PAID`, `CHECKOUT_CANCELED`, `CHECKOUT_EXPIRED` ou `CHECKOUT_CREATED`. |
| `checkout.id` | `string` | Sim | ID do checkout no Asaas. Usado para encontrar `signup_checkout_sessions.provider_checkout_id`. |
| `checkout.status` | `string` | Condicional | Status do checkout, usado como fallback para mapear o status local. |
| `checkout.customer` | `string \| object` | Nao | ID do cliente no Asaas, gravado quando status local vira `paid`. |
| `checkout.subscription` | `string \| object` | Nao | ID da assinatura no Asaas, gravado quando status local vira `paid`. |
| `checkout.payment` | `string \| object` | Nao | ID do pagamento no Asaas, gravado quando status local vira `paid`. |
| `dateCreated` | `string` | Nao | Usado como `paid_at`; se ausente ou invalido, usa `now()`. |

### Query params

Esta function nao usa query params.

### Headers relevantes

| Header | Obrigatorio | Descricao |
|---|---:|---|
| `asaas-access-token` | Condicional | Obrigatorio quando `ASAAS_WEBHOOK_TOKEN` estiver configurado. Deve ser igual ao secret local. |
| `Content-Type` | Recomendado | Esperado como `application/json`. |
| `Origin` | Nao | Usado para montar headers CORS. Normalmente webhooks server-to-server podem vir sem `Origin`. |

### Payload de output

Em sucesso processado:

| Campo | Tipo | Descricao |
|---|---|---|
| `received` | `boolean` | `true` quando o webhook foi aceito pela function. |

Quando o payload e ignorado sem erro:

| Campo | Tipo | Descricao |
|---|---|---|
| `received` | `boolean` | `true`. |
| `ignored` | `boolean` | `true` quando faltou checkout/status reconhecido ou nao havia sessao local correspondente. |

Em erro:

| Campo | Tipo | Descricao |
|---|---|---|
| `error` | `string` | Mensagem segura para quem chamou. |

### Erros possiveis

| Codigo HTTP | Codigo interno | Causa provavel | Acao recomendada |
|---:|---|---|---|
| 405 | Nao padronizado | Metodo diferente de `POST` ou `OPTIONS`. | Corrigir configuracao/teste do webhook. |
| 401 | Nao padronizado | `ASAAS_WEBHOOK_TOKEN` configurado e header `asaas-access-token` ausente/incorreto. | Conferir token configurado no Asaas e no Supabase. |
| 500 | Nao padronizado | `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` ausente, erro no banco ou exception inesperada. | Ver logs da function e secrets. |

> Observacao: esta function ainda nao retorna codigos internos padronizados como as functions de signup. Recomenda-se padronizar se o volume de debugging crescer.

### Tabelas acessadas

| Tabela / recurso | Operacao | Observacao |
|---|---|---|
| `public.signup_checkout_sessions` | `select`, `update` | Localiza a sessao pelo checkout do Asaas e atualiza status/IDs externos. |

### Funcoes RPC utilizadas

Nao foram identificadas chamadas `.rpc()` nesta function.

### Integracoes externas

- Asaas Webhooks: eventos de checkout enviados pelo provider.
- Supabase PostgREST/Admin client, via `@supabase/supabase-js`.

### Variaveis de ambiente

| Variavel | Obrigatoria | Uso |
|---|---:|---|
| `SUPABASE_URL` | Sim | URL do projeto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Client admin para atualizar `signup_checkout_sessions`. |
| `ASAAS_WEBHOOK_TOKEN` | Recomendado | Token compartilhado para validar o header `asaas-access-token`. Se ausente, a function aceita chamadas sem essa validacao. |

### Seguranca e autorizacao

Esta function usa `service_role_key` e deve ficar sem JWT Supabase porque e chamada por sistema externo. Por isso:

- `verify_jwt` deve ser `false` no deploy/config da function;
- `ASAAS_WEBHOOK_TOKEN` deve estar configurado em producao;
- quando token esta configurado, chamadas sem `asaas-access-token` correto retornam `401`;
- a function atualiza somente `signup_checkout_sessions` com `provider = 'asaas'`, `provider_checkout_id = checkout.id` e `status <> finalized`;
- nao recebe nem grava dados de cartao;
- payload completo do webhook e salvo em `metadata.last_asaas_webhook`, entao deve-se evitar expor essa coluna em APIs publicas.

Ponto de atencao: sem `ASAAS_WEBHOOK_TOKEN`, qualquer agente que conheca a URL poderia tentar enviar eventos falsos. Em producao, configurar o token e manter a URL do webhook fora de exposicoes desnecessarias.

### Idempotencia

Webhooks podem ser reenviados pelo provider. A function e tolerante a repeticao porque:

- localiza a sessao pelo par `provider = 'asaas'` + `provider_checkout_id`;
- atualiza sempre a mesma linha local;
- ignora sessoes ja `finalized`;
- eventos desconhecidos ou sem sessao local retornam `received = true, ignored = true`.

O update nao cria nova assinatura nem novo projeto. A ativacao definitiva continua centralizada em `signup-finalize`, que possui sua propria idempotencia por `signup_finalizations`.

### Logs e debugging

Log atual identificado:

```text
asaas-webhook error
```

Para investigar falhas:

- confirmar se `ASAAS_WEBHOOK_TOKEN` bate com o header `asaas-access-token`;
- verificar se o webhook do Asaas esta apontando para a URL correta da function;
- consultar `signup_checkout_sessions.provider_checkout_id` com o `checkout.id` recebido;
- conferir se a sessao nao esta `finalized`;
- verificar `status`, `paid_at`, `provider_customer_id`, `provider_subscription_id`, `provider_payment_id`;
- inspecionar `metadata.last_asaas_webhook` quando necessario.

Nao logar `ASAAS_WEBHOOK_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, payloads com dados sensiveis completos ou documentos pessoais sem mascaramento.

### Cenarios de teste recomendados

- `OPTIONS` retorna `204`.
- `GET` retorna `405`.
- `POST` sem token retorna `401` quando `ASAAS_WEBHOOK_TOKEN` esta configurado.
- `POST` com token incorreto retorna `401`.
- Payload sem `checkout.id` retorna `{ received: true, ignored: true }`.
- Evento/status desconhecido retorna `{ received: true, ignored: true }`.
- Evento `CHECKOUT_PAID` atualiza `signup_checkout_sessions.status = paid` e preenche `paid_at`.
- Evento `CHECKOUT_CANCELED` atualiza status para `canceled`.
- Evento `CHECKOUT_EXPIRED` atualiza status para `expired`.
- Evento repetido para a mesma sessao nao cria registros duplicados.
- Evento para sessao `finalized` e ignorado.

### Observacoes e riscos

- A function aceita apenas eventos de checkout mapeados no codigo atual.
- Se o Asaas mudar nomes de eventos ou estrutura do payload, o mapeamento pode precisar de ajuste.
- `paid_at` usa `dateCreated` do payload; se ausente/invalido, usa a data atual da function.
- Recomenda-se padronizar codigos internos de erro se esta function passar a ser monitorada por ferramentas automatizadas.
