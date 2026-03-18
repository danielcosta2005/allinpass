# Fluxo de Autenticacao e Controle de Acesso

## 1. Objetivo

Este documento descreve como o Allin Pass autentica usuarios, estabelece sessoes, identifica papeis e protege o acesso a funcoes administrativas, operacionais e publicas.

## 2. Componentes envolvidos

Os elementos principais do fluxo de autenticacao sao:

- `frontend/src/contexts/SupabaseAuthContext.jsx`;
- `frontend/src/layouts/ProtectedLayout.jsx`;
- `frontend/src/pages/Login.jsx`;
- `frontend/src/pages/AuthCallback.jsx`;
- `frontend/src/pages/WalletClaimCard.jsx`;
- `frontend/src/pages/ClaimCallback.jsx`;
- `frontend/src/lib/supabaseClient.js`;
- tabela `profiles`;
- tabela `project_members`;
- servico `Supabase Auth`.

## 3. Modos de autenticacao existentes

O software opera com dois modos principais:

### 3.1 Login administrativo por email e senha

Utilizado por:

- `superadmin`;
- `establishment`;
- eventualmente usuarios internos classificados como `customer` com acesso autenticado.

Fluxo:

1. O usuario acessa `/login`.
2. A pagina chama `signIn(email, password)` no `SupabaseAuthContext`.
3. A autenticacao e realizada por `supabase.auth.signInWithPassword`.
4. Em caso de sucesso, o listener `onAuthStateChange` e disparado.
5. O contexto busca o papel do usuario em `profiles`.
6. Se o papel for `establishment`, o sistema tambem consulta `project_members` para obter o `project_id`.
7. Com base no papel, o usuario e redirecionado para `/admin`, `/org` ou `/nao-autorizado`.

### 3.2 Login publico com Google para resgate de passe

Utilizado pelo cliente final no fluxo `/claim/:c`.

Fluxo:

1. O usuario acessa o link publico do passe.
2. A tela `WalletClaimCard` inicia `supabase.auth.signInWithOAuth` com o provedor Google.
3. O retorno ocorre em `/claim/callback?c=<codigo>`.
4. A pagina `ClaimCallback` recupera a sessao ou o `access_token`.
5. O token autenticado e enviado para a edge function `universal-link`.
6. A funcao identifica o usuario autenticado e vincula o resgate ao `user_pass`.
7. O usuario e redirecionado para a carteira digital adequada.

## 4. Resolucao de identidade

### 4.1 Sessao

O cliente Supabase e inicializado com:

- `persistSession: true`;
- `autoRefreshToken: true`;
- `detectSessionInUrl: true`.

Isso permite:

- manter a sessao local no navegador;
- capturar o retorno de OAuth;
- renovar tokens automaticamente quando possivel.

### 4.2 Papel do usuario

A identidade autenticada por si so nao libera acesso. O sistema executa uma segunda etapa:

1. consulta da tabela `profiles` usando o `id` do usuario autenticado;
2. validacao do papel dentro do conjunto permitido;
3. em caso de papel `establishment`, consulta adicional em `project_members`.

Papeis aceitos:

- `superadmin`;
- `establishment`;
- `customer`.

Se o perfil nao existir ou o papel for invalido, o sistema marca o usuario como `unauthorized`.

## 5. Protecao de rotas

As rotas do aplicativo sao separadas em publicas e protegidas.

### 5.1 Rotas publicas

- `/login`;
- `/auth/callback`;
- `/claim/:c`;
- `/claim/callback`;
- `/me`;
- `/c/:projectId/me`;
- `/:slug`;
- `/thanks`;
- `/nao-autorizado`.

### 5.2 Rotas protegidas

- `/`;
- `/admin`;
- `/org`.

O componente `ProtectedLayout` aplica as seguintes regras:

- bloqueia acesso sem sessao;
- aguarda a resolucao do papel antes de decidir o redirecionamento;
- permite `/admin` somente para `superadmin`;
- permite `/org` para `establishment` e `customer`;
- redireciona perfis invalidos para `/nao-autorizado`.

## 6. Controle de estado da sessao

O `SupabaseAuthContext` mantem os estados:

- `user`;
- `session`;
- `role`;
- `projectId`;
- `loading`;
- `initialized`.

A estrategia e importante porque o sistema precisa:

- evitar redirecionamentos prematuros enquanto o papel ainda nao foi resolvido;
- preservar contexto do projeto para usuarios operacionais;
- reagir a mudancas de sessao sem recarregar a aplicacao inteira.

## 7. Tratamento de expiracao e falhas de refresh

O software implementa protecao adicional para quedas temporarias de refresh de token:

- armazena contador transitorio em `sessionStorage`;
- tolera falhas breves quando o navegador esta offline;
- encerra a sessao apos repetidas falhas dentro de uma janela temporal;
- remove estado local e storage do Supabase em `forceLogout`.

Essa estrategia reduz inconsistencias entre sessao local, token expirado e interface.

## 8. Logout

O encerramento de sessao segue um fluxo robusto:

1. consulta da sessao corrente;
2. verificacao se vale a pena chamar logout no servidor;
3. limpeza forcada do storage local do Supabase;
4. limpeza dos estados internos do contexto;
5. limpeza de estados de interface salvos em `sessionStorage`;
6. redirecionamento para `/login`.

O sistema evita chamadas concorrentes de logout usando `logoutInFlightRef`.

## 9. Autenticacao no backend

As edge functions adotam dois modelos:

### 9.1 Funcoes com contexto do usuario

Exemplos:

- `create_automation`;
- `notifications_enqueue`;
- `scanner`.

Nelas, o backend:

1. recebe o `Authorization Bearer`;
2. instancia um cliente Supabase com a chave publica;
3. valida o usuario por `auth.getUser()`;
4. consulta as tabelas de autorizacao do projeto antes de executar a regra de negocio.

### 9.2 Funcoes privilegiadas

Exemplos:

- `create_pass`;
- `universal_link`;
- `apple_pass`;
- `google_pass`;
- `notifications_runner`;
- `automations_runner`.

Nessas funcoes, o backend utiliza `SUPABASE_SERVICE_ROLE_KEY` para:

- operar sobre tabelas sensiveis;
- gravar filas;
- criar instancias de passe;
- chamar APIs externas;
- executar tarefas de processamento agendado.

## 10. Vinculo entre autenticacao e resgate de passe

O fluxo de resgate publico possui uma caracteristica arquitetural relevante:

- a identidade autenticada via Google e aproveitada para enriquecer o `user_pass`;
- o software grava no metadata informacoes de `user_id`, `email`, `name`, `google_sub` e `claimed_at`;
- o `device_key` serve para vincular o passe ao dispositivo ou navegador;
- isso evita gerar instalacoes duplicadas para o mesmo dispositivo em chamadas subsequentes.

## 11. Diagrama resumido do fluxo administrativo

```text
Usuario -> /login
Frontend -> Supabase Auth (email/senha)
Supabase Auth -> Frontend (sessao)
Frontend -> profiles
Frontend -> project_members (quando establishment)
Frontend -> redireciona /admin ou /org
ProtectedLayout -> valida papel a cada rota protegida
```

## 12. Diagrama resumido do fluxo publico de claim

```text
Cliente -> /claim/:c
Frontend -> Google OAuth via Supabase
Google/Supabase -> /claim/callback?c=...
ClaimCallback -> recupera access_token
ClaimCallback -> universal-link
universal-link -> identifica usuario autenticado
universal-link -> cria ou reaproveita user_pass
universal-link -> redireciona para Apple Wallet ou Google Wallet
```

## 13. Conclusao tecnica

O fluxo de autenticacao do Allin Pass combina:

- autenticacao centralizada via Supabase Auth;
- autorizacao propria por papel e por projeto;
- separacao entre login administrativo e resgate publico;
- protecao de sessao, tratamento de expiracao e limpeza local;
- propagacao segura do contexto autenticado para edge functions.

Esse modelo confirma que o software possui camada de controle de acesso e regras de identidade proprias, indo alem de um uso trivial de login padrao.
