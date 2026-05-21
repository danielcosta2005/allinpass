# Backend Edge Functions

Este arquivo documenta as Supabase Edge Functions do projeto, explicando o objetivo de cada funcao, quando ela e utilizada, quais payloads recebe e retorna, quais processos internos executa, quais tabelas acessa, quais erros pode gerar e quais cuidados de seguranca, idempotencia e debugging devem ser observados.

## `signup-precheck`

### Objetivo

Executa a verificacao previa do cadastro Free Trial antes de criar o usuario no Supabase Auth.

Ela protege o fluxo contra tentativas abusivas, valida captcha quando configurado e verifica se o email ja pertence a uma conta existente. A fonte da verdade para existencia de conta e `auth.users`, nao `public.profiles`.

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
11. Verifica se o email ja existe em `auth.users` pela RPC `signup_precheck_auth_email_exists`.
12. Grava logs sanitizados em `function_logs`.
13. Retorna `can_proceed = true` somente quando todas as verificacoes passam.

### Fluxo interno

```text
Frontend publico
  -> signup-precheck
  -> normaliza email e extrai IP
  -> gera hashes com salt
  -> consume_signup_precheck_rate_limit
  -> valida Turnstile quando requerido
  -> signup_precheck_auth_email_exists(auth.users)
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
| 403 | `signup_precheck_blocked` | Captcha ausente, captcha invalido ou email ja existente. | Mostrar mensagem generica e orientar login quando aplicavel. |
| 405 | sem `code` | Metodo diferente de `POST` ou `OPTIONS`. | Corrigir chamada. |
| 429 | `signup_precheck_blocked` | Rate limit excedido para hash de IP/email. | Respeitar `retry_after_seconds`. |
| 503 | `signup_precheck_unavailable` | Captcha obrigatorio, mas `SIGNUP_PRECHECK_CAPTCHA_SECRET` ausente. | Configurar secret ou desligar obrigatoriedade. |
| 500 | `signup_precheck_unavailable` | Erro inesperado em RPC, Supabase ou logging. | Ver logs da function e migrations relacionadas. |

### Tabelas acessadas

| Tabela / recurso | Operacao | Observacao |
|---|---|---|
| `public.signup_precheck_rate_limits` | `select`, `insert`, `update` via RPC | Guarda tentativas por hash de IP/email, janela, bloqueio e `last_seen_at`. |
| `auth.users` | `select` via RPC | Fonte da verdade para existencia de conta por email. Ignora usuarios deletados (`deleted_at is null`). |
| `public.function_logs` | `insert` | Logs sanitizados com hashes, outcome, tentativas e duracao. |

### Funcoes RPC utilizadas

| RPC | Uso |
|---|---|
| `public.consume_signup_precheck_rate_limit(...)` | Consome a tentativa de forma atomica, cria/atualiza janela e retorna `allowed`, `retry_after_seconds`, `attempts`, `blocked_until`. |
| `public.signup_precheck_auth_email_exists(p_email text)` | Verifica existencia de email em `auth.users`; substitui a consulta antiga em `profiles.email`. |

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

- nao retorna se o email existe de forma explicita; usa mensagem generica;
- nao grava email/IP em claro nos logs ou rate limit, apenas hashes com salt;
- aplica rate limit antes de captcha e antes de verificar existencia de conta;
- usa `auth.users` como fonte da verdade para evitar inconsistencias de `profiles.email`;
- executa RPCs liberadas para `service_role`.

Ponto de atencao: `SIGNUP_PRECHECK_HASH_SALT` deve ser longo, aleatorio e secreto. Se o fallback default for usado em producao, hashes ficam mais faceis de correlacionar.

### Idempotencia

A function nao cria recursos de negocio permanentes. Chamadas repetidas sao seguras do ponto de vista de dados de signup, mas cada chamada consome uma tentativa de rate limit.

O rate limit e atomico via `for update` dentro da RPC `consume_signup_precheck_rate_limit`.

### Logs e debugging

Logs sao gravados em `public.function_logs` com `function_name = 'signup-precheck'`.

Outcomes relevantes:

- `rate_limited`
- `captcha_secret_missing`
- `captcha_missing`
- `captcha_failed`
- `existing_account_detected`
- `allowed`
- `internal_error`

Para debugar:

- conferir secrets de Turnstile e salt;
- verificar se `SIGNUP_PRECHECK_CAPTCHA_REQUIRED` esta alinhado com o widget frontend;
- consultar `signup_precheck_rate_limits` por hashes quando possivel;
- validar se `signup_precheck_auth_email_exists` foi aplicada pela migration;
- checar logs de erro sem expor email, IP, JWT ou secrets.

### Cenarios de teste recomendados

- `OPTIONS` retorna `204`.
- `GET` retorna `405`.
- `POST` sem email retorna `400`.
- Captcha obrigatorio sem secret retorna `503`.
- Captcha obrigatorio sem token retorna `403`.
- Token Turnstile invalido retorna `403`.
- Rate limit excedido retorna `429` com `retry_after_seconds`.
- Email existente em `auth.users` retorna `can_proceed=false`.
- Email inexistente com captcha valido retorna `can_proceed=true`.

### Observacoes e riscos

- O precheck nao substitui validacoes do Supabase Auth; ele apenas evita chamadas indevidas antes do signup.
- Como a mensagem de bloqueio e generica, o frontend deve tratar o texto com cuidado para nao permitir enumeracao de emails.
- A migration `20260520212555_sync_profiles_email_and_auth_precheck.sql` tambem corrige `handle_new_user()` para novos `profiles` nascerem com `email = lower(new.email)`, mas `signup-precheck` nao depende mais de `profiles.email`.

## `signup-finalize`

### Objetivo

Finaliza o cadastro Free Trial depois que o usuario ja foi criado pelo Supabase Auth.

Esta function nao cria usuario, nao recebe senha e nao executa checkout. Ela recebe uma chamada autenticada do frontend, valida o JWT do usuario recem-cadastrado e provisiona os dados de negocio iniciais para que o estabelecimento consiga acessar o painel `/org`.

### Quando e utilizada

- Apos `supabase.auth.signUp` retornar uma sessao no fluxo `/cadastro?plano=free-trial`.
- Apos confirmacao de email, quando o usuario volta para `/cadastro?plano=free-trial&finalizar=1` e ja possui sessao valida.
- Em recuperacao automatica feita pelo frontend quando o Auth redireciona o usuario antes de provisionar o projeto.
- Em chamadas repetidas de recuperacao do provisionamento, desde que o usuario ainda use o plano `free_trial`.

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
6. Resolve `establishmentName` pelo body ou por `user.user_metadata.establishment_name`.
7. Resolve `planCode` pelo body, por `user.user_metadata.plan_code` ou pelo default `free_trial`.
8. Bloqueia qualquer plano diferente de `free_trial`.
9. Reivindica a finalizacao persistida em `signup_finalizations`.
10. Se a finalizacao ja estiver completa, retorna a resposta persistida.
11. Se outra chamada estiver processando, aguarda por um curto periodo e reutiliza a resposta quando disponivel.
12. Busca o plano `free_trial` ativo em `billing_plans`.
13. Cria ou atualiza `profiles` com papel `establishment`.
14. Reaproveita o primeiro projeto em que o usuario ja e `owner`, quando existir.
15. Se nao houver projeto, cria um novo `projects` com `auth_mode = 'form_only'` e slug gerado por nome + sufixo aleatorio.
16. Garante `project_members` com o usuario como `owner`.
17. Para projeto novo, cria o `wallet_templates` inicial com defaults de Wallet.
18. Garante `billing_accounts`, `billing_subscriptions`, `billing_cycles`, `billing_credit_wallets` e `projects_notifications`.
19. Atualiza `auth.users` com metadados de signup em `app_metadata` e `user_metadata`.
20. Marca `signup_finalizations` como `completed` e persiste a resposta final.

### Fluxo interno

```text
Frontend autenticado
  -> signup-finalize
  -> valida JWT com client anon + Authorization do usuario
  -> cria client admin com service_role_key
  -> claimSignupFinalization(user.id)
     -> completed: retorna resposta persistida
     -> processing: espera ate ~7s por resposta concluida ou retorna 409
     -> proceed: continua provisionamento
  -> busca billing_plans.free_trial ativo
  -> upsert profiles
  -> encontra ou cria projects
  -> upsert project_members
  -> cria wallet_templates se o projeto for novo
  -> cria billing account/subscription/cycle quando necessario
  -> garante credit wallet e limite legado de notificacoes
  -> atualiza metadados do usuario no Supabase Auth
  -> completeSignupFinalization()
  -> retorna resposta
```

Se ocorrer erro depois da criacao de um projeto novo, a function tenta apagar esse `projects.id`. Como as tabelas ligadas usam `on delete cascade` em varios relacionamentos, isso reduz registros parciais do projeto. `profiles`, o usuario de Auth e a linha de `signup_finalizations` nao sao apagados; a finalizacao e marcada como `failed` para permitir retry.

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
| 409 | `SIGNUP_FINALIZE_IN_PROGRESS` | Outra chamada esta processando e nao concluiu dentro da janela de espera. | Aguardar alguns segundos e tentar novamente. |
| 500 | `SIGNUP_FINALIZE_PROJECT_NOT_CREATED` | Falha ao criar projeto depois das tentativas de slug. | Checar constraint de `projects.slug`, logs e payload. |
| 500 | `SIGNUP_FINALIZE_INTERNAL_ERROR` | Erro inesperado em operacoes Supabase ou cleanup. | Ver logs da function e conferir tabelas relacionadas. |

### Tabelas acessadas

| Tabela / recurso | Operacao | Observacao |
|---|---|---|
| `auth.users` | Leitura via `getUser()` e update via `auth.admin.updateUserById()` | Valida o JWT e grava `signup_project_id`, `signup_plan_code`, `establishment_name` e `plan_code`. |
| `public.signup_finalizations` | `insert`, `select`, `update` | Guarda status de idempotencia por `auth.users.id`, resposta final, erro e tentativas. |
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
- usa `signup_finalizations.user_id = user.id` como chave de idempotencia;
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
- se os secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` existem no ambiente da function;
- se o frontend esta chamando com sessao valida e `Authorization` presente;
- se `billing_plans` possui `code = 'free_trial'` e `is_active = true`;
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
- `planCode` diferente de `free_trial` retorna `400`.
- `billing_plans.free_trial` ausente ou inativo retorna `404`.
- Signup Free Trial novo cria profile, project, membership owner, wallet template, billing account, subscription, cycle, credit wallet, projects notifications e signup finalization completed.
- Chamada repetida para o mesmo usuario retorna a mesma resposta persistida em `signup_finalizations`.
- Chamadas concorrentes para o mesmo usuario executam apenas um provisionamento real.
- Usuario com projeto owner existente recebe esse projeto reaproveitado.
- Falha apos criar projeto novo remove o projeto criado e marca `signup_finalizations.status = 'failed'`.
- Frontend chama `refreshAuthProfile()` apos sucesso e libera acesso ao painel `/org`.

### Observacoes e riscos

- O fluxo pago (`signup_start_checkout` / `signup_finalize_paid`) ainda nao esta implementado nesta function.
- O provisionamento mistura varias tabelas sem uma transacao Postgres unica.
- O slug usa sufixo aleatorio e tenta novamente ate 3 vezes em conflito `23505`.
- O template de Wallet contem identificadores e URLs default hardcoded; revisar quando houver multi-tenant de certificados/assets.
- `projects_notifications` e mantido por compatibilidade com limite legado de notificacoes.
- A tabela `signup_finalizations` deve ser aplicada no banco antes do deploy desta versao da Edge Function.
