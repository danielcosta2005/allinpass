# Atualizacao global de passes Apple e Google

Este documento descreve como a edicao global de um passe funciona apos a mudanca de arquitetura.

Escopo: somente edicoes feitas no modelo global do passe em "meus cartoes". Alteracoes individuais de um `user_passes`, como pontos, validade individual ou scan de QR Code, continuam seguindo os fluxos especificos ja existentes.

## Objetivo

Antes, `update-pass` salvava o passe e, na mesma request HTTP, percorria todos os `user_passes` instalados para chamar `apple-push` e `google-push` em chunks. Isso funcionava para baixo volume, mas uma edicao de um passe com muitos clientes podia manter a Edge Function presa por muito tempo e gerar milhares de chamadas externas no clique do administrador.

Agora, `update-pass` salva a edicao global, incrementa uma revisao do passe e cria jobs persistentes para sincronizacao em background.

## Banco de dados

### `passes`

Novas colunas:

- `wallet_revision`: versao incremental do passe global.
- `wallet_updated_at`: timestamp da ultima alteracao global relevante para carteiras.

Cada edicao global incrementa `wallet_revision`.

### `pass_update_campaigns`

Representa uma campanha de sincronizacao criada por uma edicao global.

Campos principais:

- `project_id`
- `pass_id`
- `revision`
- `status`
- `total_jobs`
- `completed_jobs`
- `failed_jobs`
- `canceled_jobs`
- `metadata`

Status possiveis:

- `pending`
- `processing`
- `completed`
- `partial_failed`
- `failed`
- `canceled`

### `pass_update_jobs`

Representa uma unidade de trabalho processada em background.

Tipos de job:

- `apple_push`
- `google_class_patch`
- `google_object_patch`

O processamento usa `claim_pass_update_jobs(...)` com `for update skip locked`, evitando que dois workers processem o mesmo job ao mesmo tempo.

## Fluxo da edicao global

1. O administrador edita um passe.
2. O frontend chama `update-pass`.
3. `update-pass` valida permissao e billing.
4. O registro em `passes` e atualizado.
5. `wallet_revision` e incrementado.
6. Uma campanha e criada em `pass_update_campaigns`.
7. Jobs sao criados em `pass_update_jobs`.
8. A request retorna rapidamente ao painel.
9. `pass-updates-runner` processa os jobs em background.

O frontend agora mostra que a sincronizacao com carteiras esta em andamento, em vez de informar que todos os pushes foram enviados no clique.

## Google Wallet

### Novas instalacoes

`google-pass` agora cria a Google Wallet Class por passe, usando `pass_id` no sufixo:

```text
carteira49_{type}_pass_{pass_id}_v1
```

Antes, a Class era baseada em `project_id + type`, o que podia fazer varios passes do mesmo projeto/tipo compartilharem a mesma Class.

Com Class por passe, uma edicao global pode ser sincronizada com:

```text
PATCH loyaltyClass/{classId}
ou
PATCH genericClass/{classId}
```

Isso evita uma chamada por cliente quando a mudanca esta na Class.

### O que fica na Class

Campos globais/visuais:

- nome do emissor
- nome do programa para loyalty
- logo
- hero image
- cor de fundo
- locais do comerciante

### O que fica no Object

Campos individuais ou campos que o modelo Google exige no Object:

- `pass_token`
- QR Code individual
- pontos
- validade individual
- textos de objeto em passes generic

### Fallback legado

Passes Google ja emitidos antes desta mudanca podem ter `google_class_id` compartilhado por projeto/tipo. Nesses casos, o sistema nao faz PATCH direto na Class compartilhada, porque isso poderia afetar outros cartoes.

Para esses objetos antigos, `update-pass` cria jobs `google_object_patch` em background. Isso ainda pode gerar muitas chamadas, mas agora:

- nao bloqueia a request do admin;
- tem retry/backoff;
- tem status persistente;
- nao arrisca alterar outros passes.

## Apple Wallet

Apple Wallet nao tem uma Class compartilhada equivalente ao Google. Cada passe instalado tem seu proprio serial/token e precisa ser avisado via APNs.

Na edicao global:

1. `update-pass` incrementa `wallet_revision`.
2. Sao criados jobs `apple_push` para passes Apple instalados.
3. `pass-updates-runner` chama `apple-push` em background.
4. `apple-push` regenera o `.pkpass` e envia APNs para o dispositivo registrado.

O download Apple no `universal-link` passou a usar cache versionado por revisao:

```text
issued_users/{pass_id}/rev-{wallet_revision}/{pass_token}.pkpass
```

Assim, um cliente que abrir/baixar o passe depois de uma edicao global nao reutiliza um `.pkpass` antigo.

O `apple-push` tambem grava o `.pkpass` atualizado no caminho legado:

```text
issued_users/{pass_id}/{pass_token}.pkpass
```

Isso preserva compatibilidade com qualquer web service Apple que ainda leia o arquivo pelo caminho antigo, enquanto novos downloads usam o caminho versionado.

## Runner

Nova Edge Function:

```text
pass-updates-runner
```

Ela:

- busca jobs pendentes por RPC;
- recupera jobs presos em `processing` quando o lock vence;
- chama `apple-push` ou `google-push`;
- marca sucesso como `done`;
- reenvia falhas temporarias com backoff;
- marca como `failed` ao atingir `max_attempts`;
- atualiza o status agregado da campanha.

Backoff:

```text
1m, 5m, 15m, 1h, 6h
```

## Cron

A migration agenda `pass-updates-runner` para rodar a cada minuto via `pg_cron`/`net.http_post`.

O runner aceita:

- `x-cron-secret: <CRON_SECRET>`
- `Authorization: Bearer <CRON_SECRET>`
- `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`

Se `CRON_SECRET` nao estiver configurado, o runner continua exigindo `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.

## Arquivos principais

- `supabase/functions/update-pass/index.ts`
- `supabase/functions/pass-updates-runner/index.ts`
- `supabase/functions/apple-push/index.ts`
- `supabase/functions/google-pass/index.ts`
- `supabase/functions/google-push/index.ts`
- `supabase/functions/universal-link/index.ts`
- `supabase/migrations/20260617231908_pass_global_update_queue.sql`
- `frontend/src/components/superadmin/WalletConfigTab.jsx`

## Comportamento esperado

Para um passe novo com Google Class por `pass_id`, uma edicao global de branding/localizacao tende a gerar:

```text
Google: 1 job google_class_patch por classId
Apple: 1 job apple_push por passe Apple instalado
```

Para objetos Google legados com Class compartilhada:

```text
Google: 1 job google_object_patch por Object afetado
```

Esse fallback existe para preservar isolamento entre cartoes antigos.

## Referencias oficiais consultadas

- Google Wallet REST: `loyaltyClass.patch`
  - https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/patch
- Google Wallet REST: `genericClass.patch`
  - https://developers.google.com/wallet/reference/rest/v1/genericclass/patch
- Apple Wallet Passes: web service para atualizar passes
  - https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes
