# Arquitetura do Aplicativo Allin Pass

## 1. Finalidade do software

O Allin Pass e uma plataforma web para criacao, distribuicao e operacao de passes digitais de fidelidade, com suporte a Apple Wallet e Google Wallet. O sistema atende dois perfis principais:

- administradores globais, responsaveis pela configuracao da plataforma e dos projetos;
- operadores de estabelecimentos, responsaveis pela emissao de passes, acompanhamento de clientes, leitura de QR Codes, acumulacao de pontos e disparo de notificacoes.

O software tambem oferece um fluxo publico para que o cliente final resgate seu passe e o adicione a sua carteira digital.

## 2. Visao geral da arquitetura

O sistema adota arquitetura web em tres camadas:

1. camada de apresentacao em `React + Vite`;
2. camada de servicos e regras de negocio em `Supabase Edge Functions` executadas em ambiente `Deno`;
3. camada de persistencia em `PostgreSQL`, com apoio de `Supabase Auth` e `Supabase Storage`.

## 3. Componentes principais

### 3.1 Frontend

O frontend esta localizado em `hash/frontend` e utiliza:

- `React` para construcao das telas;
- `React Router` para roteamento publico e protegido;
- `Supabase JS` para autenticacao, chamadas de banco e invocacao de edge functions;
- componentes modulares para dashboards administrativo e operacional.

Estrutura funcional do frontend:

- `src/App.jsx`: define as rotas publicas e protegidas;
- `src/contexts/SupabaseAuthContext.jsx`: controla sessao, papel do usuario e redirecionamentos;
- `src/layouts/ProtectedLayout.jsx`: protege rotas de acordo com o papel;
- `src/pages/*`: paginas de login, callback de autenticacao, dashboards, resgate de passe e telas publicas;
- `src/components/superadmin/*`: operacoes de administracao global;
- `src/components/restaurant/*`: operacoes do estabelecimento, incluindo scanner, QR, KPIs e notificacoes;
- `src/lib/*`: funcoes de acesso a API, autenticacao, claim, QR scanner e integracoes auxiliares.

### 3.2 Backend de servicos

O backend esta localizado em `hash/backend/supabase` e implementa funcoes de dominio e integracao. Entre as funcoes principais:

- `create_pass.ts`: cria o registro base do passe, gera `short_code` e link publico de resgate;
- `universal_link.ts`: resolve o link universal do passe, identifica plataforma, cria ou reaproveita `user_passes` e redireciona para Apple Wallet ou Google Wallet;
- `apple_pass.ts`: gera arquivo `.pkpass` com certificados, layout e geolocalizacao;
- `google_pass.ts`: monta objetos e classes do Google Wallet e produz o `saveUrl`;
- `scanner.ts`: valida leitura de QR, aplica anti-replay, atualiza pontos e validade, e aciona notificacoes nao bloqueantes;
- `create_automation.ts`: cadastra automacoes de notificacao por projeto;
- `notifications_enqueue.ts`: cria notificacao e enfileira jobs por plataforma;
- `notifications_runner.ts`: consome a fila, aplica retentativas e finaliza status macro da notificacao;
- `apple_notification.ts` e `google_notificatoin.ts`: entregam mensagens para as carteiras digitais;
- `automations_runner.ts`: transforma regras automaticas em notificacoes enfileiradas;
- `geocode.ts`: auxilia o cadastro de locais;
- `create_automation.ts`, `notifications_enqueue.ts` e `scanner.ts`: concentram regras operacionais dos estabelecimentos.

### 3.3 Banco de dados

O esquema relacional esta registrado em `hash/database/schema.sql`. A modelagem concentra:

- identidade e autorizacao;
- definicao de projetos;
- configuracao visual e tecnica dos passes;
- emissao e ciclo de vida dos passes individuais;
- clientes, visitas e estados de fidelidade;
- localizacoes, notificacoes, automacoes e filas de processamento.

## 4. Dominios funcionais

### 4.1 Identidade e autorizacao

Entidades principais:

- `profiles`: define o papel do usuario (`superadmin`, `establishment`, `customer`);
- `project_members`: vincula usuarios a projetos com papel operacional;
- `orgs` e `org_members`: suporte organizacional complementar;
- `auth.users`: identidade base gerenciada pelo Supabase Auth.

### 4.2 Projetos e configuracao de wallet

Entidades principais:

- `projects`: unidade central de operacao, contendo nome, slug, modo de autenticacao e configuracoes de template;
- `wallet_configs`: configuracoes de integracao com Apple e Google Wallet;
- `wallet_templates`: defaults de layout e estrutura de dados dos passes;
- `wallet_configs_history`: historico de alteracoes de configuracao;
- `locations`: pontos geograficos usados para proximidade e relevancia do passe.

### 4.3 Passes e instalacoes

Entidades principais:

- `passes`: modelo emitido para um projeto, com design, campos, QR publico e codigos curtos;
- `user_passes`: instancia individual do passe por dispositivo ou usuario, contendo token, status de instalacao, validade, metadados e referencias das carteiras;
- `passkit_registrations`: vinculo entre passe Apple e dispositivo para push;
- `wallet_links`: associacao entre cliente e objetos emitidos nas carteiras.

### 4.4 CRM, visitas e fidelidade

Entidades principais:

- `customers`: cadastro do cliente por projeto, com status do passe e vinculo ao `user_pass`;
- `visits`: eventos de leitura/entrada contabilizados pelo scanner;
- `events`: trilha de eventos de negocio;
- `loyalty_states`: estado de fidelidade e pontuacao por ciclo.

### 4.5 Comunicacao e automacao

Entidades principais:

- `notifications`: campanha ou disparo manual/agendado;
- `notification_jobs`: fila atomica por plataforma e por passe;
- `automations`: regras automaticas do projeto;
- `automation_dispatches`: controle de execucao para evitar duplicidade;
- `projects_notifications`: cotas e limites de envio.

## 5. Fluxo arquitetural de ponta a ponta

### 5.1 Emissao e resgate de passe

1. O administrador configura projeto, template e credenciais de carteira.
2. A edge function `create_pass` grava o passe base na tabela `passes`.
3. O sistema gera um `short_code` e um link publico `/claim/:c`.
4. O cliente acessa o link, autentica-se via Google e chega a `ClaimCallback`.
5. A pagina chama `universal_link`.
6. A funcao identifica ou cria um `user_pass`, associa dispositivo e usuario, e escolhe a carteira destino.
7. Para Apple, o sistema gera ou reaproveita o `.pkpass`.
8. Para Google, o sistema gera o `saveUrl` via JWT e Wallet Objects API.

### 5.2 Operacao de fidelidade

1. O estabelecimento le o QR do cliente pelo `ScannerTab`.
2. O frontend invoca `scanner-visit`.
3. A funcao valida o usuario operador, o projeto e o token do passe.
4. O backend verifica tentativas repetidas em janela curta e pode exigir confirmacao assinada por HMAC.
5. A pontuacao e incrementada em `user_passes.metadata`.
6. A validade do passe e recalculada quando necessario.
7. O backend tenta atualizar Apple Wallet e Google Wallet com informacoes novas.

### 5.3 Notificacoes

1. O operador cria uma mensagem manual ou agenda um envio.
2. `notifications_enqueue` valida autorizacao do membro do projeto.
3. O sistema cria um registro em `notifications`.
4. Para cada passe elegivel e plataforma compativel, sao criados `notification_jobs`.
5. `notifications_runner` consome a fila com bloqueio de jobs, backoff e idempotencia.
6. As funcoes especificas por plataforma executam o disparo e atualizam o status final.

## 6. Regras de separacao por camadas

### 6.1 Camada cliente

Responsabilidades:

- interface grafica;
- navegacao;
- coleta de dados do usuario;
- inicio dos fluxos de autenticacao;
- invocacao controlada de RPCs e edge functions.

Nao concentra regras sensiveis de assinatura, emissao ou credenciais de fornecedores externos.

### 6.2 Camada de servicos

Responsabilidades:

- validacao de contexto autenticado;
- aplicacao das regras de negocio;
- emissao de passes;
- integracao com carteiras digitais;
- orquestracao de notificacoes;
- protecao contra uso indevido e duplicidade de eventos.

### 6.3 Camada de persistencia

Responsabilidades:

- armazenamento relacional de entidades de dominio;
- historico de operacoes e filas;
- registro de instalacoes e dispositivos;
- armazenamento de ativos publicos em `Supabase Storage`.

## 7. Integracoes externas

O software integra-se com os seguintes servicos:

- `Supabase Auth`: autenticacao e sessao;
- `Supabase Postgres`: persistencia relacional;
- `Supabase Storage`: armazenamento de imagens e arquivos de passe;
- `Apple Wallet / PassKit`: emissao, download, instalacao e push de passes;
- `Google Wallet Objects API`: criacao de classes/objetos e envio de mensagens;
- `Google OAuth`: autenticacao do cliente no fluxo de resgate;
- servico de geocodificacao: apoio ao cadastro de locais.

## 8. Mecanismos tecnicos relevantes

Os principais mecanismos proprietarios observados no software sao:

- emissao unificada de passes para Apple e Google a partir de um mesmo modelo de projeto;
- uso de `short_code` para resgate publico com resolucao dinamica de plataforma;
- persistencia por `device_key` para evitar duplicacao indevida de instalacoes;
- uso de HMAC e janela de expiracao para confirmacao de nova leitura em scanner;
- fila de notificacoes por plataforma com `idempotency_key`, retentativa e consolidacao de status;
- enriquecimento progressivo de `user_passes.metadata` com dados operacionais e de claim.

## 9. Consideracoes para documentacao tecnica do registro

Para fins de registro de programa de computador, esta arquitetura demonstra que o Allin Pass nao se resume a uma interface web simples. O sistema implementa:

- modelo proprio de dominios para projetos, passes, clientes, visitas e notificacoes;
- mecanismos especificos de emissao multicarteira;
- controle de autenticacao e autorizacao por papel;
- filas e automacoes para comunicacao operacional;
- tratamento de geolocalizacao, validade, pontos e anti-replay.

Esses elementos definem a estrutura funcional e tecnica do software registrado.
