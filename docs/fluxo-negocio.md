# Fluxo de Negocio do Allin Pass

## 1. Objetivo do processo de negocio

O Allin Pass operacionaliza programas de fidelidade digitais baseados em passes instalados em Apple Wallet e Google Wallet. O fluxo de negocio cobre:

- configuracao do projeto;
- emissao do passe;
- resgate pelo cliente final;
- contabilizacao de visitas e pontos;
- comunicacao com clientes;
- automacao de campanhas e acompanhamentos.

## 2. Atores do sistema

Os atores identificados no software sao:

- `superadmin`: configura projetos, membros, templates, wallet e notificacoes;
- `establishment`: opera o projeto no dia a dia;
- `customer`: usuario autenticado associado ao contexto de projeto;
- `cliente final`: pessoa que resgata e instala o passe publico;
- `processos agendados`: runners de notificacao e automacao.

## 3. Fluxo principal do negocio

### 3.1 Cadastro e configuracao de projeto

Responsavel: `superadmin`

Etapas:

1. criar ou editar um registro em `projects`;
2. definir `slug`, modo de autenticacao e metadados do projeto;
3. configurar `wallet_templates` e `wallet_configs`;
4. cadastrar `locations` para proximidade e relevancia geografica;
5. vincular membros do projeto em `project_members`.

Resultado:

- o projeto passa a ter configuracao suficiente para emitir passes e operar o programa de fidelidade.

## 4. Emissao do passe base

Responsavel: `superadmin` ou rotina administrativa do projeto

Etapas:

1. o frontend solicita a edge function `create_pass`;
2. a funcao recebe `project_id`, tipo, titulo, descricao e configuracoes visuais;
3. o backend consulta `wallet_templates` para completar defaults;
4. e gerado um identificador unico do passe;
5. e gerado um `short_code` publico para resgate;
6. o registro e salvo em `passes`;
7. a resposta devolve o link `qr_url` para uso publico.

Resultado:

- o passe fica disponivel para distribuicao por QR Code, link ou outro canal.

## 5. Resgate e instalacao pelo cliente final

Responsavel: `cliente final`

Etapas:

1. o cliente acessa `/claim/:c`;
2. realiza login com Google;
3. `ClaimCallback` chama `universal_link` com o codigo curto e o token autenticado;
4. o backend localiza o passe em `passes`;
5. identifica ou cria um `user_pass` vinculado a `device_key`;
6. registra dados de claim no metadata do passe individual;
7. detecta a plataforma de destino:
   - em dispositivos Apple, gera ou reaproveita um `.pkpass`;
   - em dispositivos nao Apple, gera um `saveUrl` do Google Wallet;
8. o usuario e redirecionado para concluir a instalacao.

Resultado:

- o cliente passa a ter uma instancia individual do passe em `user_passes`;
- o projeto ganha capacidade de rastrear uso, visitas, notificacoes e validade.

## 6. Operacao do programa de fidelidade

### 6.1 Leitura do QR Code no estabelecimento

Responsavel: `establishment`

Etapas:

1. o operador acessa o `ScannerTab`;
2. o QR do cliente e lido;
3. o frontend invoca `scanner-visit`;
4. a edge function valida:
   - sessao do operador;
   - projeto informado;
   - unicidade do token;
   - vinculo do passe ao projeto correto.

### 6.2 Protecao contra leitura duplicada

Se houver leitura muito recente do mesmo `user_pass`, o backend:

1. consulta `visits` para a ultima ocorrencia;
2. compara com a janela `SCAN_COOLDOWN_SECONDS`;
3. gera um `challenge` assinado via HMAC;
4. exige confirmacao explicita para nova contabilizacao.

Esse mecanismo reduz fraude operacional e leituras repetidas acidentais.

### 6.3 Atualizacao de pontos e validade

Apos validacao:

1. o sistema le `metadata.points` no `user_pass`;
2. verifica `expires_at`;
3. se o ciclo expirou, reinicia a pontuacao em 1 e renova a validade por 30 dias;
4. caso contrario, soma 1 ponto;
5. persiste o novo estado em `user_passes`.

Resultado:

- o passe individual e a fonte de verdade do saldo e do vencimento operacional.

## 7. Atualizacao do passe instalado

Depois da pontuacao, o backend tenta refletir a mudanca nas carteiras:

- para Apple, chama `apple-push`;
- para Google, chama `google-push` e `send-google-notification`.

Essas chamadas sao tratadas como nao bloqueantes para nao impedir a conclusao do atendimento presencial.

## 8. Gestao de clientes e historico

O sistema mantem informacoes de relacionamento por projeto em:

- `customers`;
- `events`;
- `visits`;
- `loyalty_states`.

Esses dados alimentam:

- listagens operacionais;
- dashboards;
- historico de interacao;
- segmentacao para notificacoes e automacoes.

## 9. Envio manual de notificacoes

Responsavel: `establishment`

Etapas:

1. o operador acessa `NotificationsDashboard`;
2. escolhe destinatarios, mensagem, canais e agendamento;
3. o frontend chama `notifications_enqueue`;
4. o backend valida o membro em `project_members`;
5. cria um registro em `notifications`;
6. localiza os `user_passes` elegiveis;
7. gera `notification_jobs` separados por plataforma;
8. aplica consumo de limite em `projects_notifications`.

Resultado:

- a mensagem nao e enviada diretamente; ela entra em fila para processamento controlado.

## 10. Processamento da fila de notificacoes

Responsavel: `notifications_runner`

Etapas:

1. o runner autentica a chamada por segredo de cron ou `service_role`;
2. executa RPC de captura atomica de jobs pendentes;
3. bloqueia os jobs para um `worker`;
4. identifica a plataforma do job;
5. chama `send-apple-notification` ou `send-google-notification`;
6. em caso de falha, reprograma com backoff progressivo;
7. ao final, consolida o status macro em `notifications`.

Estados de job suportados:

- `pending`;
- `processing`;
- `sent`;
- `failed`;
- `canceled`;
- `rate_limited`.

## 11. Automacoes

Responsavel: `superadmin` ou `establishment`, conforme permissao

O sistema suporta automacoes de negocio em `automations`, com tipos como:

- `points_wallet`;
- `expiring_soon`;
- `days_without_visit`.

Fluxo:

1. uma automacao e cadastrada por `create_automation`;
2. o runner `automations_runner` executa RPC de enfileiramento;
3. a base grava controles em `automation_dispatches`;
4. o resultado vira notificacao e, em seguida, jobs de entrega.

Resultado:

- o projeto consegue acionar clientes com base em comportamento ou estado do passe.

## 12. Dashboards e analitica

O sistema expoe indicadores por RPC e consultas especializadas, como:

- KPIs globais;
- KPIs por projeto;
- series temporais;
- analitica por periodo;
- listagens de clientes, membros, visitas e localizacoes.

Essas informacoes sustentam a tomada de decisao operacional dos estabelecimentos e da administracao central.

## 13. Entidades centrais do fluxo de negocio

As tabelas mais relevantes para o fluxo operacional sao:

- `projects`;
- `wallet_templates`;
- `wallet_configs`;
- `passes`;
- `user_passes`;
- `customers`;
- `visits`;
- `events`;
- `notifications`;
- `notification_jobs`;
- `automations`;
- `automation_dispatches`;
- `locations`.

## 14. Diagrama textual resumido

```text
Superadmin configura projeto -> projeto recebe template, membros e credenciais wallet
Projeto emite passe -> create_pass grava em passes e gera short_code
Cliente acessa link -> faz login Google -> universal_link cria user_pass
Carteira recebe passe -> Apple pkpass ou Google saveUrl
Estabelecimento escaneia QR -> scanner valida -> soma ponto -> renova validade se preciso
Sistema envia atualizacao para wallet
Operador envia notificacao manual ou automacao gera campanha
notifications_enqueue cria jobs
notifications_runner consome fila e entrega por plataforma
```

## 15. Caracteristicas funcionais distintivas

O fluxo de negocio evidencia caracteristicas tecnicas e operacionais proprias:

- emissao multicanal de um mesmo passe para ecossistemas Apple e Google;
- resgate publico autenticado com vinculacao posterior a dispositivo e usuario;
- modelo de fidelidade baseado em pontos e validade renovavel;
- anti-replay em scanner presencial;
- fila de notificacoes com segmentacao e limites por projeto;
- automacoes de relacionamento baseadas em estado do passe e comportamento do cliente.

## 16. Conclusao

O Allin Pass implementa um fluxo de negocio completo para programas de fidelidade digitais, integrando cadastro, emissao, claim, operacao presencial, CRM e comunicacao automatizada. O conjunto de regras descrito demonstra organizacao logica propria, com estruturas de dados e processos tecnicos suficientemente definidos para documentacao de registro no INPI.
