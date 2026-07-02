# Convites de Admins e Membros

## Objetivo

Esta implementacao substitui a criacao manual de usuarios com senha ficticia por um fluxo de convite por email. O novo modelo cobre dois mundos de acesso:

- acesso administrativo global: `admin` e `superadmin`;
- acesso operacional de restaurante/projeto: `owner`/Gestor e `staff`/Funcionario.

O convidado recebe um link por email, abre a tela de convite, define a propria senha e so entao o sistema ativa o perfil correto e aplica a permissao escolhida.

## Resumo do Que Mudou

Foi criada uma camada persistente de convites em `public.user_invitations`, com status, validade, papel solicitado, escopo e dados de aceite. A feature tambem ajusta permississoes de membros, admins e recompensas para que a autorizacao exista no backend, nao apenas na interface.

Principais mudancas:

- superadmin convida `admin` e `superadmin` por email;
- superadmin convida membros para qualquer projeto;
- gestor de restaurante convida membros apenas do proprio projeto;
- funcionario nao ve nem consegue usar a criacao de membros;
- funcionario nao cria, ativa ou desativa recompensas;
- admin comum ve a aba de admins, mas nao pode adicionar/editar/remover;
- convites podem ser reenviados enquanto nao foram aceitos;
- convites expirados continuam visiveis para reenvio;
- o mesmo email nao pode ser convidado simultaneamente como login admin e login restaurante;
- convite de membro de projeto exige que o email nao esteja vinculado a nenhum outro projeto;
- o mesmo email nao pode manter convites de membro pendentes/expirados em projetos diferentes;
- emails existentes apenas em `customers` continuam elegiveis para convite;
- links reenviados invalidam links anteriores por meio de `metadata.nonce`.

## Banco de Dados e RLS

As migrations adicionadas foram:

```text
supabase/migrations/20260702145149_invitations_rbac_rewards.sql
supabase/migrations/20260702181202_enforce_single_project_member_account.sql
```

Ela cria a tabela `public.user_invitations` com os campos principais:

- `email`;
- `invite_type`: `admin` ou `project_member`;
- `role`: `admin`, `superadmin`, `owner` ou `staff`;
- `project_id`, quando o convite e de membro;
- `invited_user_id`;
- `status`: `invited`, `active`, `expired` ou `cancelled`;
- `invited_by`, `accepted_by`;
- `expires_at`, `last_sent_at`, `accepted_at`;
- `metadata`, usado atualmente para guardar o `nonce` do link vigente.

Tambem foram adicionados indices para evitar duplicidade logica de convites pendentes por email e escopo. A migration complementar reforca que um mesmo `user_id` nao pode receber novos vinculos duplicados em `project_members`, impedindo que um login de restaurante seja vinculado a mais de um projeto. Ela aplica essa trava por trigger e cria o indice unico `project_members_single_project_per_user_idx` apenas em ambientes que nao tenham duplicidades legadas. Ela tambem troca a unicidade de convite de membro para ser global por email enquanto o convite estiver `invited` ou `expired`.

### `fn_list_members`

A RPC `public.fn_list_members(uuid)` foi recriada para retornar tanto membros ativos quanto convites pendentes/expirados. A tela de membros passa a usar um unico endpoint de leitura para exibir:

- `user_id`;
- `email`;
- `role`;
- `created_at`;
- `status`;
- `invitation_id`;
- `expires_at`.

### Rewards

As policies de escrita de `rewards` foram ajustadas para restringir criacao, update e delete a:

- `superadmin`;
- `project_members.role = owner`.

Com isso, `staff` continua podendo visualizar e usar fluxos permitidos, mas nao consegue criar recompensa nem ativar/desativar recompensas existentes.

## Helper Compartilhado de Edge Functions

Foi criado:

```text
supabase/functions/_shared/adminAccess.ts
```

Esse helper centraliza a parte comum das funcoes administrativas:

- CORS;
- respostas JSON;
- classe `HttpError`;
- criacao do client com `SUPABASE_SERVICE_ROLE_KEY`;
- validacao do usuario autenticado via bearer token;
- leitura de `profiles.role`;
- checagem de superadmin;
- checagem de permissao para gerenciar membros de projeto;
- busca de usuario do Auth por email;
- leitura de profile por user id;
- deteccao de membership de projeto;
- montagem da URL de convite;
- envio do email de convite;
- fallback para magic link quando o usuario ja existe no Auth;
- marcacao de falha de envio.

As Edge Functions que importam esse helper sao:

- `admin-accept-invitation`;
- `admin-create-member`;
- `admin-remove-member`;
- `admin-resend-invitation`;
- `admin-update-member`;
- `superadmin-create-admin`;
- `superadmin-list-admins`;
- `superadmin-remove-admin`;
- `superadmin-update-admin`.

## Edge Functions Alteradas e Criadas

### `superadmin-create-admin`

Antes, essa function criava admin com email e senha. Agora ela cria ou atualiza um convite administrativo.

Responsabilidades atuais:

- exige caller `superadmin`;
- aceita `email` e `role`;
- permite `role = admin` ou `role = superadmin`;
- bloqueia email que ja seja login de restaurante;
- bloqueia email que tenha convite de restaurante pendente/expirado;
- se o usuario ja for `admin` ou `superadmin`, atualiza o papel em vez de duplicar;
- cria ou reaproveita convite pendente/expirado;
- gera `nonce`, validade de 24h e envia email;
- em falha de envio, cancela o convite.

### `superadmin-list-admins`

Agora pode ser chamada por `admin` e `superadmin`.

Responsabilidades atuais:

- lista admins/superadmins ativos;
- lista convites administrativos pendentes ou expirados;
- calcula status `active`, `invited` ou `expired`;
- traz projetos vinculados ao admin quando aplicavel;
- retorna `canManageAdmins` para indicar se o caller e superadmin.

### `superadmin-update-admin`

Nova function para editar permissao administrativa.

Responsabilidades:

- exige caller `superadmin`;
- aceita `adminId` ou `invitationId`;
- altera papel de admin ativo;
- altera papel de convite administrativo pendente/expirado;
- permite alternar entre `admin` e `superadmin`.

### `superadmin-remove-admin`

Foi ajustada para remover admin ativo ou cancelar convite administrativo.

Responsabilidades atuais:

- exige caller `superadmin`;
- bloqueia remover o proprio acesso;
- remove profile ativo `admin`/`superadmin`;
- cancela convite administrativo `invited` ou `expired`.

### `admin-create-member`

Antes, o fluxo aceitava senha. Agora cria convite de membro por email.

Responsabilidades atuais:

- exige `projectId`, `email` e `role`;
- permite `role = owner` ou `role = staff`;
- autoriza `superadmin` para qualquer projeto;
- autoriza `owner` apenas no proprio projeto;
- bloqueia email que ja seja login administrativo;
- bloqueia email que tenha convite administrativo pendente/expirado;
- bloqueia email que ja tenha login de restaurante ou membership em qualquer projeto;
- bloqueia email que tenha convite de membro pendente/expirado em outro projeto;
- permite email que exista apenas em `customers`;
- cria/reaproveita convite pendente/expirado apenas quando o email nao possui conta operacional na Allin Pass;
- gera `nonce`, validade de 24h e envia email;
- preserva a logica legada de provisionamento de billing free trial do projeto.

### `admin-update-member`

Foi ajustada para editar membros ativos ou convites.

Responsabilidades atuais:

- autoriza `superadmin` ou `owner` do projeto;
- aceita `memberId` ou `invitationId`;
- altera `project_members.role` para membro ativo;
- altera `user_invitations.role` para convite pendente/expirado.

### `admin-remove-member`

Foi ajustada para remover membro ativo ou cancelar convite de membro.

Responsabilidades atuais:

- autoriza `superadmin` ou `owner` do projeto;
- bloqueia remover o proprio acesso ao projeto;
- remove linha de `project_members`;
- cancela convite de membro `invited` ou `expired`.

### `admin-resend-invitation`

Nova function para reenviar convite pendente/expirado.

Responsabilidades:

- recebe `invitationId`;
- valida se o convite existe e ainda nao foi aceito/cancelado;
- se o convite for admin, exige caller `superadmin`;
- se o convite for membro, exige `superadmin` ou `owner` do projeto;
- gera novo `nonce`;
- renova `expires_at` para mais 24h;
- marca status como `invited`;
- envia novo link por magic link;
- invalida links antigos porque o aceite compara o `nonce` do link com o `metadata.nonce` salvo.

### `admin-accept-invitation`

Nova function chamada pela tela `/convite`.

Responsabilidades:

- exige usuario autenticado pelo link recebido;
- aceita `invitationId`, `nonce` e opcionalmente `validateOnly`;
- valida se o email autenticado e o mesmo email do convite;
- valida se o `invited_user_id`, quando existente, bate com o usuario autenticado;
- rejeita convite expirado;
- rejeita link antigo quando o `nonce` nao bate;
- no modo `validateOnly`, apenas confirma que o convite ainda e valido;
- no aceite real, cria/atualiza `profiles`;
- em convite admin, ativa `profiles.role = admin` ou `superadmin`;
- em convite de membro, revalida que o usuario ainda nao pertence a nenhum projeto, ativa `profiles.role = establishment` e faz upsert em `project_members`;
- marca o convite como `active`;
- retorna o destino final: `/admin` ou `/org`;
- trata aceite repetido pelo mesmo usuario como sucesso idempotente.

## Fluxo de Aceite no Frontend

O link de convite cai em:

```text
/auth/callback?flow=invite&invitationId=...&nonce=...
```

O `AuthCallback` detecta `flow=invite` ou `type=invite` e redireciona para:

```text
/convite?invitationId=...&nonce=...
```

A pagina `InviteAccept.jsx`:

1. valida se ha sessao autenticada;
2. pede uma senha forte;
3. chama `admin-accept-invitation` com `validateOnly = true`;
4. se o convite ainda for valido, chama `supabase.auth.updateUser({ password })`;
5. chama `admin-accept-invitation` novamente para ativar perfil/permissao;
6. atualiza o profile no contexto de auth;
7. redireciona para `/admin` ou `/org`.

O `SupabaseAuthContext` foi ajustado para nao redirecionar automaticamente usuarios em `/convite` antes do aceite terminar.

## Mudancas de UI

### Aba Admins

Arquivo principal:

```text
frontend/src/components/superadmin/AdminTab.jsx
```

Mudancas:

- remove senha ficticia do formulario;
- adiciona escolha de papel `Admin` ou `Superadmin`;
- exibe status `Ativo`, `Convidado` ou `Expirado`;
- permite reenvio de convite;
- permite edicao de papel;
- permite remocao/cancelamento;
- esconde todas as acoes para `admin` comum;
- mantem leitura da aba para `admin` e `superadmin`.

### Aba Membros

Arquivo principal:

```text
frontend/src/components/superadmin/MembersTab.jsx
```

Mudancas:

- remove senha ficticia do formulario;
- cria membro por email + papel;
- exibe membros ativos e convites na mesma tabela;
- permite reenvio de convite;
- permite edicao de papel em membro ativo ou convite;
- permite remover membro ou cancelar convite;
- recebe `canManageMembers` para controlar exibicao de acoes.

### Dashboard Admin

Arquivo principal:

```text
frontend/src/pages/SuperadminDashboard.jsx
```

Mudancas:

- `admin` comum passa a ver aba `Admins`;
- somente `superadmin` consegue gerenciar admins;
- `superadmin` pode gerenciar membros de qualquer projeto;
- admin comum visualiza membros/clientes do projeto quando permitido, mas nao gerencia membros via essa tela.

### Dashboard Restaurante

Arquivo principal:

```text
frontend/src/pages/RestaurantDashboard.jsx
```

Mudancas:

- passa `canManageMembers={memberRole === 'owner'}`;
- passa `canManageRewards={memberRole === 'owner'}`.

### Recompensas

Arquivo principal:

```text
frontend/src/components/restaurant/RewardsTab.jsx
```

Mudancas:

- funcionario nao ve botao de criar recompensa;
- funcionario nao ve toggle de ativar/desativar;
- funcoes locais de criar e alternar status tambem retornam sem executar quando `canManageRewards = false`;
- backend/RLS tambem bloqueia a escrita.

## Regras de Permissao Consolidadas

| Papel | Pode convidar admin | Pode ver admins | Pode convidar membro | Pode editar membro | Pode criar/ativar reward |
|---|---:|---:|---:|---:|---:|
| `superadmin` | Sim | Sim | Sim, qualquer projeto | Sim, qualquer projeto | Sim |
| `admin` | Nao | Sim | Nao pelo fluxo de membros | Nao pelo fluxo de membros | Conforme regras de admin/projeto existentes |
| `owner` | Nao | Nao | Sim, proprio projeto | Sim, proprio projeto | Sim |
| `staff` | Nao | Nao | Nao | Nao | Nao |

## Estados de Convite

| Status | Significado |
|---|---|
| `invited` | Convite enviado e ainda nao aceito. |
| `expired` | Convite vencido. Continua aparecendo para permitir reenvio/cancelamento. |
| `active` | Convite aceito e acesso ativado. |
| `cancelled` | Convite cancelado por usuario autorizado ou falha de envio. |

## Deploy Realizado

As Edge Functions alteradas/criadas foram deployadas no projeto:

```text
tjagxmusbnbipeeitsyi
```

Functions deployadas:

- `admin-accept-invitation`;
- `admin-create-member`;
- `admin-remove-member`;
- `admin-resend-invitation`;
- `admin-update-member`;
- `superadmin-create-admin`;
- `superadmin-list-admins`;
- `superadmin-remove-admin`;
- `superadmin-update-admin`.

O helper `_shared/adminAccess.ts` nao e deployado como function independente; ele e incluido no bundle das functions que importam esse arquivo.

## Pontos de Atencao

- A migration precisa estar aplicada no banco remoto para o fluxo funcionar, porque as functions dependem de `user_invitations` e da nova assinatura de `fn_list_members`.
- A migration complementar `20260702181202_enforce_single_project_member_account.sql` precisa estar aplicada para o banco tambem impedir novos memberships duplicados entre projetos.
- No banco remoto atual foram encontrados dois usuarios com memberships legados em mais de um projeto; enquanto esses dados nao forem consolidados, a migration aplica a trava por trigger, mas pula o indice unico definitivo em `project_members(user_id)`.
- O envio de email depende do Supabase Auth estar com redirect URLs permitindo a base usada em `APP_BASE_URL` ou `SITE_URL`.
- Convites enviados para usuarios ja existentes no Auth usam fallback por magic link.
- O fluxo nao usa `user_metadata` para autorizacao; as permissoes efetivas continuam em `profiles` e `project_members`.
- Como as functions usam `SUPABASE_SERVICE_ROLE_KEY`, toda autorizacao e validada manualmente antes de qualquer escrita sensivel.

## Validacoes Executadas

Foram executadas as seguintes validacoes locais:

```text
npm run build
deno check supabase/functions/_shared/adminAccess.ts ...
git diff --check
```

Resultado:

- build do frontend passou;
- typecheck das Edge Functions alteradas passou;
- checagem de whitespace passou.
- `supabase db push --linked --dry-run` indicou apenas a migration complementar pendente;
- `supabase db push --linked` aplicou a migration complementar no remoto;
- consultas remotas confirmaram a trigger `trg_project_members_single_project_per_user` e o indice `user_invitations_pending_project_member_email_idx`;
- o indice unico `project_members_single_project_per_user_idx` foi pulado no remoto porque existem dois usuarios com memberships legados em multiplos projetos.
